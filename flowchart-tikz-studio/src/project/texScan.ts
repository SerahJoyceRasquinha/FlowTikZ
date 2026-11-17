/**
 * Source-level scanning of LaTeX files.
 *
 * Everything here works on offsets into the original text, so whatever is
 * found can be edited in place without disturbing a single other character.
 * Comments and verbatim material are "masked" (replaced by spaces of the same
 * length) before structure is searched, which keeps a commented-out
 * \begin{document} or a \section inside a listing from being mistaken for the
 * real thing.
 */

/** True when the character at `i` is preceded by an odd number of backslashes. */
export function escaped(text: string, i: number): boolean {
  let n = 0;
  for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) n++;
  return n % 2 === 1;
}

const VERBATIM_ENVS = ['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment', 'filecontents', 'filecontents*', 'alltt'];
const MASK_RE = /%|\\verb|\\begin\{(verbatim\*?|Verbatim|lstlisting|minted|comment|filecontents\*?|alltt)\}/g;

const blank = (s: string) => s.replace(/[^\r\n]/g, ' ');

/* Masking the same (large) text again is common - parse, number, insert -
   so the last few results are kept. */
const maskMemo = new Map<string, string>();

/**
 * Comments, `\verb|...|` and verbatim-like environments blanked to spaces
 * (newlines kept), same length as the input. Linear time, and it copies only
 * the pieces it has to change.
 */
export function maskTex(text: string): string {
  if (text.length > 4096) {
    const hit = maskMemo.get(text);
    if (hit !== undefined) return hit;
  }
  const out = maskUncached(text);
  if (text.length > 4096) {
    maskMemo.set(text, out);
    if (maskMemo.size > 8) maskMemo.delete(maskMemo.keys().next().value as string);
  }
  return out;
}

function maskUncached(text: string): string {
  const n = text.length;
  const parts: string[] = [];
  let last = 0;
  MASK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MASK_RE.exec(text))) {
    const at = m.index;
    if (escaped(text, at)) continue;
    if (m[0] === '%') {
      const nl = text.indexOf('\n', at);
      let end = nl < 0 ? n : nl;
      if (end > at && text[end - 1] === '\r') end--;
      parts.push(text.slice(last, at), ' '.repeat(end - at));
      last = end;
      MASK_RE.lastIndex = end;
      continue;
    }
    if (m[0] === '\\verb') {
      let j = at + 5;
      if (/[a-zA-Z]/.test(text[j] ?? '')) continue;
      if (text[j] === '*') j++;
      const delim = text[j];
      if (!delim || delim === '\n' || delim === ' ') continue;
      const close = text.indexOf(delim, j + 1);
      const nl = text.indexOf('\n', j + 1);
      if (close < 0 || (nl >= 0 && close > nl)) continue;
      parts.push(text.slice(last, j + 1), ' '.repeat(close - j - 1));
      last = close;
      MASK_RE.lastIndex = close + 1;
      continue;
    }
    // A verbatim-like environment: blank its body, keep \begin and \end.
    const name = m[1];
    const contentStart = at + m[0].length;
    const endTag = `\\end{${name}}`;
    const e = text.indexOf(endTag, contentStart);
    const stop = e < 0 ? n : e;
    parts.push(text.slice(last, contentStart), blank(text.slice(contentStart, stop)));
    last = stop;
    MASK_RE.lastIndex = e < 0 ? n : e + endTag.length;
  }
  if (last === 0) return text;
  parts.push(text.slice(last));
  return parts.join('');
}

void VERBATIM_ENVS;

/** Reads a balanced `{...}` group at `i` (after optional spaces). */
export function readGroup(text: string, i: number, open = '{', close = '}'): { content: string; start: number; end: number } | null {
  let j = i;
  while (j < text.length && (text[j] === ' ' || text[j] === '\t' || (text[j] === '\n' && open === '{' && text[j + 1] !== '\n'))) j++;
  if (text[j] !== open) return null;
  let depth = 0;
  for (let k = j; k < text.length; k++) {
    const ch = text[k];
    if (ch === '\\') {
      k++;
      continue;
    }
    if (open === '[' && ch === '{') {
      // Brackets inside braces do not count: [a={x]y}].
      const g = readGroup(text, k);
      if (g) {
        k = g.end - 1;
        continue;
      }
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return { content: text.slice(j + 1, k), start: j, end: k + 1 };
    }
  }
  return null;
}

