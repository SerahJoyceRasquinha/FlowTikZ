import type { Diagram } from '../model/types';
import { generateLatex } from '../latex/generator';
import { PGFPLOTS_COMPAT } from '../latex/chart';
import { escapeLatex } from '../latex/escape';
import { serialize, deserialize } from '../persistence/schema';
import { diagramBounds } from '../model/diagram';
import { deflateRaw, inflateRaw } from './zip';
import {
  lineEnd,
  lineStart,
  maskTex,
  newlineOf,
  outline,
  packageUses,
  readGroup,
  tikzLibraries,
} from './texScan';
import { FIGURE_BEGIN, FIGURE_END, type Block, type FileAccess, type ProjectDocument } from './document';

/**
 * Putting a drawing into someone's document.
 *
 * The figure goes exactly where the user clicked, as its own paragraph, in
 * the file that holds that part of the text. Only the packages the drawing
 * really needs - and that the document does not already load - are added,
 * next to the document's own \usepackage lines (in a separate preamble file
 * if that is where the document keeps them, and before hyperref, which must
 * stay last). Colours, styles and TikZ libraries go in one marked block at the
 * end of the preamble. The picture is scaled down to the text width only if it
 * is wider, so margins and column layout stay exactly as they were.
 *
 * Every FlowTikZ figure carries its own diagram (compressed, in comments), so
 * it can be opened and edited visually again, and removed without a trace.
 */

export type Placement = 'here' | 'float';

export interface FigureOptions {
  id: string;
  caption: string;
  label?: string;
  placement: Placement;
  /** Explicit float specifier; defaults to the document's own. */
  placementSpecOverride?: string;
}

export interface FigureCode {
  packages: string[];
  libraries: string[];
  /** \definecolor and \tikzset statements, one string each. */
  definitions: string[];
  /** The tikzpicture, lines without indentation. */
  picture: string[];
  hasCharts: boolean;
  widthCm: number;
}

export const PKG_LINE: Record<string, string> = {
  xcolor: '\\usepackage{xcolor}',
  graphicx: '\\usepackage{graphicx}',
  tikz: '\\usepackage{tikz}',
  pgfplots: '\\usepackage{pgfplots}',
  amsmath: '\\usepackage{amsmath}',
  amssymb: '\\usepackage{amssymb}',
  cancel: '\\usepackage{cancel}',
  circuitikz: '\\usepackage[american]{circuitikz}',
  mhchem: '\\usepackage[version=4]{mhchem}',
  chemfig: '\\usepackage{chemfig}',
  float: '\\usepackage{float}',
  'capt-of': '\\usepackage{capt-of}',
};
/** A load order known to work; ams packages before tikz. */
const PKG_ORDER = ['amsmath', 'amssymb', 'cancel', 'xcolor', 'graphicx', 'tikz', 'pgfplots', 'circuitikz', 'mhchem', 'chemfig', 'float', 'capt-of'];

/** Packages that already provide another one. */
const PROVIDES: Record<string, string[]> = {
  tikz: ['xcolor', 'graphicx'],
  pgfplots: ['tikz', 'xcolor', 'graphicx'],
  circuitikz: ['tikz', 'xcolor', 'graphicx'],
  chemfig: ['tikz', 'xcolor', 'graphicx'],
  graphics: [],
  mathtools: ['amsmath'],
  caption: ['capt-of'],
  'caption2': ['capt-of'],
  subcaption: ['capt-of'],
  amsthm: [],
  'tcolorbox': ['tikz', 'xcolor'],
  'pgf': ['xcolor', 'graphicx'],
};
/** Classes that load packages themselves. */
const CLASS_PROVIDES: Record<string, string[]> = {
  beamer: ['xcolor', 'graphicx', 'amsmath', 'amssymb'],
  standalone: [],
  'memoir': ['graphicx'],
};

/** Packages that should be loaded after everything else. */
const LOAD_LAST = /^(hyperref|cleveref|bookmark|autonum|glossaries|glossaries-extra|hypcap|doi|backref)$/;

/* ================================================================== code */

export function figureCode(d: Diagram): FigureCode {
  const res = generateLatex(d, { mode: 'snippet', comments: false });
  const lines = res.code.split('\n');
  const begin = lines.findIndex((l) => l.startsWith('\\begin{tikzpicture}'));
  const pre = lines.slice(0, begin);
  const picture = lines.slice(begin);
  const hasCharts = res.packages.includes('pgfplots');
  const b = diagramBounds(d);
  return {
    packages: [...new Set(['xcolor', 'graphicx', ...res.packages])],
    libraries: res.libraries,
    definitions: splitStatements(pre.join('\n')),
    picture,
    hasCharts,
    widthCm: b.w / (d.settings.unitsPerCm || 50),
  };
}

