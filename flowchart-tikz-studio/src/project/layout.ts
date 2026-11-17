import type { Block, ProjectDocument } from './document';
import { MATH_ENVS } from './document';
import { maskTex, readGroup } from './texScan';

/**
 * What the preview needs to look like the compiled document: page size,
 * margins, text width and font size from the class and geometry options, and
 * the numbers LaTeX would give sections, figures, tables and equations.
 */

/* ================================================================ units */

const UNIT_PT: Record<string, number> = {
  pt: 1,
  bp: 72.27 / 72,
  in: 72.27,
  cm: 72.27 / 2.54,
  mm: 72.27 / 25.4,
  pc: 12,
  dd: 1238 / 1157,
  cc: 14856 / 1157,
  sp: 1 / 65536,
};

/** A TeX length in points, or null. `em`/`ex` use the given font size. */
export function toPoints(s: string, fontPt = 10): number | null {
  const m = /^\s*(-?\d*\.?\d+)\s*([a-z]{2})\s*$/i.exec(s);
  if (!m) return null;
  const v = Number(m[1]);
  const u = m[2].toLowerCase();
  if (u === 'em') return v * fontPt;
  if (u === 'ex') return v * fontPt * 0.43;
  const f = UNIT_PT[u];
  return f === undefined ? null : v * f;
}

/* ============================================================== geometry */

export interface PageGeometry {
  paperW: number;
  paperH: number;
  textWidth: number;
  left: number;
  top: number;
  fontPt: number;
  columns: number;
  columnSep: number;
  className: string;
  /** Book-like classes number chapters. */
  hasChapters: boolean;
  slides: boolean;
}

const PAPER: Record<string, [number, number]> = {
  letterpaper: [614.295, 794.97],
  a4paper: [597.508, 845.047],
  a5paper: [421.783, 597.508],
  b5paper: [501.875, 711.317],
  legalpaper: [614.295, 1012.05],
  executivepaper: [523.15, 759.68],
  a3paper: [845.047, 1195.02],
};

/** \textwidth of the standard classes for a one-column document, by font size. */
const STD_TEXTWIDTH: Record<number, number> = { 10: 345, 11: 360, 12: 390 };
const STD_TWOCOL_TEXTWIDTH: Record<number, number> = { 10: 469, 11: 469, 12: 469 };

