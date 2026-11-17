import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectError, access, decodeText, encodeText, exportProject, kindOf, loadProject, modifiedPaths } from '../project/project';
import { openZip, readEntry } from '../project/zip';
import { parseDocument } from '../project/document';
import { planInsert } from '../project/figure';
import { diagramOf } from './helpers/projectHelpers';

const FIX = join(__dirname, 'fixtures', 'project');
const zip = (name: string) => new Blob([readFileSync(join(FIX, name))], { type: 'application/zip' });
const load = (name: string) => loadProject(zip(name), name);

async function err(p: Promise<unknown>): Promise<ProjectError> {
  try {
    await p;
  } catch (e) {
    return e as ProjectError;
  }
  throw new Error('expected a failure');
}

describe('opening a LaTeX project zip', () => {
  it('opens an Overleaf export, strips its wrapping folder and finds main.tex', async () => {
    const steps: string[] = [];
    const p = await loadProject(zip('overleaf-article.zip'), 'overleaf-article.zip', (s) => steps.push(s.stage));
    expect(p.name).toBe('overleaf-article');
    expect(p.rootPrefix).toBe('MyPaper/');
    expect(p.mainPath).toBe('main.tex');
    expect(p.order).toEqual(['main.tex', 'sections/method.tex', 'figures/diagram.png', 'refs.bib']);
    expect(p.files['figures/diagram.png'].kind).toBe('image');
    expect(p.files['figures/diagram.png'].text).toBeUndefined();
    expect(p.files['refs.bib'].text).toContain('knuth84');
    expect(steps).toEqual(expect.arrayContaining(['reading', 'scanning', 'detecting']));
    const doc = parseDocument(p.mainPath, access(p));
    expect(doc.bodyFiles).toEqual(['main.tex', 'sections/method.tex']);
    expect(doc.missing).toEqual([]);
  });

  it('refuses a zip without a main LaTeX file and says what it found', async () => {
    const e = await err(load('no-main.zip'));
    expect(e).toBeInstanceOf(ProjectError);
    expect(e.message).toMatch(/No main LaTeX file was found/);
    expect(e.details.join('\n')).toMatch(/broken\.tex has \\documentclass but no \\begin\{document\}/);
    expect(e.details.join('\n')).toMatch(/chapters\/one\.tex: no \\documentclass/);
  });

  it('refuses a zip with no .tex at all, an empty zip, a non-zip and a damaged zip', async () => {
    expect((await err(load('no-tex.zip'))).message).toMatch(/no \.tex file/);
    expect((await err(load('empty.zip'))).message).toMatch(/empty/);
    expect((await err(load('not-a-zip.zip'))).message).toMatch(/not a zip/);
    expect((await err(load('truncated.zip'))).message).toMatch(/incomplete or damaged/);
    expect((await err(loadProject(new Blob(['x']), 'notes.txt'))).message).toMatch(/choose a \.zip/);
  });

  it('asks when there are competing documents, and picks the obvious one when not', async () => {
    const multi = await load('multi-main.zip');
    expect(multi.detection.ambiguous).toBe(true);
    expect(multi.detection.candidates.map((c) => c.path).sort()).toEqual(['figures/pic.tex', 'paper.tex', 'slides.tex']);
    const clear = await load('clear-main.zip');
    expect(clear.detection.ambiguous).toBe(false);
    expect(clear.mainPath).toBe('thesis.tex');
    const doc = parseDocument(clear.mainPath, access(clear));
    expect(doc.blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph']);
    expect(doc.blocks[0].file).toBe('chapters/intro.tex');
  });

  it('opens around unreadable entries and unsafe names, with notes', async () => {
    const enc = await load('encrypted-entry.zip');
    expect(enc.mainPath).toBe('main.tex');
    expect(enc.files['secret.tex'].error).toMatch(/password-protected/);
    expect(enc.warnings.join(' ')).toMatch(/secret\.tex/);
    const unsafe = await load('unsafe-paths.zip');
    expect(unsafe.order).toEqual(['main.tex']);
    expect(unsafe.warnings.join(' ')).toMatch(/evil\.tex/);
    const bz = await load('bzip2-entry.zip');
    expect(bz.files['photo.png'].entry?.unreadable).toBeTruthy();
    const dd = await load('data-descriptor.zip');
    expect(dd.files['main.tex'].text).toContain('Streamed.');
  });

  it('reads Latin-1 and UTF-8-with-BOM sources faithfully', async () => {
    const l = await load('latin1-crlf.zip');
    expect(l.files['main.tex'].encoding).toBe('windows-1252');
    expect(l.files['main.tex'].text).toContain('Café crème.');
    const b = await load('bom.zip');
    expect(b.files['main.tex'].bom).toBe(true);
    expect(b.files['main.tex'].text!.startsWith('\\documentclass')).toBe(true);
    expect(decodeText(encodeText('Ünïcödé', 'utf-8', true)).text).toBe('Ünïcödé');
    expect(decodeText(encodeText('€ café', 'windows-1252')).text).toBe('€ café');
  });

  it('classifies files', () => {
    expect(['a.tex', 'b.bib', 'c.sty', 'd.PNG', 'e.pdf', 'f.csv', 'g.xyz'].map(kindOf)).toEqual(['tex', 'bib', 'style', 'image', 'pdf', 'data', 'other']);
  });
});

describe('downloading the project again', () => {
  it('without changes, every entry comes back byte for byte', async () => {
    const p = await load('overleaf-article.zip');
    const out = await openZip(await exportProject(p));
    const src = await openZip(zip('overleaf-article.zip'));
    expect(out.entries.map((e) => e.path)).toEqual(src.entries.map((e) => e.path));
    for (const e of src.entries.filter((x) => !x.dir)) {
      const o = out.entries.find((x) => x.path === e.path)!;
      expect(o.crc32).toBe(e.crc32);
      expect(o.compressedSize).toBe(e.compressedSize);
      expect(Buffer.from(await readEntry(out, o)).equals(Buffer.from(await readEntry(src, e)))).toBe(true);
    }
  });

  it('with a drawing inserted, only the edited file changes, folders and images intact', async () => {
    const p = await load('overleaf-article.zip');
    const doc = parseDocument(p.mainPath, access(p));
    const b = doc.blocks.find((x) => x.text.startsWith('We use a three-step'))!;
    const edits = await planInsert(doc, access(p), diagramOf('flow-if-else'), { file: b.file, offset: b.end, after: true, indent: '' }, { id: 'fig1', caption: 'Pipeline', placement: 'here' });
    for (const [path, t] of edits) p.files[path].text = t;
    expect(modifiedPaths(p).sort()).toEqual(['main.tex', 'sections/method.tex']);
    const out = await openZip(await exportProject(p));
    const read = async (path: string) => new TextDecoder().decode(await readEntry(out, out.entries.find((e) => e.path === path)!));
    expect(await read('MyPaper/sections/method.tex')).toContain('FlowTikZ figure fig1 (begin)');
    expect(await read('MyPaper/main.tex')).toContain('\\usepackage{tikz}');
    expect(await read('MyPaper/refs.bib')).toBe(p.files['refs.bib'].text);
    const src = await openZip(zip('overleaf-article.zip'));
    const png = src.entries.find((e) => e.path.endsWith('.png'))!;
    const png2 = out.entries.find((e) => e.path === png.path)!;
    expect(png2.crc32).toBe(png.crc32);
    expect(out.entries.filter((e) => e.dir).map((e) => e.path)).toEqual(['MyPaper', 'MyPaper/sections', 'MyPaper/figures']);
    // The edited project opens again, and the figure is found.
    const again = await loadProject(await exportProject(p), 'again.zip');
    const doc2 = parseDocument(again.mainPath, access(again));
    expect(doc2.blocks.filter((x) => x.kind === 'flowtikz').map((x) => x.figureId)).toEqual(['fig1']);
  });

  it('keeps the original encoding and byte-order mark of edited files', async () => {
    const l = await load('latin1-crlf.zip');
    l.files['main.tex'].text = l.files['main.tex'].text!.replace('Second', 'Zweite (Grüße)');
    const out = await openZip(await exportProject(l));
    const bytes = await readEntry(out, out.entries[0]);
    expect(bytes.includes(0xc3)).toBe(false); // not UTF-8
    expect(new TextDecoder('windows-1252').decode(bytes)).toContain('Café crème.\r\n\r\nZweite (Grüße)');
    const b = await load('bom.zip');
    b.files['main.tex'].text += '% edited\n';
    const ob = await openZip(await exportProject(b));
    const bb = await readEntry(ob, ob.entries[0]);
    expect([...bb.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('carries unreadable entries (bzip2, encrypted) through untouched', async () => {
    for (const name of ['bzip2-entry.zip', 'encrypted-entry.zip']) {
      const p = await load(name);
      p.files['main.tex'].text += '\n% touched\n';
      const out = await openZip(await exportProject(p));
      const src = await openZip(zip(name));
      for (const e of src.entries.filter((x) => x.unreadable)) {
        const o = out.entries.find((x) => x.path === e.path)!;
        expect(o.method).toBe(e.method);
        expect(o.crc32).toBe(e.crc32);
        expect(o.encrypted).toBe(e.encrypted);
        expect(o.compressedSize).toBe(e.compressedSize);
      }
    }
  });
});
