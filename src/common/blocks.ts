import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { cleanHtml } from './sanitize';

/**
 * Pages are an ordered list of blocks. This is the server's copy of the contract: unknown block
 * types are rejected and every field is coerced to a known shape, because blocks are rendered
 * straight into CSS and HTML on the public site.
 */
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : '');
/** Only http(s) and site-relative URLs; blocks a javascript: href or a CSS url() breakout. */
const url = (v: unknown) => {
  const s = str(v).trim();
  return /^(https?:\/\/|\/(?!\/)|mailto:|tel:|#)[^\s"'()<>\\]*$/i.test(s) ? s : '';
};

const PLACEMENTS = ['full', 'wide', 'center', 'left', 'right'] as const;

function cleanImage(v: unknown) {
  const d = (v ?? {}) as Record<string, unknown>;
  return { url: url(d.url), alt: str(d.alt, 300), caption: str(d.caption, 500) };
}

const BLOCKS: Record<string, (d: Record<string, unknown>) => Record<string, unknown>> = {
  richText: (d) => ({ html: cleanHtml(str(d.html, 500_000)) }),
  heading: (d) => ({
    eyebrow: str(d.eyebrow, 200),
    text: str(d.text, 500),
    level: oneOf(d.level, ['h1', 'h2', 'h3'], 'h2'),
    size: oneOf(d.size, ['md', 'lg', 'xl', 'display'], 'lg'),
  }),
  hero: (d) => ({
    eyebrow: str(d.eyebrow, 200),
    title: str(d.title, 300),
    subtitle: str(d.subtitle, 800),
    imageUrl: url(d.imageUrl),
    overlay: num(d.overlay, 0, 90, 40),
    height: num(d.height, 30, 100, 70),
    contentPosition: oneOf(d.contentPosition, ['top', 'center', 'bottom'], 'bottom'),
    buttonLabel: str(d.buttonLabel, 80),
    buttonHref: url(d.buttonHref),
  }),
  image: (d) => ({
    ...cleanImage(d),
    placement: oneOf(d.placement, PLACEMENTS, 'wide'),
    widthPct: num(d.widthPct, 10, 100, 50),
    aspect: oneOf(d.aspect, ['auto', '1/1', '4/3', '16/9', '21/9', '3/4'], 'auto'),
    focalX: num(d.focalX, 0, 100, 50),
    focalY: num(d.focalY, 0, 100, 50),
    href: url(d.href),
  }),
  imageText: (d) => ({
    ...cleanImage(d),
    html: cleanHtml(str(d.html, 200_000)),
    side: oneOf(d.side, ['left', 'right'], 'left'),
    widthPct: num(d.widthPct, 20, 80, 50),
    align: oneOf(d.align, ['start', 'center', 'end'], 'center'),
  }),
  gallery: (d) => ({
    images: (Array.isArray(d.images) ? d.images : []).slice(0, 60).map(cleanImage),
    columns: num(d.columns, 1, 6, 3),
    gap: num(d.gap, 0, 64, 16),
    aspect: oneOf(d.aspect, ['auto', '1/1', '4/3', '16/9', '3/4'], '4/3'),
    fit: oneOf(d.fit, ['cover', 'contain'], 'cover'),
  }),
  columns: (d) => ({
    columns: (Array.isArray(d.columns) ? d.columns : []).slice(0, 4).map((c) => cleanHtml(str(c, 100_000))),
    gap: num(d.gap, 0, 96, 32),
  }),
  quote: (d) => ({ text: str(d.text, 1500), cite: str(d.cite, 200) }),
  cta: (d) => ({
    title: str(d.title, 300),
    text: str(d.text, 800),
    buttonLabel: str(d.buttonLabel, 80),
    buttonHref: url(d.buttonHref),
  }),
  form: (d) => ({
    title: str(d.title, 200),
    intro: str(d.intro, 800),
    subject: str(d.subject, 120) || 'General enquiry',
    nameLabel: str(d.nameLabel, 200) || 'Full name',
    emailLabel: str(d.emailLabel, 200) || 'Email',
    phoneLabel: str(d.phoneLabel, 200) || 'Phone',
    phoneRequired: d.phoneRequired === true,
    fields: (Array.isArray(d.fields) ? d.fields : []).slice(0, 12).map((f) => {
      const x = (f ?? {}) as Record<string, unknown>;
      return {
        type: oneOf(x.type, ['text', 'textarea', 'radio'], 'text'),
        label: str(x.label, 300),
        required: x.required === true,
        options: (Array.isArray(x.options) ? x.options : []).slice(0, 30).map((o) => str(o, 120)).filter(Boolean),
        note: str(x.note, 500),
      };
    }),
    submitLabel: str(d.submitLabel, 40) || 'Submit',
  }),
  divider: () => ({}),
  /** The governance bodies and their countries, filled in from the team list when the page renders. */
  governance: () => ({}),
  spacer: (d) => ({ height: num(d.height, 0, 400, 48) }),
};

export const BLOCK_TYPES = Object.keys(BLOCKS);

function cleanStyle(v: unknown) {
  const s = (v ?? {}) as Record<string, unknown>;
  return {
    background: color(s.background),
    backgroundImage: url(s.backgroundImage),
    color: color(s.color),
    paddingTop: num(s.paddingTop, 0, 320, 48),
    paddingBottom: num(s.paddingBottom, 0, 320, 48),
    width: oneOf(s.width, ['narrow', 'normal', 'wide', 'full'], 'normal'),
    textAlign: oneOf(s.textAlign, ['left', 'center', 'right'], 'left'),
    fontFamily: oneOf(s.fontFamily, ['sans', 'serif'], 'sans'),
    fontScale: num(s.fontScale, 70, 200, 100),
    radius: num(s.radius, 0, 64, 0),
    shadow: oneOf(s.shadow, ['none', 'soft', 'strong'], 'none'),
    animation: oneOf(s.animation, ['none', 'fade', 'rise', 'zoom'], 'rise'),
    hideOnMobile: s.hideOnMobile === true,
  };
}

export function cleanBlocks(input: unknown): unknown[] {
  if (!Array.isArray(input)) throw new BadRequestException('blocks must be an array');
  return input.map((raw, i) => {
    const b = (raw ?? {}) as Record<string, unknown>;
    const clean = typeof b.type === 'string' && Object.hasOwn(BLOCKS, b.type) ? BLOCKS[b.type] : undefined;
    if (!clean) throw new BadRequestException(`Block ${i + 1}: unknown type "${String(b.type)}"`);
    return {
      id: /^[\w-]{1,64}$/.test(str(b.id)) ? b.id : randomUUID(),
      type: b.type,
      data: clean((b.data ?? {}) as Record<string, unknown>),
      style: cleanStyle(b.style),
    };
  });
}
