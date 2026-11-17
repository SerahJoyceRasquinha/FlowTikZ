import {
  expandMacros,
  inclusions,
  lineEnd,
  lineStart,
  macros,
  maskTex,
  outline,
  packageUses,
  readGroup,
  readOptional,
  type Macro,
  type PackageUse,
  type TexOutline,
} from './texScan';

/**
 * The document as a list of source-mapped blocks: headings, paragraphs,
 * environments, FlowTikZ figures, page breaks... Each block knows the file
 * and the exact character range it came from, which is what lets a drawing be
 * inserted between two of them without touching anything else.
 *
 * \input, \include, \subfile and \import are followed, so a thesis split into
 * chapter files previews as one document and a drawing lands in the chapter
 * file it belongs to.
 */

export type BlockKind = 'heading' | 'paragraph' | 'env' | 'flowtikz' | 'command' | 'missing';

export interface Block {
  /** Stable for a given source: file + offset. */
  key: string;
  kind: BlockKind;
  file: string;
  start: number;
  end: number;
  /** Raw source of the block. */
  text: string;
  /** Environment name, sectioning command or special command. */
  name?: string;
  /** Section level: 0 part, 1 chapter, 2 section, 3 subsection, ... */
  level?: number;
  starred?: boolean;
  title?: string;
  /** Labels defined inside the block. */
  labels: string[];
  /** Renders as nothing (a lone \label, \vspace, \newcommand...). */
  hidden?: boolean;
  /** FlowTikZ figure id. */
  figureId?: string;
  /** Leading whitespace of the block's first line (for matching indentation). */
  indent: string;
}

export interface ProjectDocument {
  mainPath: string;
  mainDir: string;
  outline: TexOutline;
  blocks: Block[];
  preamble: PreambleInfo;
  /** Files the document pulls in that could not be found. */
  missing: string[];
  /** All files that contribute to the body, in order. */
  bodyFiles: string[];
}

export interface PreambleInfo {
  /** Packages loaded by the main preamble and the files/local packages it pulls in. */
  packages: PackageUse[];
  packageNames: Set<string>;
  title: string;
  author: string;
  date: string;
  graphicsPaths: string[];
  macros: Map<string, Macro>;
  /** Preamble files (main first) and their \usepackage ranges. */
  files: { path: string; uses: PackageUse[] }[];
}

export interface FileAccess {
  /** Text of a project file (path relative to the project root), if it exists and is text. */
  text(path: string): string | undefined;
  exists(path: string): boolean;
}

export const FIGURE_BEGIN = /^[ \t]*%[ \t]*=+[ \t]*FlowTikZ figure[ \t]+([A-Za-z0-9_-]+)[ \t]*\(begin\)[^\r\n]*(?=\r?$)/m;
export const FIGURE_END = (id: string) => new RegExp(`^[ \\t]*%[ \\t]*=+[ \\t]*FlowTikZ figure[ \\t]+${id}[ \\t]*\\(end\\)[^\\r\\n]*(?=\\r?$)`, 'm');

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function joinPath(dir: string, rel: string): string | null {
  const parts = (dir ? `${dir}/${rel}` : rel).replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(p);
  }
  return out.join('/');
}

/** Resolve an \input-style target the way TeX does: relative to the main file's folder, .tex optional. */
export function resolveTex(target: string, baseDir: string, files: FileAccess, extraDir?: string): string | null {
  const t = target.replace(/^["']|["']$/g, '').trim();
  if (!t) return null;
  const dirs = extraDir !== undefined ? [extraDir] : [baseDir];
  for (const d of dirs) {
    for (const cand of [t, `${t}.tex`]) {
      const p = joinPath(d, cand);
      if (p && files.exists(p)) return p;
    }
  }
  return null;
}

const SECTION_LEVEL: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

/** Display-math environments stay inside the paragraph they are written in. */
export const MATH_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'flalign', 'flalign*',
  'eqnarray', 'eqnarray*', 'displaymath', 'math', 'alignat', 'alignat*', 'split', 'subequations',
]);

const STANDALONE_COMMANDS = new Set([
  'maketitle', 'tableofcontents', 'listoffigures', 'listoftables', 'newpage', 'clearpage', 'cleardoublepage', 'pagebreak',
  'appendix', 'bibliography', 'printbibliography', 'bibliographystyle', 'frontmatter', 'mainmatter', 'backmatter',
  'printindex', 'addbibresource', 'nocite',
]);

