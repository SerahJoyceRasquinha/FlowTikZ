import { describe, expect, it } from 'vitest';
import {
  detectMain,
  escaped,
  expandMacros,
  inclusions,
  macros,
  maskTex,
  newlineOf,
  outline,
  packageUses,
  readGroup,
  readOptional,
  tikzLibraries,
} from '../project/texScan';
import { findEnvEnd, parseDocument, resolveTex, joinPath, type FileAccess } from '../project/document';
import { numberDocument, pageGeometry, parseBib, toPoints } from '../project/layout';

export function filesOf(map: Record<string, string>): FileAccess {
  return { text: (p) => map[p], exists: (p) => p in map };
}

describe('scanning LaTeX source', () => {
  it('masks comments but keeps escaped percent signs and offsets', () => {
    const src = 'a % comment \\section{x}\nb \\% kept % gone\n\\\\% after linebreak';
    const m = maskTex(src);
    expect(m.length).toBe(src.length);
    expect(m).not.toContain('comment');
    expect(m).toContain('\\%');
    expect(m).not.toContain('gone');
    expect(m).not.toContain('after linebreak');
    expect(m.indexOf('b')).toBe(src.indexOf('b'));
  });

  it('masks verbatim, listings and \\verb so their contents are not structure', () => {
    const src = 'x \\begin{verbatim}\n\\section{fake}\n\\end{verbatim} \\verb|\\begin{document}| \\begin{lstlisting}[a]\n\\end{figure}\n\\end{lstlisting}';
    const m = maskTex(src);
    expect(m).not.toContain('fake');
    expect(m).not.toContain('\\begin{document}');
    expect(m).not.toContain('\\end{figure}');
    expect(m).toContain('\\end{verbatim}');
  });

  it('knows escaped characters', () => {
    expect(escaped('\\%', 1)).toBe(true);
    expect(escaped('\\\\%', 2)).toBe(false);
  });

  it('reads balanced groups and optional arguments', () => {
    expect(readGroup('{a{b}c}d', 0)?.content).toBe('a{b}c');
    expect(readGroup('  {x}', 0)?.content).toBe('x');
    expect(readGroup('{\\}}x}', 0)?.content).toBe('\\}');
    expect(readGroup('{never', 0)).toBeNull();
    expect(readOptional('[a={x]y}]z', 0)?.content).toBe('a={x]y}');
    expect(readOptional('{x}', 0)).toBeNull();
  });

  it('outlines a document: class, options, body', () => {
    const t = '% \\documentclass{fake}\n\\documentclass[11pt, twocolumn]{article}\n\\begin{document}\nHi\n\\end{document}\n';
    const o = outline(t);
    expect(o.className).toBe('article');
    expect(o.classOptions).toEqual(['11pt', 'twocolumn']);
    expect(t.slice(o.bodyStart, o.endAt).trim()).toBe('Hi');
  });

  it('lists packages with options, including comma lists and RequirePackage', () => {
    const t = '\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath,amssymb}\n% \\usepackage{tikz}\n\\RequirePackage{xcolor}[2020/01/01]';
    const uses = packageUses(maskTex(t));
    expect(uses.map((u) => u.name)).toEqual(['inputenc', 'amsmath', 'amssymb', 'xcolor']);
    expect(uses[0].options).toEqual(['utf8']);
  });

  it('collects TikZ libraries and inclusions', () => {
    const t = '\\usetikzlibrary{arrows.meta, positioning}\\usepgflibrary{shapes}\n\\input{a}\\include{ch/b}\\subfile{c}\\import{dir/}{d}\\input e.tex';
    const m = maskTex(t);
    expect([...tikzLibraries(m)].sort()).toEqual(['arrows.meta', 'positioning', 'shapes']);
    expect(inclusions(m).map((i) => `${i.command}:${i.dir ?? ''}${i.target}`)).toEqual(['input:a', 'include:ch/b', 'subfile:c', 'import:dir/d', 'input:e.tex']);
  });

  it('reads macros and expands them, with arguments and defaults', () => {
    const t = '\\newcommand{\\R}{\\mathbb{R}}\\newcommand\\norm[1]{\\lVert #1\\rVert}\\newcommand{\\pair}[2][x]{(#1,#2)}\\def\\half{\\frac12}\\DeclareMathOperator{\\argmax}{arg\\,max}';
    const defs = new Map(macros(maskTex(t)).map((m) => [m.name, m]));
    expect([...defs.keys()].sort()).toEqual(['R', 'argmax', 'half', 'norm', 'pair']);
    expect(expandMacros('x\\in\\R, \\norm{v}, \\pair{y}, \\pair[a]{b}, \\half, \\argmax', defs)).toBe(
      'x\\in\\mathbb{R}, \\lVert v\\rVert, (x,y), (a,b), \\frac12, \\operatorname{arg\\,max}',
    );
    // A self-referencing macro cannot loop forever.
    const loop = new Map([['a', { name: 'a', args: 0, body: '\\a\\a' }]]);
    expect(expandMacros('\\a', loop).length).toBeGreaterThan(0);
  });

  it('matches nested environments', () => {
    const m = '\\begin{a}\\begin{a}x\\end{a}y\\end{a}z';
    expect(m.slice(0, findEnvEnd(m, 'a', 9))).toBe('\\begin{a}\\begin{a}x\\end{a}y\\end{a}');
  });

  it('detects Windows line endings', () => {
    expect(newlineOf('a\r\nb')).toBe('\r\n');
    expect(newlineOf('a\nb')).toBe('\n');
  });

  it('resolves paths like TeX', () => {
    const files = filesOf({ 'p/sec/a.tex': '', 'p/b.tex': '' });
    expect(joinPath('p', '../x')).toBe('x');
    expect(joinPath('', '../x')).toBeNull();
    expect(resolveTex('sec/a', 'p', files)).toBe('p/sec/a.tex');
    expect(resolveTex('b.tex', 'p', files)).toBe('p/b.tex');
    expect(resolveTex('nope', 'p', files)).toBeNull();
  });
});

