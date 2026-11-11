/**
 * Structural checks on user-supplied TeX.
 *
 * Runs before anything reaches the generated document, and also on content
 * read from a save file, so a hand-edited project cannot smuggle a primitive
 * into the output. Failures become an issue in the code panel and a visible
 * placeholder; the document still compiles.
 */

const FORBIDDEN =
  /\\(?:input|include|includegraphics|write|immediate|openin|openout|read|catcode|def|edef|gdef|xdef|let|newcommand|renewcommand|providecommand|usepackage|documentclass|href|url|csname|special|directlua|ShellEscape|loop)(?![a-zA-Z])|\\end\{document\}/;

export function validateTex(tex: string): string | null {
  const banned = tex.match(FORBIDDEN);
  if (banned) return `${banned[0]} is not allowed in a formula.`;

  const foreign = tex.match(/[^\x00-\x7F\u00C0-\u017F]/);
  if (foreign) return `The character ${foreign[0]} is not available to pdfLaTeX here; use its LaTeX command.`;

  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '%') return 'A bare % would comment out the rest of the formula; write \\% instead.';
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth < 0) return 'There is a closing brace } with no matching opening brace.';
    }
  }
  if (depth > 0) return `${depth} opening brace${depth > 1 ? 's are' : ' is'} never closed.`;

  const stripped = tex.replace(/\\\\/g, '  ');
  const lefts = (stripped.match(/\\left(?![a-zA-Z])/g) ?? []).length;
  const rights = (stripped.match(/\\right(?![a-zA-Z])/g) ?? []).length;
  if (lefts !== rights) return `\\left and \\right do not pair up (${lefts} and ${rights}).`;

  const stack: string[] = [];
  for (const m of stripped.matchAll(/\\(begin|end)\{([^}]*)\}/g)) {
    if (m[1] === 'begin') stack.push(m[2]);
    else if (stack.pop() !== m[2]) return `\\end{${m[2]}} does not match its \\begin.`;
  }
  if (stack.length) return `\\begin{${stack[stack.length - 1]}} is never closed.`;
  return null;
}

/** Characters pdfLaTeX will not accept in math mode, and their macros. */
const UNICODE_TO_TEX: Record<string, string> = {
  α: '\\alpha ', β: '\\beta ', γ: '\\gamma ', δ: '\\delta ', ε: '\\varepsilon ', ζ: '\\zeta ',
  η: '\\eta ', θ: '\\theta ', ι: '\\iota ', κ: '\\kappa ', λ: '\\lambda ', μ: '\\mu ', µ: '\\mu ',
  ν: '\\nu ', ξ: '\\xi ', π: '\\pi ', ρ: '\\rho ', σ: '\\sigma ', τ: '\\tau ', υ: '\\upsilon ',
  φ: '\\phi ', χ: '\\chi ', ψ: '\\psi ', ω: '\\omega ', Γ: '\\Gamma ', Δ: '\\Delta ', Θ: '\\Theta ',
  Λ: '\\Lambda ', Ξ: '\\Xi ', Π: '\\Pi ', Σ: '\\Sigma ', Φ: '\\Phi ', Ψ: '\\Psi ', Ω: '\\Omega ',
  '\u2126': '\\Omega ', '×': '\\times ', '÷': '\\div ', '·': '\\cdot ', '−': '-', '±': '\\pm ', '∓': '\\mp ',
  '≠': '\\neq ', '≤': '\\leq ', '≥': '\\geq ', '≈': '\\approx ', '≡': '\\equiv ', '∝': '\\propto ',
  '∞': '\\infty ', '→': '\\to ', '←': '\\leftarrow ', '⇒': '\\Rightarrow ', '⇔': '\\Leftrightarrow ',
  '∈': '\\in ', '∉': '\\notin ', '⊂': '\\subset ', '⊆': '\\subseteq ', '∪': '\\cup ', '∩': '\\cap ',
  '∅': '\\emptyset ', '∀': '\\forall ', '∃': '\\exists ', '∧': '\\land ', '∨': '\\lor ', '¬': '\\neg ',
  '∫': '\\int ', '∮': '\\oint ', '∂': '\\partial ', '∇': '\\nabla ', '∑': '\\sum ', '∏': '\\prod ',
  '∠': '\\angle ', '⊥': '\\perp ', '∥': '\\parallel ', '°': '^\\circ ', 'ħ': '\\hbar ',
};

/** Replace typed Unicode maths with the macro that compiles under pdfLaTeX. */
export function unicodeToTex(s: string): string {
  let out = '';
  for (const ch of s) out += UNICODE_TO_TEX[ch] ?? ch;
  return out;
}

/** mhchem cannot read a typed degree sign; `$^\\circ$` means the same. */
export function normalizeChemSource(s: string): string {
  return s.replace(/°/g, '$^\\circ$').replace(/\u2212/g, '-');
}