/** Commands that print nothing; a paragraph made only of these is hidden. */
const SILENT = /^(?:\\(?:label|vspace\*?|hspace\*?|noindent|indent|centering|raggedright|raggedleft|setlength|addtolength|setcounter|addtocounter|newcommand\*?|renewcommand\*?|providecommand|def|let|pagestyle|thispagestyle|small|footnotesize|large|Large|normalsize|bigskip|medskip|smallskip|par|newline|linebreak|nopagebreak|vfill|hfill|null|phantomsection|addcontentsline|markboth|markright|graphicspath|DeclareMathOperator\*?|newtheorem|theoremstyle|captionsetup|hypersetup|bibliographystyle|nocite)\b(?:\*?\s*(?:\[[^\]]*\])?\s*(?:\{(?:[^{}]|\{[^{}]*\})*\})*)?|\s)+$/;

interface ParseCtx {
  files: FileAccess;
  mainDir: string;
  blocks: Block[];
  missing: string[];
  bodyFiles: string[];
  depth: number;
  visiting: Set<string>;
}

function labelsIn(masked: string): string[] {
  const out: string[] = [];
  const re = /\\label\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) out.push(m[1].trim());
  return out;
}

function indentAt(text: string, at: number): string {
  const ls = lineStart(text, at);
  return /^[ \t]*/.exec(text.slice(ls, at))?.[0] ?? '';
}

