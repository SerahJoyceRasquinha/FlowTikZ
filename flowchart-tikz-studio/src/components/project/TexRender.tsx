import { Fragment, memo, useEffect, useState, type ReactNode } from 'react';
import { renderTex } from '../../science/math/engine';
import { maskTex, readGroup, readOptional, expandMacros, type Macro } from '../../project/texScan';
import { findEnvEnd, joinPath } from '../../project/document';
import { fileBlob, type LatexProject } from '../../project/project';
import { toPoints } from '../../project/layout';

/**
 * A LaTeX-to-HTML renderer for the document preview.
 *
 * It aims at a faithful-looking reading copy, not a typesetter: sections,
 * paragraphs, emphasis, lists, tables, figures with the project's images,
 * citations and cross-references, and real mathematics (through the same
 * MathJax engine as the formula editor). What it cannot draw - someone's own
 * TikZ code, PDF images - is shown as a labelled placeholder of the right size.
 */

export interface RenderCtx {
  labels: Map<string, string>;
  citations: Map<string, number>;
  macros: Map<string, Macro>;
  project: LatexProject | null;
  mainDir: string;
  graphicsPaths: string[];
  /** Points to CSS pixels, including zoom. */
  px: number;
  textWidthPt: number;
  fontPt: number;
  /** Equation numbers to hand out, in order, for the block being drawn. */
  eqNumbers: string[];
  /** Float numbers for the block being drawn. */
  floatNumbers: string[];
  floatKind: 'figure' | 'table';
  footnotes: ReactNode[];
  footnoteStart: number;
}

let keySeq = 0;
const k = () => `r${++keySeq}`;

/* ================================================================ maths */

export const TexMath = memo(function TexMath({ tex, display, number }: { tex: string; display: boolean; number?: string }) {
  const r = renderTex(tex, display);
  if (!r) return <code className="tx-math-raw">{display ? `\\[${tex}\\]` : `$${tex}$`}</code>;
  if (!r.ok) {
    return (
      <code className="tx-math-raw tx-math-error" title={r.error}>
        {display ? `\\[${tex}\\]` : `$${tex}$`}
      </code>
    );
  }
  const [vx, vy, vw, vh] = r.viewBox;
  const depth = (vy + vh) / 1000;
  const svg = (
    <svg
      className="tx-math"
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      style={{ width: `${r.natural.w}em`, height: `${r.natural.h}em`, verticalAlign: display ? 'middle' : `${-depth}em` }}
      role="img"
      aria-label={tex}
      dangerouslySetInnerHTML={{ __html: r.markup }}
    />
  );
  if (!display) return svg;
  return (
    <div className="tx-display">
      <span className="tx-display-body">{svg}</span>
      {number && <span className="tx-eqno">({number})</span>}
    </div>
  );
});

/** Turn a math environment's body into something MathJax renders in one go. */
export function mathEnvToTex(env: string, body: string): { tex: string; numbered: boolean } {
  const base = env.replace(/\*$/, '');
  const numbered = !env.endsWith('*') && ['equation', 'align', 'gather', 'multline', 'flalign', 'eqnarray', 'alignat'].includes(base);
  let b = body.replace(/\\label\s*\{[^}]*\}/g, '').replace(/\\(?:nonumber|notag)\b/g, '').replace(/\\tag\*?\s*\{[^}]*\}/g, '');
  if (base === 'alignat') b = b.replace(/^\s*\{\d+\}/, '');
  switch (base) {
    case 'align':
    case 'flalign':
    case 'alignat':
      return { tex: `\\begin{aligned}${b}\\end{aligned}`, numbered };
    case 'eqnarray':
      return { tex: `\\begin{aligned}${b.replace(/&\s*([=<>]|\\[a-z]+)\s*&/g, '&$1 ')}\\end{aligned}`, numbered };
    case 'gather':
    case 'multline':
      return { tex: `\\begin{gathered}${b}\\end{gathered}`, numbered };
    default:
      return { tex: b.trim(), numbered };
  }
}

/* =============================================================== images */

const urlCache = new Map<string, Promise<string | null>>();

export function clearImageCache() {
  for (const p of urlCache.values()) void p.then((u) => u && URL.revokeObjectURL?.(u));
  urlCache.clear();
}

const IMG_EXTS = ['', '.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg', '.gif', '.webp', '.PNG', '.JPG', '.PDF'];

