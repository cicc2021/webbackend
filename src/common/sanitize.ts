import sanitizeHtml from 'sanitize-html';

const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%/]+\)$/i, /^[a-z]+$/i];
const LENGTH = [/^-?\d+(\.\d+)?(px|em|rem|%|vw)?$/];
const SPACING = [/^(-?\d+(\.\d+)?(px|em|rem|%)?|auto)(\s+(-?\d+(\.\d+)?(px|em|rem|%)?|auto)){0,3}$/];

/** Classes the frontend's prose stylesheet understands. Anything else is theme residue. */
const KEPT_CLASSES = ['wp-block-buttons', 'wp-block-button__link', 'wp-block-separator', 'btn-link'];

const options: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li',
    'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'mark', 'small', 'span', 'div', 'a', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'section', 'article',
    'iframe',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'class', 'style'],
    img: ['src', 'alt', 'width', 'height', 'loading', 'style', 'class', 'data-placement'],
    iframe: ['src', 'width', 'height', 'allowfullscreen', 'title', 'loading'],
    td: ['colspan', 'rowspan', 'style'],
    th: ['colspan', 'rowspan', 'style', 'scope'],
    '*': ['style', 'class'],
  },
  allowedClasses: { '*': KEPT_CLASSES },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  allowedIframeHostnames: ['www.youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com', 'www.google.com'],
  allowedStyles: {
    '*': {
      color: COLOR,
      'background-color': COLOR,
      'text-align': [/^(left|right|center|justify)$/],
      'font-size': LENGTH,
      'font-weight': [/^(normal|bold|[1-9]00)$/],
      'font-style': [/^(normal|italic)$/],
      'font-family': [/^[\w\s,"'-]+$/],
      'text-decoration': [/^(none|underline|line-through)$/],
      'line-height': LENGTH,
      'letter-spacing': LENGTH,
      'text-transform': [/^(none|uppercase|lowercase|capitalize)$/],
      width: LENGTH,
      'max-width': LENGTH,
      height: [...LENGTH, /^auto$/],
      float: [/^(left|right|none)$/],
      display: [/^(block|inline-block)$/],
      margin: SPACING,
      'margin-left': SPACING,
      'margin-right': SPACING,
      'margin-top': SPACING,
      'margin-bottom': SPACING,
      padding: SPACING,
      'border-radius': LENGTH,
    },
  },
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: attribs.target === '_blank' ? { ...attribs, rel: 'noopener noreferrer' } : attribs,
    }),
  },
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'form', 'select', 'button'],
};

/** Every piece of stored HTML passes through here, so public pages can render it as-is. */
export function cleanHtml(html: string): string {
  return sanitizeHtml(html ?? '', options);
}

export function stripTags(html: string): string {
  return sanitizeHtml(html ?? '', { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
