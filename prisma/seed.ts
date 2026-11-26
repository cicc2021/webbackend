import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import { hashPassword } from '../src/auth/password';
import { databaseFromEnv } from '../src/config/configuration';
import { createAdapter } from '../src/prisma/client';

for (const f of ['.env.local', `.env.${process.env.NODE_ENV ?? 'development'}`, '.env']) loadEnv({ path: f, quiet: true });

/** Creates the first admin only. Never overwrites an existing account's password. */
async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
  if (process.env.NODE_ENV === 'production' && password.startsWith('ChangeMe')) {
    throw new Error('Refusing to create a production admin with the temporary password');
  }
  const prisma = new PrismaClient({ adapter: createAdapter(databaseFromEnv()) });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) console.log(`Admin ${email} already exists, left unchanged`);
  else {
    await prisma.user.create({ data: { email, name: 'CICC Admin', role: 'ADMIN', passwordHash: await hashPassword(password) } });
    console.log(`Created admin ${email}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
