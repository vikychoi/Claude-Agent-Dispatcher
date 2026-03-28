import { Router } from 'express';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { encrypt, decrypt } from '@taskshed/shared';
import type { McpServer, McpTestResult, TestMcpServerRequest, OAuthMetadata } from '@taskshed/shared';
import Redis from 'ioredis';
import { query } from '../db.js';
import { config } from '../config.js';

function maskEnv(env: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const key of Object.keys(env)) {
    masked[key] = '***';
  }
  return masked;
}

function encryptEnvValues(env: Record<string, string>): Record<string, string> {
  const encrypted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    encrypted[key] = encrypt(value, config.secretKey);
  }
  return encrypted;
}

function decryptEnvValues(env: Record<string, string>): Record<string, string> {
  const decrypted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    decrypted[key] = decrypt(value, config.secretKey);
  }
  return decrypted;
}

function sanitizeServer(server: McpServer): Record<string, unknown> {
  const { oauth_access_token, oauth_refresh_token, ...rest } = server;
  return {
    ...rest,
    env: maskEnv(server.env),
    has_oauth_token: Boolean(oauth_access_token),
  };
}

function jsonRpcRequest(id: number, method: string, params: Record<string, unknown> = {}) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

async function testStdioConnection(
  command: string,
  args: string[],
  env: Record<string, string>
): Promise<McpTestResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ success: false, error: 'Connection timed out after 10 seconds' });
    }, 10000);

    const proc = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buffer = '';
    let initResult: Record<string, unknown> | null = null;

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: `Failed to spawn: ${err.message}` });
    });

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            initResult = msg.result;
            proc.stdin.write(jsonRpcRequest(2, 'tools/list') + '\n');
          } else if (msg.id === 2 && msg.result) {
            clearTimeout(timeout);
            proc.kill();
            resolve({
              success: true,
              serverInfo: initResult ? {
                name: (initResult as Record<string, Record<string, string>>).serverInfo?.name || 'Unknown',
                version: (initResult as Record<string, Record<string, string>>).serverInfo?.version || 'Unknown',
                protocolVersion: (initResult as Record<string, string>).protocolVersion,
              } : undefined,
              tools: (msg.result as Record<string, unknown[]>).tools as McpTestResult['tools'] || [],
            });
          } else if (msg.error) {
            clearTimeout(timeout);
            proc.kill();
            resolve({ success: false, error: msg.error.message || 'JSON-RPC error' });
          }
        } catch {
          // partial or non-JSON line, skip
        }
      }
    });

    proc.stderr.on('data', () => { /* ignore stderr logging */ });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (!initResult) {
        resolve({ success: false, error: `Process exited with code ${code} before responding` });
      }
    });

    proc.stdin.write(jsonRpcRequest(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'taskshed', version: '1.0.0' },
    }) + '\n');
  });
}

function parseSSEResponse(text: string): unknown[] {
  const messages: unknown[] = [];
  for (const block of text.split('\n\n')) {
    for (const line of block.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          messages.push(JSON.parse(line.slice(6)));
        } catch { /* skip */ }
      }
    }
  }
  return messages;
}

