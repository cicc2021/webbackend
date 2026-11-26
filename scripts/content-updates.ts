/**
 * Applies the CICC requirements of 4 November 2026 to the content: program period 2026–2036, the new
 * copyright notice, CICC navy instead of the old red in page styling, and the official MHQ team.
 * Safe to re-run: every change is a replacement or an upsert. The site importer runs it too, so a
 * re-import can't bring the old content back.
 *
 *   npm run content:update
 */
import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import { databaseFromEnv } from '../src/config/configuration';
import { createAdapter } from '../src/prisma/client';

/** Ordered: the longer phrases go first so the plain range doesn't pre-empt them. */
export const TEXT_REPLACEMENTS: [string, string][] = [
  ['© Copyright 2025 – All Rights Reserved', '© 2026 Council of International Chambers of Commerce. All Rights Reserved.'],
  ['September 2025 – December 2030', 'January 2026 – December 2036'],
  ['2025–2030', '2026–2036'],
  ['2025-2030', '2026–2036'],
  ['2025 – 2030', '2026–2036'],
  ['2025–2035', '2026–2036'],
];

const BLOCK_STYLE = {
  background: '', backgroundImage: '', color: '', paddingTop: 48, paddingBottom: 48, width: 'normal', textAlign: 'left',
  fontFamily: 'sans', fontScale: 100, radius: 0, shadow: 'none', animation: 'rise', hideOnMobile: false,
};

/** Old brand red in stored page styles and category colours, mapped to the CICC palette. */
const COLOUR_REPLACEMENTS: [string, string][] = [
  ['#eb3f43', '#0b1f4d'],
  ['#c92b30', '#163b8c'],
];
const CATEGORY_COLOURS: Record<string, string> = {
  'b2b-conferences': '#1f4fb8',
  conferences: '#0b1f4d',
  seminars: '#2f7bbf',
  'project-site-visits': '#1f8a70',
  launches: '#b8955a',
};

interface Person {
  name: string;
  /** Internal only: never published, except the President's. */
  designation: string;
  /** Matches the importer's keys, so a re-import updates instead of duplicating. */
  key: string;
  /** Only filled where the import has no country. Inferred from the registration code's ISO country number. */
  country?: string;
}

/**
 * Governance structure, in display order. Publicly, only the President's name appears; every other
 * body is shown as the list of countries its members represent. Names and positions stay internal.
 */
export const GOVERNANCE: { group: string; people: Person[] }[] = [
  { group: "President's Desk", people: [{ name: 'Besim Jashari', designation: 'Founder & President', key: 'president' }] },
  {
    group: 'Executive Management',
    people: [
      { name: 'Prof. Dr. Bharat Purohit', designation: 'Attorney General', key: 'mhq:22356151', country: 'India' },
      { name: 'Eng. Tutuk Astyawati', designation: 'Chairwoman – Admin & HR', key: 'mhq:21360013', country: 'Indonesia' },
      { name: 'Irfan Sheikh', designation: 'Chairman – Economic Development & Finance', key: 'mhq:21356007', country: 'India' },
      { name: 'Sheikh Khalifa', designation: 'Honorary Chairman', key: 'board:21048056' },
      { name: 'Jaqueline Guelirion', designation: 'Advisor to President', key: 'board:21756005' },
      { name: 'Syed Tauseef Zaidi', designation: 'Investment Advisor', key: 'board:22784138' },
    ],
  },
  {
    group: 'Executive Board',
    people: [
      { name: 'Aroid Jashari', designation: 'CEO – MHQ', key: 'board:24000218' },
      { name: 'Lindim Menna', designation: 'Board of Investor Member', key: 'board:24756217' },
      { name: 'Leonora Kusari', designation: 'CEO – Balkan RHQ', key: 'board:24000215' },
      { name: 'Baton Kusari', designation: 'CEO – Kosovo HQ', key: 'board:26000267', country: 'Kosovo' },
      { name: 'Priscilla Nyathi', designation: 'Investment & Wealth Management Director', key: 'board:21826035' },
      { name: 'Jacob Osei Yeboah', designation: 'CEO – Africa RHQ in Ghana', key: 'board:23228185' },
      { name: 'Jorge Artulo Cordoba Solano', designation: 'CEO – Costa Rica HQ', key: 'board:21188105' },
      { name: 'Panya Kukereekhet', designation: 'CEO – Thailand HQ', key: 'board:22764157' },
      { name: 'Silvia Varga', designation: 'CEO – International Healthcare Club', key: 'board:21036040' },
      { name: 'Khulood Alhosani', designation: 'Government Affairs Director', key: 'board:24784205' },
      { name: 'Penka Ivanova', designation: 'CEO – Oil & Trading', key: 'board:23364166' },
    ],
  },
];
/** Published as countries too: everyone the import placed on the Advisory Board. */
const ADVISORY_BOARD = 'Advisory Board';

