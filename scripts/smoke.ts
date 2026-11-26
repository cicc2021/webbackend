/** Hits key endpoints of a running API, e.g. after a deploy. API_URL defaults to local. */
const base = process.env.API_URL ?? 'http://localhost:4000/api';

async function check(path: string, ok: (body: any) => boolean) {
  const res = await fetch(base + path);
  const body = await res.json();
  if (!res.ok || !ok(body)) throw new Error(`${path}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  console.log(`ok ${path}`);
}

async function main() {
  await check('/health', (b) => b.status === 'ok');
  await check('/pages', (b) => Array.isArray(b));
  await check('/pages/nav', (b) => Array.isArray(b));
  await check('/events', (b) => Array.isArray(b));
  await check('/blog', (b) => Array.isArray(b));
  await check('/governance', (b) => Array.isArray(b.bodies));
  const admin = await fetch(`${base}/admin/staff`);
  if (admin.status !== 401) throw new Error(`/admin/staff should be 401 without a token, got ${admin.status}`);
  console.log('ok admin routes require auth');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