export function resolveImage(project: LatexProject | null, target: string, mainDir: string, graphicsPaths: string[]): string | null {
  if (!project) return null;
  const t = target.replace(/^["']|["']$/g, '').trim();
  const dirs = [mainDir, ...graphicsPaths.map((g) => joinPath(mainDir, g) ?? g)];
  for (const d of dirs) {
    for (const ext of IMG_EXTS) {
      const p = joinPath(d, t + ext);
      if (p && p in project.files) return p;
    }
  }
  return null;
}

function ProjectImage({ ctx, target, opts }: { ctx: RenderCtx; target: string; opts: string }) {
  const path = resolveImage(ctx.project, target, ctx.mainDir, ctx.graphicsPaths);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const renderable = !!path && /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(path);
  useEffect(() => {
    if (!renderable || !ctx.project || !path) return;
    let alive = true;
    const key = `${ctx.project.name}:${path}`;
    if (!urlCache.has(key)) {
      urlCache.set(
        key,
        fileBlob(ctx.project, path)
          .then((b) => (typeof URL.createObjectURL === 'function' ? URL.createObjectURL(b) : null))
          .catch(() => null),
      );
    }
    void urlCache.get(key)!.then((u) => {
      if (!alive) return;
      if (u) setUrl(u);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [renderable, path, ctx.project]);

  const style = imageStyle(opts, ctx);
  if (!path) {
    return (
      <span className="tx-img-missing" style={style} title={`Image not found in the project: ${target}`}>
        Image not found: {target}
      </span>
    );
  }
  if (!renderable || failed) {
    return (
      <span className="tx-img-placeholder" style={{ ...style, minHeight: 60 }} title={path}>
        <b>{path.split('/').pop()}</b>
        <span>{/\.pdf$/i.test(path) ? 'PDF image (shown in the compiled document)' : /\.e?ps$/i.test(path) ? 'EPS image (shown in the compiled document)' : 'Image could not be shown here'}</span>
      </span>
    );
  }
  return url ? <img className="tx-img" src={url} alt={path} style={style} /> : <span className="tx-img-loading" style={{ ...style, minHeight: 40 }} />;
}

function imageStyle(opts: string, ctx: RenderCtx): React.CSSProperties {
  const kv = new Map(opts.split(',').map((s) => s.split('=').map((x) => x.trim()) as [string, string]));
  const len = (v: string | undefined): number | null => {
    if (!v) return null;
    const rel = /^(\d*\.?\d+)?\s*\\(textwidth|linewidth|columnwidth|hsize)$/.exec(v);
    if (rel) return (rel[1] ? Number(rel[1]) : 1) * ctx.textWidthPt;
    if (/\\textheight/.test(v)) {
      const n = /^(\d*\.?\d+)/.exec(v);
      return (n ? Number(n[1]) : 1) * ctx.textWidthPt * 1.3;
    }
    return toPoints(v, ctx.fontPt);
  };
  const w = len(kv.get('width'));
  const h = len(kv.get('height'));
  const scale = Number(kv.get('scale'));
  const s: React.CSSProperties = { maxWidth: '100%' };
  if (w) s.width = Math.min(w, ctx.textWidthPt) * ctx.px;
  else if (h) s.height = h * ctx.px;
  else if (scale > 0) s.width = `${Math.min(100, scale * 60)}%`;
  else s.width = '60%';
  if (kv.get('angle')) s.transform = `rotate(${-Number(kv.get('angle'))}deg)`;
  return s;
}

/* ============================================================ text bits */

const SYMBOLS: Record<string, string> = {
  LaTeX: 'LaTeX', LaTeXe: 'LaTeX2ε', TeX: 'TeX', ldots: '…', dots: '…', textellipsis: '…', textbackslash: '\\', S: '§', P: '¶',
  copyright: '©', textcopyright: '©', textregistered: '®', texttrademark: '™', dag: '†', ddag: '‡', pounds: '£', euro: '€',
  textdegree: '°', degree: '°', ss: 'ß', ae: 'æ', AE: 'Æ', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ', aa: 'å', AA: 'Å',
  oe: 'œ', OE: 'Œ', textendash: '–', textemdash: '—', textquoteleft: '‘', textquoteright: '’', textquotedblleft: '“',
  textquotedblright: '”', textbullet: '•', textperiodcentered: '·', textasciitilde: '~', textasciicircum: '^', textbar: '|',
  textless: '<', textgreater: '>', textunderscore: '_', checkmark: '✓', quad: ' ', qquad: '  ', enspace: ' ',
  thinspace: ' ', textsection: '§', textparagraph: '¶', textdollar: '$', textpercent: '%', ampersand: '&', today: '',
};

const ACCENTS: Record<string, string> = {
  "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇',
  c: '̧', v: '̌', u: '̆', H: '̋', r: '̊', k: '̨', b: '̱', d: '̣',
};

/** Commands that print nothing but may take arguments. */
const SILENT: Record<string, number> = {
  label: 1, index: 1, glossary: 1, hypertarget: 1, nocite: 1, vspace: 1, 'vspace*': 1, hspace: 1, 'hspace*': 1, noindent: 0,
  indent: 0, centering: 0, raggedright: 0, raggedleft: 0, protect: 0, relax: 0, phantomsection: 0, addcontentsline: 3,
  setlength: 2, addtolength: 2, setcounter: 2, addtocounter: 2, stepcounter: 1, refstepcounter: 1, pagestyle: 1,
  thispagestyle: 1, markboth: 2, markright: 1, bigskip: 0, medskip: 0, smallskip: 0, vfill: 0, hfill: 0, null: 0,
  newpage: 0, clearpage: 0, pagebreak: 0, nopagebreak: 0, linebreak: 0, allowbreak: 0, sloppy: 0, fussy: 0,
  graphicspath: 1, captionsetup: 1, hypersetup: 1, newcommand: 2, renewcommand: 2, providecommand: 2, def: 0,
  DeclareMathOperator: 2, newtheorem: 2, theoremstyle: 1, bibliographystyle: 1, maketitle: 0, item: 0,
  rule: 2, strut: 0, FloatBarrier: 0, balance: 0, IEEEpeerreviewmaketitle: 0, onecolumn: 0, twocolumn: 0, selectlanguage: 1,
  usetikzlibrary: 1, tikzset: 1, definecolor: 3, color: 1, normalfont: 0, frenchspacing: 0, ignorespaces: 0, xspace: 0,
};

const SIZE_SWITCH: Record<string, string> = {
  tiny: '0.5em', scriptsize: '0.7em', footnotesize: '0.8em', small: '0.9em', normalsize: '1em', large: '1.2em',
  Large: '1.44em', LARGE: '1.73em', huge: '2.07em', Huge: '2.49em',
};

interface FontState {
  b?: boolean;
  i?: boolean;
  tt?: boolean;
  sc?: boolean;
  sf?: boolean;
  size?: string;
}

function styled(state: FontState, nodes: ReactNode[]): ReactNode[] {
  if (!state.b && !state.i && !state.tt && !state.sc && !state.sf && !state.size) return nodes;
  const style: React.CSSProperties = {};
  if (state.b) style.fontWeight = 700;
  if (state.i) style.fontStyle = 'italic';
  if (state.tt) style.fontFamily = 'var(--tx-mono)';
  if (state.sc) style.fontVariant = 'small-caps';
  if (state.sf) style.fontFamily = 'var(--tx-sans)';
  if (state.size) style.fontSize = state.size;
  return [
    <span key={k()} style={style}>
      {nodes}
    </span>,
  ];
}

/** Inline LaTeX to React. Display maths and nested environments become blocks. */
export function inline(src: string, ctx: RenderCtx, state: FontState = {}): ReactNode[] {
  const masked = maskTex(src);
  const out: ReactNode[] = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = '';
    }
  };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '%' && masked[i] === ' ') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '$') {
      const disp = src[i + 1] === '$';
      const open = disp ? 2 : 1;
      let j = i + open;
      while (j < n && !(src[j] === '$' && src[j - 1] !== '\\' && (!disp || src[j + 1] === '$'))) j++;
      flush();
      const tex = src.slice(i + open, j);
      out.push(<TexMath key={k()} tex={tex} display={disp} />);
      i = j + open;
      continue;
    }
    if (c === '\\') {
      const next = src[i + 1] ?? '';
      if (next === '(' || next === '[') {
        const close = next === '(' ? '\\)' : '\\]';
        const j = src.indexOf(close, i + 2);
        const e = j < 0 ? n : j;
        flush();
        out.push(<TexMath key={k()} tex={src.slice(i + 2, e)} display={next === '['} />);
        i = e + 2;
        continue;
      }
      if (next === '\\') {
        flush();
        out.push(<br key={k()} />);
        i += 2;
        const o = readOptional(src, i);
        if (o) i = o.end;
        continue;
      }
      if (!/[a-zA-Z@]/.test(next)) {
        // Control symbols.
        if (next in ACCENTS) {
          const g = readGroup(src, i + 2);
          const base = g ? g.content : src[i + 2] ?? '';
          buf += (base.replace(/^\\i$/, 'i').replace(/^\\j$/, 'j') + ACCENTS[next]).normalize('NFC');
          i = g ? g.end : i + 3;
          continue;
        }
        if (next === ',' || next === ';' || next === ':' || next === '!' || next === ' ') buf += next === '!' ? '' : ' ';
        else if (next === '/' || next === '-') buf += '';
        else buf += next;
        i += 2;
        continue;
      }
      let j = i + 1;
      while (j < n && /[a-zA-Z@]/.test(src[j])) j++;
      let name = src.slice(i + 1, j);
      if (src[j] === '*') {
        name += '*';
        j++;
      }
      const res = command(name, src, j, ctx, state);
      if (res) {
        if (res.text !== undefined) buf += res.text;
        else {
          flush();
          out.push(...(res.nodes ?? []));
        }
        if (res.rest) {
          // A font switch: everything after it, to the end of the group.
          flush();
          out.push(...styled(res.rest, inline(src.slice(res.end), ctx, { ...state, ...res.rest })));
          return styled(state, out);
        }
        i = res.end;
        // A control word with no argument swallows the spaces after it
        // ("\LaTeX is" prints "LaTeXis" in TeX too); after {...} they stay.
        if (res.end === j && !res.keepSpace) while (i < n && (src[i] === ' ' || src[i] === '\t')) i++;
        continue;
      }
      i = j;
      continue;
    }
    if (c === '{') {
      const g = readGroup(src, i);
      if (g) {
        flush();
        out.push(<Fragment key={k()}>{inline(g.content, ctx, state)}</Fragment>);
        i = g.end;
        continue;
      }
      i++;
      continue;
    }
    if (c === '}') {
      i++;
      continue;
    }
    if (c === '~') {
      buf += ' ';
      i++;
      continue;
    }
    if (c === '-' && src[i + 1] === '-') {
      if (src[i + 2] === '-') {
        buf += '—';
        i += 3;
      } else {
        buf += '–';
        i += 2;
      }
      continue;
    }
    if (c === '`') {
      if (src[i + 1] === '`') {
        buf += '“';
        i += 2;
      } else {
        buf += '‘';
        i++;
      }
      continue;
    }
    if (c === "'" && src[i + 1] === "'") {
      buf += '”';
      i += 2;
      continue;
    }
    if (c === "'") {
      buf += '’';
      i++;
      continue;
    }
    if (c === '\n' || c === '\r' || c === '\t') {
      if (!buf.endsWith(' ')) buf += ' ';
      i++;
      continue;
    }
    if (c === '&') {
      buf += ' ';
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return styled(state, out);
}

interface CmdResult {
  end: number;
  text?: string;
  nodes?: ReactNode[];
  /** Font switch to apply to the rest of the group. */
  rest?: FontState;
  keepSpace?: boolean;
}

function args(src: string, at: number, count: number): { list: string[]; end: number; opt?: string } {
  let j = at;
  let opt: string | undefined;
  const o = readOptional(src, j);
  if (o) {
    opt = o.content;
    j = o.end;
  }
  const list: string[] = [];
  for (let n = 0; n < count; n++) {
    const g = readGroup(src, j);
    if (!g) break;
    list.push(g.content);
    j = g.end;
  }
  return { list, end: j, opt };
}

function wrap(tag: string, content: ReactNode[], props: Record<string, unknown> = {}): ReactNode {
  const T = tag as keyof JSX.IntrinsicElements;
  return (
    <T key={k()} {...props}>
      {content}
    </T>
  );
}

function command(name: string, src: string, at: number, ctx: RenderCtx, state: FontState): CmdResult | null {
  const one = (f: (s: string) => ReactNode[]): CmdResult => {
    const a = args(src, at, 1);
    return { end: a.end, nodes: a.list.length ? f(a.list[0]) : [] };
  };
  switch (name) {
    case 'textbf':
      return one((s) => [wrap('strong', inline(s, ctx, state))]);
    case 'textit':
    case 'emph':
    case 'textsl':
      return one((s) => [wrap('em', inline(s, ctx, state))]);
    case 'texttt':
    case 'path':
      return one((s) => [wrap('code', inline(s, ctx, state), { className: 'tx-tt' })]);
    case 'underline':
    case 'uline':
      return one((s) => [wrap('u', inline(s, ctx, state))]);
    case 'textsc':
      return one((s) => [wrap('span', inline(s, ctx, state), { style: { fontVariant: 'small-caps' } })]);
    case 'textsf':
      return one((s) => [wrap('span', inline(s, ctx, state), { style: { fontFamily: 'var(--tx-sans)' } })]);
    case 'textrm':
    case 'textup':
    case 'textmd':
    case 'textnormal':
    case 'mbox':
    case 'hbox':
    case 'text':
    case 'makebox':
    case 'NoCaseChange':
      return one((s) => inline(s, ctx, state));
    case 'fbox':
    case 'framebox':
      return one((s) => [wrap('span', inline(s, ctx, state), { className: 'tx-fbox' })]);
    case 'textsuperscript':
      return one((s) => [wrap('sup', inline(s, ctx, state))]);
    case 'textsubscript':
      return one((s) => [wrap('sub', inline(s, ctx, state))]);
    case 'textcolor': {
      const a = args(src, at, 2);
      return { end: a.end, nodes: [wrap('span', inline(a.list[1] ?? '', ctx, state), { style: { color: cssColor(a.list[0] ?? '') } })] };
    }
    case 'colorbox': {
      const a = args(src, at, 2);
      return { end: a.end, nodes: [wrap('span', inline(a.list[1] ?? '', ctx, state), { style: { background: cssColor(a.list[0] ?? '') } })] };
    }
    case 'footnote':
    case 'footnotetext': {
      const a = args(src, at, 1);
      const n = ctx.footnoteStart + ctx.footnotes.length + 1;
      ctx.footnotes.push(
        <li key={k()} value={n}>
          {inline(a.list[0] ?? '', ctx)}
        </li>,
      );
      return { end: a.end, nodes: [wrap('sup', [String(n)], { className: 'tx-fn' })] };
    }
    case 'url':
    case 'nolinkurl': {
      const g = readGroup(src, at);
      return { end: g ? g.end : at, nodes: [wrap('code', [g?.content ?? ''], { className: 'tx-url' })] };
    }
    case 'href': {
      const a = args(src, at, 2);
      return { end: a.end, nodes: [wrap('span', inline(a.list[1] ?? '', ctx, state), { className: 'tx-link', title: a.list[0] })] };
    }
    case 'ref':
    case 'autoref':
    case 'cref':
    case 'Cref':
    case 'vref':
    case 'nameref':
    case 'pageref':
    case 'eqref':
    case 'ref*':
    case 'autoref*': {
      const g = readGroup(src, at);
      const keys = (g?.content ?? '').split(',').map((s) => s.trim());
      const nums = keys.map((x) => (name === 'pageref' ? '1' : (ctx.labels.get(x) ?? '??')));
      const prefix = name.startsWith('autoref') || name === 'cref' ? '' : name === 'Cref' ? '' : '';
      const t = name === 'eqref' ? `(${nums.join(', ')})` : prefix + nums.join(', ');
      return { end: g ? g.end : at, nodes: [wrap('span', [t], { className: nums.includes('??') ? 'tx-ref tx-ref-missing' : 'tx-ref' })] };
    }
    case 'cite':
    case 'citep':
    case 'citet':
    case 'parencite':
    case 'autocite':
    case 'textcite':
    case 'citealp':
    case 'footcite':
    case 'supercite':
    case 'cite*':
    case 'citep*':
    case 'citet*': {
      const a = args(src, at, 1);
      let end = a.end;
      const o2 = readOptional(src, end);
      if (o2) end = o2.end;
      const g = readGroup(src, end);
      const raw = g ? g.content : a.list[0] ?? '';
      if (g) end = g.end;
      const nums = raw.split(',').map((s) => s.trim()).filter(Boolean).map((x) => ctx.citations.get(x) ?? '?');
      return { end, nodes: [wrap('span', [`[${nums.join(', ')}${a.opt && !o2 ? `, ${a.opt}` : ''}]`], { className: 'tx-cite' })] };
    }
    case 'includegraphics':
    case 'includegraphics*': {
      const a = args(src, at, 1);
      return { end: a.end, nodes: [<ProjectImage key={k()} ctx={ctx} target={a.list[0] ?? ''} opts={a.opt ?? ''} />] };
    }
    case 'caption':
    case 'captionof': {
      let j = at;
      let kind = ctx.floatKind;
      if (name === 'captionof') {
        const g = readGroup(src, j);
        if (g) {
          kind = g.content.trim() === 'table' ? 'table' : 'figure';
          j = g.end;
        }
      }
      const a = args(src, j, 1);
      const num = ctx.floatNumbers.shift() ?? '';
      return {
        end: a.end,
        nodes: [
          <span key={k()} className="tx-caption">
            <b>
              {kind === 'table' ? 'Table' : 'Figure'} {num}:
            </b>{' '}
            {inline(a.list[0] ?? '', ctx)}
          </span>,
        ],
      };
    }
    case 'item': {
      const o = readOptional(src, at);
      return { end: o ? o.end : at, nodes: o ? [wrap('b', inline(o.content, ctx, state))] : [] };
    }
    case 'begin': {
      const g = readGroup(src, at);
      if (!g) return null;
      const env = g.content.trim();
      const masked = maskTex(src);
      const close = findEnvEnd(masked, env, g.end);
      const inner = src.slice(g.end, Math.max(g.end, close - `\\end{${env}}`.length));
      return { end: close, nodes: [<Fragment key={k()}>{environment(env, inner, ctx)}</Fragment>] };
    }
    case 'end':
      return { end: readGroup(src, at)?.end ?? at, nodes: [] };
    case 'par':
      return { end: at, nodes: [<span key={k()} className="tx-parbreak" />] };
    case 'newline':
      return { end: at, nodes: [<br key={k()} />] };
    case 'bfseries':
    case 'bf':
      return { end: at, nodes: [], rest: { b: true } };
    case 'itshape':
    case 'it':
    case 'em':
    case 'slshape':
    case 'sl':
      return { end: at, nodes: [], rest: { i: true } };
    case 'ttfamily':
    case 'tt':
      return { end: at, nodes: [], rest: { tt: true } };
    case 'scshape':
    case 'sc':
      return { end: at, nodes: [], rest: { sc: true } };
    case 'sffamily':
    case 'sf':
      return { end: at, nodes: [], rest: { sf: true } };
    case 'rmfamily':
    case 'upshape':
    case 'mdseries':
      return { end: at, nodes: [] };
    default:
      break;
  }
  if (name in SIZE_SWITCH) return { end: at, nodes: [], rest: { size: SIZE_SWITCH[name] } };
  if (name === 'today') return { end: at, text: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) };
  if (name in SYMBOLS) {
    // "\LaTeX{}" and "\LaTeX\ " keep the space after them.
    let end = at;
    if (src.startsWith('{}', end)) end += 2;
    return { end, text: SYMBOLS[name], keepSpace: src.startsWith('{}', at) };
  }
  if (name in SILENT) {
    const a = args(src, at, SILENT[name]);
    return { end: a.end, nodes: [] };
  }
  // Unknown command: keep the text of its last argument, drop the rest.
  const a = args(src, at, 3);
  if (!a.list.length) return { end: a.end, nodes: [] };
  return { end: a.end, nodes: inline(a.list[a.list.length - 1], ctx, state) };
}

const NAMED: Record<string, string> = {
  red: '#d00', blue: '#00c', green: '#080', black: '#000', white: '#fff', gray: '#808080', grey: '#808080', orange: '#f80',
  purple: '#808', brown: '#963', cyan: '#0cc', magenta: '#c0c', yellow: '#cc0', violet: '#80f', teal: '#088', olive: '#880',
  lime: '#8c0', pink: '#f9b', darkgray: '#404040', lightgray: '#c0c0c0',
};
function cssColor(c: string): string {
  const s = c.trim();
  const mix = /^(\w+)!(\d+)(?:!(\w+))?$/.exec(s);
  if (mix) return NAMED[mix[1]] ?? mix[1];
  return NAMED[s] ?? (/^[a-zA-Z]+$/.test(s) ? s : 'inherit');
}

/* ========================================================== environments */

/** Split at row breaks (`\\`) or cell separators (`&`) outside groups and nested environments. */
export function splitTop(src: string, mode: 'rows' | 'cells'): string[] {
  const masked = maskTex(src);
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === '\\') {
      if (masked.startsWith('\\begin{', i)) {
        const g = readGroup(masked, i + 6);
        if (g) {
          i = findEnvEnd(masked, g.content.trim(), g.end) - 1;
          continue;
        }
      }
      if (mode === 'rows' && masked[i + 1] === '\\' && depth === 0) {
        parts.push(src.slice(last, i));
        let j = i + 2;
        const o = readOptional(masked, j);
        if (o) j = o.end;
        last = j;
        i = j - 1;
        continue;
      }
      i++; // skip the escaped character (\&, \{, \\ inside groups...)
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (mode === 'cells' && c === '&' && depth === 0) {
      parts.push(src.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(src.slice(last));
  return parts;
}

/** List items: split at top-level \item. */
export function listItems(src: string): { label?: string; body: string }[] {
  const masked = maskTex(src);
  const marks: number[] = [];
  for (let i = 0; i < masked.length; i++) {
    if (masked.startsWith('\\begin{', i)) {
      const g = readGroup(masked, i + 6);
      if (g) {
        i = findEnvEnd(masked, g.content.trim(), g.end) - 1;
        continue;
      }
    }
    if (masked[i] === '{') {
      const g = readGroup(masked, i);
      if (g) {
        i = g.end - 1;
        continue;
      }
    }
    if (masked.startsWith('\\item', i) && !/[a-zA-Z]/.test(masked[i + 5] ?? '')) marks.push(i);
  }
  return marks.map((m, n) => {
    let j = m + 5;
    const o = readOptional(src, j);
    let label: string | undefined;
    if (o) {
      label = o.content;
      j = o.end;
    }
    return { label, body: src.slice(j, marks[n + 1] ?? src.length) };
  });
}

/** Rows and cells of a tabular body. */
export function tableRows(src: string): { cells: { text: string; span: number; align?: string }[]; ruleAbove: boolean }[] {
  const rows = splitTop(src, 'rows');
  const out: { cells: { text: string; span: number; align?: string }[]; ruleAbove: boolean }[] = [];
  let pendingRule = false;
  for (const raw of rows) {
    let r = raw;
    const rule = /\\(hline|toprule|midrule|bottomrule|cline\{[^}]*\}|cmidrule(\([^)]*\))?\{[^}]*\})/g;
    if (rule.test(r)) pendingRule = true;
    r = r.replace(rule, '');
    if (!r.trim()) continue;
    const cells = splitTop(r, 'cells').map((c) => {
      const mc = /^\s*\\multicolumn\s*\{(\d+)\}\s*\{([^}]*)\}\s*\{([\s\S]*)\}\s*$/.exec(c);
      if (mc) return { text: mc[3], span: Number(mc[1]), align: /c/.test(mc[2]) ? 'center' : /r/.test(mc[2]) ? 'right' : 'left' };
      return { text: c.trim(), span: 1 };
    });
    out.push({ cells, ruleAbove: pendingRule });
    pendingRule = false;
  }
  return out;
}

