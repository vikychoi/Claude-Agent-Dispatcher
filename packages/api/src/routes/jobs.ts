import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import {
  QUEUE_NAME,
  DEFAULT_CLAUDE_CONFIG,
  THINKING_EFFORTS,
  encrypt,
  decrypt,
} from '@taskshed/shared';
import type {
  CreateJobRequest,
  Job,
  LogLine,
  Skill,
  McpServer,
  McpServerSnapshot,
  ThinkingEffort,
} from '@taskshed/shared';
import { query } from '../db.js';
import { config } from '../config.js';
import { DEFAULT_FILE_SIZE_LIMIT_MB, DEFAULT_ARTIFACT_DEPTH_LIMIT } from './settings.js';

export function createJobsRouter(redis: Redis) {
  const router = Router();
  const jobQueue = new Queue(QUEUE_NAME, { connection: redis.duplicate() });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10000 * 1024 * 1024 } });

  router.post('/', upload.array('files'), async (req, res) => {
    const body = (req.body.data ? JSON.parse(req.body.data as string) : req.body) as CreateJobRequest;
    if (!body.prompt) {
      res.status(400).json({ error: 'Prompt is required', code: 'VALIDATION_ERROR' });
      return;
    }

    const claudeConfig = {
      model: (body.claude_config?.model ?? DEFAULT_CLAUDE_CONFIG.model) as string,
      thinkingEffort: body.claude_config?.thinkingEffort as ThinkingEffort | undefined,
    };

    if (!claudeConfig.model || typeof claudeConfig.model !== 'string') {
      res.status(400).json({ error: 'Model is required', code: 'VALIDATION_ERROR' });
      return;
    }
    if (claudeConfig.thinkingEffort && !THINKING_EFFORTS.includes(claudeConfig.thinkingEffort)) {
      res.status(400).json({ error: `Invalid thinking effort: ${claudeConfig.thinkingEffort}`, code: 'VALIDATION_ERROR' });
      return;
    }

    const autoContinueCount = typeof body.auto_continue_count === 'number' && body.auto_continue_count >= 1 && body.auto_continue_count <= 50
      ? Math.floor(body.auto_continue_count) : undefined;
    const autoContinuePrompt = autoContinueCount && typeof body.auto_continue_prompt === 'string' && body.auto_continue_prompt.trim()
      ? body.auto_continue_prompt.trim() : undefined;

    const configToStore: Record<string, unknown> = { model: claudeConfig.model };
    if (claudeConfig.thinkingEffort) configToStore.thinkingEffort = claudeConfig.thinkingEffort;
    if (autoContinueCount) configToStore.autoContinueCount = autoContinueCount;
    if (autoContinuePrompt) configToStore.autoContinuePrompt = autoContinuePrompt;

    let scheduledFor: string | null = null;
    if (body.scheduled_for) {
      const parsed = new Date(body.scheduled_for);
      if (isNaN(parsed.getTime())) {
        res.status(400).json({ error: 'Invalid scheduled_for date', code: 'VALIDATION_ERROR' });
        return;
      }
      scheduledFor = parsed.toISOString();
    } else if (typeof body.delay_minutes === 'number' && body.delay_minutes > 0) {
      scheduledFor = new Date(Date.now() + Math.floor(body.delay_minutes) * 60000).toISOString();
    }

    let skillsSnapshot: Array<{ id: string; name: string; content: string }> = [];
    if (body.skill_ids?.length) {
      const placeholders = body.skill_ids.map((_, i) => `$${i + 1}`).join(',');
      const skillsResult = await query<Skill>(
        `SELECT id, name, content FROM skills WHERE id IN (${placeholders})`,
        body.skill_ids
      );
      skillsSnapshot = skillsResult.rows.map(s => ({ id: s.id, name: s.name, content: s.content }));
    }

    let mcpSnapshot: McpServerSnapshot[] = [];
    if (body.mcp_server_ids?.length) {
      const placeholders = body.mcp_server_ids.map((_, i) => `$${i + 1}`).join(',');
      const mcpResult = await query<McpServer>(
        `SELECT * FROM mcp_servers WHERE id IN (${placeholders})`,
        body.mcp_server_ids
      );
      mcpSnapshot = mcpResult.rows.map(s => {
        const decryptedEnv: Record<string, string> = {};
        for (const [key, value] of Object.entries(s.env)) {
          decryptedEnv[key] = decrypt(value, config.secretKey);
        }
        return {
          id: s.id,
          name: s.name,
          type: s.type,
          command: s.command,
          args: s.args,
          env: decryptedEnv,
          url: s.url,
          oauth_access_token: s.oauth_access_token
            ? decrypt(s.oauth_access_token, config.secretKey)
            : undefined,
        };
      });
    }

    const mcpSnapshotToStore = mcpSnapshot.length > 0
      ? encrypt(JSON.stringify(mcpSnapshot), config.secretKey)
      : '';

    const result = await query<Job>(
      `INSERT INTO jobs (prompt, claude_md, claude_config, job_skills_snapshot, job_mcp_snapshot, scheduled_for)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6) RETURNING *`,
      [
        body.prompt,
        body.claude_md || '',
        JSON.stringify(configToStore),
        JSON.stringify(skillsSnapshot),
        mcpSnapshotToStore,
        scheduledFor,
      ]
    );

    const job = result.rows[0];

    const uploadedFiles = (req.files as Express.Multer.File[] | undefined) || [];
    if (uploadedFiles.length > 0) {
      const limitResult = await query<{ value: string }>(`SELECT value FROM settings WHERE key = 'file_size_limit'`);
      const limitMb = limitResult.rows.length > 0 ? parseInt(limitResult.rows[0].value, 10) : DEFAULT_FILE_SIZE_LIMIT_MB;
      const limitBytes = limitMb * 1024 * 1024;
      for (const file of uploadedFiles) {
        if (file.size > limitBytes) {
          res.status(400).json({ error: `File "${file.originalname}" (${(file.size / 1024 / 1024).toFixed(1)} MB) exceeds the ${limitMb} MB limit`, code: 'FILE_TOO_LARGE' });
          return;
        }
      }
      const inputDir = path.join(config.jobDataDir, job.id, 'input', 'files');
      fs.mkdirSync(inputDir, { recursive: true });
      for (const file of uploadedFiles) {
        fs.writeFileSync(path.join(inputDir, file.originalname), file.buffer);
      }
    }

    const delay = scheduledFor ? Math.max(0, new Date(scheduledFor).getTime() - Date.now()) : 0;
    await jobQueue.add('process-job', { jobId: job.id }, delay > 0 ? { delay } : {});
    res.status(201).json(job);
  });

  router.get('/', async (_req, res) => {
    const result = await query<Job>('SELECT * FROM jobs ORDER BY created_at DESC');
    res.json(result.rows);
  });

  router.get('/activity', async (_req, res) => {
    const runningJobs = await query<{ id: string }>(`SELECT id FROM jobs WHERE status = 'running'`);
    const activities: Record<string, string> = {};
    for (const job of runningJobs.rows) {
      const state = await redis.get(`job:${job.id}:activity:state`);
      if (state) activities[job.id] = state;
    }
    res.json(activities);
  });

  router.get('/:id', async (req, res) => {
    const result = await query<Job>('SELECT * FROM jobs WHERE id = $1', [req.params['id']]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Job not found', code: 'NOT_FOUND' });
      return;
    }
    res.json(result.rows[0]);
  });

  router.get('/:id/logs', async (req, res) => {
    const result = await query<LogLine>(
      'SELECT * FROM job_logs WHERE job_id = $1 ORDER BY created_at, id',
      [req.params['id']]
    );
    res.json(result.rows);
  });

  router.post('/:id/prompt', async (req, res) => {
    const jobResult = await query<Job>('SELECT status FROM jobs WHERE id = $1', [req.params['id']]);
    if (jobResult.rows.length === 0) {
      res.status(404).json({ error: 'Job not found', code: 'NOT_FOUND' });
      return;
    }
    if (jobResult.rows[0].status !== 'running') {
      res.status(409).json({ error: 'Job is not running', code: 'NOT_RUNNING' });
      return;
    }
    const { prompt } = req.body as { prompt: string };
    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required', code: 'VALIDATION_ERROR' });
      return;
    }
    const logEntry = {
      job_id: req.params['id'],
      source: 'stdin',
      line: prompt,
      created_at: new Date().toISOString(),
    };
    await query(
      'INSERT INTO job_logs (job_id, source, line) VALUES ($1, $2, $3)',
      [req.params['id'], 'stdin', prompt]
    );
    await redis.publish(`job:${req.params['id']}:logs`, JSON.stringify(logEntry));
    await redis.publish(`job:${req.params['id']}:control`, JSON.stringify({ type: 'prompt', prompt }));
    res.json({ sent: true });
  });

  router.post('/:id/terminate', async (req, res) => {
    const jobResult = await query<Job>('SELECT status FROM jobs WHERE id = $1', [req.params['id']]);
    if (jobResult.rows.length === 0) {
      res.status(404).json({ error: 'Job not found', code: 'NOT_FOUND' });
      return;
    }
    if (jobResult.rows[0].status !== 'running') {
      res.status(409).json({ error: 'Job is not running', code: 'NOT_RUNNING' });
      return;
    }
    await redis.publish(`job:${req.params['id']}:control`, JSON.stringify({ type: 'terminate' }));
    res.json({ terminated: true });
  });

  router.post('/:id/restart', async (req, res) => {
    const original = await query<Job>('SELECT * FROM jobs WHERE id = $1', [req.params['id']]);
    if (original.rows.length === 0) {
      res.status(404).json({ error: 'Job not found', code: 'NOT_FOUND' });
      return;
    }
    const orig = original.rows[0];
    if (orig.status === 'running' || orig.status === 'queued') {
      res.status(409).json({ error: 'Job is still active', code: 'CONFLICT' });
      return;
    }

    const result = await query<Job>(
      `INSERT INTO jobs (prompt, claude_md, claude_config, job_skills_snapshot, job_mcp_snapshot)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5) RETURNING *`,
      [
        orig.prompt,
        orig.claude_md,
        JSON.stringify(orig.claude_config),
        JSON.stringify(orig.job_skills_snapshot),
        typeof orig.job_mcp_snapshot === 'string' ? orig.job_mcp_snapshot : '',
      ]
    );
    const newJob = result.rows[0];

    const origFilesDir = path.join(config.jobDataDir, orig.id, 'input', 'files');
    if (fs.existsSync(origFilesDir)) {
      const newFilesDir = path.join(config.jobDataDir, newJob.id, 'input', 'files');
      fs.mkdirSync(newFilesDir, { recursive: true });
      for (const file of fs.readdirSync(origFilesDir)) {
        fs.copyFileSync(path.join(origFilesDir, file), path.join(newFilesDir, file));
      }
    }

    await jobQueue.add('process-job', { jobId: newJob.id });
    res.status(201).json(newJob);
  });

  router.delete('/:id', async (req, res) => {
    const jobResult = await query<Job>('SELECT status FROM jobs WHERE id = $1', [req.params['id']]);
    if (jobResult.rows.length === 0) {
      res.status(404).json({ error: 'Job not found', code: 'NOT_FOUND' });
      return;
    }
    if (jobResult.rows[0].status === 'running') {
      res.status(409).json({ error: 'Terminate the job before deleting', code: 'CONFLICT' });
      return;
    }
    await query('DELETE FROM job_logs WHERE job_id = $1', [req.params['id']]);
    await query('DELETE FROM jobs WHERE id = $1', [req.params['id']]);
    const jobDir = path.join(config.jobDataDir, req.params['id']!);
    if (fs.existsSync(jobDir)) {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
    res.status(204).end();
  });

  const SKIP_DIRS = new Set(['input', 'node_modules', '.git', '.claude', '.npm', '__pycache__']);
  const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db']);

  function listFilesRecursive(dir: string, base: string, maxDepth: number, currentDepth = 0): Array<{ path: string; size: number; createdAt: string }> {
    const results: Array<{ path: string; size: number; createdAt: string }> = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      if (SKIP_FILES.has(entry.name)) continue;
      const rel = base ? `${base}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (currentDepth < maxDepth) {
          results.push(...listFilesRecursive(full, rel, maxDepth, currentDepth + 1));
        }
      } else {
        try {
          const stat = fs.statSync(full);
          results.push({ path: rel, size: stat.size, createdAt: stat.birthtime.toISOString() });
        } catch {
          // Skip broken symlinks or inaccessible files
        }
      }
    }
    return results;
  }

  router.get('/:id/files', async (req, res) => {
    const depthResult = await query<{ value: string }>(`SELECT value FROM settings WHERE key = 'artifact_depth_limit'`);
    const maxDepth = depthResult.rows.length > 0 ? parseInt(depthResult.rows[0].value, 10) : DEFAULT_ARTIFACT_DEPTH_LIMIT;
    const workspaceDir = path.join(config.jobDataDir, req.params['id']!, 'workspace');
    const files = listFilesRecursive(workspaceDir, '', maxDepth);
    res.json(files);
  });

  router.get('/:id/files/*', async (req, res) => {
    const wildcard = (req.params as unknown as Record<string, string>)['0'] || '';
    const filePath = path.join(config.jobDataDir, req.params['id']!, 'workspace', wildcard);
    const resolved = path.resolve(filePath);
    const jobDir = path.resolve(config.jobDataDir, req.params['id']!, 'workspace');
    if (!resolved.startsWith(jobDir)) {
      res.status(400).json({ error: 'Invalid path', code: 'INVALID_PATH' });
      return;
    }
    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      res.status(404).json({ error: 'File not found', code: 'NOT_FOUND' });
      return;
    }
    res.download(resolved);
  });

  return router;
}
