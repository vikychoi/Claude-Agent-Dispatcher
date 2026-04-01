import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import Docker from 'dockerode';
import Redis from 'ioredis';
import { decrypt } from '@taskshed/shared';
import type { Job, AuthConfig, McpServerSnapshot } from '@taskshed/shared';
import { config } from './config.js';
import { query } from './db.js';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const stdinHandles = new Map<string, NodeJS.WritableStream>();

function parseMemoryLimit(limit: string): number {
  const match = limit.match(/^(\d+)([gmk]?)$/i);
  if (!match) return 2 * 1024 * 1024 * 1024;
  const num = parseInt(match[1], 10);
  const unit = (match[2] || '').toLowerCase();
  if (unit === 'g') return num * 1024 * 1024 * 1024;
  if (unit === 'm') return num * 1024 * 1024;
  if (unit === 'k') return num * 1024;
  return num;
}

async function getAuthConfig(): Promise<AuthConfig> {
  const result = await query<{ value: string }>(`SELECT value FROM settings WHERE key = 'auth'`);
  if (result.rows.length === 0) {
    throw new Error('No auth credential configured. Visit /settings to set up authentication.');
  }
  return JSON.parse(decrypt(result.rows[0].value, config.secretKey));
}

function decodeMcpSnapshot(raw: unknown): McpServerSnapshot[] {
  if (typeof raw === 'string' && raw.length > 0) {
    return JSON.parse(decrypt(raw, config.secretKey));
  }
  if (Array.isArray(raw)) {
    return raw;
  }
  return [];
}

