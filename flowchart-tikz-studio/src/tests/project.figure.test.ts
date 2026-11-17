import { beforeAll, describe, expect, it } from 'vitest';
import { diagramOf } from './helpers/projectHelpers';
import { loadEngine } from '../science/math/engine';
import { parseDocument, type FileAccess } from '../project/document';
import {
  decodeDiagram,
  documentStyle,
  encodeDiagram,
  figureCode,
  findFigure,
  loadedPackages,
  planInsert,
  planRemove,
  planReplace,
  slugLabel,
  splitStatements,
  type FigureOptions,
  type Target,
} from '../project/figure';
import { maskTex, packageUses } from '../project/texScan';

class Files implements FileAccess {
  constructor(public map: Record<string, string>) {}
  text = (p: string) => this.map[p];
  exists = (p: string) => p in this.map;
  apply(edits: Map<string, string>) {
    for (const [p, t] of edits) this.map[p] = t;
  }
}

const MAIN = `\\documentclass[11pt]{article}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\begin{document}
\\section{Intro}
First paragraph.

Second paragraph.
\\end{document}
`;

function afterBlock(files: Files, main: string, text: string): Target {
  const doc = parseDocument(main, files);
  const b = doc.blocks.find((x) => x.text.startsWith(text))!;
  return { file: b.file, offset: b.end, after: true, indent: b.indent };
}

const opts = (o: Partial<FigureOptions> = {}): FigureOptions => ({ id: 'fig1', caption: '', placement: 'here', ...o });

beforeAll(async () => {
  await loadEngine();
});

