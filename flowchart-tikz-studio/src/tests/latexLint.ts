/**
 * Static checks that catch the failure modes a real LaTeX run would catch,
 * without needing a TeX distribution in CI: unbalanced groups, unterminated
 * statements, colours used but never defined, and libraries used but never
 * loaded. `docs/VERIFICATION.md` describes the actual compilation pass that
 * complements these.
 */

export interface LintResult {
  ok: boolean;
  problems: string[];
}

const LIBRARY_TRIGGERS: { pattern: RegExp; library: string }[] = [
  { pattern: /\b(Stealth|Latex|Triangle|Bar|Circle|Diamond)\[/, library: 'arrows.meta' },
  { pattern: /shape=diamond|shape=ellipse/, library: 'shapes.geometric' },
  { pattern: /shape=rounded rectangle|rounded rectangle arc length/, library: 'shapes.misc' },
  { pattern: /drop shadow/, library: 'shadows' },
];

export function lintLatex(code: string, opts: { standalone: boolean }): LintResult {
  const problems: string[] = [];
  const lines = code.split('\n');

  /* Balanced braces and brackets, ignoring comments. */
  let braces = 0;
  let brackets = 0;
  for (const [i, raw] of lines.entries()) {
    const line = raw.replace(/(^|[^\\])%.*$/, '$1');
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      const escaped = c > 0 && line[c - 1] === '\\';
      if (escaped) continue;
      if (ch === '{') braces++;
      if (ch === '}') braces--;
      if (ch === '[') brackets++;
      if (ch === ']') brackets--;
      if (braces < 0) problems.push(`line ${i + 1}: closing brace with no opener`);
      if (brackets < 0) problems.push(`line ${i + 1}: closing bracket with no opener`);
    }
  }
  if (braces !== 0) problems.push(`unbalanced braces (${braces})`);
  if (brackets !== 0) problems.push(`unbalanced brackets (${brackets})`);

  /* One terminating semicolon per drawing statement. */
  const statements =
    (code.match(/\\draw\[/g) ?? []).length +
    (code.match(/\\node\[/g) ?? []).length +
    (code.match(/\\coordinate \(/g) ?? []).length;
  const semicolons = (code.match(/;/g) ?? []).length;
  if (statements !== semicolons) {
    problems.push(
      `${statements} drawing statements but ${semicolons} semicolons`,
    );
  }

  /* Scopes must close. */
  const open = (code.match(/\\begin\{scope\}/g) ?? []).length;
  const close = (code.match(/\\end\{scope\}/g) ?? []).length;
  if (open !== close) problems.push(`${open} scopes opened, ${close} closed`);

  /* Environments must close. */
  for (const env of opts.standalone ? ['document', 'tikzpicture'] : ['tikzpicture']) {
    const b = (code.match(new RegExp(`\\\\begin\\{${env}\\}`, 'g')) ?? []).length;
    const e = (code.match(new RegExp(`\\\\end\\{${env}\\}`, 'g')) ?? []).length;
    if (b !== e || b === 0) problems.push(`${env} environment is not balanced`);
  }

  /* Every generated colour name must have a definition. */
  const defined = new Set(
    [...code.matchAll(/\\definecolor\{(fc[0-9A-F]{6})\}/g)].map((m) => m[1]),
  );
  for (const m of code.matchAll(/\b(fc[0-9A-F]{6})\b/g)) {
    if (!defined.has(m[1])) problems.push(`colour ${m[1]} is used but never defined`);
  }

  /* No duplicate colour definitions. */
  const defList = [...code.matchAll(/\\definecolor\{([^}]+)\}/g)].map((m) => m[1]);
  if (new Set(defList).size !== defList.length) {
    problems.push('a colour is defined more than once');
  }

  /* Libraries implied by the body must be loaded (or listed for the preamble). */
  const body = code;
  for (const trigger of LIBRARY_TRIGGERS) {
    if (trigger.pattern.test(body)) {
      const loaded = new RegExp(
        `usetikzlibrary\\{[^}]*${trigger.library.replace('.', '\\.')}`,
      ).test(body);
      if (!loaded) problems.push(`library ${trigger.library} is required but not loaded`);
    }
  }

  /* Style names referenced in options must be defined by \tikzset. */
  for (const style of ['fcnode', 'fcpath', 'fcedge', 'fclabel']) {
    const used = new RegExp(`\\[${style}[,\\]]`).test(code);
    if (used && !code.includes(`${style}/.style=`)) {
      problems.push(`style ${style} is used but never defined`);
    }
  }

  /* Coordinates must be numeric. */
  for (const m of code.matchAll(/\(([^)]*)\)/g)) {
    if (/NaN|Infinity|undefined/.test(m[1])) {
      problems.push(`non-numeric coordinate: (${m[1]})`);
    }
  }

  if (opts.standalone && !code.includes('\\documentclass')) {
    problems.push('standalone output has no \\documentclass');
  }
  if (!opts.standalone && code.includes('\\documentclass')) {
    problems.push('snippet output should not contain \\documentclass');
  }

  return { ok: problems.length === 0, problems };
}
