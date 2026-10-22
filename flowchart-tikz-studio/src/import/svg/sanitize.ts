import { XmlElement, XmlNode, localName, textContent } from '../xml/parser';

/**
 * SVG sanitisation.
 *
 * Imported SVG is never inserted into the page: it is parsed into plain
 * objects and read as data. Sanitisation is therefore defence in depth - it
 * guarantees that the tree the importer walks (and the reconstruction SVG the
 * user can download) contains nothing active and nothing that reaches out to
 * the network:
 *
 *  - script, event-handler attributes and `javascript:` URLs are removed;
 *  - elements that embed other documents or animate are removed;
 *  - `href`s must point inside the document (`#id`) or be an inline raster
 *    `data:` URI; external references are removed and counted;
 *  - `url(...)` in styles may only reference `#id`;
 *  - `<foreignObject>` HTML is reduced to its plain text, which is all the
 *    importer ever reads from it.
 */

export interface SanitizeStats {
  scripts: number;
  eventHandlers: number;
  externalRefs: number;
  activeElements: number;
  foreignObjects: number;
}

const REMOVE_ELEMENTS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'canvas',
  'animate',
  'animatemotion',
  'animatetransform',
  'animatecolor',
  'set',
  'handler',
  'listener',
  'discard',
  'meta',
  'link',
  'base',
]);

const SAFE_DATA_URI = /^data:image\/(png|jpe?g|gif|webp|bmp|avif);base64,[A-Za-z0-9+/=\s]*$/i;

function isInternalRef(v: string): boolean {
  return /^\s*#[\w.:-]+\s*$/.test(v);
}

/** Drop `url(...)` references that leave the document, and script-ish values. */
export function sanitizeStyleValue(value: string, stats: SanitizeStats): string {
  let out = value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_whole, _q, ref: string) => {
    if (isInternalRef(ref)) return `url(${ref.trim()})`;
    stats.externalRefs++;
    return 'none';
  });
  if (/expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding/i.test(out)) {
    stats.externalRefs++;
    out = out.replace(/expression\s*\([^)]*\)|javascript:[^;]*|@import[^;]*;?|behavior\s*:[^;]*|-moz-binding\s*:[^;]*/gi, '');
  }
  return out;
}

/** Plain text of an HTML fragment, with block breaks as newlines. */
export function htmlToPlainText(node: XmlNode): string {
  if (node.type === 'text') return node.value;
  const name = localName(node.name);
  if (name === 'br') return '\n';
  const inner = node.children.map(htmlToPlainText).join('');
  if (['div', 'p', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(name)) return `\n${inner}\n`;
  return inner;
}

export function tidyLines(s: string): string {
  return s
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l, i, all) => l.length > 0 || (i > 0 && i < all.length - 1 && all[i - 1].length > 0))
    .join('\n')
    .trim();
}

function sanitizeElement(el: XmlElement, stats: SanitizeStats): XmlElement | null {
  const name = localName(el.name);
  if (name === 'script') {
    stats.scripts++;
    return null;
  }
  if (REMOVE_ELEMENTS.has(name)) {
    stats.activeElements++;
    return null;
  }

  const attrs: Record<string, string> = Object.create(null);
  for (const [k, v] of Object.entries(el.attrs)) {
    const key = k.toLowerCase();
    const local = localName(k);
    if (key.startsWith('on')) {
      stats.eventHandlers++;
      continue;
    }
    if (local === 'href' || local === 'src') {
      if (isInternalRef(v)) attrs[k] = v.trim();
      else if (name === 'image' && SAFE_DATA_URI.test(v)) attrs[k] = v;
      else if (/^\s*javascript:/i.test(v)) stats.scripts++;
      else stats.externalRefs++;
      continue;
    }
    if (/^\s*javascript:/i.test(v)) {
      stats.scripts++;
      continue;
    }
    if (key === 'style' || /url\(/i.test(v)) {
      attrs[k] = sanitizeStyleValue(v, stats);
      continue;
    }
    attrs[k] = v;
  }

  if (name === 'foreignobject') {
    stats.foreignObjects++;
    // Keep geometry and the plain text; the HTML itself is discarded.
    const text = tidyLines(htmlToPlainText(el));
    return { type: 'element', name: el.name, attrs, children: text ? [{ type: 'text', value: text }] : [] };
  }

  if (name === 'style') {
    const css = sanitizeStyleValue(textContent(el), stats);
    return { type: 'element', name: el.name, attrs, children: [{ type: 'text', value: css }] };
  }

  const children: XmlNode[] = [];
  for (const c of el.children) {
    if (c.type === 'text') children.push(c);
    else {
      const s = sanitizeElement(c, stats);
      if (s) children.push(s);
    }
  }
  return { type: 'element', name: el.name, attrs, children };
}

export function sanitizeSvg(root: XmlElement): { root: XmlElement; stats: SanitizeStats } {
  const stats: SanitizeStats = {
    scripts: 0,
    eventHandlers: 0,
    externalRefs: 0,
    activeElements: 0,
    foreignObjects: 0,
  };
  if (localName(root.name) !== 'svg') {
    throw new Error('The root element is not <svg>.');
  }
  const clean = sanitizeElement(root, stats);
  if (!clean) throw new Error('The SVG could not be sanitised.');
  return { root: clean, stats };
}