/** Block-level parse of one file's range; follows inclusions. */
function parseRange(ctx: ParseCtx, file: string, text: string, masked: string, from: number, to: number) {
  if (!ctx.bodyFiles.includes(file)) ctx.bodyFiles.push(file);
  const push = (b: Omit<Block, 'key' | 'text' | 'labels' | 'indent'> & { labels?: string[] }) => {
    const raw = text.slice(b.start, b.end);
    ctx.blocks.push({
      ...b,
      key: `${b.file}:${b.start}`,
      text: raw,
      labels: b.labels ?? labelsIn(masked.slice(b.start, b.end)),
      indent: indentAt(text, b.start),
    });
  };

  let i = from;
  let para = -1; // start of the current paragraph, or -1
  const endPara = (at: number) => {
    if (para < 0) return;
    let e = at;
    while (e > para && /\s/.test(text[e - 1])) e--;
    if (e > para) {
      const body = masked.slice(para, e);
      push({ kind: 'paragraph', file, start: para, end: e, hidden: SILENT.test(body) || body.trim() === '' });
    }
    para = -1;
  };

  const SPECIAL = /[\n\\{%]/g;
  let nextPct = text.indexOf('%', from);
  while (i < to) {
    const ch = masked[i];
    // Inside a paragraph, plain text runs up to the next character that can
    // matter (newline, command, group, comment): skip it in one step.
    if (para >= 0 && ch !== '\n' && ch !== '\\' && ch !== '{' && text[i] !== '%') {
      SPECIAL.lastIndex = i + 1;
      const next = SPECIAL.exec(masked);
      // The next raw '%' (FlowTikZ markers live in comments), found once and
      // reused while scanning forward, so the whole pass stays linear.
      if (nextPct !== -1 && nextPct <= i) nextPct = text.indexOf('%', i + 1);
      let stop = next && next.index < to ? next.index : to;
      if (nextPct >= 0 && nextPct < stop) stop = nextPct;
      i = stop;
      continue;
    }
    // FlowTikZ figure markers live in comments, so look at the raw text.
    if (text[i] === '%' && (i === 0 || text[i - 1] === '\n' || /^[ \t]*$/.test(text.slice(lineStart(text, i), i)))) {
      const ls = lineStart(text, i);
      const line = text.slice(ls, lineEnd(text, i)).replace(/\r?\n$/, '');
      const begin = FIGURE_BEGIN.exec(line);
      if (begin) {
        const id = begin[1];
        const endRe = FIGURE_END(id);
        const rest = text.slice(ls, to);
        const em = endRe.exec(rest);
        if (em) {
          endPara(ls);
          const stop = ls + em.index + em[0].length;
          push({ kind: 'flowtikz', file, start: ls, end: stop, figureId: id, name: 'flowtikz' });
          i = stop;
          continue;
        }
      }
    }
    if (ch === '\n') {
      // A blank line ends a paragraph.
      let j = i + 1;
      while (j < to && (masked[j] === ' ' || masked[j] === '\t' || masked[j] === '\r')) j++;
      if (masked[j] === '\n') endPara(i);
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '\\' && /[a-zA-Z]/.test(masked[i + 1] ?? '')) {
      let j = i + 1;
      while (j < to && /[a-zA-Z@]/.test(masked[j])) j++;
      const name = masked.slice(i + 1, j);
      const starred = masked[j] === '*';
      const afterStar = starred ? j + 1 : j;

      if (name === 'begin') {
        const g = readGroup(masked, j);
        const env = g?.content.trim() ?? '';
        if (g && env !== 'document') {
          const close = findEnvEnd(masked, env, g.end, to);
          if (MATH_ENVS.has(env)) {
            if (para < 0) para = i;
            i = close;
            continue;
          }
          endPara(i);
          push({ kind: 'env', file, start: i, end: close, name: env });
          i = close;
          continue;
        }
      }

      if (name in SECTION_LEVEL) {
        endPara(i);
        let k = afterStar;
        const short = readOptional(masked, k);
        if (short) k = short.end;
        const g = readGroup(masked, k);
        let end = g ? g.end : afterStar;
        // A \label straight after the heading belongs to it.
        const lab = /^\s*\\label\s*\{[^}]*\}/.exec(masked.slice(end, Math.min(to, end + 300)));
        if (lab) end += lab[0].length;
        push({
          kind: 'heading',
          file,
          start: i,
          end,
          name,
          level: SECTION_LEVEL[name],
          starred,
          title: g ? text.slice(g.start + 1, g.end - 1) : '',
        });
        i = end;
        continue;
      }

      if (['input', 'include', 'subfile', 'import', 'subimport', 'includefrom', 'subincludefrom', 'inputfrom', 'subinputfrom'].includes(name)) {
        const inc = inclusions(masked, i, Math.min(to, i + 600))[0];
        if (inc && inc.start === i) {
          endPara(i);
          let base = ctx.mainDir;
          let extra: string | undefined;
          if (inc.dir !== undefined) extra = /^sub/.test(inc.command) ? joinCurrent(file, inc.dir) : joinPath('', inc.dir) ?? inc.dir;
          if (/^sub/.test(inc.command) && extra === undefined) base = dirOf(file);
          const path = resolveTex(inc.target, base, ctx.files, extra);
          const childText = path ? ctx.files.text(path) : undefined;
          if (path && childText !== undefined && ctx.depth < 12 && !ctx.visiting.has(path)) {
            const cm = maskTex(childText);
            let from2 = 0;
            let to2 = childText.length;
            if (inc.command === 'subfile') {
              // A subfile is a whole document: take its body.
              const o = outline(childText, cm);
              if (o.bodyStart >= 0) {
                from2 = o.bodyStart;
                to2 = o.endAt;
              }
            }
            ctx.visiting.add(path);
            ctx.depth++;
            parseRange(ctx, path, childText, cm, from2, to2);
            ctx.depth--;
            ctx.visiting.delete(path);
            if (inc.command === 'include') {
              ctx.blocks.push({ key: `${file}:${i}:inc`, kind: 'command', name: 'clearpage', file, start: i, end: inc.end, text: text.slice(i, inc.end), labels: [], indent: '', hidden: true });
            }
          } else {
            if (!path) ctx.missing.push(inc.target);
            push({ kind: 'missing', file, start: i, end: inc.end, name: inc.target });
          }
          i = inc.end;
          continue;
        }
      }

      if (STANDALONE_COMMANDS.has(name) && para < 0) {
        let k = afterStar;
        const o = readOptional(masked, k);
        if (o) k = o.end;
        const g = name === 'bibliography' || name === 'bibliographystyle' || name === 'addbibresource' || name === 'nocite' ? readGroup(masked, k) : null;
        const end = g ? g.end : k;
        push({ kind: 'command', file, start: i, end, name, hidden: name === 'bibliographystyle' || name === 'addbibresource' || name === 'nocite' || name === 'frontmatter' || name === 'mainmatter' || name === 'backmatter' });
        i = end;
        continue;
      }
    }
    // Ordinary text (or an inline command): part of a paragraph.
    if (para < 0) para = i;
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '{') {
      // Groups never end a paragraph midway: skip to the matching brace,
      // stopping at a blank line so a stray brace cannot swallow the rest.
      const g = readGroup(masked, i);
      if (g && g.end <= to && !/\n[ \t\r]*\n/.test(masked.slice(i, g.end))) {
        i = g.end;
        continue;
      }
    }
    i++;
  }
  endPara(to);
}

