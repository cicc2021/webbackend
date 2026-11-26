/**
 * Imports council-icc.org through its WordPress REST API: pages, posts, events and board members.
 * Images are copied into the configured storage, so nothing hotlinks the old site.
 *
 *   npm run import:site            create what's missing; records edited in the admin are left alone
 *   npm run import:site -- --force overwrite previously imported records from the source
 *   npm run import:site -- --all-media  also copy the whole WordPress media library (about 500 MB)
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { cleanBlocks } from '../src/common/blocks';
import { cleanHtml, slugify, stripTags } from '../src/common/sanitize';
import { databaseFromEnv, storageFromEnv } from '../src/config/configuration';
import { createStorage, detectDocumentOrImage } from '../src/media/storage';
import { createAdapter } from '../src/prisma/client';
import { applyContentUpdates } from './content-updates';

for (const f of ['.env.local', `.env.${process.env.NODE_ENV ?? 'development'}`, '.env']) loadEnv({ path: f, quiet: true });

const SOURCE = 'https://council-icc.org';
const API = `${SOURCE}/wp-json/wp/v2`;
const FORCE = process.argv.includes('--force');
const ALL_MEDIA = process.argv.includes('--all-media');
const PARTNERS_SOURCE_ID = -1;
const UA = { 'User-Agent': 'Mozilla/5.0 (CICC site migration)' };

const prisma = new PrismaClient({ adapter: createAdapter(databaseFromEnv()) });
const storageConfig = storageFromEnv();
const localOrigin = (process.env.PUBLIC_API_ORIGIN ?? '').replace(/\/$/, '');
const storage = createStorage(storageConfig, localOrigin);
/** Where files in the current storage live, to spot ones copied to a previous storage. */
const STORAGE_BASE = storageConfig.driver === 's3' ? storageConfig.publicUrl : `${localOrigin}/uploads`;

interface WpItem {
  id: number;
  slug: string;
  parent?: number;
  link: string;
  date: string;
  title: { rendered: string };
  content: { rendered: string };
  excerpt: { rendered: string };
  featured_media: number;
}

