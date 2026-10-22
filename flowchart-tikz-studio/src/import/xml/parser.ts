/**
 * A small, strict, DOM-free XML parser.
 *
 * Why not `DOMParser`? Three reasons:
 *
 *  - It does not exist inside a Web Worker, and the import pipeline runs in
 *    one so that parsing a large file never freezes the editor.
 *  - Parsing SVG with the browser's parser builds live SVG elements. Nothing
 *    here is ever attached to a document, and nothing is ever rendered from
 *    the source markup: the parser yields plain objects, and the importers
 *    read *data* out of them. There is no path by which a `<script>`, an event
 *    handler attribute or a `javascript:` URL in an imported file can execute.
 *  - Entity handling is under our control. Internal entity declarations are
 *    rejected outright, which rules out "billion laughs" expansion and
 *    external-entity (XXE) reads by construction.
 *
 * The parser is intentionally not a validating one; it accepts well-formed
 * XML plus the handful of HTML entity names that show up in real-world SVG.
 */

export interface XmlElement {
  type: 'element';
  /** Qualified name as written, e.g. "svg:rect" or "rect". */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

export interface XmlText {
  type: 'text';
  value: string;
}

export type XmlNode = XmlElement | XmlText;

export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlError';
  }
}

export interface XmlParseOptions {
  /** Maximum element nesting. Deeply nested input is rejected, not recursed into. */
  maxDepth?: number;
  /** Maximum number of elements. */
  maxElements?: number;
}

const PREDEFINED: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  // HTML names that commonly leak into hand-written or exported SVG.
  nbsp: '\u00a0',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  deg: '°',
  times: '×',
  middot: '·',
};

/** Decode character and entity references. Unknown names are kept literally. */
export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      // Control characters other than tab/newline/return have no business in a diagram label.
      if (code < 0x20 && code !== 0x9 && code !== 0xa && code !== 0xd) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    }
    const named = PREDEFINED[ref];
    return named !== undefined ? named : whole;
  });
}

const NAME_START = /[A-Za-z_:À-￿]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-·À-￿]/;

export function parseXml(source: string, opts: XmlParseOptions = {}): XmlElement {
  const maxDepth = opts.maxDepth ?? 256;
  const maxElements = opts.maxElements ?? 200_000;
  let src = source;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);

  let i = 0;
  const n = src.length;
  let elementCount = 0;
  let root: XmlElement | null = null;
  const stack: XmlElement[] = [];

  const fail = (msg: string): never => {
    // Report a line number, never the offending content itself.
    const line = src.slice(0, i).split('\n').length;
    throw new XmlError(`${msg} (line ${line})`);
  };

  const readName = (): string => {
    const start = i;
    if (i >= n || !NAME_START.test(src[i])) fail('Expected a name');
    i++;
    while (i < n && NAME_CHAR.test(src[i])) i++;
    return src.slice(start, i);
  };

  const skipSpace = () => {
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };

  const appendText = (value: string) => {
    if (!value) return;
    const parent = stack[stack.length - 1];
    if (!parent) {
      if (value.trim()) fail('Text outside the root element');
      return;
    }
    const last = parent.children[parent.children.length - 1];
    if (last && last.type === 'text') last.value += value;
    else parent.children.push({ type: 'text', value });
  };

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      appendText(decodeEntities(src.slice(i)));
      i = n;
      break;
    }
    if (lt > i) appendText(decodeEntities(src.slice(i, lt)));
    i = lt;

    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      if (end < 0) fail('Unterminated comment');
      i = end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      if (end < 0) fail('Unterminated CDATA section');
      appendText(src.slice(i + 9, end));
      i = end + 3;
      continue;
    }
    if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2);
      if (end < 0) fail('Unterminated processing instruction');
      i = end + 2;
      continue;
    }
    if (src.startsWith('<!DOCTYPE', i) || src.startsWith('<!doctype', i)) {
      // Skip the declaration, including an internal subset, but refuse any
      // entity definitions inside it.
      let depth = 0;
      let j = i + 9;
      for (; j < n; j++) {
        const c = src[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      if (j >= n) fail('Unterminated DOCTYPE');
      const decl = src.slice(i, j + 1);
      if (/<!ENTITY/i.test(decl)) {
        throw new XmlError('Entity declarations are not allowed in imported files');
      }
      i = j + 1;
      continue;
    }
    if (src.startsWith('<!', i)) fail('Unsupported markup declaration');

    if (src[i + 1] === '/') {
      i += 2;
      const name = readName();
      skipSpace();
      if (src[i] !== '>') fail('Malformed closing tag');
      i++;
      const open = stack.pop();
      if (!open) fail(`Unexpected closing tag </${name}>`);
      if (open!.name !== name) fail(`Mismatched closing tag </${name}>, expected </${open!.name}>`);
      continue;
    }

    // Start tag.
    i++;
    const name = readName();
    const attrs: Record<string, string> = Object.create(null);
    let selfClosing = false;
    for (;;) {
      skipSpace();
      if (i >= n) fail('Unterminated start tag');
      const c = src[i];
      if (c === '>') {
        i++;
        break;
      }
      if (c === '/' && src[i + 1] === '>') {
        i += 2;
        selfClosing = true;
        break;
      }
      const attrName = readName();
      skipSpace();
      if (src[i] !== '=') fail(`Attribute ${attrName} has no value`);
      i++;
      skipSpace();
      const q = src[i];
      if (q !== '"' && q !== "'") fail('Attribute value must be quoted');
      const end = src.indexOf(q, i + 1);
      if (end < 0) fail('Unterminated attribute value');
      const raw = src.slice(i + 1, end);
      if (raw.indexOf('<') >= 0) fail('"<" is not allowed in attribute values');
      // Attribute-value normalisation: literal whitespace becomes a space;
      // character references (e.g. &#xa;) survive, which is how draw.io
      // encodes line breaks in labels.
      attrs[attrName] = decodeEntities(raw.replace(/[\t\n\r]/g, ' '));
      i = end + 1;
    }

    elementCount++;
    if (elementCount > maxElements) throw new XmlError('The file has too many elements to import');
    if (stack.length >= maxDepth) throw new XmlError('The file is nested too deeply to import');

    // `attrs` has a null prototype, so an attribute literally named
    // `__proto__` is just an attribute and cannot pollute anything.
    const el: XmlElement = { type: 'element', name, attrs, children: [] };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(el);
    else if (root) fail('More than one root element');
    else root = el;
    if (!selfClosing) stack.push(el);
  }

  if (stack.length) throw new XmlError(`Unclosed element <${stack[stack.length - 1].name}>`);
  if (!root) throw new XmlError('No root element found');
  return root;
}

