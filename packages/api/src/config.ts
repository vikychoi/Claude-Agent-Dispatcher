function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env['PORT'] || '3000', 10),
  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL'),
  secretKey: required('SECRET_KEY'),
  jobDataDir: process.env['JOB_DATA_DIR'] || '/data/jobs',
  apiBaseUrl: process.env['API_BASE_URL'] || `http://localhost:${parseInt(process.env['PORT'] || '3000', 10)}`,
};
