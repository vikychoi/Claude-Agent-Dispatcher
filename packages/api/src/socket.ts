import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import { query } from './db.js';
import type { LogLine } from '@taskshed/shared';

export function setupSocket(httpServer: HttpServer, redisUrl: string): Server {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  const jobSubs = new Map<string, { sub: Redis; refCount: number }>();
  const redisReader = new Redis(redisUrl, { maxRetriesPerRequest: null });

  io.on('connection', (socket) => {
    const joinedJobs = new Set<string>();

    socket.on('join-job', async (jobId: string) => {
      if (joinedJobs.has(jobId)) return;
      joinedJobs.add(jobId);
      socket.join(jobId);

      const logs = await query<LogLine>(
        'SELECT * FROM job_logs WHERE job_id = $1 ORDER BY created_at, id',
        [jobId]
      );
      socket.emit('logs-history', logs.rows);

      const activityState = await redisReader.get(`job:${jobId}:activity:state`);
      if (activityState) {
        socket.emit('activity', { state: activityState });
      }

      let entry = jobSubs.get(jobId);
      if (!entry) {
        const sub = new Redis(redisUrl, { maxRetriesPerRequest: null });
        await sub.subscribe(`job:${jobId}:logs`, `job:${jobId}:status`, `job:${jobId}:tokens`, `job:${jobId}:activity`, `job:${jobId}:cost`);
        sub.on('message', (channel: string, message: string) => {
          try {
            if (channel === `job:${jobId}:logs`) {
              io.to(jobId).emit('log', JSON.parse(message));
            } else if (channel === `job:${jobId}:status`) {
              io.to(jobId).emit('status', JSON.parse(message));
            } else if (channel === `job:${jobId}:tokens`) {
              io.to(jobId).emit('tokens', JSON.parse(message));
            } else if (channel === `job:${jobId}:activity`) {
              io.to(jobId).emit('activity', JSON.parse(message));
            } else if (channel === `job:${jobId}:cost`) {
              io.to(jobId).emit('cost', JSON.parse(message));
            }
          } catch {
            // ignore malformed messages
          }
        });
        entry = { sub, refCount: 0 };
        jobSubs.set(jobId, entry);
      }
      entry.refCount++;
    });

    const cleanupJob = async (jobId: string) => {
      if (!joinedJobs.has(jobId)) return;
      joinedJobs.delete(jobId);
      socket.leave(jobId);
      const entry = jobSubs.get(jobId);
      if (entry) {
        entry.refCount--;
        if (entry.refCount <= 0) {
          jobSubs.delete(jobId);
          try {
            await entry.sub.unsubscribe();
            entry.sub.disconnect();
          } catch {
            // ignore cleanup errors
          }
        }
      }
    };

    socket.on('leave-job', (jobId: string) => {
      cleanupJob(jobId);
    });

    socket.on('disconnect', () => {
      for (const jobId of joinedJobs) {
        cleanupJob(jobId);
      }
    });
  });

  return io;
}
