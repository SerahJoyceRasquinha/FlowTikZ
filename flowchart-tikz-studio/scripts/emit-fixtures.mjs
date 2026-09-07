/**
 * Emit LaTeX fixtures for real compilation.
 *
 * Static tests can prove the output is well-formed; only a TeX run proves it
 * compiles. This script writes one .tex per representative diagram into
 * latex-verify/, which `scripts/verify-latex.sh` then compiles with pdflatex.
 *
 * Usage: npm run latex:fixtures
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'latex-verify');
mkdirSync(outDir, { recursive: true });

// The model is TypeScript; compile it on the fly through esbuild, which ships
// with Vite, so this script needs no extra dependency.
const { build } = await import('esbuild');
const bundle = await build({
  entryPoints: [resolve(here, 'fixtures.entry.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node18',
});
const code = bundle.outputFiles[0].text;
const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const { fixtures } = await import(dataUrl);

for (const { name, code: tex } of fixtures) {
  const file = resolve(outDir, `${name}.tex`);
  writeFileSync(file, tex, 'utf8');
  console.log(`wrote ${file} (${tex.split('\n').length} lines)`);
}
console.log(`\n${fixtures.length} fixtures ready. Compile them with:\n  bash scripts/verify-latex.sh`);
void register;
