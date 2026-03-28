import http from 'node:http';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import Redis from 'ioredis';
import { config } from './config.js';
import { runMigrations } from './migrate.js';
import { settingsRouter } from './routes/settings.js';
import { skillsRouter } from './routes/skills.js';
import { createMcpServersRouter } from './routes/mcp-servers.js';
import { createJobsRouter } from './routes/jobs.js';
import { setupSocket } from './socket.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

app.use('/settings', settingsRouter);
app.use('/skills', skillsRouter);
app.use('/mcp-servers', createMcpServersRouter(redis));
app.use('/jobs', createJobsRouter(redis));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
});

const server = http.createServer(app);
setupSocket(server, config.redisUrl);

async function start() {
  await runMigrations();
  server.listen(config.port, () => {
    console.log(`API server listening on port ${config.port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start API server:', err);
  process.exit(1);
});