/* ------------------------------------------------------------- helpers */

/** Local part of a qualified name: "svg:rect" -> "rect". */
export function localName(name: string): string {
  const k = name.indexOf(':');
  return (k >= 0 ? name.slice(k + 1) : name).toLowerCase();
}

export function childElements(el: XmlElement): XmlElement[] {
  return el.children.filter((c): c is XmlElement => c.type === 'element');
}

/** First descendant (depth-first) whose local name matches. */
export function findFirst(el: XmlElement, name: string): XmlElement | null {
  for (const c of el.children) {
    if (c.type !== 'element') continue;
    if (localName(c.name) === name) return c;
    const deeper = findFirst(c, name);
    if (deeper) return deeper;
  }
  return null;
}

export function findAll(el: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of el.children) {
    if (c.type !== 'element') continue;
    if (localName(c.name) === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

/** Concatenated text content of an element and its descendants. */
export function textContent(el: XmlNode): string {
  if (el.type === 'text') return el.value;
  return el.children.map(textContent).join('');
}

/** Attribute lookup that ignores namespace prefixes ("xlink:href" == "href"). */
export function attr(el: XmlElement, name: string): string | undefined {
  const direct = el.attrs[name];
  if (direct !== undefined) return direct;
  for (const k of Object.keys(el.attrs)) {
    if (localName(k) === name.toLowerCase()) return el.attrs[k];
  }
  return undefined;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Serialise a (sanitised) tree back to markup. */
export function serializeXml(el: XmlElement, indent = ''): string {
  const attrs = Object.keys(el.attrs)
    .map((k) => ` ${k}="${escapeXml(el.attrs[k])}"`)
    .join('');
  if (el.children.length === 0) return `${indent}<${el.name}${attrs}/>`;
  const onlyText = el.children.every((c) => c.type === 'text');
  if (onlyText) {
    return `${indent}<${el.name}${attrs}>${escapeXml(textContent(el))}</${el.name}>`;
  }
  const inner = el.children
    .map((c) => (c.type === 'text' ? (c.value.trim() ? escapeXml(c.value) : '') : serializeXml(c, `${indent}  `)))
    .filter(Boolean)
    .join('\n');
  return `${indent}<${el.name}${attrs}>\n${inner}\n${indent}</${el.name}>`;
}
