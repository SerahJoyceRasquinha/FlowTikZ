/**
 * LaTeX text escaping.
 *
 * User text never reaches the output unfiltered. Everything that TeX would
 * treat as markup is either escaped or replaced with an equivalent command,
 * so no diagram content can break compilation (or inject commands).
 */

const SIMPLE: Record<string, string> = {
  '#': '\\#',
  '$': '\\$',
  '%': '\\%',
  '&': '\\&',
  '_': '\\_',
  '{': '\\{',
  '}': '\\}',
};

const COMMANDS: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '<': '\\textless{}',
  '>': '\\textgreater{}',
  '|': '\\textbar{}',
};

/** Characters we can map to a real LaTeX command instead of dropping them. */
const UNICODE: Record<string, string> = {
  '—': '---',
  '–': '--',
  '“': "``",
  '”': "''",
  '‘': '`',
  '’': "'",
  '…': '\\ldots{}',
  '≤': '$\\leq$',
  '≥': '$\\geq$',
  '≠': '$\\neq$',
  '×': '$\\times$',
  '÷': '$\\div$',
  '±': '$\\pm$',
  '→': '$\\rightarrow$',
  '←': '$\\leftarrow$',
  '↔': '$\\leftrightarrow$',
  '⇒': '$\\Rightarrow$',
  '∞': '$\\infty$',
  '°': '\\textdegree{}',
  'α': '$\\alpha$',
  'β': '$\\beta$',
  'γ': '$\\gamma$',
  'δ': '$\\delta$',
  'λ': '$\\lambda$',
  'μ': '$\\mu$',
  'π': '$\\pi$',
  'σ': '$\\sigma$',
  'Δ': '$\\Delta$',
  'Σ': '$\\Sigma$',
  'Ω': '$\\Omega$',
  '\u00a0': '~',
};

export interface EscapeResult {
  text: string;
  /** Characters we could not represent with pdfLaTeX's default encoding. */
  risky: string[];
}

function escapeChar(ch: string): { out: string; risky: boolean } {
  if (SIMPLE[ch]) return { out: SIMPLE[ch], risky: false };
  if (COMMANDS[ch]) return { out: COMMANDS[ch], risky: false };
  if (UNICODE[ch]) return { out: UNICODE[ch], risky: false };
  const code = ch.codePointAt(0) ?? 0;
  if (code < 128) return { out: ch, risky: false };
  // Latin-1 supplement and Latin Extended-A survive pdfLaTeX with
  // fontenc/inputenc, which the generated preamble loads.
  if (code <= 0x017f) return { out: ch, risky: false };
  return { out: ch, risky: true };
}

/** Escape a single line of user text. */
export function escapeLatex(input: string): EscapeResult {
  const risky = new Set<string>();
  let out = '';
  for (const ch of input) {
    const r = escapeChar(ch);
    out += r.out;
    if (r.risky) risky.add(ch);
  }
  return { text: out, risky: [...risky] };
}

export interface EscapedText {
  /** Ready-to-emit node body, with `\\` between lines. */
  body: string;
  lines: string[];
  risky: string[];
  isEmpty: boolean;
}

/**
 * Escape multi-line text and apply inline formatting.
 * Formatting is applied per line so that a line break never splits a group.
 */
export function escapeNodeText(
  raw: string,
  opts: { bold?: boolean; italic?: boolean; underline?: boolean } = {},
): EscapedText {
  const source = raw ?? '';
  const rawLines = source.split(/\r?\n/);
  const risky = new Set<string>();
  const lines = rawLines.map((line) => {
    const r = escapeLatex(line);
    r.risky.forEach((c) => risky.add(c));
    let t = r.text;
    if (t.length === 0) return '';
    if (opts.bold) t = `\\textbf{${t}}`;
    if (opts.italic) t = `\\textit{${t}}`;
    if (opts.underline) t = `\\underline{${t}}`;
    return t;
  });
  const isEmpty = source.trim().length === 0;
  return {
    body: lines.join(' \\\\ '),
    lines,
    risky: [...risky],
    isEmpty,
  };
}

/** Escape text destined for a LaTeX comment (no command expansion there). */
export function escapeComment(raw: string): string {
  return (raw ?? '').replace(/[\r\n]+/g, ' ').replace(/%/g, '\\%');
}