/** Individual names inside page and event text, replaced so only the President's name is published. */
const NAME_REPLACEMENTS: [string, string][] = [
  ['under the leadership and supervision of Mr. Irfan Sheikh', 'under the leadership and supervision of the Blockchain Department'],
  ['Warm regards,<br />Irfan Sheikh<br />Managing Director – Blockchain Department CICC', 'Warm regards,<br />Blockchain Department, CICC'],
  ['<br />\n(Host Speakers: Mrs. Priscilla Nyathi &amp; Prof.Dr. Bharat Purohit)', ''],
  ['<h2>Mr. Irfan Sheikh</h2><div>Managing Director, Blockchain Department &amp; Head of AI &amp; SI Department</div>', '<h2>AI &amp; SI Department</h2>'],
  ['Under the leadership of Mr. Irfan Sheikh, the proposed department', 'Under the leadership of the Blockchain Department, the proposed department'],
];

const BOARD_MEMBERS_PAGE = 6216;
/** The official seal on a 3:2 white canvas, served by the website itself (frontend/public). */
const SEAL_COVER = '/cicc-logo-cover.jpg';
const BOARD_MEMBERS_INTRO =
  "<p>The Council's governance bodies represent its international presence across 150 countries, through country representatives, advisory members, honorary consuls and government representatives.</p>";