/** Split TeX into top-level statements (by balanced braces, one per line start). */
export function splitStatements(src: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (const line of src.split('\n')) {
    if (!cur && !line.trim()) continue;
    cur = cur ? `${cur}\n${line}` : line;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\') {
        i++;
        continue;
      }
      if (line[i] === '{') depth++;
      else if (line[i] === '}') depth--;
    }
    if (depth <= 0) {
      if (cur.trim() && !cur.trim().startsWith('%')) out.push(cur.trim());
      cur = '';
      depth = 0;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/* ============================================================ embedded data */

const DATA_PREFIX = '% flowtikz-data: ';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encodeDiagram(d: Diagram): Promise<string[]> {
  // Compact JSON: the pretty-printed save format would only make the comment longer.
  const json = new TextEncoder().encode(JSON.stringify(JSON.parse(serialize(d))));
  const packed = await deflateRaw(json);
  const b64 = (packed === json ? 'r' : 'z') + toBase64(packed);
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += 96) out.push(DATA_PREFIX + b64.slice(i, i + 96));
  return out;
}

/** The diagram stored in a FlowTikZ figure block, or null. */
export async function decodeDiagram(block: string): Promise<Diagram | null> {
  const data = block
    .split(/\r?\n/)
    .filter((l) => l.trimStart().startsWith(DATA_PREFIX.trim()))
    .map((l) => l.trimStart().slice(DATA_PREFIX.trim().length).trim())
    .join('');
  if (!data) return null;
  try {
    const kind = data[0];
    const bytes = fromBase64(data.slice(1));
    const raw = kind === 'z' ? await inflateRaw(bytes, 64 * 1024 * 1024, 'figure data') : bytes;
    return deserialize(new TextDecoder().decode(raw)).diagram;
  } catch {
    return null;
  }
}

/* ========================================================= document style */

export interface DocStyle {
  floatSpec: string;
  labelPrefix: string;
  usesCentering: boolean;
}

/** How this document writes its figures, so a new one looks like the rest. */
export function documentStyle(texts: string[]): DocStyle {
  const specs = new Map<string, number>();
  let prefixFig = 0;
  let prefixFigure = 0;
  let centering = 0;
  let centerEnv = 0;
  for (const t of texts) {
    const m = maskTex(t);
    for (const f of m.matchAll(/\\begin\{figure\*?\}\s*(\[[^\]]*\])?/g)) {
      const s = (f[1] ?? '').replace(/[[\]\s]/g, '');
      specs.set(s, (specs.get(s) ?? 0) + 1);
    }
    prefixFig += (m.match(/\\label\{fig:/g) ?? []).length;
    prefixFigure += (m.match(/\\label\{figure:/g) ?? []).length;
    for (const f of m.matchAll(/\\begin\{figure\*?\}([\s\S]{0,300}?)\\end\{figure\*?\}/g)) {
      if (/\\centering/.test(f[1])) centering++;
      if (/\\begin\{center\}/.test(f[1])) centerEnv++;
    }
  }
  let floatSpec = 'htbp';
  let best = 0;
  for (const [s, n] of specs) if (s && n > best) [floatSpec, best] = [s, n];
  return {
    floatSpec,
    labelPrefix: prefixFigure > prefixFig ? 'figure:' : 'fig:',
    usesCentering: centering >= centerEnv,
  };
}

export function slugLabel(caption: string, fallback: string): string {
  const s = caption
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 5)
    .join('-');
  return s || fallback;
}

/* ============================================================ the edit plan */

export interface Target {
  file: string;
  /** Character offset to insert at. */
  offset: number;
  /** Insert after the block ending at `offset` (true) or before the block starting there. */
  after: boolean;
  indent: string;
}

export type Edits = Map<string, string>;

function needLines(code: FigureCode, opts: FigureOptions, provided: Set<string>, className: string): string[] {
  const want = new Set(code.packages);
  if (opts.placement === 'float' && /^H$/.test(opts.placementSpecOverride ?? '')) want.add('float');
  if (opts.placement === 'here' && opts.caption.trim()) want.add('capt-of');
  const have = new Set(provided);
  for (const p of provided) for (const q of PROVIDES[p] ?? []) have.add(q);
  for (const q of CLASS_PROVIDES[className] ?? []) have.add(q);
  return PKG_ORDER.filter((p) => want.has(p) && !have.has(p));
}

