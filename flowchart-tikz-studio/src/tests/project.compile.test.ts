import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { access, exportProject, loadProject, type LatexProject } from '../project/project';
import { parseDocument } from '../project/document';
import { planInsert, type Placement } from '../project/figure';
import { loadEngine } from '../science/math/engine';
import { diagramOf } from './helpers/projectHelpers';

/**
 * End-to-end proof that a document with drawn figures still compiles, and
 * that inserting them did not disturb the layout: the edited project is
 * exported, unzipped by Python's zipfile (an independent reader) and compiled
 * with pdflatex next to the untouched original. Page size and \textwidth must
 * match, and no new overfull boxes may appear.
 *
 * Skipped where pdflatex is not installed.
 */

const FIX = join(__dirname, 'fixtures', 'project');
const hasTex = spawnSync('pdflatex', ['--version']).status === 0 && spawnSync('python3', ['--version']).status === 0;

async function unzipTo(blob: Blob): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'ftz-compile-'));
  const zipPath = join(dir, 'project.zip');
  writeFileSync(zipPath, Buffer.from(await blob.arrayBuffer()));
  execFileSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; z.extractall(sys.argv[2])', zipPath, join(dir, 'x')]);
  return join(dir, 'x');
}

interface Compiled {
  ok: boolean;
  log: string;
  overfull: number;
  textwidth: string;
  pages: number;
}

function compile(dir: string, main: string): Compiled {
  const mainDir = join(dir, main.split('/').slice(0, -1).join('/'));
  const file = main.split('/').pop()!;
  // Report \textwidth into the log to compare layouts.
  const src = readFileSync(join(mainDir, file), 'latin1');
  writeFileSync(join(mainDir, file), src.replace('\\begin{document}', '\\begin{document}\\typeout{TEXTWIDTH=\\the\\textwidth}'), 'latin1');
  let ok = true;
  for (let pass = 0; pass < 2; pass++) {
    const r = spawnSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', file], { cwd: mainDir, encoding: 'latin1', timeout: 120_000 });
    if (r.status !== 0) ok = false;
  }
  const log = readFileSync(join(mainDir, file.replace(/\.tex$/, '.log')), 'latin1');
  const pdf = join(mainDir, file.replace(/\.tex$/, '.pdf'));
  const pages = existsSync(pdf) ? Number(/\/Type\s*\/Pages[\s\S]*?\/Count (\d+)/.exec(readFileSync(pdf, 'latin1'))?.[1] ?? 0) : 0;
  return {
    ok: ok && existsSync(pdf),
    log,
    overfull: (log.match(/Overfull \\hbox/g) ?? []).length,
    textwidth: /TEXTWIDTH=([\d.]+pt)/.exec(log)?.[1] ?? '',
    pages,
  };
}

async function insertAll(p: LatexProject, plan: { after: string; template: string; placement: Placement; caption: string }[]) {
  let n = 0;
  for (const step of plan) {
    const doc = parseDocument(p.mainPath, access(p));
    const b = doc.blocks.find((x) => x.text.startsWith(step.after));
    if (!b) throw new Error(`no block starting with ${step.after}`);
    const edits = await planInsert(doc, access(p), diagramOf(step.template), { file: b.file, offset: b.end, after: true, indent: b.indent }, { id: `fig${++n}`, caption: step.caption, label: step.caption ? `fig:t${n}` : undefined, placement: step.placement });
    for (const [path, t] of edits) p.files[path].text = t;
  }
}

const cases: { zip: string; plan: { after: string; template: string; placement: Placement; caption: string }[] }[] = [
  {
    zip: 'overleaf-article.zip',
    plan: [
      { after: 'We use a three-step', template: 'flow-if-else', placement: 'here', caption: 'Decision step' },
      { after: '\\section{Results}', template: 'phys-rc', placement: 'float', caption: 'An RC circuit' },
      { after: 'It works.', template: 'flow-binary-search', placement: 'here', caption: '' },
      { after: 'Flowcharts are everywhere', template: 'math-quadratic', placement: 'here', caption: 'Roots' },
      { after: '\\section{Conclusion}', template: 'chem-haber', placement: 'float', caption: 'Haber process' },
    ],
  },
  { zip: 'preamble-file.zip', plan: [{ after: 'Some text in a report', template: 'flow-login', placement: 'float', caption: 'Login' }] },
  { zip: 'report-include.zip', plan: [{ after: 'Intro text', template: 'phys-free-body', placement: 'here', caption: 'Forces' }] },
  { zip: 'twocolumn.zip', plan: [{ after: 'Two column text', template: 'flow-waterfall', placement: 'float', caption: 'Wide process' }, { after: 'More words', template: 'flow-linear', placement: 'here', caption: '' }] },
  { zip: 'latin1-crlf.zip', plan: [{ after: 'Caf', template: 'flow-ipo', placement: 'here', caption: 'Café flow' }] },
];

describe.skipIf(!hasTex)('compiling documents with inserted drawings (pdflatex)', () => {
  beforeAll(async () => {
    await loadEngine();
  });

  for (const c of cases) {
    it(`${c.zip}: compiles, same page size and text width, no new overfull boxes`, async () => {
      const original = await loadProject(new Blob([readFileSync(join(FIX, c.zip))]), c.zip);
      const before = compile(await unzipTo(await exportProject(original)), original.rootPrefix + original.mainPath);
      expect(before.ok, `original ${c.zip} should compile:\n${before.log.slice(-1500)}`).toBe(true);

      const edited = await loadProject(new Blob([readFileSync(join(FIX, c.zip))]), c.zip);
      await insertAll(edited, c.plan);
      const after = compile(await unzipTo(await exportProject(edited)), edited.rootPrefix + edited.mainPath);
      expect(after.ok, `edited ${c.zip} should compile:\n${after.log.split('\n').filter((l) => l.startsWith('!')).join('\n')}\n${after.log.slice(-2000)}`).toBe(true);
      expect(after.textwidth).toBe(before.textwidth);
      expect(after.overfull, after.log.split('\n').filter((l) => /Overfull/.test(l)).join('\n')).toBeLessThanOrEqual(before.overfull);
      expect(after.pages).toBeGreaterThanOrEqual(before.pages);
      expect(after.log).not.toMatch(/LaTeX Error|Undefined control sequence|Option clash/);
    }, 240_000);
  }
});