export async function applyContentUpdates(prisma: PrismaClient) {
  const counts: Record<string, number> = {};
  await prisma.$transaction(
    async (tx) => {
      // 1. Text and colours wherever content is stored.
      // Matched as stored: inside page blocks (JSON) and in event and post HTML.
      for (const [from, to] of [...TEXT_REPLACEMENTS, ...COLOUR_REPLACEMENTS, ...NAME_REPLACEMENTS]) {
        const changed =
          (await tx.$executeRaw`UPDATE "Page" SET blocks = replace(blocks::text, ${from}, ${to})::jsonb, title = replace(title, ${from}, ${to}), excerpt = replace(excerpt, ${from}, ${to}), "seoTitle" = replace("seoTitle", ${from}, ${to}), "seoDescription" = replace("seoDescription", ${from}, ${to}) WHERE blocks::text LIKE '%' || ${from} || '%' OR title LIKE '%' || ${from} || '%' OR excerpt LIKE '%' || ${from} || '%'`) +
          (await tx.$executeRaw`UPDATE "Event" SET content = replace(content, ${from}, ${to}), title = replace(title, ${from}, ${to}), summary = replace(summary, ${from}, ${to}) WHERE content LIKE '%' || ${from} || '%' OR title LIKE '%' || ${from} || '%' OR summary LIKE '%' || ${from} || '%'`) +
          (await tx.$executeRaw`UPDATE "BlogPost" SET content = replace(content, ${from}, ${to}), title = replace(title, ${from}, ${to}), excerpt = replace(excerpt, ${from}, ${to}) WHERE content LIKE '%' || ${from} || '%' OR title LIKE '%' || ${from} || '%' OR excerpt LIKE '%' || ${from} || '%'`);
        if (changed) counts[`"${from.slice(0, 40)}"`] = changed;
      }
      for (const [slug, color] of Object.entries(CATEGORY_COLOURS)) {
        await tx.eventCategory.updateMany({ where: { slug }, data: { color } });
      }

      // Event summaries were cut from the original text at import, so they can still carry names.
      for (const e of await tx.event.findMany({ where: { summary: { contains: 'Host Speakers' } } })) {
        await tx.event.update({ where: { id: e.id }, data: { summary: e.summary.replace(/\s*\(Host Speakers:[^)]*\)?/g, '') } });
      }

      // The old "CICC Project Feasibility Team" logo is replaced by the official seal, which the website serves.
      const oldLogos = await tx.media.findMany({ where: { filename: { startsWith: 'CICC-PROJECT-FEASIBILITY-TEAM' } }, select: { url: true } });
      if (oldLogos.length) {
        const urls = oldLogos.map((m) => m.url);
        counts.oldLogoCovers =
          (await tx.event.updateMany({ where: { coverUrl: { in: urls } }, data: { coverUrl: SEAL_COVER } })).count +
          (await tx.page.updateMany({ where: { coverUrl: { in: urls } }, data: { coverUrl: SEAL_COVER } })).count +
          (await tx.blogPost.updateMany({ where: { coverUrl: { in: urls } }, data: { coverUrl: SEAL_COVER } })).count;
      }

      // 2. Governance: listed people are published in order; the Advisory Board follows; nobody else is.
      const keep: string[] = [];
      let order = 0;
      for (const { group, people } of GOVERNANCE) {
        for (const p of people) {
          const data = { name: p.name, designation: p.designation, group, sortOrder: order++, isPublished: true, pageId: null, photoUrl: '', ...(p.country ? { country: p.country } : {}) };
          await tx.staffMember.upsert({ where: { sourceKey: p.key }, update: data, create: { ...data, country: p.country ?? '', sourceKey: p.key } });
          keep.push(p.key);
        }
      }
      const advisory = await tx.staffMember.findMany({ where: { group: ADVISORY_BOARD, sourceKey: { startsWith: 'board:' } }, orderBy: { sortOrder: 'asc' } });
      for (const a of advisory) {
        await tx.staffMember.update({ where: { id: a.id }, data: { isPublished: true, pageId: null, photoUrl: '', sortOrder: order++ } });
        keep.push(a.sourceKey!);
      }
      counts.governance = keep.length;
      counts.unpublished = (
        await tx.staffMember.updateMany({ where: { isPublished: true, OR: [{ sourceKey: null }, { sourceKey: { notIn: keep } }] }, data: { isPublished: false } })
      ).count;

      // The Board Members page listed every name and registration code; it now shows the countries per body.
      const board = await tx.page.findUnique({ where: { sourceId: BOARD_MEMBERS_PAGE } });
      if (board) {
        await tx.page.update({
          where: { id: board.id },
          data: {
            blocks: [
              { id: 'board-intro', type: 'richText', data: { html: BOARD_MEMBERS_INTRO }, style: { ...BLOCK_STYLE, paddingBottom: 0 } },
              { id: 'board-governance', type: 'governance', data: {}, style: BLOCK_STYLE },
            ],
            excerpt: 'The CICC governance bodies and the countries they represent.',
          },
        });
      }

      // 3. The old site's team widget listed names and photos, so remove it from the page body. It runs from its "… MANAGEMENT" heading to the end of the block.
      for (const page of await tx.page.findMany({ where: { sourceId: { not: null } } })) {
        const blocks = page.blocks as { type: string; data: { html?: string } }[];
        let changed = false;
        for (const b of blocks) {
          const html = b.data.html ?? '';
          const filters = html.indexOf('All Members</div>');
          if (b.type !== 'richText' || filters === -1) continue;
          const heading = html.lastIndexOf('<p', filters);
          if (heading === -1 || !/MANAGEMENT/i.test(html.slice(heading, filters))) continue;
          b.data.html = html.slice(0, heading).trimEnd();
          changed = true;
        }
        if (changed) await tx.page.update({ where: { id: page.id }, data: { blocks } });
      }

      // 4. Department staff stay internal: kept for the admin, linked to their page, never published.
      const cards = await tx.staffMember.findMany({ where: { sourceKey: { startsWith: 'card:' } } });
      for (const card of cards) {
        const page = await tx.page.findUnique({ where: { sourceId: Number(card.sourceKey!.split(':')[1]) }, select: { id: true } });
        await tx.staffMember.update({ where: { id: card.id }, data: { pageId: page?.id ?? null, isPublished: false, photoUrl: '' } });
      }
    },
    { timeout: 120_000 },
  );
  // Last line of defence: report any other person's name still in published text.
  const names = (await prisma.staffMember.findMany({ where: { NOT: { sourceKey: 'president' } }, select: { name: true } }))
    .map((n) => n.name.replace(/^(Prof\. Dr\.|Eng\.|Dr\.|Col|H\.e\.)\s+/i, '').split(',')[0].trim())
    .filter((n) => n.split(' ').length > 1);
  const texts = [
    ...(await prisma.page.findMany({ where: { status: 'PUBLISHED' }, select: { path: true, blocks: true } })).map((p) => [p.path, JSON.stringify(p.blocks)]),
    ...(await prisma.event.findMany({ where: { status: 'PUBLISHED' }, select: { slug: true, content: true, summary: true, title: true } })).map((e) => [`event ${e.slug}`, e.content + e.summary + e.title]),
    ...(await prisma.blogPost.findMany({ where: { status: 'PUBLISHED' }, select: { slug: true, content: true } })).map((b) => [`post ${b.slug}`, b.content]),
  ];
  const leaks = texts.flatMap(([where, text]) => names.filter((n) => text.toLowerCase().includes(n.toLowerCase())).map((n) => `${n} in ${where}`));
  if (leaks.length) console.warn('Names still published:', leaks);
  counts.namesStillPublished = leaks.length;
  return counts;
}

if (require.main === module) {
  for (const f of ['.env.local', `.env.${process.env.NODE_ENV ?? 'development'}`, '.env']) loadEnv({ path: f, quiet: true });
  const prisma = new PrismaClient({ adapter: createAdapter(databaseFromEnv()) });
  applyContentUpdates(prisma)
    .then((counts) => console.log('Content updated:', counts))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
