import { Router } from 'express';
import { encrypt, decrypt } from '@taskshed/shared';
import type { AuthStatusResponse, SetAuthRequest } from '@taskshed/shared';
import { query } from '../db.js';
import { config } from '../config.js';

export const settingsRouter = Router();

settingsRouter.get('/auth', async (_req, res) => {
  const result = await query<{ value: string }>(`SELECT value FROM settings WHERE key = 'auth'`);
  if (result.rows.length === 0) {
    res.json({ mode: 'oauth', configured: false } satisfies AuthStatusResponse);
    return;
  }
  const decrypted = JSON.parse(decrypt(result.rows[0].value, config.secretKey));
  res.json({ mode: decrypted.mode, configured: true } satisfies AuthStatusResponse);
});

settingsRouter.put('/auth', async (req, res) => {
  const body = req.body as SetAuthRequest;
  let credential: string;
  if (body.mode === 'oauth') {
    if (!body.credentials || typeof body.credentials !== 'string') {
      res.status(400).json({ error: 'Credentials JSON is required', code: 'INVALID_CREDENTIALS' });
      return;
    }
    try {
      const parsed = JSON.parse(body.credentials);
      if (!parsed.claudeAiOauth?.accessToken) {
        res.status(400).json({ error: 'Missing claudeAiOauth.accessToken in credentials', code: 'INVALID_CREDENTIALS' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'Invalid JSON', code: 'INVALID_CREDENTIALS' });
      return;
    }
    credential = body.credentials;
  } else if (body.mode === 'api_key') {
    if (!body.key || typeof body.key !== 'string') {
      res.status(400).json({ error: 'API key is required', code: 'INVALID_KEY' });
      return;
    }
    credential = body.key;
  } else {
    res.status(400).json({ error: 'Invalid auth mode', code: 'INVALID_MODE' });
    return;
  }

  const encrypted = encrypt(JSON.stringify({ mode: body.mode, credential }), config.secretKey);
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('auth', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [encrypted]
  );
  res.json({ configured: true });
});

settingsRouter.delete('/auth', async (_req, res) => {
  await query(`DELETE FROM settings WHERE key = 'auth'`);
  res.json({ configured: false });
});

export const DEFAULT_FILE_SIZE_LIMIT_MB = 50;
export const DEFAULT_ARTIFACT_DEPTH_LIMIT = 1;

settingsRouter.get('/file-size-limit', async (_req, res) => {
  const result = await query<{ value: string }>(`SELECT value FROM settings WHERE key = 'file_size_limit'`);
  const limitMb = result.rows.length > 0 ? parseInt(result.rows[0].value, 10) : DEFAULT_FILE_SIZE_LIMIT_MB;
  res.json({ limitMb });
});

settingsRouter.put('/file-size-limit', async (req, res) => {
  const { limitMb } = req.body as { limitMb: number };
  if (typeof limitMb !== 'number' || limitMb < 1 || limitMb > 10000) {
    res.status(400).json({ error: 'Limit must be between 1 and 10000 MB', code: 'VALIDATION_ERROR' });
    return;
  }
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('file_size_limit', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [String(Math.floor(limitMb))]
  );
  res.json({ limitMb: Math.floor(limitMb) });
});

settingsRouter.get('/artifact-depth-limit', async (_req, res) => {
  const result = await query<{ value: string }>(`SELECT value FROM settings WHERE key = 'artifact_depth_limit'`);
  const depth = result.rows.length > 0 ? parseInt(result.rows[0].value, 10) : DEFAULT_ARTIFACT_DEPTH_LIMIT;
  res.json({ depth });
});

settingsRouter.put('/artifact-depth-limit', async (req, res) => {
  const { depth } = req.body as { depth: number };
  if (typeof depth !== 'number' || depth < 1 || depth > 100) {
    res.status(400).json({ error: 'Depth must be between 1 and 100', code: 'VALIDATION_ERROR' });
    return;
  }
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('artifact_depth_limit', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [String(Math.floor(depth))]
  );
  res.json({ depth: Math.floor(depth) });
});