const PKG_BEGIN = '% ---- FlowTikZ: packages for drawn figures ----';
const PKG_END = '% ---- FlowTikZ: end of packages ----';
const DEF_BEGIN = '% ---- FlowTikZ: colours and styles for drawn figures ----';
const DEF_END = '% ---- FlowTikZ: end of colours and styles ----';

function findMarked(text: string, begin: string, end: string): { start: number; end: number; inner: string } | null {
  const a = text.indexOf(begin);
  if (a < 0) return null;
  const b = text.indexOf(end, a);
  if (b < 0) return null;
  const s = lineStart(text, a);
  const e = lineEnd(text, b);
  const innerStart = lineEnd(text, a);
  return { start: s, end: e, inner: text.slice(innerStart, lineStart(text, b)) };
}

/** Where the packages block goes: file and offset. */
function packageSite(doc: ProjectDocument, files: FileAccess): { file: string; offset: number } {
  const main = doc.mainPath;
  const mainText = files.text(main) ?? '';
  const pre = doc.preamble.files;
  const mainUses = pre[0].uses.filter((u) => u.start < (doc.outline.beginAt >= 0 ? doc.outline.beginAt : mainText.length));
  // If the document keeps its packages in a separate file, follow it.
  const best = pre
    .slice(1)
    .filter((f) => f.path.endsWith('.tex') && f.uses.length > mainUses.length && f.uses.length >= 2)
    .sort((a, b) => b.uses.length - a.uses.length)[0];
  const site = best ?? pre[0];
  const text = files.text(site.path) ?? '';
  const uses = site === pre[0] ? mainUses : site.uses;
  const last = uses.find((u) => LOAD_LAST.test(u.name));
  if (last) return { file: site.path, offset: lineStart(text, last.start) };
  if (uses.length) {
    const end = Math.max(...uses.map((u) => u.end));
    return { file: site.path, offset: lineEnd(text, end) };
  }
  const o = outline(mainText);
  return { file: main, offset: o.classEnd >= 0 ? lineEnd(mainText, o.classEnd) : 0 };
}

function insertAt(text: string, at: number, piece: string): string {
  return text.slice(0, at) + piece + text.slice(at);
}