describe('inserting a drawing into a document', () => {
  it('puts the figure exactly after the chosen paragraph and moves the rest down unchanged', async () => {
    const f = new Files({ 'main.tex': MAIN });
    const doc = parseDocument('main.tex', f);
    const edits = await planInsert(doc, f, diagramOf('flow-if-else'), afterBlock(f, 'main.tex', 'First paragraph'), opts());
    const out = edits.get('main.tex')!;
    const fig = out.indexOf('% ==== FlowTikZ figure fig1 (begin)');
    expect(fig).toBeGreaterThan(out.indexOf('First paragraph.'));
    expect(fig).toBeLessThan(out.indexOf('Second paragraph.'));
    // Paragraph structure: a blank line before and after the figure.
    expect(out).toMatch(/First paragraph\.\n\n% ==== FlowTikZ figure fig1 \(begin\)/);
    expect(out).toMatch(/\(end\) ====\n\nSecond paragraph\./);
    // Every original line is still there, in order.
    const original = MAIN.split('\n').filter((l) => l.trim());
    let at = 0;
    for (const l of original) {
      const i = out.indexOf(l, at);
      expect(i, l).toBeGreaterThanOrEqual(0);
      at = i;
    }
  });

  it('adds only missing packages, before hyperref, once', async () => {
    const f = new Files({ 'main.tex': MAIN });
    const doc = parseDocument('main.tex', f);
    const edits = await planInsert(doc, f, diagramOf('flow-if-else'), afterBlock(f, 'main.tex', 'First'), opts());
    const out = edits.get('main.tex')!;
    const pkgs = loadedPackages(out);
    expect(pkgs.filter((p) => p === 'graphicx').length).toBe(1);
    expect(pkgs.filter((p) => p === 'amsmath').length).toBe(1);
    expect(pkgs).toContain('tikz');
    expect(pkgs).toContain('xcolor');
    expect(pkgs.indexOf('tikz')).toBeLessThan(pkgs.indexOf('hyperref'));
    expect(pkgs[pkgs.length - 1]).toBe('hyperref');
  });

  it('puts colours, styles and libraries in one block at the end of the preamble', async () => {
    const f = new Files({ 'main.tex': MAIN });
    const doc = parseDocument('main.tex', f);
    const out = (await planInsert(doc, f, diagramOf('flow-if-else'), afterBlock(f, 'main.tex', 'First'), opts())).get('main.tex')!;
    const defs = out.indexOf('% ---- FlowTikZ: colours and styles');
    expect(defs).toBeGreaterThan(out.indexOf('\\usepackage{hyperref}'));
    expect(defs).toBeLessThan(out.indexOf('\\begin{document}'));
    const block = out.slice(defs, out.indexOf('% ---- FlowTikZ: end of colours'));
    expect(block).toContain('\\definecolor{');
    expect(block).toContain('\\tikzset{');
  });

  it('a second figure reuses the blocks: no duplicate packages, colours or styles', async () => {
    const f = new Files({ 'main.tex': MAIN });
    f.apply(await planInsert(parseDocument('main.tex', f), f, diagramOf('flow-if-else'), afterBlock(f, 'main.tex', 'First'), opts()));
    f.apply(await planInsert(parseDocument('main.tex', f), f, diagramOf('flow-while'), afterBlock(f, 'main.tex', 'Second'), opts({ id: 'fig2' })));
    const out = f.map['main.tex'];
    expect((out.match(/FlowTikZ: packages for drawn figures/g) ?? []).length).toBe(1);
    expect((out.match(/FlowTikZ: colours and styles/g) ?? []).length).toBe(1);
    const pk = loadedPackages(out);
    expect(new Set(pk).size).toBe(pk.length);
    const defs = out.slice(out.indexOf('% ---- FlowTikZ: colours'), out.indexOf('% ---- FlowTikZ: end of colours'));
    const colours = defs.match(/\\definecolor\{[^}]+\}/g) ?? [];
    expect(new Set(colours).size).toBe(colours.length);
    expect((defs.match(/fcnode\/\.style/g) ?? []).length).toBe(1);
    expect(parseDocument('main.tex', f).blocks.filter((b) => b.kind === 'flowtikz').map((b) => b.figureId)).toEqual(['fig1', 'fig2']);
  });

  it('follows a separate preamble file when that is where the packages live', async () => {
    const f = new Files({
      'main.tex': '\\documentclass{report}\n\\input{preamble}\n\\begin{document}\nText.\n\\end{document}\n',
      'preamble.tex': '\\usepackage{amsmath}\n\\usepackage{xcolor}\n\\usepackage{cleveref}\n',
    });
    const edits = await planInsert(parseDocument('main.tex', f), f, diagramOf('flow-linear'), afterBlock(f, 'main.tex', 'Text'), opts());
    const pre = edits.get('preamble.tex')!;
    expect(pre).toContain('\\usepackage{tikz}');
    expect(pre.indexOf('\\usepackage{tikz}')).toBeLessThan(pre.indexOf('\\usepackage{cleveref}'));
    expect(pre).not.toMatch(/\\usepackage\{xcolor\}[\s\S]*\\usepackage\{xcolor\}/);
    // Definitions still go just before \begin{document} in the main file.
    expect(edits.get('main.tex')).toMatch(/end of colours and styles ----\n\n\\begin\{document\}/);
  });

  it('adds packages right after \\documentclass when a document loads none', async () => {
    const f = new Files({ 'main.tex': '\\documentclass{article}\n\\begin{document}\nHi.\n\\end{document}\n' });
    const out = (await planInsert(parseDocument('main.tex', f), f, diagramOf('flow-linear'), afterBlock(f, 'main.tex', 'Hi'), opts())).get('main.tex')!;
    expect(out).toMatch(/^\\documentclass\{article\}\n% ---- FlowTikZ: packages/);
  });

  it('does not add what the document already has, under any name that provides it', async () => {
    const f = new Files({ 'main.tex': '\\documentclass{article}\n\\usepackage[dvipsnames]{xcolor}\n\\usepackage{pgfplots}\n\\usetikzlibrary{arrows.meta}\n\\begin{document}\nHi.\n\\end{document}\n' });
    const out = (await planInsert(parseDocument('main.tex', f), f, diagramOf('flow-if-else'), afterBlock(f, 'main.tex', 'Hi'), opts())).get('main.tex')!;
    const pk = packageUses(maskTex(out)).map((p) => p.name);
    expect(pk.filter((p) => p === 'xcolor').length).toBe(1);
    expect(pk).not.toContain('tikz'); // pgfplots loads it
    expect(pk).not.toContain('graphicx'); // so does that
    const defs = out.slice(out.indexOf('% ---- FlowTikZ: colours'));
    expect(defs).not.toMatch(/\\usetikzlibrary\{[^}]*arrows\.meta/);
  });

  it('science drawings bring their own packages (circuitikz, amsmath, mhchem)', async () => {
    const f = new Files({ 'main.tex': '\\documentclass{article}\n\\begin{document}\nHi.\n\\end{document}\n' });
    const out = (await planInsert(parseDocument('main.tex', f), f, diagramOf('phys-rc'), afterBlock(f, 'main.tex', 'Hi'), opts())).get('main.tex')!;
    expect(out).toContain('\\usepackage[american]{circuitikz}');
    const f2 = new Files({ 'main.tex': '\\documentclass{article}\n\\begin{document}\nHi.\n\\end{document}\n' });
    const chem = (await planInsert(parseDocument('main.tex', f2), f2, diagramOf('chem-haber'), afterBlock(f2, 'main.tex', 'Hi'), opts())).get('main.tex')!;
    expect(chem).toContain('\\usepackage[version=4]{mhchem}');
  });

  it('scales the picture to the text width only when wider, so margins and columns are kept', async () => {
    const code = figureCode(diagramOf('flow-binary-search'));
    expect(code.picture[0]).toBe('\\begin{tikzpicture}[x=1cm, y=1cm]');
    const f = new Files({ 'main.tex': MAIN });
    const out = (await planInsert(parseDocument('main.tex', f), f, diagramOf('flow-binary-search'), afterBlock(f, 'main.tex', 'First'), opts())).get('main.tex')!;
    expect(out).toContain('\\resizebox{\\ifdim\\width>\\linewidth\\linewidth\\else\\width\\fi}{!}{%');
    expect(out).not.toMatch(/\\geometry|\\setlength\{\\textwidth/);
  });

  it('"exactly here" uses a centred block with \\captionof (adding capt-of only when captioned)', async () => {
    const f = new Files({ 'main.tex': MAIN });
    const plain = (await planInsert(parseDocument('main.tex', f), f, diagramOf('flow-linear'), afterBlock(f, 'main.tex', 'First'), opts())).get('main.tex')!;
    expect(plain).toContain('\\begin{center}');
    expect(plain).not.toContain('capt-of');
    const cap = (await planInsert(parseDocument('main.tex', f), f, diagramOf('flow-linear'), afterBlock(f, 'main.tex', 'First'), opts({ caption: 'Steps & stages: 100%', label: 'fig:steps' }))).get('main.tex')!;
    expect(cap).toContain('\\usepackage{capt-of}');
    expect(cap).toContain('\\captionof{figure}{Steps \\& stages: 100\\%}\\label{fig:steps}');
    // A document with the caption package needs no capt-of.
    const f2 = new Files({ 'main.tex': MAIN.replace('\\usepackage{hyperref}', '\\usepackage{caption}\n\\usepackage{hyperref}') });
    const cap2 = (await planInsert(parseDocument('main.tex', f2), f2, diagramOf('flow-linear'), afterBlock(f2, 'main.tex', 'First'), opts({ caption: 'X' }))).get('main.tex')!;
    expect(cap2).not.toContain('capt-of');
  });

  it('"floating figure" copies the document\'s own placement and label style', async () => {
    const main = MAIN.replace('Second paragraph.', '\\begin{figure}[H]\n\\centering\nx\n\\caption{Old}\\label{figure:old}\n\\end{figure}\n\nSecond paragraph.');
    const f = new Files({ 'main.tex': main });
    const doc = parseDocument('main.tex', f);
    const style = documentStyle([main]);
    expect(style).toEqual({ floatSpec: 'H', labelPrefix: 'figure:', usesCentering: true });
    const out = (await planInsert(doc, f, diagramOf('flow-linear'), afterBlock(f, 'main.tex', 'First'), opts({ placement: 'float', caption: 'New', label: 'figure:new' }))).get('main.tex')!;
    expect(out).toContain('\\begin{figure}[H]\n  \\centering');
    expect(out).toContain('\\caption{New}\n  \\label{figure:new}');
  });

  it('keeps Windows line endings and the indentation of where it lands', async () => {
    const crlf = '\\documentclass{article}\r\n\\begin{document}\r\n\\begin{itemize}\r\n\\item x\r\n\\end{itemize}\r\n  Indented paragraph.\r\n\\end{document}\r\n';
    const f = new Files({ 'main.tex': crlf });
    const out = (await planInsert(parseDocument('main.tex', f), f, diagramOf('flow-linear'), afterBlock(f, 'main.tex', 'Indented'), opts())).get('main.tex')!;
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
    expect(out).toContain('\r\n  % ==== FlowTikZ figure fig1 (begin)');
  });

  it('inserts into the chapter file the clicked text came from', async () => {
    const f = new Files({
      'main.tex': '\\documentclass{report}\n\\usepackage{xcolor}\n\\begin{document}\n\\include{ch/one}\n\\end{document}\n',
      'ch/one.tex': '\\chapter{One}\nChapter text.\n',
    });
    const doc = parseDocument('main.tex', f);
    const b = doc.blocks.find((x) => x.text.startsWith('Chapter text'))!;
    const edits = await planInsert(doc, f, diagramOf('flow-linear'), { file: b.file, offset: b.end, after: true, indent: '' }, opts());
    expect(edits.get('ch/one.tex')).toContain('FlowTikZ figure fig1 (begin)');
    expect(edits.get('main.tex')).toContain('\\usepackage{tikz}');
    expect(edits.get('main.tex')).not.toContain('FlowTikZ figure fig1');
  });

  it('starts the figure on its own line even when the text shares a line with a heading', async () => {
    const f = new Files({ 'main.tex': '\\documentclass{article}\n\\begin{document}\n\\section{A}Text right after.\n\\end{document}\n' });
    const doc = parseDocument('main.tex', f);
    const b = doc.blocks.find((x) => x.kind === 'paragraph')!;
    for (const after of [false, true]) {
      const g = new Files({ ...f.map });
      const t = { file: b.file, offset: after ? b.end : b.start, after, indent: '' };
      g.apply(await planInsert(parseDocument('main.tex', g), g, diagramOf('flow-linear'), t, opts()));
      const again = parseDocument('main.tex', g);
      expect(again.blocks.filter((x) => x.kind === 'flowtikz').length, `after=${after}`).toBe(1);
      expect(again.blocks.find((x) => x.kind === 'heading')!.text).toBe('\\section{A}');
      expect(again.blocks.some((x) => x.kind === 'paragraph' && x.text === 'Text right after.')).toBe(true);
    }
  });

  it('can insert before the first block of the document', async () => {
    const f = new Files({ 'main.tex': MAIN });
    const doc = parseDocument('main.tex', f);
    const b = doc.blocks[0];
    const out = (await planInsert(doc, f, diagramOf('flow-linear'), { file: b.file, offset: b.start, after: false, indent: '' }, opts())).get('main.tex')!;
    expect(out).toMatch(/\\begin\{document\}\n% ==== FlowTikZ figure fig1 \(begin\)[\s\S]*\(end\) ====\n\n\\section\{Intro\}/);
  });
});

