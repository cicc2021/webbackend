export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  publicApiOrigin: string;
  corsOrigins: string[];
}
export interface DatabaseConfig {
  url: string;
  ssl: 'false' | 'true' | 'no-verify' | 'verify';
}
export interface AuthConfig {
  jwtSecret: string;
  cookieSecure: boolean;
}
export interface StorageConfig {
  driver: 'local' | 's3';
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  publicUrl: string;
}

export function databaseFromEnv(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  return { url: env.DATABASE_URL ?? '', ssl: (env.DATABASE_SSL as DatabaseConfig['ssl']) ?? 'false' };
}

export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  return {
    driver: (env.STORAGE_DRIVER as StorageConfig['driver']) ?? 'local',
    endpoint: env.S3_ENDPOINT ?? '',
    region: env.S3_REGION ?? 'auto',
    bucket: env.S3_BUCKET ?? '',
    accessKey: env.S3_ACCESS_KEY ?? '',
    secretKey: env.S3_SECRET_KEY ?? '',
    publicUrl: (env.S3_PUBLIC_URL ?? '').replace(/\/$/, ''),
  };
}

export default () => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 4000),
    apiPrefix: process.env.API_PREFIX ?? 'api',
    publicApiOrigin: (process.env.PUBLIC_API_ORIGIN ?? '').replace(/\/$/, ''),
    corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
  } satisfies AppConfig,
  database: databaseFromEnv(),
  auth: {
    jwtSecret: process.env.JWT_SECRET ?? '',
    cookieSecure: process.env.COOKIE_SECURE === 'true',
  } satisfies AuthConfig,
  storage: storageFromEnv(),
});