function joinCurrent(file: string, dir: string): string {
  return joinPath(dirOf(file), dir) ?? dir;
}

/** End offset of `\end{env}` matching a `\begin{env}` whose name ends at `from`. */
export function findEnvEnd(masked: string, env: string, from: number, to = masked.length): number {
  const open = `\\begin{${env}}`;
  const close = `\\end{${env}}`;
  let depth = 1;
  let i = from;
  while (i < to) {
    const a = masked.indexOf(open, i);
    const b = masked.indexOf(close, i);
    if (b < 0 || b >= to) return to;
    if (a >= 0 && a < b) {
      depth++;
      i = a + open.length;
    } else {
      depth--;
      i = b + close.length;
      if (depth === 0) return i;
    }
  }
  return to;
}

/** Preamble facts, from the main file and what its preamble pulls in. */
export function readPreamble(mainPath: string, text: string, masked: string, o: TexOutline, files: FileAccess): PreambleInfo {
  const preEnd = o.beginAt >= 0 ? o.beginAt : text.length;
  const uses = packageUses(masked, 0, preEnd);
  const filesInfo: PreambleInfo['files'] = [{ path: mainPath, uses }];
  const all: PackageUse[] = [...uses];
  const macroList = macros(masked, 0, preEnd);
  const mainDir = dirOf(mainPath);
  const pulled = new Set<string>();
  const visit = (pathAt: string, depth: number) => {
    if (depth > 5 || pulled.has(pathAt)) return;
    pulled.add(pathAt);
    const t = files.text(pathAt);
    if (t === undefined) return;
    const m = maskTex(t);
    const u = packageUses(m);
    filesInfo.push({ path: pathAt, uses: u });
    all.push(...u);
    macroList.push(...macros(m));
    for (const inc of inclusions(m)) {
      const p = resolveTex(inc.target, mainDir, files);
      if (p) visit(p, depth + 1);
    }
    for (const pu of u) {
      const sty = joinPath(mainDir, `${pu.name}.sty`);
      if (sty && files.exists(sty)) visit(sty, depth + 1);
    }
  };
  for (const inc of inclusions(masked, 0, preEnd)) {
    const p = resolveTex(inc.target, mainDir, files);
    if (p) visit(p, 1);
  }
  for (const pu of uses) {
    const sty = joinPath(mainDir, `${pu.name}.sty`);
    if (sty && files.exists(sty)) visit(sty, 1);
  }
  const arg = (cmd: string) => {
    const re = new RegExp(`\\\\${cmd}\\s*(?:\\[[^\\]]*\\])?\\s*\\{`);
    const m = re.exec(masked.slice(0, o.endAt));
    if (!m) return '';
    const g = readGroup(masked, m.index + m[0].length - 1);
    return g ? text.slice(g.start + 1, g.end - 1) : '';
  };
  const gp: string[] = [];
  const gm = /\\graphicspath\s*\{/.exec(masked.slice(0, preEnd));
  if (gm) {
    const outer = readGroup(masked, gm.index + gm[0].length - 1);
    if (outer) {
      let k = 0;
      for (;;) {
        const inner = readGroup(outer.content, k);
        if (!inner) break;
        gp.push(inner.content.trim());
        k = inner.end;
      }
    }
  }
  const macroMap = new Map<string, Macro>();
  for (const mm of macroList) macroMap.set(mm.name, mm);
  return {
    packages: all,
    packageNames: new Set(all.map((p) => p.name)),
    title: arg('title'),
    author: arg('author'),
    date: arg('date'),
    graphicsPaths: gp,
    macros: macroMap,
    files: filesInfo,
  };
}

export function parseDocument(mainPath: string, files: FileAccess): ProjectDocument {
  const text = files.text(mainPath) ?? '';
  const masked = maskTex(text);
  const o = outline(text, masked);
  const ctx: ParseCtx = {
    files,
    mainDir: dirOf(mainPath),
    blocks: [],
    missing: [],
    bodyFiles: [],
    depth: 0,
    visiting: new Set([mainPath]),
  };
  if (o.bodyStart >= 0) parseRange(ctx, mainPath, text, masked, o.bodyStart, o.endAt);
  return {
    mainPath,
    mainDir: ctx.mainDir,
    outline: o,
    blocks: ctx.blocks,
    preamble: readPreamble(mainPath, text, masked, o, files),
    missing: ctx.missing,
    bodyFiles: ctx.bodyFiles,
  };
}

export { expandMacros };