export function pageGeometry(doc: ProjectDocument, mainText: string): PageGeometry {
  const cls = doc.outline.className;
  const opts = doc.outline.classOptions;
  let fontPt = 10;
  for (const o of opts) {
    const m = /^(\d+)pt$/.exec(o);
    if (m) fontPt = Number(m[1]);
  }
  let paper = PAPER.letterpaper;
  for (const o of opts) if (PAPER[o]) paper = PAPER[o];
  let [paperW, paperH] = paper;
  if (opts.includes('landscape')) [paperW, paperH] = [paperH, paperW];
  let columns = opts.includes('twocolumn') ? 2 : 1;
  let columnSep = 10;
  let textWidth = (columns === 2 ? STD_TWOCOL_TEXTWIDTH : STD_TEXTWIDTH)[fontPt] ?? 345;
  let hasChapters = /^(report|book|memoir|scrbook|scrreprt|thesis|ut-thesis|ucthesis)$/i.test(cls);
  let slides = false;

  // Common journal and conference classes.
  if (/^IEEEtran$/i.test(cls)) {
    fontPt = opts.find((o) => /^\d+pt$/.test(o)) ? fontPt : 10;
    columns = opts.includes('onecolumn') ? 1 : 2;
    textWidth = 516;
    columnSep = 12;
    paper = opts.includes('a4paper') ? PAPER.a4paper : PAPER.letterpaper;
    [paperW, paperH] = paper;
  } else if (/^acmart$/i.test(cls)) {
    columns = opts.some((o) => /sigconf|sigplan/.test(o)) ? 2 : 1;
    textWidth = columns === 2 ? 506 : 390;
    fontPt = columns === 2 ? 9 : 10;
    columnSep = 24;
  } else if (/^llncs$/i.test(cls)) {
    textWidth = 347;
  } else if (/^elsarticle$/i.test(cls)) {
    columns = opts.some((o) => /5p|twocolumn/.test(o)) ? 2 : 1;
    textWidth = columns === 2 ? 522 : 390;
  } else if (/^revtex4/i.test(cls)) {
    columns = opts.includes('onecolumn') || opts.includes('preprint') ? 1 : 2;
    textWidth = columns === 2 ? 510 : 468;
    columnSep = 18;
  } else if (/^beamer$/i.test(cls)) {
    slides = true;
    paperW = 364.19;
    paperH = 273.14;
    textWidth = paperW - 40;
    fontPt = 11;
    hasChapters = false;
  } else if (/^(scrartcl|scrreprt|scrbook)$/i.test(cls)) {
    textWidth = paperW * 0.66;
  } else if (/^(memoir)$/i.test(cls)) {
    textWidth = paperW * 0.62;
  }

  let left = (paperW - textWidth) / 2;
  let top = 72;

  // Packages that move the margins.
  const pre = maskTex(mainText).slice(0, doc.outline.beginAt >= 0 ? doc.outline.beginAt : mainText.length);
  const loaded = doc.preamble.packages;
  if (loaded.some((p) => p.name === 'fullpage')) {
    left = 72.27;
    textWidth = paperW - 2 * left;
  }
  const geometryOpts = [...loaded.filter((p) => p.name === 'geometry').flatMap((p) => p.options)];
  const gs = /\\geometry\s*\{/.exec(pre);
  if (gs) {
    const g = readGroup(pre, gs.index + gs[0].length - 1);
    if (g) geometryOpts.push(...g.content.split(',').map((s) => s.trim()));
  }
  if (geometryOpts.length) {
    const kv = new Map<string, string>();
    for (const o of geometryOpts) {
      const [k, v] = o.split('=').map((s) => s.trim());
      kv.set(k, v ?? 'true');
      if (PAPER[k]) [paperW, paperH] = PAPER[k];
    }
    if (kv.has('landscape')) [paperW, paperH] = [Math.max(paperW, paperH), Math.min(paperW, paperH)];
    const len = (k: string) => (kv.has(k) ? toPoints(kv.get(k)!, fontPt) : null);
    let l = len('left') ?? len('inner') ?? len('lmargin') ?? len('hmargin') ?? len('margin');
    let r = len('right') ?? len('outer') ?? len('rmargin') ?? len('hmargin') ?? len('margin');
    const tw = len('textwidth') ?? len('width');
    const t = len('top') ?? len('tmargin') ?? len('vmargin') ?? len('margin');
    const hm = kv.get('hmargin');
    if (hm && hm.startsWith('{')) {
      const parts = hm.replace(/[{}]/g, '').split(',');
      l = toPoints(parts[0], fontPt);
      r = toPoints(parts[1] ?? parts[0], fontPt);
    }
    if (tw !== null) {
      textWidth = tw;
      left = l ?? (r !== null ? paperW - tw - r : (paperW - tw) / 2);
    } else if (l !== null || r !== null) {
      const L = l ?? r ?? left;
      const R = r ?? l ?? left;
      left = L;
      textWidth = paperW - L - R;
    } else if (kv.has('scale')) {
      const sc = Number(kv.get('scale'));
      if (sc > 0 && sc <= 1) {
        textWidth = paperW * sc;
        left = (paperW - textWidth) / 2;
      }
    }
    if (t !== null) top = t;
  }
  // \setlength{\textwidth}{...} in the preamble.
  const sl = /\\setlength\s*\{?\s*\\textwidth\s*\}?\s*\{([^}]*)\}/.exec(pre);
  if (sl) {
    const v = toPoints(sl[1], fontPt);
    if (v) {
      textWidth = v;
      left = (paperW - v) / 2;
    }
  }
  textWidth = Math.max(120, Math.min(textWidth, paperW - 20));
  left = Math.max(0, Math.min(left, paperW - textWidth));
  return { paperW, paperH, textWidth, left, top, fontPt, columns, columnSep, className: cls, hasChapters, slides };
}

/* ============================================================= numbering */

export interface Numbering {
  /** Display number of each numbered heading. */
  headings: Map<string, string>;
  /** Figure / table numbers by block key, in order of their captions. */
  floats: Map<string, { kind: 'figure' | 'table'; numbers: string[] }>;
  /** Equation numbers by block key, in order of appearance. */
  equations: Map<string, string[]>;
  /** \label -> what \ref prints. */
  labels: Map<string, string>;
  /** Citation key -> number, in order of first citation. */
  citations: Map<string, number>;
  toc: { level: number; number: string; title: string; key: string }[];
}

const NUMBERED_MATH = /\\begin\{(equation|align|gather|multline|flalign|eqnarray|alignat)\}/g;

function countCaptions(masked: string): number {
  return (masked.match(/\\caption(?:of\s*\{\s*(?:figure|table)\s*\})?\s*(?:\[[^\]]*\])?\s*\{/g) ?? []).length;
}