function prepareJobDirs(jobId: string, job: Job, mcpServers: McpServerSnapshot[]): void {
  const inputDir = path.join(config.jobDataDir, jobId, 'input');
  const workspaceDir = path.join(config.jobDataDir, jobId, 'workspace');
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.chownSync(workspaceDir, 1001, 1001);

  if (job.claude_md) {
    fs.writeFileSync(path.join(inputDir, 'CLAUDE.md'), job.claude_md);
  }

  if (job.job_skills_snapshot.length > 0) {
    const skillsDir = path.join(inputDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    for (const skill of job.job_skills_snapshot) {
      fs.writeFileSync(path.join(skillsDir, `${skill.name}.md`), skill.content);
    }
  }

  if (mcpServers.length > 0) {
    const mcpConfig: Record<string, Record<string, unknown>> = {};
    for (const server of mcpServers) {
      if (server.type === 'stdio') {
        mcpConfig[server.name] = {
          type: 'stdio',
          command: server.command,
          args: server.args,
          env: server.env,
        };
      } else {
        const serverConfig: Record<string, unknown> = {
          type: 'sse',
          url: server.url,
          env: server.env,
        };
        if (server.oauth_access_token) {
          serverConfig['headers'] = { Authorization: `Bearer ${server.oauth_access_token}` };
        }
        mcpConfig[server.name] = serverConfig;
      }
    }
    fs.writeFileSync(path.join(inputDir, 'mcp_config.json'), JSON.stringify({ mcpServers: mcpConfig }, null, 2));
  }
}

export async function processJob(jobId: string, redis: Redis): Promise<void> {
  const auth = await getAuthConfig();

  const jobResult = await query<Job>('SELECT * FROM jobs WHERE id = $1', [jobId]);
  if (jobResult.rows.length === 0) throw new Error(`Job ${jobId} not found`);
  const job = jobResult.rows[0];

  const mcpServers = decodeMcpSnapshot(job.job_mcp_snapshot);
  prepareJobDirs(jobId, job, mcpServers);

  await query(`UPDATE jobs SET status = 'running', started_at = NOW() WHERE id = $1`, [jobId]);
  await redis.publish(`job:${jobId}:status`, JSON.stringify({ status: 'running' }));

  const env: string[] = [
    `INITIAL_PROMPT=${job.prompt}`,
    `JOB_ID=${jobId}`,
    'IS_SANDBOX=1',
    `CLAUDE_MODEL=${job.claude_config.model}`,
  ];

  if (auth.mode === 'api_key') {
    env.push(`ANTHROPIC_API_KEY=${auth.credential}`);
  } else {
    const credentialsPath = path.join(config.jobDataDir, jobId, 'input', '.credentials.json');
    fs.writeFileSync(credentialsPath, auth.credential);
  }

  if (job.claude_config.thinkingEffort) {
    env.push(`CLAUDE_THINKING_EFFORT=${job.claude_config.thinkingEffort}`);
  }

  if (job.claude_config.autoContinueCount) {
    env.push(`AUTO_CONTINUE_COUNT=${job.claude_config.autoContinueCount}`);
    env.push(`AUTO_CONTINUE_PROMPT=${job.claude_config.autoContinuePrompt || 'continue'}`);
  }

  const hostWorkspaceBind = `${config.hostJobDataDir}/${jobId}/workspace:/workspace:rw`;
  const hostInputBind = `${config.hostJobDataDir}/${jobId}/input:/workspace/input:ro`;

  const container = await docker.createContainer({
    Image: config.agentImageTag,
    Env: env,
    Labels: { job_id: jobId },
    HostConfig: {
      Binds: [hostWorkspaceBind, hostInputBind],
      Memory: parseMemoryLimit(config.containerMemoryLimit),
      CpuQuota: config.containerCpuQuota,
    },
    OpenStdin: true,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await container.attach({ stream: true, stdin: true, stdout: true, stderr: true });
  stdinHandles.set(jobId, stream);

  let terminated = false;

  const sub = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  await sub.subscribe(`job:${jobId}:control`);
  sub.on('message', (_channel: string, message: string) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'prompt') {
        redis.set(`job:${jobId}:activity:state`, 'working');
        redis.publish(`job:${jobId}:activity`, JSON.stringify({ state: 'working', turn: turnCount }));
        const stdinStream = stdinHandles.get(jobId);
        if (stdinStream) {
          stdinStream.write(data.prompt + '\n');
        }
      } else if (data.type === 'terminate') {
        terminated = true;
        container.kill().catch(() => {});
      }
    } catch (err) {
      console.error(`Error handling control message for job ${jobId}:`, err);
    }
  });

  await container.start();
  redis.set(`job:${jobId}:activity:state`, 'working');
  redis.publish(`job:${jobId}:activity`, JSON.stringify({ state: 'working' }));

  const stdout = new PassThrough();
  const stderr = new PassThrough();
  docker.modem.demuxStream(stream, stdout, stderr);

  const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');

  const emitLog = (source: 'stdout' | 'stderr', line: string) => {
    const cleaned = stripAnsi(line);
    if (!cleaned) return;
    const logEntry = { job_id: jobId, source, line: cleaned, created_at: new Date().toISOString() };
    query(
      'INSERT INTO job_logs (job_id, source, line) VALUES ($1, $2, $3)',
      [jobId, source, cleaned]
    ).then(() =>
      redis.publish(`job:${jobId}:logs`, JSON.stringify(logEntry))
    ).catch(err => {
      console.error(`Failed to log for job ${jobId}:`, err);
    });
  };

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let turnCount = 0;

  const publishTokens = () => {
    const payload = JSON.stringify({ input_tokens: totalInputTokens, output_tokens: totalOutputTokens });
    redis.publish(`job:${jobId}:tokens`, payload);
    query('UPDATE jobs SET input_tokens = $2, output_tokens = $3 WHERE id = $1',
      [jobId, totalInputTokens, totalOutputTokens]).catch(() => {});
  };

  const processStdoutLine = (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    try {
      const event = JSON.parse(line);
      if (event.type === 'assistant' && event.message) {
        if (event.message.usage) {
          totalInputTokens += event.message.usage.input_tokens || 0;
          totalOutputTokens += event.message.usage.output_tokens || 0;
          totalInputTokens += event.message.usage.cache_creation_input_tokens || 0;
          totalInputTokens += event.message.usage.cache_read_input_tokens || 0;
          publishTokens();
        }
        if (Array.isArray(event.message.content)) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              for (const textLine of block.text.split('\n')) {
                emitLog('stdout', textLine);
              }
            } else if (block.type === 'tool_use') {
              emitLog('stdout', `[${block.name}] ${typeof block.input === 'string' ? block.input : JSON.stringify(block.input)}`);
            }
          }
        }
      } else if (event.type === 'result') {
        const cost = event.total_cost_usd ?? event.cost_usd;
        if (cost !== undefined) {
          totalCostUsd += Number(cost);
          emitLog('stdout', `Cost: $${totalCostUsd.toFixed(4)} | Turns: ${event.num_turns ?? '-'}`);
          redis.publish(`job:${jobId}:cost`, JSON.stringify({ cost_usd: totalCostUsd }));
          query('UPDATE jobs SET cost_usd = $2 WHERE id = $1', [jobId, totalCostUsd]).catch(() => {});
        }
        turnCount++;
        redis.set(`job:${jobId}:activity:state`, 'idle');
        redis.publish(`job:${jobId}:activity`, JSON.stringify({ state: 'idle', turn: turnCount }));
      }
    } catch {
      emitLog('stdout', raw);
    }
  };

  const processLineStream = (source: 'stdout' | 'stderr', readable: NodeJS.ReadableStream) => {
    let buffer = '';
    const handler = source === 'stdout' ? processStdoutLine : (line: string) => emitLog('stderr', line);
    readable.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        handler(line);
      }
    });
    readable.on('end', () => {
      if (buffer.length > 0) {
        handler(buffer);
        buffer = '';
      }
    });
  };

  processLineStream('stdout', stdout);
  processLineStream('stderr', stderr);

  try {
    const { StatusCode } = await container.wait();
    if (terminated || StatusCode === 0) {
      await query(`UPDATE jobs SET status = 'terminated', finished_at = NOW() WHERE id = $1`, [jobId]);
      await redis.publish(`job:${jobId}:status`, JSON.stringify({ status: 'terminated' }));
    } else {
      await query(`UPDATE jobs SET status = 'failed', error = $2, finished_at = NOW() WHERE id = $1`, [jobId, `Container exited with code ${StatusCode}`]);
      await redis.publish(`job:${jobId}:status`, JSON.stringify({ status: 'failed', error: `Container exited with code ${StatusCode}` }));
    }
  } finally {
    stdinHandles.delete(jobId);
    try { await redis.del(`job:${jobId}:activity:state`); } catch {}
    try { await sub.unsubscribe(); } catch {}
    sub.disconnect();
    try { await container.remove({ force: true }); } catch {}
  }
}

export async function reconcileOrphanedContainers(): Promise<void> {
  const containers = await docker.listContainers({ all: true, filters: { label: ['job_id'] } });
  for (const containerInfo of containers) {
    const jobId = containerInfo.Labels['job_id'];
    if (!jobId) continue;
    const result = await query<{ status: string }>('SELECT status FROM jobs WHERE id = $1', [jobId]);
    if (result.rows.length > 0 && result.rows[0].status === 'running') {
      console.log(`Reconciling orphaned container for job ${jobId}`);
      const container = docker.getContainer(containerInfo.Id);
      try { await container.kill(); } catch {}
      try { await container.remove({ force: true }); } catch {}
      await query(`UPDATE jobs SET status = 'failed', error = 'Orphaned container from previous crash', finished_at = NOW() WHERE id = $1`, [jobId]);
    }
  }
}