async function fetchRetry(url: string, attempts = 3): Promise<Response> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) });
      if (res.ok || res.status === 404) return res;
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (i >= attempts) throw new Error(`${url}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

async function fetchAll(type: string): Promise<WpItem[]> {
  const items: WpItem[] = [];
  for (let page = 1; ; page++) {
    const res = await fetchRetry(`${API}/${type}?per_page=100&page=${page}`);
    const batch = (await res.json()) as WpItem[];
    items.push(...batch);
    if (batch.length < 100 || page >= Number(res.headers.get('x-wp-totalpages') ?? 1)) return items;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"');

const KEEP_UPPER = new Set(['CICC', 'AI', 'SI', 'B2B', 'UAE', 'EPC', 'USA', 'UK', 'DAO', 'HQ', 'RHQ', 'MHQ', 'II', 'III']);
const LOWER = new Set(['a', 'an', 'and', 'of', 'the', 'for', 'to', 'in', 'with', 'from']);
/** The source writes most titles in capitals. Mixed-case words like "PhD" are left alone. */
function niceCase(s: string): string {
  return s
    .split(/(\s+|-|\/)/)
    .map((w, i) => {
      if (!/^[^a-z]*[A-Z][^a-z]*$/.test(w) || KEEP_UPPER.has(w.replace(/[^A-Z0-9]/g, ''))) return w;
      const lower = w.toLowerCase();
      if (i > 0 && LOWER.has(lower)) return lower;
      return lower.replace(/\p{L}/u, (c) => c.toUpperCase());
    })
    .join('');
}
const cleanTitle = (raw: string) =>
  niceCase(decode(raw).replace(/\s*►+\s*/g, ' – ').replace(/\s+/g, ' ').trim());

/* ------------ images ------------ */
const imageCache = new Map<string, Promise<string>>();

/** Returns the URL in our storage, or '' if the source file is gone. */
function rehostFile(source: string): Promise<string> {
  const absolute = source.startsWith('/') ? SOURCE + source : source;
  let job = imageCache.get(absolute);
  if (!job) {
    job = (async () => {
      const known = await prisma.media.findUnique({ where: { sourceUrl: absolute } });
      // Moved to a new storage since the last import? Then copy it again and update the row.
      if (known?.url.startsWith(STORAGE_BASE)) return known.url;
      try {
        const res = await fetchRetry(absolute);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = Buffer.from(await res.arrayBuffer());
        const kind = detectDocumentOrImage(body);
        if (!kind) throw new Error('not a supported file');
        const key = `media/imported/${randomUUID()}.${kind.ext}`;
        const url = await storage.put(key, body, kind.mime);
        const filename = decodeURIComponent(absolute.split('/').pop() ?? key).slice(0, 200);
        const row = { key, url, filename, mimeType: kind.mime, size: body.length, sourceUrl: absolute };
        await prisma.media.upsert({ where: { sourceUrl: absolute }, update: row, create: row });
        return url;
      } catch (e) {
        console.warn(`  ! file skipped: ${absolute} (${(e as Error).message})`);
        return '';
      }
    })();
    imageCache.set(absolute, job);
  }
  return job;
}

/** Some attachments answer 401 on the REST API, but every public page still shows its image. */
async function pageImage(page: string): Promise<string> {
  const src = page.match(/<img[^>]+wp-post-image[^>]*>/)?.[0].match(/src="([^"]+)"/)?.[1] ?? page.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  return src ? rehostFile(decode(src)) : '';
}

async function featuredUrl(id: number): Promise<string> {
  if (!id) return '';
  // Some attachments answer 401 on the REST API, which shouldn't stop the import.
  const res = await fetch(`${API}/media/${id}`, { headers: UA, signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!res?.ok) return '';
  const media = (await res.json()) as { source_url?: string };
  return media.source_url ? rehostFile(media.source_url) : '';
}

/** Rehosts images and points links at their new home on this site. */
async function migrateHtml(html: string, linkMap: (href: string) => string): Promise<string> {
  let out = html
    .replace(/\s(srcset|sizes)="[^"]*"/g, '')
    // A team plugin writes its image tags with single quotes.
    .replace(/<img\s+src='([^']+)'/g, '<img src="$1"')
    .replace(/<form[\s\S]*?<\/form>/g, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');
  const sources = new Set([...out.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => decode(m[1])));
  for (const src of sources) {
    const url = /\.svg(\?|$)/.test(src) ? '' : await rehostFile(src);
    out = out.split(src).join(url);
  }
  out = out.replace(/<img[^>]+src=""[^>]*>/g, '');
  // Documents and images people can open from a link move too, or they'd die with the old site.
  const files = new Set([...out.matchAll(/href="(https?:\/\/(?:www\.)?council-icc\.org\/wp-content\/uploads\/[^"]+)"/g)].map((m) => m[1]));
  for (const href of files) {
    const url = await rehostFile(decode(href));
    if (url) out = out.split(`href="${href}"`).join(`href="${url}"`);
  }
  out = out.replace(/href="(https?:\/\/(?:www\.)?council-icc\.org[^"]*)"/g, (_, href) => `href="${linkMap(decode(href))}"`);
  // WordPress expresses alignment as classes; the sanitizer only keeps inline styles.
  out = out.replace(/class="([^"]*has-text-align-(left|center|right)[^"]*)"((?:\s+style="([^"]*)")?)/g, (_, cls, align, __, style) =>
    `class="${cls}" style="text-align:${align};${style ?? ''}"`,
  );
  return cleanHtml(out).replace(/<p>\s*<\/p>/g, '').trim();
}

const richText = (html: string) => ({ type: 'richText', data: { html }, style: { paddingTop: 48, paddingBottom: 48 } });

/** Rebuilds a WPForms form as a native form block, keeping its labels, fields and notes. */
function parseForm(rendered: string, subject: string) {
  const start = rendered.indexOf('<form');
  if (start === -1) return null;
  const html = rendered.slice(start, rendered.indexOf('</form>', start));
  const clean = (h: string) => decode(stripTags(h)).replace(/\s*\*\s*$/, '').replace(/\s*:\s*$/, '').trim();
  const form = { title: '', intro: '', subject, nameLabel: '', emailLabel: '', phoneLabel: '', phoneRequired: false, fields: [] as object[], submitLabel: 'Submit' };
  for (const part of html.split(/(?=<div[^>]+class="wpforms-field wpforms-field-)/).slice(1)) {
    const type = part.match(/wpforms-field wpforms-field-(\w+)/)?.[1];
    const labelHtml = part.match(/<label[^>]*class="wpforms-field-label"[^>]*>([\s\S]*?)<\/label>/)?.[1] ?? '';
    const required = /wpforms-required-label/.test(labelHtml);
    const label = clean(labelHtml);
    const note = decode(stripTags(part.match(/wpforms-field-description"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? ''));
    if (type === 'name') form.nameLabel = label;
    else if (type === 'email') form.emailLabel = label;
    else if (type === 'number' || type === 'phone') {
      form.phoneLabel = label;
      form.phoneRequired = required;
    } else if (type === 'text' || type === 'textarea') form.fields.push({ type, label, required, note });
    else if (type === 'radio') {
      const options = [...part.matchAll(/wpforms-field-label-inline"[^>]*>([\s\S]*?)<\/label>/g)].map((m) => decode(stripTags(m[1])));
      form.fields.push({ type, label, required, options, note });
    }
  }
  return form;
}

/** Source pages whose body was a plugin widget, replaced by the native feature. */
const CALENDAR_PAGE = 81;
const NATIVE_CTA: Record<number, object> = {
  81: { title: 'See every event on the calendar', text: 'Browse upcoming CICC conferences and site visits by month.', buttonLabel: 'Open the calendar', buttonHref: '/events/calendar' },
  87: { title: 'Prefer to choose online?', text: 'Browse every event and its packages, then book your place directly.', buttonLabel: 'Browse events', buttonHref: '/events' },
};

/* ------------ pages ------------ */
async function importPages(pages: WpItem[], navOrder: (link: string) => number, linkMap: (h: string) => string) {
  const CATEGORY_NAMES: Record<string, string> = {
    'about-us': 'About CICC',
    departments: 'Departments',
    'membership-and-events': 'Membership & Events',
    'busines-network': 'Business Network',
    'ai-si': 'AI & SI',
  };
  const categoryIds = new Map<string, string>();
  for (const [i, name] of Object.values(CATEGORY_NAMES).entries()) {
    const slug = slugify(name);
    const cat = await prisma.pageCategory.upsert({ where: { slug }, update: {}, create: { name, slug, sortOrder: i } });
    categoryIds.set(name, cat.id);
  }

  const byId = new Map(pages.map((p) => [p.id, p]));
  const depth = (p: WpItem): number => (p.parent && byId.has(p.parent) ? 1 + depth(byId.get(p.parent)!) : 0);
  const pathOf = (p: WpItem) => new URL(p.link).pathname.replace(/\/$/, '');
  const rootSlug = (p: WpItem) => pathOf(p).split('/')[1];
  const sorted = pages.filter((p) => pathOf(p) !== '').sort((a, b) => depth(a) - depth(b));
  const ids = new Map<number, string>();

  // Parents first, so children can connect to them.
  for (const p of sorted) {
    const existing = await prisma.page.findUnique({ where: { sourceId: p.id } });
    if (existing && !FORCE) {
      ids.set(p.id, existing.id);
      continue;
    }
    const html = p.id === CALENDAR_PAGE
      ? await migrateHtml(p.content.rendered.split(/<div[^>]*class="[^"]*mec-/)[0], linkMap)
      : await migrateHtml(p.content.rendered, linkMap);
    const blocks: object[] = [];
    // A page can be nothing but an image, such as the organisation chart.
    if (stripTags(html) || /<(img|iframe|table)\b/.test(html)) blocks.push(richText(html));
    const form = parseForm(p.content.rendered, cleanTitle(p.title.rendered));
    if (form) blocks.push({ type: 'form', data: form, style: { paddingTop: 48, paddingBottom: 80, width: 'narrow' } });
    if (NATIVE_CTA[p.id]) blocks.push({ type: 'cta', data: NATIVE_CTA[p.id], style: { background: '#eb3f43', color: '#ffffff', paddingTop: 80, paddingBottom: 80, width: 'full', textAlign: 'center' } });

    const excerpt = decode(stripTags(p.content.rendered)).slice(0, 180);
    const parentId = p.parent ? ids.get(p.parent) : undefined;
    const data = {
      title: cleanTitle(p.title.rendered),
      slug: p.slug,
      path: pathOf(p),
      excerpt,
      coverUrl: await featuredUrl(p.featured_media),
      blocks: cleanBlocks(blocks) as Prisma.InputJsonValue,
      status: 'PUBLISHED' as const,
      showInNav: true,
      sortOrder: navOrder(p.link),
      parentId: parentId ?? null,
      categoryId: categoryIds.get(CATEGORY_NAMES[rootSlug(p)]) ?? null,
      sourceId: p.id,
    };
    const saved = await prisma.page.upsert({ where: { sourceId: p.id }, update: data, create: data });
    ids.set(p.id, saved.id);
    console.log(`  page ${saved.path}`);
  }
  return ids.size;
}

/* ------------ events ------------ */
const EVENT_CATEGORIES = [
  { name: 'B2B Conferences', test: /b2b/i, color: '#eb3f43' },
  { name: 'Seminars', test: /seminar/i, color: '#2b59c3' },
  { name: 'Project Site Visits', test: /site visit/i, color: '#1f9d6b' },
  { name: 'Launches', test: /launch/i, color: '#b8791b' },
  { name: 'Conferences', test: /./, color: '#231f20' },
];

function parseTime(t: string | undefined, fallback: string) {
  const m = t?.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!m) return fallback;
  const hour = (+m[1] % 12) + (/p/i.test(m[3]) ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${m[2]}:00`;
}

