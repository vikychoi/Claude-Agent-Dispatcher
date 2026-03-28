function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL'),
  secretKey: required('SECRET_KEY'),
  agentImageTag: process.env['AGENT_IMAGE_TAG'] || 'claude-agent:latest',
  maxConcurrentJobs: parseInt(process.env['MAX_CONCURRENT_JOBS'] || '3', 10),
  containerMemoryLimit: process.env['CONTAINER_MEMORY_LIMIT'] || '2g',
  containerCpuQuota: parseInt(process.env['CONTAINER_CPU_QUOTA'] || '100000', 10),
  jobDataDir: process.env['JOB_DATA_DIR'] || '/data/jobs',
  hostJobDataDir: required('HOST_JOB_DATA_DIR'),
};
