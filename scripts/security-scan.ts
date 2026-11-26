/**
 * Monthly security check of the website's content and accounts. Read-only: it reports, never changes.
 *
 *   npm run security:scan
 *
 * Looks for injected code in stored content, links to unexpected outside sites, files of unexpected
 * types, and account problems such as the first temporary password still working.
 */
import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import { verifyPassword } from '../src/auth/password';
import { databaseFromEnv } from '../src/config/configuration';
import { createAdapter } from '../src/prisma/client';

for (const f of ['.env.local', `.env.${process.env.NODE_ENV ?? 'development'}`, '.env']) loadEnv({ path: f, quiet: true });

/** Patterns that should never survive the sanitizer. Finding one means content got in another way. */
const INJECTION = [/<script/i, /javascript:/i, /\son\w+\s*=/i, /<iframe(?![^>]*(youtube\.com|youtube-nocookie\.com|vimeo\.com|google\.com))/i, /<object|<embed/i, /eval\(|atob\(|document\.cookie/i, /data:text\/html/i];
const TRUSTED_HOSTS = ['council-icc.org', 'innoida.utho.io', 'youtube.com', 'youtu.be', 'linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com'];
const TEMP_PASSWORDS = ['ChangeMe-CICC-2026'];

async function main() {
  const prisma = new PrismaClient({ adapter: createAdapter(databaseFromEnv()) });
  const findings: string[] = [];
  const outsideHosts = new Map<string, Set<string>>();

  const check = (where: string, text: string) => {
    for (const p of INJECTION) if (p.test(text)) findings.push(`Suspicious code (${p.source}) in ${where}`);
    for (const m of text.matchAll(/https?:\/\/([^/"'\s<>)]+)/g)) {
      const host = m[1].toLowerCase().replace(/^www\./, '');
      if (!TRUSTED_HOSTS.some((t) => host === t || host.endsWith(`.${t}`))) {
        if (!outsideHosts.has(host)) outsideHosts.set(host, new Set());
        outsideHosts.get(host)!.add(where);
      }
    }
  };

  for (const p of await prisma.page.findMany()) check(`page ${p.path}`, JSON.stringify(p.blocks) + p.coverUrl);
  for (const e of await prisma.event.findMany()) check(`event ${e.slug}`, e.content + e.coverUrl);
  for (const b of await prisma.blogPost.findMany()) check(`post ${b.slug}`, b.content + b.coverUrl);
  for (const s of await prisma.staffMember.findMany()) check(`team ${s.name}`, `${s.bio} ${s.linkedin}`);

  // Only the President may be named publicly; anyone else's name in published text is a leak.
  const names = (await prisma.staffMember.findMany({ where: { NOT: { sourceKey: 'president' } }, select: { name: true } }))
    .map((n) => n.name.replace(/^(Prof\. Dr\.|Eng\.|Dr\.|Col|H\.e\.)\s+/i, '').split(',')[0].trim())
    .filter((n) => n.split(' ').length > 1);
  const published = [
    ...(await prisma.page.findMany({ where: { status: 'PUBLISHED' } })).map((p) => [`page ${p.path}`, JSON.stringify(p.blocks) + p.title + p.excerpt]),
    ...(await prisma.event.findMany({ where: { status: 'PUBLISHED' } })).map((e) => [`event ${e.slug}`, e.content + e.title + e.summary]),
    ...(await prisma.blogPost.findMany({ where: { status: 'PUBLISHED' } })).map((b) => [`post ${b.slug}`, b.content + b.title]),
  ];
  for (const [where, text] of published) {
    for (const n of names) if (text.toLowerCase().includes(n.toLowerCase())) findings.push(`Confidential name "${n}" published in ${where}`);
  }

  const media = await prisma.media.findMany();
  const allowed = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'application/pdf']);
  for (const m of media) if (!allowed.has(m.mimeType)) findings.push(`Unexpected file type ${m.mimeType}: ${m.filename}`);

  const users = await prisma.user.findMany();
  const admins = users.filter((u) => u.role === 'ADMIN' && u.isActive);
  if (admins.length === 0) findings.push('No active administrator account');
  for (const u of users) {
    for (const pw of TEMP_PASSWORDS) {
      if (u.isActive && (await verifyPassword(pw, u.passwordHash))) findings.push(`Account ${u.email} still uses the temporary password: change it now`);
    }
  }
  const stale = users.filter((u) => u.isActive && Date.now() - (u.lastLoginAt ?? u.createdAt).getTime() > 180 * 86_400_000);
  for (const u of stale) findings.push(`Account ${u.email} hasn't signed in for 6 months or more: disable it if it's no longer needed`);

  const ssl = databaseFromEnv().ssl;
  if (ssl === 'false' && !/localhost|127\.0\.0\.1|host\.docker\.internal/.test(databaseFromEnv().url)) {
    findings.push('The database connection is not encrypted (DATABASE_SSL=false)');
  }
  if (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'true') findings.push('COOKIE_SECURE is not true in production');

  console.log(`Checked ${await prisma.page.count()} pages, ${await prisma.event.count()} events, ${await prisma.blogPost.count()} posts, ${media.length} files, ${users.length} accounts.`);
  if (outsideHosts.size) {
    console.log('\nLinks to outside sites (check they are expected):');
    for (const [host, where] of [...outsideHosts].sort()) console.log(`  ${host}  (${[...where].slice(0, 3).join(', ')}${where.size > 3 ? ', …' : ''})`);
  }
  console.log(findings.length ? `\n${findings.length} finding(s):\n${findings.map((f) => `  ! ${f}`).join('\n')}` : '\nNo problems found.');
  await prisma.$disconnect();
  process.exitCode = findings.some((f) => f.startsWith('Suspicious') || f.startsWith('Confidential') || f.includes('temporary password')) ? 2 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
