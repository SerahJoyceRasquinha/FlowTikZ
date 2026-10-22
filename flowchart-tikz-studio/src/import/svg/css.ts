import type { XmlElement } from '../xml/parser';
import { localName } from '../xml/parser';

/**
 * Just enough CSS to style exported SVG faithfully.
 *
 * Illustrator, Inkscape, Mermaid, draw.io and friends put presentation into
 * `<style>` blocks with class, id and element selectors, sometimes with a
 * descendant or child combinator. This module parses those rules and resolves
 * which declarations apply to an element, honouring specificity and source
 * order. At-rules, pseudo-classes and attribute selectors are ignored (and so
 * never match), which is the safe direction to be wrong in.
 */

interface Compound {
  tag?: string;
  id?: string;
  classes: string[];
}

interface Selector {
  /** Compounds from left to right, with the combinator *before* each. */
  parts: { compound: Compound; combinator: ' ' | '>' }[];
  specificity: number;
}

export interface CssRule {
  selector: Selector;
  decls: Record<string, string>;
  order: number;
}

function parseCompound(s: string): Compound | null {
  if (!s || /[:[\]()]/.test(s)) return null;
  const c: Compound = { classes: [] };
  const re = /([#.]?)([\w-]+|\*)/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(s))) {
    consumed += m[0].length;
    if (m[1] === '#') c.id = m[2];
    else if (m[1] === '.') c.classes.push(m[2]);
    else if (m[2] !== '*') c.tag = m[2].toLowerCase();
  }
  return consumed === s.length ? c : null;
}

function parseSelector(src: string): Selector | null {
  const tokens = src.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
  const parts: Selector['parts'] = [];
  let combinator: ' ' | '>' = ' ';
  let spec = 0;
  for (const t of tokens) {
    if (t === '>') {
      combinator = '>';
      continue;
    }
    const compound = parseCompound(t);
    if (!compound) return null;
    spec += (compound.id ? 100 : 0) + compound.classes.length * 10 + (compound.tag ? 1 : 0);
    parts.push({ compound, combinator });
    combinator = ' ';
  }
  return parts.length ? { parts, specificity: spec } : null;
}

export function parseDeclarations(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of src.split(';')) {
    const k = decl.indexOf(':');
    if (k < 0) continue;
    const prop = decl.slice(0, k).trim().toLowerCase();
    const value = decl
      .slice(k + 1)
      .replace(/!important/i, '')
      .trim();
    if (prop && value) out[prop] = value;
  }
  return out;
}

export function parseCss(css: string, startOrder = 0): CssRule[] {
  const rules: CssRule[] = [];
  // Comments and at-rule blocks (media queries, font-faces) are dropped.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[^{;]*(\{[^{}]*(\{[^{}]*\}[^{}]*)*\}|;)/g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  let order = startOrder;
  while ((m = re.exec(text))) {
    const decls = parseDeclarations(m[2]);
    for (const sel of m[1].split(',')) {
      const selector = parseSelector(sel);
      if (selector) rules.push({ selector, decls, order: order++ });
    }
  }
  return rules;
}

function matchesCompound(el: XmlElement, c: Compound): boolean {
  if (c.tag && localName(el.name) !== c.tag) return false;
  if (c.id && el.attrs.id !== c.id) return false;
  if (c.classes.length) {
    const cls = (el.attrs.class ?? '').split(/\s+/);
    for (const k of c.classes) if (!cls.includes(k)) return false;
  }
  return true;
}

/** Does `sel` match `el`, given its ancestors (nearest last)? */
export function matches(sel: Selector, el: XmlElement, ancestors: XmlElement[]): boolean {
  const parts = sel.parts;
  if (!matchesCompound(el, parts[parts.length - 1].compound)) return false;
  let a = ancestors.length - 1;
  for (let i = parts.length - 2; i >= 0; i--) {
    const needDirect = parts[i + 1].combinator === '>';
    if (needDirect) {
      if (a < 0 || !matchesCompound(ancestors[a], parts[i].compound)) return false;
      a--;
    } else {
      while (a >= 0 && !matchesCompound(ancestors[a], parts[i].compound)) a--;
      if (a < 0) return false;
      a--;
    }
  }
  return true;
}

/** Declarations from stylesheet rules that apply to `el`, cascade-resolved. */
export function cascade(rules: CssRule[], el: XmlElement, ancestors: XmlElement[]): Record<string, string> {
  const hits = rules.filter((r) => matches(r.selector, el, ancestors));
  hits.sort((a, b) => a.selector.specificity - b.selector.specificity || a.order - b.order);
  const out: Record<string, string> = {};
  for (const h of hits) Object.assign(out, h.decls);
  return out;
}