function columnAligns(spec: string): string[] {
  const out: string[] = [];
  const s = spec.replace(/@\{[^}]*\}|!\{[^}]*\}|>\{[^}]*\}|<\{[^}]*\}/g, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === 'l') out.push('left');
    else if (c === 'c') out.push('center');
    else if (c === 'r') out.push('right');
    else if (c === 'p' || c === 'm' || c === 'b' || c === 'X') {
      out.push('left');
      if (s[i + 1] === '{') {
        const g = readGroup(s, i + 1);
        if (g) i = g.end - 1;
      }
    } else if (c === '*') {
      const n = readGroup(s, i + 1);
      const what = n ? readGroup(s, n.end) : null;
      if (n && what) {
        for (let t = 0; t < Number(n.content); t++) out.push(...columnAligns(what.content));
        i = what.end - 1;
      }
    }
  }
  return out;
}

function Table({ body, spec, ctx }: { body: string; spec: string; ctx: RenderCtx }) {
  const aligns = columnAligns(spec);
  const rows = tableRows(body);
  return (
    <table className="tx-table">
      <tbody>
        {rows.map((r, ri) => {
          let col = 0;
          return (
            <tr key={ri} className={r.ruleAbove ? 'tx-rule' : undefined}>
              {r.cells.map((c, ci) => {
                const align = c.align ?? aligns[col] ?? 'left';
                col += c.span;
                return (
                  <td key={ci} colSpan={c.span > 1 ? c.span : undefined} style={{ textAlign: align as 'left' }}>
                    {inline(c.text, ctx)}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Paragraph flow inside an environment (lists, figures, minipages...). */
export function flow(src: string, ctx: RenderCtx): ReactNode[] {
  const paras = src.split(/\n[ \t\r]*\n/);
  return paras.filter((p) => p.trim()).map((p) => (
    <div key={k()} className="tx-par">
      {inline(p, ctx)}
    </div>
  ));
}

const MATH_ENV = /^(equation|align|gather|multline|flalign|eqnarray|displaymath|alignat|math)\*?$/;

export function environment(env: string, inner: string, ctx: RenderCtx): ReactNode {
  if (MATH_ENV.test(env)) {
    const { tex, numbered } = mathEnvToTex(env, inner);
    return <TexMath key={k()} tex={tex} display={env !== 'math'} number={numbered ? ctx.eqNumbers.shift() : undefined} />;
  }
  switch (env) {
    case 'itemize':
    case 'enumerate':
    case 'description':
    case 'compactitem':
    case 'compactenum':
    case 'inparaenum': {
      const items = listItems(inner);
      const Tag = env === 'enumerate' || env === 'compactenum' ? 'ol' : env === 'description' ? 'dl' : 'ul';
      if (Tag === 'dl') {
        return (
          <dl className="tx-dl">
            {items.map((it, n) => (
              <Fragment key={n}>
                <dt>{inline(it.label ?? '', ctx)}</dt>
                <dd>{flow(it.body, ctx)}</dd>
              </Fragment>
            ))}
          </dl>
        );
      }
      return (
        <Tag className="tx-list">
          {items.map((it, n) => (
            <li key={n} className={it.label !== undefined ? 'tx-li-label' : undefined} data-label={it.label}>
              {it.label !== undefined && <span className="tx-li-mark">{inline(it.label, ctx)}</span>}
              {flow(it.body, ctx)}
            </li>
          ))}
        </Tag>
      );
    }
    case 'tabular':
    case 'tabular*':
    case 'tabularx':
    case 'tabulary':
    case 'longtable':
    case 'array': {
      let rest = inner;
      if (env === 'tabular*' || env === 'tabularx' || env === 'tabulary') {
        const w = readGroup(rest, 0);
        if (w) rest = rest.slice(w.end);
      }
      const o = readOptional(rest, 0);
      if (o) rest = rest.slice(o.end);
      const spec = readGroup(rest, 0);
      const body = spec ? rest.slice(spec.end) : rest;
      return <Table key={k()} body={body} spec={spec?.content ?? ''} ctx={ctx} />;
    }
    case 'figure':
    case 'figure*':
    case 'table':
    case 'table*':
    case 'wrapfigure':
    case 'SCfigure':
    case 'subfigure':
    case 'minipage': {
      let rest = inner;
      const o = readOptional(rest, 0);
      if (o) rest = rest.slice(o.end);
      if (env === 'wrapfigure' || env === 'minipage' || env === 'subfigure') {
        const w = readGroup(rest, 0);
        if (w) rest = rest.slice(w.end);
      }
      const isTable = env.startsWith('table');
      const prevKind = ctx.floatKind;
      ctx.floatKind = isTable ? 'table' : 'figure';
      const content = flow(rest, ctx);
      ctx.floatKind = prevKind;
      return (
        <figure className={`tx-figure${/\\centering/.test(inner) ? ' centered' : ''}${env === 'minipage' || env === 'subfigure' ? ' tx-mini' : ''}`}>
          {content}
        </figure>
      );
    }
    case 'center':
      return <div className="tx-center">{flow(inner, ctx)}</div>;
    case 'flushright':
      return <div style={{ textAlign: 'right' }}>{flow(inner, ctx)}</div>;
    case 'flushleft':
      return <div style={{ textAlign: 'left' }}>{flow(inner, ctx)}</div>;
    case 'quote':
    case 'quotation':
    case 'verse':
      return <blockquote className="tx-quote">{flow(inner, ctx)}</blockquote>;
    case 'abstract':
      return (
        <div className="tx-abstract">
          <div className="tx-abstract-title">Abstract</div>
          {flow(inner, ctx)}
        </div>
      );
    case 'verbatim':
    case 'verbatim*':
    case 'Verbatim':
    case 'lstlisting':
    case 'minted':
    case 'alltt': {
      let body = inner;
      if (env === 'lstlisting') {
        const o = readOptional(body, 0);
        if (o) body = body.slice(o.end);
      }
      if (env === 'minted') {
        const o = readOptional(body, 0);
        if (o) body = body.slice(o.end);
        const lang = readGroup(body, 0);
        if (lang) body = body.slice(lang.end);
      }
      return <pre className="tx-pre">{body.replace(/^\r?\n/, '')}</pre>;
    }
    case 'tikzpicture':
    case 'circuitikz':
    case 'pgfpicture':
    case 'forest':
    case 'axis':
      return (
        <div className="tx-tikz" title="TikZ code from the document; it is drawn when the document is compiled">
          <b>TikZ picture</b>
          <span>drawn when the document is compiled ({inner.split('\n').length} lines)</span>
        </div>
      );
    case 'thebibliography': {
      const items = listItems(inner.replace(/^\s*\{[^}]*\}/, ''));
      return (
        <div className="tx-bib">
          <div className="tx-h tx-h2 tx-bib-title">References</div>
          <ol>
            {items.map((it, n) => (
              <li key={n}>{inline(it.body.replace(/^\s*\{[^}]*\}/, ''), ctx)}</li>
            ))}
          </ol>
        </div>
      );
    }
    case 'frame': {
      // Beamer slide.
      let body = inner;
      const o = readOptional(body, 0);
      if (o) body = body.slice(o.end);
      const t = readGroup(body, 0);
      let title = '';
      if (t && !/^\s*\n/.test(body)) {
        title = t.content;
        body = body.slice(t.end);
      }
      const ft = /\\frametitle\s*\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(body);
      if (ft) {
        title = ft[1];
        body = body.replace(ft[0], '');
      }
      return (
        <div className="tx-slide">
          {title && <div className="tx-slide-title">{inline(title, ctx)}</div>}
          {flow(body, ctx)}
        </div>
      );
    }
    case 'theorem':
    case 'lemma':
    case 'proposition':
    case 'corollary':
    case 'definition':
    case 'remark':
    case 'example':
    case 'proof': {
      const o = readOptional(inner, 0);
      const body = o ? inner.slice(o.end) : inner;
      const name = env[0].toUpperCase() + env.slice(1);
      return (
        <div className={`tx-thm${env === 'proof' ? ' tx-proof' : ''}`}>
          <b>{name}{o ? ` (${o.content})` : ''}.</b> {flow(body, ctx)}
          {env === 'proof' && <span className="tx-qed">∎</span>}
        </div>
      );
    }
    case 'comment':
    case 'filecontents':
    case 'filecontents*':
      return null;
    default:
      return <div className={`tx-env tx-env-${env.replace(/[^a-z]/gi, '')}`}>{flow(inner, ctx)}</div>;
  }
}

export function expand(src: string, ctx: RenderCtx): string {
  return expandMacros(src, ctx.macros);
}