export function numberDocument(doc: ProjectDocument, geo: PageGeometry): Numbering {
  const headings = new Map<string, string>();
  const floats = new Map<string, { kind: 'figure' | 'table'; numbers: string[] }>();
  const equations = new Map<string, string[]>();
  const labels = new Map<string, string>();
  const citations = new Map<string, number>();
  const toc: Numbering['toc'] = [];
  const counters = [0, 0, 0, 0, 0, 0, 0];
  let fig = 0;
  let tab = 0;
  let eq = 0;
  let appendix = false;
  const topLevel = geo.hasChapters ? 1 : 2;
  const prefix = () => (geo.hasChapters && counters[1] ? `${appendix ? String.fromCharCode(64 + counters[1]) : counters[1]}.` : '');

  for (const b of doc.blocks) {
    const masked = maskTex(b.text);
    if (b.kind === 'command' && b.name === 'appendix') {
      appendix = true;
      counters[topLevel] = 0;
      continue;
    }
    if (b.kind === 'heading' && b.level !== undefined) {
      const lvl = b.level;
      if (b.starred || lvl > 4 || (lvl === 0)) {
        if (!b.starred && lvl <= 4) toc.push({ level: lvl, number: '', title: b.title ?? '', key: b.key });
        else if (b.starred && lvl <= 3) toc.push({ level: lvl, number: '', title: b.title ?? '', key: b.key });
        continue;
      }
      if (lvl < topLevel) {
        // \chapter in an article-like class does not exist; treat as section.
        continue;
      }
      counters[lvl]++;
      for (let k = lvl + 1; k < counters.length; k++) counters[k] = 0;
      if (lvl === 1) {
        fig = 0;
        tab = 0;
        eq = 0;
      }
      const parts: string[] = [];
      for (let k = topLevel; k <= lvl; k++) parts.push(k === topLevel && appendix ? String.fromCharCode(64 + counters[k]) : String(counters[k]));
      const num = parts.join('.');
      headings.set(b.key, num);
      toc.push({ level: lvl, number: num, title: b.title ?? '', key: b.key });
      for (const l of b.labels) labels.set(l, num);
      continue;
    }
    // Figures and tables: count their captions, in order.
    const isTable = b.kind === 'env' && /^table\*?$/.test(b.name ?? '');
    const isFigure = (b.kind === 'env' && /^(figure\*?|wrapfigure|SCfigure)$/.test(b.name ?? '')) || b.kind === 'flowtikz';
    const captionCount = countCaptions(masked);
    if ((isTable || isFigure || /\\captionof/.test(masked)) && captionCount) {
      const numbers: string[] = [];
      const capRe = /\\caption(of\s*\{\s*(figure|table)\s*\})?/g;
      let m: RegExpExecArray | null;
      const labelRe = /\\label\s*\{([^}]*)\}/g;
      const caps: { at: number; kind: 'figure' | 'table' }[] = [];
      while ((m = capRe.exec(masked))) caps.push({ at: m.index, kind: m[2] ? (m[2] as 'figure' | 'table') : isTable ? 'table' : 'figure' });
      for (const c of caps) {
        const n = c.kind === 'table' ? ++tab : ++fig;
        numbers.push(`${prefix()}${n}`);
      }
      floats.set(b.key, { kind: isTable ? 'table' : 'figure', numbers });
      while ((m = labelRe.exec(masked))) {
        // A label refers to the caption before it.
        const idx = caps.filter((c) => c.at < m!.index).length - 1;
        if (idx >= 0) labels.set(m[1].trim(), numbers[idx]);
      }
    }
    // Equations, anywhere.
    const eqs: string[] = [];
    let m: RegExpExecArray | null;
    NUMBERED_MATH.lastIndex = 0;
    while ((m = NUMBERED_MATH.exec(masked))) {
      eq++;
      const num = `${prefix()}${eq}`;
      eqs.push(num);
      const env = m[1];
      const close = masked.indexOf(`\\end{${env}}`, m.index);
      const body = masked.slice(m.index, close < 0 ? masked.length : close);
      for (const lm of body.matchAll(/\\label\s*\{([^}]*)\}/g)) labels.set(lm[1].trim(), num);
    }
    if (eqs.length) equations.set(b.key, eqs);
    void MATH_ENVS;
    // Citations in order of first use.
    for (const cm of masked.matchAll(/\\(?:no)?cite[a-zA-Z]*\*?\s*(?:\[[^\]]*\]\s*){0,2}\{([^}]*)\}/g)) {
      for (const k of cm[1].split(',').map((s) => s.trim()).filter(Boolean)) if (!citations.has(k)) citations.set(k, citations.size + 1);
    }
    for (const lab of b.labels) if (!labels.has(lab)) labels.set(lab, '??');
  }
  return { headings, floats, equations, labels, citations, toc };
}

/* ========================================================= bibliography */

export interface BibEntry {
  key: string;
  type: string;
  fields: Record<string, string>;
}

/** A tolerant .bib reader: enough for author, title, venue and year. */
export function parseBib(text: string): Map<string, BibEntry> {
  const out = new Map<string, BibEntry>();
  const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    // Body runs to the brace that closes the entry.
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
    }
    const body = text.slice(start, i - 1);
    const fields: Record<string, string> = {};
    const fre = /(\w+)\s*=\s*/g;
    let f: RegExpExecArray | null;
    while ((f = fre.exec(body))) {
      let j = f.index + f[0].length;
      let val = '';
      if (body[j] === '{') {
        const g = readGroup(body, j);
        if (g) {
          val = g.content;
          j = g.end;
        }
      } else if (body[j] === '"') {
        const e = body.indexOf('"', j + 1);
        val = body.slice(j + 1, e < 0 ? body.length : e);
        j = e + 1;
      } else {
        const e = /[,\n}]/.exec(body.slice(j));
        val = body.slice(j, e ? j + e.index : body.length).trim();
      }
      fields[f[1].toLowerCase()] = val.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
      fre.lastIndex = j;
    }
    out.set(m[2], { key: m[2], type, fields });
    re.lastIndex = i;
  }
  return out;
}

export type { Block };
