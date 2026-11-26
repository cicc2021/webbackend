import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Same order as the app, so CLI commands on a server never fall through to the dev database.
for (const f of ['.env.local', `.env.${process.env.NODE_ENV ?? 'development'}`, '.env']) {
  loadEnv({ path: f, quiet: true });
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: { path: path.join('prisma', 'migrations') },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