/** Packages, libraries and definitions the document now needs, merged into place. */
function updatePreamble(doc: ProjectDocument, files: FileAccess, edits: Edits, code: FigureCode, opts: FigureOptions): void {
  const read = (p: string) => edits.get(p) ?? files.text(p) ?? '';
  const mainText = read(doc.mainPath);
  const nl = newlineOf(mainText);
  const className = doc.outline.className;

  // ---- packages
  const provided = new Set(doc.preamble.packageNames);
  const missing = needLines(code, opts, provided, className);
  if (missing.length) {
    // An earlier FlowTikZ block anywhere in the preamble files is extended.
    let target: { file: string; at: number; existing: string } | null = null;
    for (const f of doc.preamble.files) {
      const t = read(f.path);
      const blk = findMarked(t, PKG_BEGIN, PKG_END);
      if (blk) {
        target = { file: f.path, at: lineStart(t, t.indexOf(PKG_END)), existing: blk.inner };
        break;
      }
    }
    if (target) {
      const t = read(target.file);
      const n = newlineOf(t);
      edits.set(target.file, insertAt(t, target.at, missing.map((p) => PKG_LINE[p] + n).join('')));
    } else {
      const site = packageSite(doc, files);
      const t = read(site.file);
      const n = newlineOf(t);
      const block = [PKG_BEGIN, ...missing.map((p) => PKG_LINE[p]), PKG_END].join(n) + n;
      // Keep a separating newline if the previous line does not end with one.
      const prefix = site.offset > 0 && t[site.offset - 1] !== '\n' ? n : '';
      edits.set(site.file, insertAt(t, site.offset, prefix + block));
    }
  }

  // ---- definitions block at the end of the main preamble
  const text = read(doc.mainPath);
  const masked = maskTex(text);
  const o = outline(text, masked);
  if (o.beginAt < 0) return;
  const existing = findMarked(text, DEF_BEGIN, DEF_END);
  const outside = existing ? masked.slice(0, existing.start) + ' '.repeat(existing.end - existing.start) + masked.slice(existing.end, o.beginAt) : masked.slice(0, o.beginAt);
  const haveLibs = tikzLibraries(outside);
  for (const f of doc.preamble.files.slice(1)) for (const l of tikzLibraries(maskTex(read(f.path)))) haveLibs.add(l);
  const prior = existing ? splitStatements(existing.inner) : [];
  const priorLibs = new Set<string>();
  const priorRest: string[] = [];
  for (const s of prior) {
    const lm = /^\\usetikzlibrary\{([^}]*)\}$/.exec(s);
    if (lm) lm[1].split(',').forEach((l) => l.trim() && priorLibs.add(l.trim()));
    else priorRest.push(s);
  }
  const libs = [...new Set([...priorLibs, ...code.libraries])].filter((l) => !haveLibs.has(l) || priorLibs.has(l)).sort();
  const statements: string[] = [];
  if (libs.length) statements.push(`\\usetikzlibrary{${libs.join(',')}}`);
  const compatSet = /\\pgfplotsset\s*\{[^}]*compat\s*=/.test(outside) || doc.preamble.files.slice(1).some((f) => /\\pgfplotsset\s*\{[^}]*compat\s*=/.test(maskTex(read(f.path))));
  const rest = [...priorRest];
  if (code.hasCharts && !compatSet && !rest.some((s) => s.includes('compat='))) rest.push(`\\pgfplotsset{compat=${PGFPLOTS_COMPAT}}`);
  for (const s of code.definitions) if (!rest.includes(s)) rest.push(s);
  // Colours first, then everything else, each group stable.
  const colours = rest.filter((s) => s.startsWith('\\definecolor')).sort();
  const others = rest.filter((s) => !s.startsWith('\\definecolor'));
  statements.push(...others.filter((s) => s.startsWith('\\pgfplotsset')), ...colours, ...others.filter((s) => !s.startsWith('\\pgfplotsset')));
  const block = [DEF_BEGIN, ...statements.map((s) => s.split('\n').join(nl)), DEF_END].join(nl) + nl;
  if (existing) {
    edits.set(doc.mainPath, text.slice(0, existing.start) + block + text.slice(existing.end));
  } else {
    // Block plus a blank line, right above \begin{document}; removing exactly
    // that restores the original byte for byte.
    const at = lineStart(text, o.beginAt);
    edits.set(doc.mainPath, text.slice(0, at) + block + nl + text.slice(at));
  }
}

/** The LaTeX of the figure block itself. */
export function figureBlock(code: FigureCode, data: string[], opts: FigureOptions, style: DocStyle, nl: string, indent: string): string {
  const pic = code.picture.map((l) => `    ${l}`);
  pic[pic.length - 1] += '%';
  const scaled = [
    '  \\resizebox{\\ifdim\\width>\\linewidth\\linewidth\\else\\width\\fi}{!}{%',
    ...pic,
    '  }',
  ];
  const caption = opts.caption.trim() ? escapeLatex(opts.caption.trim()).text : '';
  const label = opts.label?.trim();
  const lines: string[] = [
    `% ==== FlowTikZ figure ${opts.id} (begin) ====`,
    '% Drawn with FlowTikZ. Re-open this project in FlowTikZ to edit it visually.',
    ...data,
  ];
  if (opts.placement === 'float') {
    lines.push(`\\begin{figure}[${opts.placementSpecOverride ?? style.floatSpec}]`, '  \\centering', ...scaled);
    if (caption) lines.push(`  \\caption{${caption}}`);
    if (caption && label) lines.push(`  \\label{${label}}`);
    lines.push('\\end{figure}');
  } else {
    lines.push('\\begin{center}', ...scaled);
    if (caption) lines.push(`  \\captionof{figure}{${caption}}${label ? `\\label{${label}}` : ''}`);
    lines.push('\\end{center}');
  }
  lines.push(`% ==== FlowTikZ figure ${opts.id} (end) ====`);
  return lines.map((l) => (l ? indent + l : l)).join(nl);
}