async function testHttpConnection(
  url: string,
  accessToken?: string
): Promise<McpTestResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-06-18',
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let initRes: Response;
  try {
    initRes = await fetch(url, {
      method: 'POST',
      headers,
      body: jsonRpcRequest(1, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'taskshed', version: '1.0.0' },
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    return { success: false, error: `Connection failed: ${(err as Error).message}` };
  }

  if (initRes.status === 401) {
    return discoverAuthFromResponse(initRes, url);
  }

  if (!initRes.ok) {
    return { success: false, error: `HTTP ${initRes.status}: ${initRes.statusText}` };
  }

  let initResult: Record<string, unknown>;
  const contentType = initRes.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    const messages = parseSSEResponse(await initRes.text());
    initResult = (messages.find((m: unknown) => (m as Record<string, unknown>).id === 1) as Record<string, Record<string, unknown>>)?.result as Record<string, unknown> || {};
  } else {
    const json = await initRes.json() as Record<string, unknown>;
    initResult = (json.result as Record<string, unknown>) || {};
  }

  let toolsRes: Response;
  try {
    toolsRes = await fetch(url, {
      method: 'POST',
      headers,
      body: jsonRpcRequest(2, 'tools/list'),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    return { success: false, error: `tools/list failed: ${(err as Error).message}` };
  }

  let toolsResult: Record<string, unknown>;
  const toolsContentType = toolsRes.headers.get('content-type') || '';
  if (toolsContentType.includes('text/event-stream')) {
    const messages = parseSSEResponse(await toolsRes.text());
    toolsResult = (messages.find((m: unknown) => (m as Record<string, unknown>).id === 2) as Record<string, Record<string, unknown>>)?.result as Record<string, unknown> || {};
  } else {
    const json = await toolsRes.json() as Record<string, unknown>;
    toolsResult = (json.result as Record<string, unknown>) || {};
  }

  const serverInfo = initResult.serverInfo as Record<string, string> | undefined;
  return {
    success: true,
    serverInfo: serverInfo ? {
      name: serverInfo.name || 'Unknown',
      version: serverInfo.version || 'Unknown',
      protocolVersion: initResult.protocolVersion as string,
    } : undefined,
    tools: (toolsResult.tools as McpTestResult['tools']) || [],
  };
}

async function discoverAuthFromResponse(res: Response, serverUrl: string): Promise<McpTestResult> {
  const wwwAuth = res.headers.get('www-authenticate') || '';
  const resourceMetadataMatch = wwwAuth.match(/resource_metadata="([^"]+)"/);

  let resourceMetadataUrl: string;
  if (resourceMetadataMatch) {
    resourceMetadataUrl = resourceMetadataMatch[1];
  } else {
    const parsed = new URL(serverUrl);
    resourceMetadataUrl = `${parsed.origin}/.well-known/oauth-protected-resource`;
  }

  try {
    const rmRes = await fetch(resourceMetadataUrl, { signal: AbortSignal.timeout(5000) });
    if (!rmRes.ok) {
      return { success: false, authRequired: true, error: 'Authentication required but could not discover authorization server' };
    }
    const rmData = await rmRes.json() as { authorization_servers?: string[] };
    const authServer = rmData.authorization_servers?.[0];
    if (!authServer) {
      return { success: false, authRequired: true, error: 'Authentication required but no authorization server found in resource metadata' };
    }

    const asMeta = await discoverAuthServerMetadata(authServer);
    return {
      success: false,
      authRequired: true,
      authServerUrl: authServer,
      registrationEndpoint: asMeta?.['registration_endpoint'] as string | undefined,
    };
  } catch {
    return { success: false, authRequired: true, error: 'Authentication required but metadata discovery failed' };
  }
}

async function discoverAuthServerMetadata(authServer: string): Promise<Record<string, unknown> | null> {
  const parsed = new URL(authServer);
  const candidates = parsed.pathname && parsed.pathname !== '/'
    ? [
        `${parsed.origin}/.well-known/oauth-authorization-server${parsed.pathname}`,
        `${parsed.origin}/.well-known/openid-configuration${parsed.pathname}`,
      ]
    : [
        `${parsed.origin}/.well-known/oauth-authorization-server`,
        `${parsed.origin}/.well-known/openid-configuration`,
      ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return await res.json() as Record<string, unknown>;
    } catch { /* try next */ }
  }
  return null;
}

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function createMcpServersRouter(redis: Redis): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const result = await query<McpServer>('SELECT * FROM mcp_servers ORDER BY name');
    res.json(result.rows.map(sanitizeServer));
  });

  router.post('/', async (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (!body.name || !body.type) {
      res.status(400).json({ error: 'Name and type are required', code: 'VALIDATION_ERROR' });
      return;
    }
    if (body.type === 'stdio' && !body.command) {
      res.status(400).json({ error: 'Command is required for stdio type', code: 'VALIDATION_ERROR' });
      return;
    }
    if (body.type === 'sse' && !body.url) {
      res.status(400).json({ error: 'URL is required for sse type', code: 'VALIDATION_ERROR' });
      return;
    }
    const env = (body.env || {}) as Record<string, string>;
    const encryptedEnv = Object.keys(env).length ? encryptEnvValues(env) : {};
    const result = await query<McpServer>(
      `INSERT INTO mcp_servers (name, type, command, args, env, url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [body.name, body.type, body.command || null, JSON.stringify(body.args || []), JSON.stringify(encryptedEnv), body.url || null]
    );
    res.status(201).json(sanitizeServer(result.rows[0]));
  });

  router.get('/:id', async (req, res) => {
    const result = await query<McpServer>('SELECT * FROM mcp_servers WHERE id = $1', [req.params['id']]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'MCP server not found', code: 'NOT_FOUND' });
      return;
    }
    res.json(sanitizeServer(result.rows[0]));
  });

  router.put('/:id', async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const existing = await query<McpServer>('SELECT * FROM mcp_servers WHERE id = $1', [req.params['id']]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'MCP server not found', code: 'NOT_FOUND' });
      return;
    }
    const current = existing.rows[0];
    let envToStore = current.env;
    if (body.env) {
      const merged = { ...current.env };
      for (const [key, value] of Object.entries(body.env as Record<string, string>)) {
        merged[key] = encrypt(value, config.secretKey);
      }
      envToStore = merged;
    }
    const result = await query<McpServer>(
      `UPDATE mcp_servers SET name = $1, type = $2, command = $3, args = $4, env = $5, url = $6, updated_at = NOW() WHERE id = $7 RETURNING *`,
      [
        (body.name as string) ?? current.name,
        (body.type as string) ?? current.type,
        (body.command as string) ?? current.command,
        JSON.stringify(body.args ?? current.args),
        JSON.stringify(envToStore),
        (body.url as string) ?? current.url,
        req.params['id'],
      ]
    );
    res.json(sanitizeServer(result.rows[0]));
  });

  router.delete('/:id', async (req, res) => {
    const running = await query(
      `SELECT 1 FROM jobs WHERE status = 'running' AND job_mcp_snapshot LIKE '%' || $1 || '%'`,
      [req.params['id']]
    );
    if (running.rows.length > 0) {
      res.status(409).json({ error: 'MCP server is referenced by a running job', code: 'CONFLICT' });
      return;
    }
    await query('DELETE FROM mcp_servers WHERE id = $1', [req.params['id']]);
    res.status(204).end();
  });

  // --- Connection Testing ---

  router.post('/test', async (req, res) => {
    const body = req.body as TestMcpServerRequest;
    let result: McpTestResult;
    if (body.type === 'stdio') {
      if (!body.command) {
        res.status(400).json({ error: 'Command is required', code: 'VALIDATION_ERROR' });
        return;
      }
      result = await testStdioConnection(body.command, body.args || [], body.env || {});
    } else {
      if (!body.url) {
        res.status(400).json({ error: 'URL is required', code: 'VALIDATION_ERROR' });
        return;
      }
      result = await testHttpConnection(body.url);
    }
    res.json(result);
  });

  router.post('/:id/test', async (req, res) => {
    const serverResult = await query<McpServer>('SELECT * FROM mcp_servers WHERE id = $1', [req.params['id']]);
    if (serverResult.rows.length === 0) {
      res.status(404).json({ error: 'MCP server not found', code: 'NOT_FOUND' });
      return;
    }
    const server = serverResult.rows[0];
    const env = decryptEnvValues(server.env);
    let result: McpTestResult;
    if (server.type === 'stdio') {
      result = await testStdioConnection(server.command!, server.args, env);
    } else {
      const token = server.oauth_access_token ? decrypt(server.oauth_access_token, config.secretKey) : undefined;
      result = await testHttpConnection(server.url!, token);
    }
    res.json(result);
  });

  // --- OAuth Flow ---

  router.post('/:id/auth/start', async (req, res) => {
    const serverResult = await query<McpServer>('SELECT * FROM mcp_servers WHERE id = $1', [req.params['id']]);
    if (serverResult.rows.length === 0) {
      res.status(404).json({ error: 'MCP server not found', code: 'NOT_FOUND' });
      return;
    }
    const server = serverResult.rows[0];
    if (server.type !== 'sse' || !server.url) {
      res.status(400).json({ error: 'OAuth is only supported for HTTP/SSE servers', code: 'INVALID_TYPE' });
      return;
    }

    const parsed = new URL(server.url);
    const resourceMetadataUrl = `${parsed.origin}/.well-known/oauth-protected-resource`;

    let rmData: { resource?: string; authorization_servers?: string[] };
    try {
      const rmRes = await fetch(resourceMetadataUrl, { signal: AbortSignal.timeout(5000) });
      if (!rmRes.ok) throw new Error(`HTTP ${rmRes.status}`);
      rmData = await rmRes.json() as typeof rmData;
    } catch (err) {
      res.status(502).json({ error: `Resource metadata discovery failed: ${(err as Error).message}`, code: 'DISCOVERY_FAILED' });
      return;
    }

    const authServer = rmData.authorization_servers?.[0];
    if (!authServer) {
      res.status(502).json({ error: 'No authorization server found in resource metadata', code: 'NO_AUTH_SERVER' });
      return;
    }

    const asMeta = await discoverAuthServerMetadata(authServer);
    if (!asMeta || !asMeta['authorization_endpoint'] || !asMeta['token_endpoint']) {
      res.status(502).json({ error: 'Auth server metadata missing required endpoints', code: 'INVALID_METADATA' });
      return;
    }

    const redirectUri = `${config.apiBaseUrl}/mcp-servers/${server.id}/auth/callback`;
    let clientId: string;
    let clientSecret: string | undefined;

    if (asMeta['registration_endpoint']) {
      try {
        const regRes = await fetch(asMeta['registration_endpoint'] as string, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_name: 'Taskshed',
            redirect_uris: [redirectUri],
            grant_types: ['authorization_code'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!regRes.ok) throw new Error(`HTTP ${regRes.status}: ${await regRes.text()}`);
        const regData = await regRes.json() as { client_id: string; client_secret?: string };
        clientId = regData.client_id;
        clientSecret = regData.client_secret;
      } catch (err) {
        res.status(502).json({ error: `Dynamic client registration failed: ${(err as Error).message}`, code: 'DCR_FAILED' });
        return;
      }
    } else {
      res.status(400).json({ error: 'Auth server does not support dynamic client registration', code: 'NO_DCR' });
      return;
    }

    const { codeVerifier, codeChallenge } = generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');
    const resourceUrl = rmData.resource || server.url;

    const oauthState = {
      server_id: server.id,
      code_verifier: codeVerifier,
      client_id: clientId,
      client_secret: clientSecret,
      token_endpoint: asMeta['token_endpoint'] as string,
      resource_url: resourceUrl,
      redirect_uri: redirectUri,
    };
    await redis.set(`mcp_oauth:${state}`, JSON.stringify(oauthState), 'EX', 600);

    const metadata: OAuthMetadata = {
      resource_url: resourceUrl,
      authorization_server: authServer,
      client_id: clientId,
      client_secret: clientSecret,
      token_endpoint: asMeta['token_endpoint'] as string,
      authorization_endpoint: asMeta['authorization_endpoint'] as string,
      registration_endpoint: asMeta['registration_endpoint'] as string | undefined,
      scopes: asMeta['scopes_supported'] as string[] | undefined,
    };
    await query(
      `UPDATE mcp_servers SET oauth_metadata = $1 WHERE id = $2`,
      [JSON.stringify(metadata), server.id]
    );

    const scopeStr = (asMeta['scopes_supported'] as string[] | undefined)?.join(' ') || '';
    const authUrl = new URL(asMeta['authorization_endpoint'] as string);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    if (scopeStr) authUrl.searchParams.set('scope', scopeStr);
    authUrl.searchParams.set('resource', resourceUrl);

    res.json({ authorization_url: authUrl.toString() });
  });

  router.get('/:id/auth/callback', async (req, res) => {
    const { code, state, error: oauthError } = req.query as Record<string, string>;
    const serverId = req.params['id'];

    if (oauthError) {
      res.send(callbackHtml(serverId, false, `Authorization denied: ${oauthError}`));
      return;
    }

    if (!code || !state) {
      res.send(callbackHtml(serverId, false, 'Missing code or state parameter'));
      return;
    }

    const stateData = await redis.get(`mcp_oauth:${state}`);
    if (!stateData) {
      res.send(callbackHtml(serverId, false, 'Invalid or expired state. Please try again.'));
      return;
    }
    await redis.del(`mcp_oauth:${state}`);

    const oauthState = JSON.parse(stateData) as {
      server_id: string;
      code_verifier: string;
      client_id: string;
      client_secret?: string;
      token_endpoint: string;
      resource_url: string;
      redirect_uri: string;
    };

    if (oauthState.server_id !== serverId) {
      res.send(callbackHtml(serverId, false, 'State mismatch'));
      return;
    }

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: oauthState.redirect_uri,
      code_verifier: oauthState.code_verifier,
      client_id: oauthState.client_id,
      resource: oauthState.resource_url,
    });

    try {
      const tokenRes = await fetch(oauthState.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams.toString(),
        signal: AbortSignal.timeout(10000),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        res.send(callbackHtml(serverId, false, `Token exchange failed: ${errBody}`));
        return;
      }

      const tokenData = await tokenRes.json() as { access_token: string; refresh_token?: string };
      const encAccessToken = encrypt(tokenData.access_token, config.secretKey);
      const encRefreshToken = tokenData.refresh_token ? encrypt(tokenData.refresh_token, config.secretKey) : null;

      await query(
        `UPDATE mcp_servers SET oauth_access_token = $1, oauth_refresh_token = $2 WHERE id = $3`,
        [encAccessToken, encRefreshToken, serverId]
      );

      res.send(callbackHtml(serverId, true));
    } catch (err) {
      res.send(callbackHtml(serverId, false, `Token exchange error: ${(err as Error).message}`));
    }
  });

  return router;
}

function callbackHtml(serverId: string, success: boolean, error?: string): string {
  const message = JSON.stringify({ type: 'mcp-oauth-complete', serverId, success, error });
  return `<!DOCTYPE html><html><body>
    <p>${success ? 'Authorization successful. You can close this window.' : `Authorization failed: ${error || 'Unknown error'}`}</p>
    <script>
      if (window.opener) {
        window.opener.postMessage(${message}, '*');
      }
      setTimeout(() => window.close(), 2000);
    </script>
  </body></html>`;
}