describe('editing and removing a drawn figure', () => {
  it('embeds the diagram so it can be read back exactly', async () => {
    const d = diagramOf('flow-if-else');
    const lines = await encodeDiagram(d);
    expect(lines.every((l) => l.startsWith('% flowtikz-data: ') && l.length <= 17 + 96)).toBe(true);
    const back = await decodeDiagram(lines.join('\n'));
    expect(back?.order).toEqual(d.order);
    expect(Object.values(back!.nodes).map((n) => n.text)).toEqual(Object.values(d.nodes).map((n) => n.text));
    expect(await decodeDiagram('% flowtikz-data: zNOTBASE64!!')).toBeNull();
    expect(await decodeDiagram('no data')).toBeNull();
  });

  it('replaces a figure in place, keeping its id and position', async () => {
    const f = new Files({ 'main.tex': MAIN });
    f.apply(await planInsert(parseDocument('main.tex', f), f, diagramOf('flow-if-else'), afterBlock(f, 'main.tex', 'First'), opts()));
    const doc = parseDocument('main.tex', f);
    const block = doc.blocks.find((b) => b.kind === 'flowtikz')!;
    const before = f.map['main.tex'];
    f.apply(await planReplace(doc, f, diagramOf('flow-linear'), block, opts({ caption: 'Now captioned' })));
    const after = f.map['main.tex'];
    expect((after.match(/FlowTikZ figure fig1 \(begin\)/g) ?? []).length).toBe(1);
    expect(after).toContain('Now captioned');
    // Same place in the text (the preamble above may have grown by a package).
    expect(after.indexOf('FlowTikZ figure fig1') - after.indexOf('First paragraph.')).toBe(before.indexOf('FlowTikZ figure fig1') - before.indexOf('First paragraph.'));
    expect(after.slice(after.indexOf('(end) ===='))).toBe(before.slice(before.indexOf('(end) ====')));
    const decoded = await decodeDiagram(parseDocument('main.tex', f).blocks.find((b) => b.kind === 'flowtikz')!.text);
    expect(Object.values(decoded!.nodes).some((n) => n.text === 'Read input')).toBe(true);
  });

  it('removing the only figure restores the original document byte for byte', async () => {
    for (const src of [MAIN, MAIN.replace(/\n/g, '\r\n'), '\\documentclass{article}\n\\begin{document}\nHi.\n\\end{document}\n']) {
      const f = new Files({ 'main.tex': src });
      f.apply(await planInsert(parseDocument('main.tex', f), f, diagramOf('phys-rc'), afterBlock(f, 'main.tex', src.includes('First') ? 'First' : 'Hi'), opts({ caption: 'C' })));
      expect(f.map['main.tex']).not.toBe(src);
      const doc = parseDocument('main.tex', f);
      f.apply(planRemove(doc, f, doc.blocks.find((b) => b.kind === 'flowtikz')!));
      expect(f.map['main.tex']).toBe(src);
    }
  });

  it('removing one of two figures keeps the shared preamble blocks', async () => {
    const f = new Files({ 'main.tex': MAIN });
    f.apply(await planInsert(parseDocument('main.tex', f), f, diagramOf('flow-if-else'), afterBlock(f, 'main.tex', 'First'), opts()));
    f.apply(await planInsert(parseDocument('main.tex', f), f, diagramOf('flow-while'), afterBlock(f, 'main.tex', 'Second'), opts({ id: 'fig2' })));
    const doc = parseDocument('main.tex', f);
    f.apply(planRemove(doc, f, doc.blocks.find((b) => b.figureId === 'fig1')!));
    expect(f.map['main.tex']).toContain('FlowTikZ: packages');
    expect(f.map['main.tex']).toContain('FlowTikZ figure fig2');
    expect(f.map['main.tex']).not.toContain('FlowTikZ figure fig1');
    expect(findFigure(f.map['main.tex'], 'fig2')).not.toBeNull();
  });
});

describe('helpers', () => {
  it('splits definitions into statements', () => {
    expect(splitStatements('\\definecolor{a}{HTML}{000000}\n\\tikzset{x/.style={\n  draw}}\n% c\n\n\\b')).toEqual([
      '\\definecolor{a}{HTML}{000000}',
      '\\tikzset{x/.style={\n  draw}}',
      '\\b',
    ]);
  });
  it('makes labels from captions', () => {
    expect(slugLabel('Login Process: Overview & Flow', 'x')).toBe('login-process-overview-flow');
    expect(slugLabel('!!!', 'fallback')).toBe('fallback');
  });
});