export const readOptional = (text: string, i: number) => {
  let j = i;
  while (text[j] === ' ' || text[j] === '\t') j++;
  return text[j] === '[' ? readGroup(text, j, '[', ']') : null;
};

/** The offset just past the line containing `i` (after its newline). */
export function lineEnd(text: string, i: number): number {
  const nl = text.indexOf('\n', i);
  return nl < 0 ? text.length : nl + 1;
}

export function lineStart(text: string, i: number): number {
  return text.lastIndexOf('\n', i - 1) + 1;
}

/** "\r\n" when the file uses Windows line endings, so edits match it. */
export function newlineOf(text: string): string {
  return /\r\n/.test(text.slice(0, 20000)) ? '\r\n' : '\n';
}

/* ================================================================ document */

export interface TexOutline {
  /** Offset of `\documentclass`, or -1. */
  classAt: number;
  className: string;
  classOptions: string[];
  /** End of the `\documentclass[...]{...}` statement. */
  classEnd: number;
  /** Offset of `\begin{document}`, or -1; and just after it. */
  beginAt: number;
  bodyStart: number;
  /** Offset of `\end{document}`, or the end of the text. */
  endAt: number;
}

export function outline(text: string, masked = maskTex(text)): TexOutline {
  const cls = /\\documentclass(?![a-zA-Z])/.exec(masked);
  let className = '';
  let classOptions: string[] = [];
  let classEnd = -1;
  if (cls) {
    let j = cls.index + cls[0].length;
    const opt = readOptional(masked, j);
    if (opt) {
      classOptions = opt.content.split(',').map((s) => s.trim()).filter(Boolean);
      j = opt.end;
    }
    const g = readGroup(masked, j);
    if (g) {
      className = g.content.trim();
      classEnd = g.end;
    }
  }
  const begin = masked.indexOf('\\begin{document}');
  const end = begin >= 0 ? masked.indexOf('\\end{document}', begin) : -1;
  return {
    classAt: cls ? cls.index : -1,
    className,
    classOptions,
    classEnd,
    beginAt: begin,
    bodyStart: begin >= 0 ? begin + '\\begin{document}'.length : -1,
    endAt: end >= 0 ? end : text.length,
  };
}

/* ================================================================ preamble */

export interface PackageUse {
  name: string;
  options: string[];
  /** Statement range in the file. */
  start: number;
  end: number;
}

/** Every `\usepackage` / `\RequirePackage` in a range of a file. */
export function packageUses(masked: string, from = 0, to = masked.length): PackageUse[] {
  const out: PackageUse[] = [];
  const re = /\\(?:usepackage|RequirePackage|RequirePackageWithOptions)(?![a-zA-Z])/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) && m.index < to) {
    let j = m.index + m[0].length;
    const opt = readOptional(masked, j);
    if (opt) j = opt.end;
    const g = readGroup(masked, j);
    if (!g) continue;
    let end = g.end;
    const date = readOptional(masked, end); // optional [date]
    if (date) end = date.end;
    const options = opt ? opt.content.split(',').map((s) => s.trim()).filter(Boolean) : [];
    for (const name of g.content.split(',').map((s) => s.trim()).filter(Boolean)) {
      out.push({ name, options, start: m.index, end });
    }
  }
  return out;
}

export function tikzLibraries(masked: string, from = 0, to = masked.length): Set<string> {
  const libs = new Set<string>();
  const re = /\\use(?:tikz|pgf)library(?![a-zA-Z])/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) && m.index < to) {
    const g = readGroup(masked, m.index + m[0].length);
    if (g) for (const l of g.content.split(',')) if (l.trim()) libs.add(l.trim());
  }
  return libs;
}

