/**
 * Saves a copy of the old WordPress site, for reference and recovery: every page, post, event,
 * category, menu and logo entry as JSON, the public HTML of every page, and every file in the media
 * library. Safe to re-run: existing files are skipped.
 *
 *   npm run backup:wordpress -- /path/to/folder
 *
 * This copies what the site publishes. Server files, the WordPress database and email need a backup
 * from the Hostinger panel as well.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const SOURCE = 'https://council-icc.org';
const API = `${SOURCE}/wp-json/wp/v2`;
const UA = { 'User-Agent': 'Mozilla/5.0 (CICC site backup)' };
const TYPES = ['pages', 'posts', 'mec-events', 'media', 'categories', 'tags', 'mec_category', 'gs-logo-slider', 'igmap', 'sptp_generator'];

const root = process.argv[2];
if (!root) {
  console.error('Usage: npm run backup:wordpress -- /path/to/folder');
  process.exit(1);
}

async function fetchRetry(url: string, attempts = 3): Promise<Response> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120_000) });
      if (res.ok || res.status === 401 || res.status === 404) return res;
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (i >= attempts) throw new Error(`${url}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

async function exists(path: string) {
  return stat(path).then(() => true, () => false);
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

async function main() {
  const report: Record<string, number | string> = { source: SOURCE, startedAt: new Date().toISOString() };

  const all: Record<string, { link?: string; source_url?: string }[]> = {};
  for (const type of TYPES) {
    const items: { link?: string; source_url?: string }[] = [];
    for (let page = 1; ; page++) {
      const res = await fetchRetry(`${API}/${type}?per_page=100&page=${page}`);
      if (!res.ok) break;
      const batch = (await res.json()) as { link?: string }[];
      items.push(...batch);
      // A page can hold fewer than 100 when WordPress hides private items, so go by the page count.
      if (page >= Number(res.headers.get('x-wp-totalpages') ?? 1)) break;
    }
    all[type] = items;
    await mkdir(join(root, 'json'), { recursive: true });
    await writeFile(join(root, 'json', `${type}.json`), JSON.stringify(items, null, 2));
    report[type] = items.length;
    console.log(`${type}: ${items.length}`);
  }

  // The rendered HTML keeps what the API doesn't: menus, widgets, theme sections.
  const links = [`${SOURCE}/`, ...['pages', 'posts', 'mec-events'].flatMap((t) => all[t].map((i) => i.link!).filter(Boolean))];
  await mapLimit(links, 4, async (link) => {
    const path = new URL(link).pathname.replace(/\/$/, '') || '/home';
    // Event addresses can be very long; a short hash keeps shortened ones apart.
    const safe = decodeURIComponent(path).replace(/[^\w/.-]+/g, '_');
    const name = safe.length > 150 ? `${safe.slice(0, 150)}-${createHash('sha1').update(path).digest('hex').slice(0, 8)}` : safe;
    const file = join(root, 'html', name, 'index.html');
    if (await exists(file)) return;
    const res = await fetchRetry(link);
    if (!res.ok) return;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, await res.text());
  });
  report.htmlPages = links.length;
  console.log(`html: ${links.length}`);

  // Media files, original size, kept in the same folder layout as on the old server.
  let saved = 0;
  let failed = 0;
  const urls = all.media.map((m) => m.source_url).filter((u): u is string => !!u);
  await mapLimit(urls, 5, async (url) => {
    const file = join(root, 'media', decodeURIComponent(new URL(url).pathname.replace(/^\/wp-content\/uploads\//, '')));
    if (await exists(file)) return void saved++;
    const res = await fetchRetry(url).catch(() => null);
    if (!res?.ok || !res.body) return void failed++;
    await mkdir(dirname(file), { recursive: true });
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
    if (++saved % 50 === 0) console.log(`media: ${saved}/${urls.length}`);
  });
  report.mediaSaved = saved;
  report.mediaFailed = failed;
  report.finishedAt = new Date().toISOString();
  await writeFile(join(root, 'backup-report.json'), JSON.stringify(report, null, 2));
  console.log('Done', report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