describe('finding the main file', () => {
  const doc = (cls = 'article', body = 'x') => `\\documentclass{${cls}}\n\\begin{document}\n${body}\n\\end{document}\n`;
  it('prefers main.tex, shallow paths and files that include others', () => {
    const d = detectMain([
      { path: 'other.tex', text: doc() },
      { path: 'main.tex', text: doc() },
      { path: 'deep/x/main.tex', text: doc() },
    ]);
    expect(d.candidates[0].path).toBe('main.tex');
    expect(d.ambiguous).toBe(false);
  });

  it('skips subfiles, standalone pictures win last, commented classes do not count', () => {
    const d = detectMain([
      { path: 'thesis.tex', text: doc('report', '\\subfile{ch}') },
      { path: 'ch.tex', text: '\\documentclass[thesis.tex]{subfiles}\n\\begin{document}\nx\n\\end{document}' },
      { path: 'fig.tex', text: doc('standalone') },
      { path: 'note.tex', text: '% \\documentclass{article}\n\\begin{document}\\end{document}' },
    ]);
    expect(d.candidates.map((c) => c.path)).toEqual(['thesis.tex', 'fig.tex']);
    expect(d.rejected.some((r) => r.path === 'ch.tex' && /subfile/.test(r.reason))).toBe(true);
    expect(d.ambiguous).toBe(false);
  });

  it('rejects a class without \\begin{document}, and flags a close call as ambiguous', () => {
    const d = detectMain([
      { path: 'paper.tex', text: doc() },
      { path: 'slides.tex', text: doc('beamer') },
      { path: 'broken.tex', text: '\\documentclass{article}\n' },
    ]);
    expect(d.rejected).toEqual([{ path: 'broken.tex', reason: 'has \\documentclass but no \\begin{document}' }]);
    expect(d.ambiguous).toBe(true);
    expect(d.candidates.length).toBe(2);
  });

  it('finds nothing in chapter-only projects', () => {
    expect(detectMain([{ path: 'a.tex', text: '\\chapter{A}' }]).candidates).toEqual([]);
  });
});