/** Files pulled in with \input / \include / \subfile / \import at offsets in a range. */
export interface Inclusion {
  command: string;
  target: string;
  /** For \import{dir}{file}: the directory part. */
  dir?: string;
  start: number;
  end: number;
}

export function inclusions(masked: string, from = 0, to = masked.length): Inclusion[] {
  const out: Inclusion[] = [];
  const re = /\\(input|include|subfile|import|subimport|includefrom|subincludefrom|inputfrom|subinputfrom)(?![a-zA-Z])\*?/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) && m.index < to) {
    const cmd = m[1];
    const g1 = readGroup(masked, m.index + m[0].length);
    if (!g1) {
      // TeX primitive form: \input file
      if (cmd === 'input') {
        const bare = /^[ \t]+([^\s{}\\]+)/.exec(masked.slice(m.index + m[0].length, m.index + m[0].length + 200));
        if (bare) out.push({ command: cmd, target: bare[1], start: m.index, end: m.index + m[0].length + bare[0].length });
      }
      continue;
    }
    if (/import|from/.test(cmd)) {
      const g2 = readGroup(masked, g1.end);
      if (g2) out.push({ command: cmd, dir: g1.content.trim(), target: g2.content.trim(), start: m.index, end: g2.end });
    } else {
      out.push({ command: cmd, target: g1.content.trim(), start: m.index, end: g1.end });
    }
  }
  return out;
}

/** Simple macros from \newcommand / \renewcommand / \def / \DeclareMathOperator. */
export interface Macro {
  name: string;
  args: number;
  optionalDefault?: string;
  body: string;
}