/** Compute every file change needed to insert a figure at a target. */
export async function planInsert(
  doc: ProjectDocument,
  files: FileAccess,
  diagram: Diagram,
  target: Target,
  opts: FigureOptions,
): Promise<Edits> {
  const edits: Edits = new Map();
  const code = figureCode(diagram);
  const data = await encodeDiagram(diagram);
  const style = documentStyle(doc.bodyFiles.map((p) => files.text(p) ?? ''));
  const host = files.text(target.file) ?? '';
  const nl = newlineOf(host);
  const block = figureBlock(code, data, opts, style, nl, target.indent);
  let next: string;
  if (target.after) {
    const following = host.slice(target.offset);
    const tail = /^[ \t]*\r?\n/.test(following) ? '' : nl;
    next = host.slice(0, target.offset) + nl + nl + block + tail + following;
  } else {
    // The figure always starts on a line of its own, even when the text it
    // goes before shares a line with something (\section{A}Text).
    const lineHead = host.slice(lineStart(host, target.offset), target.offset);
    const lead = /\S/.test(lineHead) ? nl : '';
    next = host.slice(0, target.offset) + lead + block + nl + nl + target.indent + host.slice(target.offset).replace(/^[ \t]+/, '');
  }
  edits.set(target.file, next);
  updatePreamble(doc, files, edits, code, opts);
  return edits;
}

/** Locate a FlowTikZ figure block in a file. */
export function findFigure(text: string, id: string): { start: number; end: number } | null {
  const re = new RegExp(FIGURE_BEGIN.source.replace('([A-Za-z0-9_-]+)', id), 'm');
  const b = re.exec(text);
  if (!b) return null;
  const e = FIGURE_END(id).exec(text.slice(b.index));
  if (!e) return null;
  return { start: lineStart(text, b.index), end: b.index + e.index + e[0].length };
}

/** Replace an existing FlowTikZ figure with a new drawing (same place, same id). */
export async function planReplace(doc: ProjectDocument, files: FileAccess, diagram: Diagram, block: Block, opts: FigureOptions): Promise<Edits> {
  const edits: Edits = new Map();
  const text = files.text(block.file) ?? '';
  const at = findFigure(text, opts.id);
  if (!at) throw new Error('The figure was not found in the document any more.');
  const code = figureCode(diagram);
  const data = await encodeDiagram(diagram);
  const style = documentStyle(doc.bodyFiles.map((p) => files.text(p) ?? ''));
  const nl = newlineOf(text);
  const fb = figureBlock(code, data, opts, style, nl, block.indent).replace(/^[ \t]+/, '');
  edits.set(block.file, text.slice(0, at.start) + block.indent + fb + text.slice(at.end));
  updatePreamble(doc, files, edits, code, opts);
  return edits;
}

/** Remove a figure; when it was the last one, also remove what FlowTikZ added to the preamble. */
export function planRemove(doc: ProjectDocument, files: FileAccess, block: Block): Edits {
  const edits: Edits = new Map();
  const text = files.text(block.file) ?? '';
  const at = findFigure(text, block.figureId ?? '');
  if (!at) return edits;
  let s = at.start;
  let e = at.end;
  // Swallow the blank line the insertion added, so the text closes up again.
  const after = /^(\r?\n){1,2}/.exec(text.slice(e));
  const before = /(\r?\n)[ \t]*(\r?\n)?$/.exec(text.slice(0, s));
  if (after && before && before[2]) {
    s -= before[0].length;
  } else if (after) {
    e += after[0].length;
  }
  edits.set(block.file, text.slice(0, s) + text.slice(e));
  const remaining = doc.blocks.filter((b) => b.kind === 'flowtikz' && b.key !== block.key).length;
  if (remaining === 0) {
    for (const f of new Set([doc.mainPath, ...doc.preamble.files.map((x) => x.path)])) {
      let t = edits.get(f) ?? files.text(f) ?? '';
      for (const [b1, b2] of [[PKG_BEGIN, PKG_END], [DEF_BEGIN, DEF_END]]) {
        const m = findMarked(t, b1, b2);
        if (m) {
          let end = m.end;
          if (b1 === DEF_BEGIN && /^\r?\n/.test(t.slice(end))) end = lineEnd(t, end);
          t = t.slice(0, m.start) + t.slice(end);
        }
      }
      if (t !== (files.text(f) ?? '')) edits.set(f, t);
    }
  }
  return edits;
}

/** Packages a document loads, as names (for tests and the UI). */
export function loadedPackages(text: string): string[] {
  const m = maskTex(text);
  const o = outline(text, m);
  return packageUses(m, 0, o.beginAt >= 0 ? o.beginAt : m.length).map((p) => p.name);
}

export { readGroup };