function parseLocation(title: string): string {
  const bracket = title.match(/\[([^\]]+)\]/);
  if (bracket) return bracket[1].replace(/\s*\/\s*/, ', ');
  const dash = title.match(/[–-]\s*([^–-]+)$/);
  return dash ? dash[1].trim() : '';
}

async function importEvents(items: WpItem[], linkMap: (h: string) => string) {
  const catIds = new Map<string, string>();
  for (const [i, c] of EVENT_CATEGORIES.entries()) {
    const slug = slugify(c.name);
    const row = await prisma.eventCategory.upsert({ where: { slug }, update: {}, create: { name: c.name, slug, color: c.color, sortOrder: i } });
    catIds.set(c.name, row.id);
  }

  let done = 0;
  let skipped = 0;
  await mapLimit(items, 5, async (e) => {
    const existing = await prisma.event.findUnique({ where: { sourceId: e.id }, select: { id: true } });
    if (existing && !FORCE) return;
    // Dates aren't in the REST payload; the public page carries them as JSON-LD.
    const page = await (await fetchRetry(e.link)).text();
    const start = page.match(/"startDate":\s*"(\d{4}-\d{2}-\d{2})/)?.[1];
    const end = page.match(/"endDate":\s*"(\d{4}-\d{2}-\d{2})/)?.[1] ?? start;
    if (!start || !end) {
      skipped++;
      console.warn(`  ! event skipped, no dates: ${e.link}`);
      return;
    }
    const times = page.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
    const title = cleanTitle(e.title.rendered);
    const content = await migrateHtml(e.content.rendered, linkMap);
    const category = EVENT_CATEGORIES.find((c) => c.test.test(title))!;
    const data = {
      title,
      slug: `${slugify(title).slice(0, 60).replace(/-+$/, '')}-${start}-${e.id}`,
      summary: decode(stripTags(e.content.rendered)).slice(0, 220),
      content,
      coverUrl: (await featuredUrl(e.featured_media)) || (await pageImage(page)),
      location: parseLocation(title),
      startAt: new Date(`${start}T${parseTime(times?.[1], '09:00:00')}Z`),
      endAt: new Date(`${end}T${parseTime(times?.[2], '17:00:00')}Z`),
      status: 'PUBLISHED' as const,
      categoryId: catIds.get(category.name),
      sourceId: e.id,
    };
    // The source's booking form offers these three choices and lists no prices.
    const packages = [
      { name: 'Participate', description: 'Attend the event as a delegate.', sortOrder: 0 },
      { name: 'Sponsor', description: 'Support the event as a sponsor.', sortOrder: 1 },
      { name: 'Project Site Visit', description: 'Join the accompanying project site visit.', sortOrder: 2 },
    ];
    await prisma.event.upsert({
      where: { sourceId: e.id },
      update: data,
      create: { ...data, packages: { create: packages } },
    });
    if (++done % 20 === 0) console.log(`  ${done} events`);
  });
  return { done, skipped };
}

/* ------------ blog ------------ */
async function importPosts(posts: WpItem[], linkMap: (h: string) => string) {
  const cat = await prisma.blogCategory.upsert({ where: { slug: 'news' }, update: {}, create: { name: 'News', slug: 'news' } });
  for (const p of posts) {
    const existing = await prisma.blogPost.findUnique({ where: { sourceId: p.id }, select: { id: true } });
    if (existing && !FORCE) continue;
    const title = cleanTitle(p.title.rendered);
    const data = {
      title,
      slug: `${slugify(title).slice(0, 70).replace(/-+$/, '')}-${p.id}`,
      excerpt: decode(stripTags(p.excerpt.rendered)).slice(0, 300),
      content: await migrateHtml(p.content.rendered, linkMap),
      coverUrl: (await featuredUrl(p.featured_media)) || (await pageImage(await (await fetchRetry(p.link)).text())),
      status: 'PUBLISHED' as const,
      publishedAt: new Date(p.date),
      categoryId: cat.id,
      sourceId: p.id,
    };
    await prisma.blogPost.upsert({ where: { sourceId: p.id }, update: data, create: data });
  }
}

/* ------------ staff ------------ */
async function importStaff(pages: WpItem[]) {
  let count = 0;
  const president = pages.find((p) => p.id === 6125);
  const leader = president && /<strong>Mr\.\s*([^<]+)<br\s*\/?>([^<]+)<br/i.exec(president.content.rendered);
  if (leader) {
    const data = { name: decode(leader[1]).trim(), designation: decode(leader[2]).trim(), group: 'Leadership', sortOrder: 0 };
    await prisma.staffMember.upsert({ where: { sourceKey: 'president' }, update: FORCE ? data : {}, create: { ...data, sourceKey: 'president' } });
    count++;
  }

  // Team cards on department pages carry a role and contact email.
  const cardOrder = 1000;
  let cardIndex = 0;
  for (const page of pages) {
    const cards = page.content.rendered.split(/(?=<div class="wpm_6310_team_style_\d+ wpm_6310_team_member_info")/).slice(1);
    for (const card of cards) {
      const field = (name: string) => decode(stripTags(card.match(new RegExp(`team_style_\\d+_${name}"[^>]*>([\\s\\S]*?)</div>`))?.[1] ?? '')).trim();
      const name = field('title');
      if (!name) continue;
      const data = {
        name,
        designation: field('designation') || cleanTitle(page.title.rendered),
        group: cleanTitle(page.title.rendered),
        email: card.match(/mailto:([^'"\s]+)/)?.[1] ?? '',
        sortOrder: cardOrder + cardIndex++,
      };
      const sourceKey = `card:${page.id}:${slugify(name)}`;
      await prisma.staffMember.upsert({ where: { sourceKey }, update: FORCE ? data : {}, create: { ...data, sourceKey } });
      count++;
    }
  }

  const board = pages.find((p) => p.id === 6216);
  if (!board) return count;
  // Each table follows a heading paragraph naming the group.
  const sections = board.content.rendered.split(/(?=<p[^>]*>\s*<strong>[^<]+<\/strong>\s*<\/p>)/);
  let order = 10;
  for (const section of sections) {
    const heading = /^<p[^>]*>\s*<strong>([^<]+)<\/strong>/.exec(section)?.[1];
    if (!heading) continue;
    const group = niceCase(decode(heading).trim());
    for (const row of section.matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)) {
      const [country, name, code] = [row[1], row[2], row[3]].map((c) => decode(stripTags(c)).trim());
      if (!name || /^name$/i.test(name) || !code) continue;
      const data = {
        name: niceCase(name),
        designation: `${group.replace(/\s+Members?$/i, '')} Member`,
        group,
        country: country.replace(/\p{Regional_Indicator}/gu, '').trim(),
        sortOrder: order++,
      };
      const sourceKey = `board:${code}`;
      await prisma.staffMember.upsert({ where: { sourceKey }, update: FORCE ? data : {}, create: { ...data, sourceKey } });
      count++;
    }
  }
  return count;
}

/* ------------ partners ------------ */
/** The home page's logo slider, kept as an editable page that the new home page also reads. */
async function importPartners(home: string, navOrder: (link: string) => number) {
  const existing = await prisma.page.findUnique({ where: { sourceId: PARTNERS_SOURCE_ID }, select: { id: true } });
  if (existing && !FORCE) return 0;
  const logos = await fetchAll('gs-logo-slider');
  const parent = await prisma.page.findFirst({ where: { path: '/about-us' } });
  const homeImages = [...home.matchAll(/<img[^>]+>/g)].map((m) => m[0]);
  const images = await mapLimit(logos, 5, async (logo) => {
    const title = niceCase(decode(logo.title.rendered).trim());
    let url = await featuredUrl(logo.featured_media);
    if (!url) {
      // Protected attachment: the slider on the old home page still shows it.
      const key = slugify(decode(logo.title.rendered));
      const tag = homeImages.find((t) => slugify(t.match(/src="[^"]*\/([^"/]+)"/)?.[1] ?? '').startsWith(key));
      const src = tag?.match(/src="([^"]+)"/)?.[1];
      if (src) url = await rehostFile(src);
    }
    if (!url) console.warn(`  ! partner logo not found: ${title}`);
    return { url, alt: title, caption: title };
  });
  const found = images.filter((i) => i.url);
  const data = {
    title: 'Our Partners',
    slug: 'our-partners',
    path: '/about-us/our-partners',
    excerpt: 'The companies and institutions working with CICC.',
    blocks: cleanBlocks([{ type: 'gallery', data: { images: found, columns: 5, gap: 24, aspect: '4/3', fit: 'contain' }, style: { width: 'wide', paddingTop: 64, paddingBottom: 96 } }]) as Prisma.InputJsonValue,
    status: 'PUBLISHED' as const,
    showInNav: true,
    sortOrder: navOrder(`${SOURCE}/about-us/`) + 1,
    parentId: parent?.id ?? null,
    categoryId: parent?.categoryId ?? null,
    sourceId: PARTNERS_SOURCE_ID,
  };
  await prisma.page.upsert({ where: { sourceId: PARTNERS_SOURCE_ID }, update: data, create: data });
  return found.length;
}

/** Everything else in the WordPress library, whether or not a page uses it. */
async function importAllMedia() {
  const items: { source_url?: string }[] = [];
  for (let page = 1; ; page++) {
    const res = await fetchRetry(`${API}/media?per_page=100&page=${page}`);
    const batch = (await res.json()) as { source_url?: string }[];
    items.push(...batch);
    if (batch.length < 100) break;
  }
  await mapLimit(items, 5, async (m) => (m.source_url ? rehostFile(m.source_url) : ''));
  return items.length;
}

async function main() {
  console.log(`Importing from ${SOURCE} into ${databaseFromEnv().url.replace(/\/\/[^@]+@/, '//***@')}`);
  const [pages, posts, events, home] = await Promise.all([
    fetchAll('pages'),
    fetchAll('posts'),
    fetchAll('mec-events'),
    fetchRetry(`${SOURCE}/`).then((r) => r.text()),
  ]);
  console.log(`Found ${pages.length} pages, ${posts.length} posts, ${events.length} events`);

  const pathByLink = new Set(pages.map((p) => new URL(p.link).pathname));
  // WordPress redirects retired URLs by slug (/membership/x to /membership-and-events/x), so do the same.
  const pathBySlug = new Map(pages.map((p) => [p.slug, new URL(p.link).pathname]));
  const postPaths = new Set(posts.map((p) => new URL(p.link).pathname));
  const linkMap = (href: string) => {
    const url = new URL(href, SOURCE);
    if (url.pathname.startsWith('/wp-content/')) return url.href;
    if (url.pathname.startsWith('/events/') || url.pathname.startsWith('/events-and-activities/')) return '/events';
    if (url.pathname.includes('our-headquearters')) return '/about-us/headquarters';
    if (postPaths.has(url.pathname)) return '/blog';
    const page = pathByLink.has(url.pathname) ? url.pathname : pathBySlug.get(url.pathname.split('/').filter(Boolean).pop() ?? '');
    if (page) return page.replace(/(.)\/$/, '$1') + url.hash;
    return url.pathname === '/' ? '/' : url.href;
  };
  // The source's menu order is the order links first appear in its header.
  const navOrder = (link: string) => {
    const i = home.indexOf(`href="${link}"`);
    return i === -1 ? 999_999 : i;
  };

  console.log('Pages…');
  const pageCount = await importPages(pages, navOrder, linkMap);
  console.log('Events…');
  const ev = await importEvents(events, linkMap);
  console.log('Posts…');
  await importPosts(posts, linkMap);
  console.log('Staff…');
  const staff = await importStaff(pages);
  console.log('Partners…');
  const partners = await importPartners(home, navOrder);
  // The site's real logo, so it's in the library for whoever wants to use it.
  const logo = home.match(/<img[^>]+custom-logo[^>]*>/)?.[0].match(/src="([^"]+)"/)?.[1];
  if (logo) await rehostFile(logo);
  const library = ALL_MEDIA ? await importAllMedia() : 0;
  // The source still has the old dates and team, so re-apply the agreed corrections after every import.
  console.log('Content updates…', await applyContentUpdates(prisma));
  console.log(`Done. pages=${pageCount} eventsWritten=${ev.done} eventsSkipped=${ev.skipped} posts=${posts.length} staff=${staff} partners=${partners} files=${imageCache.size}${ALL_MEDIA ? ` library=${library}` : ''}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
