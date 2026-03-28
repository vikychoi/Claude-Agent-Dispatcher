import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { QUEUE_NAME } from '@taskshed/shared';
import { config } from './config.js';
import { processJob, reconcileOrphanedContainers } from './orchestrator.js';

const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

async function start() {
  console.log('Worker starting...');
  await reconcileOrphanedContainers();
  console.log('Orphaned container reconciliation complete');

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { jobId } = job.data as { jobId: string };
      console.log(`Processing job ${jobId}`);
      await processJob(jobId, redis);
    },
    {
      connection: redis.duplicate(),
      concurrency: config.maxConcurrentJobs,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('Worker error:', err);
  });

  console.log(`Worker ready (concurrency: ${config.maxConcurrentJobs})`);
}

start().catch((err) => {
  console.error('Failed to start worker:', err);
  process.exit(1);
});