export function macros(masked: string, from = 0, to = masked.length): Macro[] {
  const out: Macro[] = [];
  const src = masked.slice(from, to);
  const re = /\\(?:re)?newcommand\*?\s*(?:\{\s*(\\[a-zA-Z@]+)\s*\}|(\\[a-zA-Z@]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const name = (m[1] ?? m[2]).slice(1);
    let j = m.index + m[0].length;
    let args = 0;
    let optionalDefault: string | undefined;
    const a = readOptional(src, j);
    if (a && /^\s*\d\s*$/.test(a.content)) {
      args = Number(a.content.trim());
      j = a.end;
      const d = readOptional(src, j);
      if (d) {
        optionalDefault = d.content;
        j = d.end;
      }
    }
    const body = readGroup(src, j);
    if (body) out.push({ name, args, optionalDefault, body: body.content });
  }
  const def = /\\def\s*\\([a-zA-Z@]+)((?:#\d)*)\s*\{/g;
  while ((m = def.exec(src))) {
    const body = readGroup(src, m.index + m[0].length - 1);
    if (body) out.push({ name: m[1], args: (m[2].match(/#/g) ?? []).length, body: body.content });
  }
  const op = /\\DeclareMathOperator(\*?)\s*\{\s*\\([a-zA-Z]+)\s*\}/g;
  while ((m = op.exec(src))) {
    const body = readGroup(src, m.index + m[0].length);
    if (body) out.push({ name: m[2], args: 0, body: `\\operatorname${m[1]}{${body.content}}` });
  }
  return out;
}

/** Expand user macros in a string (bounded, so recursive definitions stop). */
export function expandMacros(s: string, defs: Map<string, Macro>, depth = 0): string {
  if (defs.size === 0 || depth > 8 || !s.includes('\\')) return s;
  let changed = false;
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\\' && /[a-zA-Z@]/.test(s[i + 1] ?? '')) {
      let j = i + 1;
      while (j < s.length && /[a-zA-Z@]/.test(s[j])) j++;
      const name = s.slice(i + 1, j);
      const d = defs.get(name);
      if (d) {
        let k = j;
        const args: string[] = [];
        if (d.optionalDefault !== undefined) {
          const o = readOptional(s, k);
          args.push(o ? o.content : d.optionalDefault);
          if (o) k = o.end;
        }
        while (args.length < d.args) {
          const g = readGroup(s, k);
          if (g) {
            args.push(g.content);
            k = g.end;
          } else {
            // A single token argument: \frac12 style.
            let t = k;
            while (s[t] === ' ') t++;
            if (t >= s.length) break;
            if (s[t] === '\\') {
              let e = t + 1;
              while (e < s.length && /[a-zA-Z]/.test(s[e])) e++;
              args.push(s.slice(t, Math.max(e, t + 2)));
              k = Math.max(e, t + 2);
            } else {
              args.push(s[t]);
              k = t + 1;
            }
          }
        }
        let body = d.body;
        args.forEach((a, n) => {
          body = body.split(`#${n + 1}`).join(a);
        });
        out += body;
        i = k;
        changed = true;
        continue;
      }
      out += s.slice(i, j);
      i = j;
      continue;
    }
    out += s[i];
    i++;
  }
  return changed ? expandMacros(out, defs, depth + 1) : out;
}

/* ============================================================ main file */

export interface MainCandidate {
  path: string;
  score: number;
  className: string;
  reasons: string[];
}

export interface MainDetection {
  candidates: MainCandidate[];
  /** .tex files that have \documentclass but no \begin{document}, etc. */
  rejected: { path: string; reason: string }[];
  /** True when the best guess is not clearly better than the next one. */
  ambiguous: boolean;
}

const MAIN_NAMES = /^(main|thesis|report|paper|manuscript|root|article|document|ms|book|dissertation|index|master)\.tex$/i;

/**
 * Which .tex file is the document? The same question Overleaf answers when a
 * zip is uploaded: a file with \documentclass and \begin{document}, preferring
 * conventional names, shallow paths and files that pull others in.
 */
export function detectMain(files: { path: string; text: string }[]): MainDetection {
  const candidates: MainCandidate[] = [];
  const rejected: { path: string; reason: string }[] = [];
  for (const f of files) {
    const masked = maskTex(f.text);
    const o = outline(f.text, masked);
    if (o.classAt < 0) continue;
    if (o.beginAt < 0) {
      rejected.push({ path: f.path, reason: 'has \\documentclass but no \\begin{document}' });
      continue;
    }
    if (o.className === 'subfiles') {
      rejected.push({ path: f.path, reason: 'is a subfile of another document' });
      continue;
    }
    if (o.beginAt < o.classAt) {
      rejected.push({ path: f.path, reason: '\\begin{document} comes before \\documentclass' });
      continue;
    }
    const reasons: string[] = [];
    let score = 100;
    const base = f.path.split('/').pop() ?? f.path;
    if (/^main\.tex$/i.test(base)) {
      score += 50;
      reasons.push('named main.tex');
    } else if (MAIN_NAMES.test(base)) {
      score += 30;
      reasons.push(`conventional name (${base})`);
    }
    const depth = f.path.split('/').length - 1;
    score -= depth * 15;
    if (o.className === 'standalone') {
      score -= 45;
      reasons.push('a standalone picture');
    }
    const incs = inclusions(masked).length;
    if (incs) {
      score += Math.min(25, incs * 5);
      reasons.push(`includes ${incs} file${incs > 1 ? 's' : ''}`);
    }
    if (/\\(?:bibliography|addbibresource|printbibliography)\b/.test(masked)) {
      score += 8;
      reasons.push('has a bibliography');
    }
    score += Math.min(10, f.text.length / 10000);
    candidates.push({ path: f.path, score: Math.round(score * 10) / 10, className: o.className, reasons });
  }
  candidates.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  // Ask the user when two real documents compete: a close score, or a top
  // pick that is not the conventional root main.tex.
  const real = candidates.filter((c) => c.className !== 'standalone');
  const top = candidates[0];
  const ambiguous =
    real.length > 1 && (top.score - candidates[1].score < 25 || !/^main\.tex$/i.test(top.path));
  return { candidates, rejected, ambiguous };
}
