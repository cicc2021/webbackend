/**
 * Moves files from backend/uploads to the configured bucket and repoints every saved link, keeping
 * all content edits. Links only change once each file is confirmed readable at its new address.
 * Safe to re-run. Local files are left in place as a backup.
 *
 *   npm run media:migrate
 */
import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { databaseFromEnv, storageFromEnv } from '../src/config/configuration';
import { createStorage, LOCAL_UPLOAD_DIR } from '../src/media/storage';
import { createAdapter } from '../src/prisma/client';

for (const f of ['.env.local', `.env.${process.env.NODE_ENV ?? 'development'}`, '.env']) loadEnv({ path: f, quiet: true });

async function main() {
  const cfg = storageFromEnv();
  if (cfg.driver !== 's3') throw new Error('Set STORAGE_DRIVER=s3 first');
  const prisma = new PrismaClient({ adapter: createAdapter(databaseFromEnv()) });
  const storage = createStorage(cfg, '');
  const pending = await prisma.media.findMany({ where: { NOT: { url: { startsWith: cfg.publicUrl } } } });
  const oldBases = new Set<string>();
  console.log(`${pending.length} files to move`);

  let next = 0;
  const moved: { id: string; url: string }[] = [];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < pending.length) {
        const m = pending[next++];
        const url = await storage.put(m.key, await readFile(join(LOCAL_UPLOAD_DIR, m.key)), m.mimeType);
        const res = await fetch(url);
        await res.body?.cancel();
        if (!res.ok) throw new Error(`${url} answered ${res.status}, so no links were changed. Is the bucket publicly readable?`);
        oldBases.add(m.url.slice(0, m.url.length - m.key.length));
        moved.push({ id: m.id, url });
      }
    }),
  );

  // Every location that can hold a media link, as one all-or-nothing change.
  const base = `${cfg.publicUrl}/`;
  await prisma.$transaction(
    async (tx) => {
      for (const m of moved) await tx.media.update({ where: { id: m.id }, data: { url: m.url } });
      for (const old of oldBases) {
        await tx.$executeRaw`UPDATE "Page" SET "coverUrl" = replace("coverUrl", ${old}, ${base}), blocks = replace(blocks::text, ${old}, ${base})::jsonb`;
        await tx.$executeRaw`UPDATE "Event" SET "coverUrl" = replace("coverUrl", ${old}, ${base}), content = replace(content, ${old}, ${base})`;
        await tx.$executeRaw`UPDATE "BlogPost" SET "coverUrl" = replace("coverUrl", ${old}, ${base}), content = replace(content, ${old}, ${base})`;
        await tx.$executeRaw`UPDATE "StaffMember" SET "photoUrl" = replace("photoUrl", ${old}, ${base}), bio = replace(bio, ${old}, ${base})`;
      }
    },
    { timeout: 120_000 },
  );
  console.log(`Moved ${moved.length} files; links now point at ${cfg.publicUrl}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