describe('the document as blocks', () => {
  const main = [
    '\\documentclass{article}',
    '\\usepackage{amsmath}',
    '\\title{T}\\author{A}',
    '\\begin{document}',
    '\\maketitle',
    '\\section{Intro}\\label{sec:i}',
    'First paragraph',
    'continues here with $x$ and',
    '\\begin{equation} a=b \\label{eq:1} \\end{equation}',
    'still the same paragraph.',
    '',
    '% \\section{commented}',
    'Second paragraph.',
    '\\label{lonely}',
    '',
    '\\begin{figure}[h]\\caption{Cap}\\label{fig:a}\\end{figure}',
    '\\input{ch/two}',
    '\\input{missing}',
    '\\newpage',
    '\\end{document}',
  ].join('\n');
  const files = filesOf({ 'main.tex': main, 'ch/two.tex': '\\subsection{Two}\nText in two.\n\n\\begin{itemize}\\item a\\end{itemize}\n' });
  const d = parseDocument('main.tex', files);

  it('splits headings, paragraphs (math included), environments and commands, with exact source ranges', () => {
    expect(d.blocks.map((b) => `${b.kind}${b.name ? `:${b.name}` : ''}`)).toEqual([
      'command:maketitle', 'heading:section', 'paragraph', 'paragraph', 'env:figure', 'heading:subsection', 'paragraph', 'env:itemize', 'missing:missing', 'command:newpage',
    ]);
    for (const b of d.blocks) expect(files.text(b.file)!.slice(b.start, b.end)).toBe(b.text);
    const para = d.blocks[2];
    expect(para.text.startsWith('First paragraph')).toBe(true);
    expect(para.text.endsWith('still the same paragraph.')).toBe(true);
    expect(d.blocks[1].labels).toEqual(['sec:i']);
    expect(d.blocks[1].text).toBe('\\section{Intro}\\label{sec:i}');
  });

  it('follows \\input into other files and notes missing ones', () => {
    expect(d.blocks[5].file).toBe('ch/two.tex');
    expect(d.bodyFiles).toEqual(['main.tex', 'ch/two.tex']);
    expect(d.missing).toEqual(['missing']);
  });

  it('reads the preamble: packages, title, author', () => {
    expect([...d.preamble.packageNames]).toEqual(['amsmath']);
    expect(d.preamble.title).toBe('T');
    expect(d.preamble.author).toBe('A');
  });

  it('stops include cycles and runaway nesting', () => {
    const loop = filesOf({
      'main.tex': '\\documentclass{article}\\begin{document}\n\\input{a}\n\\end{document}',
      'a.tex': 'A text.\n\n\\input{b}\n',
      'b.tex': 'B text.\n\n\\input{a}\n',
    });
    const dd = parseDocument('main.tex', loop);
    expect(dd.blocks.filter((b) => b.kind === 'paragraph').map((b) => b.text)).toEqual(['A text.', 'B text.']);
  });

  it('handles an empty body and a body-less file', () => {
    expect(parseDocument('m.tex', filesOf({ 'm.tex': '\\documentclass{article}\\begin{document}\\end{document}' })).blocks).toEqual([]);
    expect(parseDocument('m.tex', filesOf({ 'm.tex': 'no document here' })).blocks).toEqual([]);
  });

  it('numbers sections, figures, equations and resolves labels and citations', () => {
    const geo = pageGeometry(d, main);
    const n = numberDocument(d, geo);
    expect(n.labels.get('sec:i')).toBe('1');
    expect(n.labels.get('eq:1')).toBe('1');
    expect(n.labels.get('fig:a')).toBe('1');
    expect(n.headings.get(d.blocks[5].key)).toBe('1.1');
  });
});

describe('page geometry', () => {
  const geo = (main: string, extra: Record<string, string> = {}) => {
    const f = filesOf({ 'main.tex': main, ...extra });
    return pageGeometry(parseDocument('main.tex', f), main);
  };
  it('uses the standard class text widths per font size', () => {
    expect(geo('\\documentclass{article}\\begin{document}x\\end{document}').textWidth).toBe(345);
    expect(geo('\\documentclass[12pt]{article}\\begin{document}x\\end{document}').textWidth).toBe(390);
    expect(geo('\\documentclass[twocolumn]{article}\\begin{document}x\\end{document}').columns).toBe(2);
  });
  it('reads geometry margins, paper and textwidth', () => {
    const g = geo('\\documentclass[a4paper]{article}\\usepackage[margin=2.5cm]{geometry}\\begin{document}x\\end{document}');
    expect(Math.round(g.left)).toBe(71);
    expect(Math.round(g.textWidth)).toBe(Math.round(597.508 - 2 * 71.13));
    const g2 = geo('\\documentclass{article}\\usepackage{geometry}\\geometry{left=1in,right=2in}\\begin{document}x\\end{document}');
    expect(Math.round(g2.textWidth)).toBe(Math.round(614.295 - 3 * 72.27));
  });
  it('knows a few journal classes and units', () => {
    expect(geo('\\documentclass{IEEEtran}\\begin{document}x\\end{document}').columns).toBe(2);
    expect(toPoints('1in')).toBeCloseTo(72.27);
    expect(toPoints('2.54cm')).toBeCloseTo(72.27);
    expect(toPoints('3em', 10)).toBe(30);
    expect(toPoints('wide')).toBeNull();
  });
});

describe('bibliography', () => {
  it('reads common .bib forms', () => {
    const bib = parseBib('@book{k1, author = {A and B}, title = {The {\\TeX}book}, year = 1984}\n@comment{x}\n@article{k2,\n title="Quoted",\n journal={J}}');
    expect(bib.get('k1')?.fields).toMatchObject({ author: 'A and B', title: 'The \\TeXbook', year: '1984' });
    expect(bib.get('k2')?.fields.title).toBe('Quoted');
    expect(bib.has('x')).toBe(false);
  });
});
