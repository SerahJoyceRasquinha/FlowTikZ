import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useProject, type Caret } from '../../state/projectStore';
import { useEditor } from '../../state/store';
import { useEngineVersion } from '../../science/math/engine';
import type { Block, ProjectDocument } from '../../project/document';
import { joinPath } from '../../project/document';
import { numberDocument, pageGeometry, parseBib, type Numbering, type PageGeometry } from '../../project/layout';
import { decodeDiagram } from '../../project/figure';
import type { Diagram } from '../../model/types';
import { maskTex, readGroup } from '../../project/texScan';
import { environment, expand, flow, inline, type RenderCtx } from './TexRender';
import { DiagramPicture } from './DiagramPicture';
import { DrawingFrame } from './DrawingFrame';
import { Icon } from '../Icon';

/**
 * The imported document, drawn as a page, in place of the drawing board.
 * Click anywhere to choose where a drawing goes; the drawing board then opens
 * right there, inside the page, and everything below it moves down.
 */

const PT = 96 / 72.27; // CSS pixels per TeX point at 100%

function useWidth(ref: React.RefObject<HTMLElement>): number {
  const [w, setW] = useState(900);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) setW(r.width);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [ref]);
  return w;
}

const VIRTUAL_FROM = 400;

function useMemoAfterHeading(visible: Block[]): boolean[] {
  return useMemo(() => {
    const out: boolean[] = [];
    let after = false;
    for (const b of visible) {
      out.push(after);
      after = b.kind === 'heading' || (after && b.kind === 'command');
    }
    return out;
  }, [visible]);
}

/**
 * Windowed list of rows with measured heights: rows near the viewport are
 * rendered, the rest are spacers sized from measurements (or estimates until
 * a row has been seen). Keeps documents with tens of thousands of blocks
 * responsive.
 */
function VirtualRows({
  count,
  rowKey,
  estimate,
  render,
  scrollRef,
  activeRow,
  resetKey,
}: {
  count: number;
  rowKey: (n: number) => string;
  estimate: (n: number) => number;
  render: (n: number) => ReactNode;
  scrollRef: React.RefObject<HTMLDivElement>;
  activeRow: number;
  resetKey: string;
}) {
  const heights = useRef(new Map<string, number>());
  const hostRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<[number, number]>([0, Math.min(count, 60)]);
  const [measureTick, setMeasureTick] = useState(0);
  useEffect(() => {
    heights.current.clear();
  }, [resetKey]);

  const offsets = useMemo(() => {
    const o = new Float64Array(count + 1);
    for (let n = 0; n < count; n++) o[n + 1] = o[n] + (heights.current.get(rowKey(n)) ?? estimate(n));
    return o;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, measureTick, resetKey, rowKey]);

  const update = useCallback(() => {
    const sc = scrollRef.current;
    const host = hostRef.current;
    if (!sc || !host) return;
    const top = sc.scrollTop - (host.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop);
    const viewH = sc.clientHeight || 800;
    const from = Math.max(0, top - 1200);
    const to = top + viewH + 1600;
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] < from) lo = mid + 1;
      else hi = mid;
    }
    let end = lo;
    while (end < count && offsets[end] < to) end++;
    let start = lo;
    if (activeRow >= 0) {
      start = Math.min(start, activeRow);
      end = Math.max(end, activeRow + 1);
    }
    setRange((r) => (r[0] === start && r[1] === end ? r : [start, end]));
  }, [count, offsets, scrollRef, activeRow]);

  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    let frameId = 0;
    const onScroll = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(update);
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      sc.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frameId);
    };
  }, [update, scrollRef]);

  // Bring a drawing opened off-screen (for example at the end) into view.
  useEffect(() => {
    if (activeRow < 0) return;
    const sc = scrollRef.current;
    const host = hostRef.current;
    if (!sc || !host) return;
    const hostTop = host.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    const y = hostTop + offsets[activeRow];
    if (y < sc.scrollTop || y > sc.scrollTop + sc.clientHeight - 80) sc.scrollTop = Math.max(0, y - 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRow]);

  // Measure what was rendered; images and maths may change size later.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let changed = false;
    host.querySelectorAll<HTMLElement>('[data-vrow]').forEach((el) => {
      const k = el.dataset.vrow!;
      const h = el.offsetHeight;
      if (h > 0 && Math.abs((heights.current.get(k) ?? -1) - h) > 1) {
        heights.current.set(k, h);
        changed = true;
      }
    });
    if (changed) setMeasureTick((t) => t + 1);
  });
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setMeasureTick((t) => t + 1));
    host.querySelectorAll('[data-vrow]').forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [range]);

  const [start, end] = [Math.min(range[0], count), Math.min(range[1], count)];
  const rows: ReactNode[] = [];
  for (let n = start; n < end; n++) {
    rows.push(
      <div key={rowKey(n)} data-vrow={rowKey(n)}>
        {render(n)}
      </div>,
    );
  }
  return (
    <div ref={hostRef} className="tx-virtual" data-rows={count} data-rendered={end - start}>
      <div style={{ height: offsets[start] }} aria-hidden="true" />
      {rows}
      <div style={{ height: offsets[count] - offsets[end] }} aria-hidden="true" />
    </div>
  );
}

function estimateHeight(b: Block, geo: PageGeometry, px: number): number {
  const line = geo.fontPt * 1.25 * px;
  const perLine = Math.max(20, (geo.textWidth / geo.columns / (geo.fontPt * 0.5)) | 0);
  if (b.kind === 'heading') return line * 2.4;
  if (b.kind === 'env' && /figure|table/.test(b.name ?? '')) return line * 12;
  return Math.max(line, Math.ceil(b.text.length / perLine) * line);
}

function FlowTikZFigure({ block, ctx, geo, px, numbers }: { block: Block; ctx: RenderCtx; geo: PageGeometry; px: number; numbers: string[] }) {
  const [diagram, setDiagram] = useState<Diagram | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void decodeDiagram(block.text).then((d) => alive && setDiagram(d));
    return () => {
      alive = false;
    };
  }, [block.text]);
  const caption = /\\caption(?:of\{figure\})?\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(block.text)?.[1];
  const colW = (geo.textWidth - (geo.columns - 1) * geo.columnSep) / geo.columns;
  return (
    <figure className="tx-figure centered tx-flowtikz">
      {diagram === undefined ? (
        <div className="tx-img-loading" style={{ height: 80 }} />
      ) : diagram ? (
        <DiagramPicture diagram={diagram} pxPerCm={(72.27 / 2.54) * px} maxWidthPx={colW * px} />
      ) : (
        <div className="tx-tikz">
          <b>FlowTikZ figure</b>
          <span>its drawing data is missing, so it cannot be shown or edited here</span>
        </div>
      )}
      {caption !== undefined && (
        <span className="tx-caption">
          <b>Figure {numbers[0] ?? ''}:</b> {inline(caption, ctx)}
        </span>
      )}
    </figure>
  );
}

function Bibliography({ doc, ctx, keys }: { doc: ProjectDocument; ctx: RenderCtx; keys: string[] }) {
  const project = ctx.project;
  const entries = useMemo(() => {
    const all = new Map<string, ReturnType<typeof parseBib> extends Map<string, infer V> ? V : never>();
    if (!project) return all;
    const files = keys.flatMap((k) => k.split(',')).map((s) => s.trim()).filter(Boolean);
    for (const f of files) {
      const p = joinPath(doc.mainDir, f.endsWith('.bib') ? f : `${f}.bib`);
      const t = p ? project.files[p]?.text : undefined;
      if (t) for (const [k, v] of parseBib(t)) all.set(k, v);
    }
    return all;
  }, [project, keys, doc.mainDir]);
  const cited = [...ctx.citations.entries()].sort((a, b) => a[1] - b[1]);
  return (
    <div className="tx-bib">
      <div className="tx-h tx-h2 tx-bib-title">References</div>
      <ol>
        {cited.map(([key, n]) => {
          const e = entries.get(key);
          return (
            <li key={key} value={n}>
              {e ? (
                <>
                  {e.fields.author ? `${e.fields.author.replace(/\s+and\s+/g, ', ')}. ` : ''}
                  <i>{e.fields.title ?? key}</i>
                  {e.fields.journal || e.fields.booktitle || e.fields.publisher ? `. ${e.fields.journal ?? e.fields.booktitle ?? e.fields.publisher}` : ''}
                  {e.fields.year ? `, ${e.fields.year}` : ''}.
                </>
              ) : (
                <span className="tx-ref-missing">{key}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const RenderedBlock = memo(function RenderedBlock({
  block,
  doc,
  ctxBase,
  numbering,
  geo,
  px,
  afterHeading,
}: {
  block: Block;
  doc: ProjectDocument;
  ctxBase: Omit<RenderCtx, 'eqNumbers' | 'floatNumbers' | 'footnotes' | 'floatKind' | 'footnoteStart'>;
  numbering: Numbering;
  geo: PageGeometry;
  px: number;
  afterHeading: boolean;
  version: number;
}) {
  const ctx: RenderCtx = {
    ...ctxBase,
    eqNumbers: [...(numbering.equations.get(block.key) ?? [])],
    floatNumbers: [...(numbering.floats.get(block.key)?.numbers ?? [])],
    floatKind: numbering.floats.get(block.key)?.kind ?? 'figure',
    footnotes: [],
    footnoteStart: 0,
  };
  let body: ReactNode = null;
  const src = expand(block.text, ctx);
  switch (block.kind) {
    case 'heading': {
      const num = numbering.headings.get(block.key);
      const lvl = Math.min(6, (block.level ?? 2) + 1);
      const isChapter = block.level === 1;
      body = (
        <div className={`tx-h tx-h${lvl}${isChapter ? ' tx-chapter' : ''}`} role="heading" aria-level={lvl}>
          {isChapter && num && <div className="tx-chapter-label">Chapter {num}</div>}
          {num && !isChapter && (
            <>
              <span className="tx-hnum">{num}</span>{' '}
            </>
          )}
          {inline(expand(block.title ?? '', ctx), ctx)}
        </div>
      );
      break;
    }
    case 'paragraph':
      body = <div className={`tx-p${afterHeading ? ' tx-noindent' : ''}`}>{inline(src, ctx)}</div>;
      break;
    case 'env': {
      const masked = maskTex(src);
      const open = /^\\begin\s*\{[^}]*\}/.exec(masked);
      const close = `\\end{${block.name}}`;
      const inner = src.slice(open ? open[0].length : 0, src.length - (masked.endsWith(close) ? close.length : 0));
      body = environment(block.name ?? '', inner, ctx);
      break;
    }
    case 'flowtikz':
      body = <FlowTikZFigure block={block} ctx={ctx} geo={geo} px={px} numbers={ctx.floatNumbers} />;
      break;
    case 'missing':
      body = (
        <div className="tx-missing" role="note">
          <Icon name="file" size={14} /> File not found in the project: <code>{block.name}</code>
        </div>
      );
      break;
    case 'command':
      switch (block.name) {
        case 'maketitle': {
          const pre = doc.preamble;
          body = (
            <div className="tx-title">
              <div className="tx-title-main">{inline(expand(pre.title, ctx), ctx)}</div>
              {pre.author && (
                <div className="tx-title-author">
                  {expand(pre.author, ctx)
                    .split(/\\and\b/)
                    .map((a, n) => (
                      <span key={n} className="tx-author">
                        {inline(a.replace(/\\thanks\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, ''), ctx)}
                      </span>
                    ))}
                </div>
              )}
              <div className="tx-title-date">{inline(pre.date !== '' ? expand(pre.date, ctx) : '\\today', ctx)}</div>
            </div>
          );
          break;
        }
        case 'tableofcontents':
          body = (
            <div className="tx-toc">
              <div className="tx-h tx-h2">Contents</div>
              {numbering.toc
                .filter((t) => t.level <= 3)
                .map((t) => (
                  <div key={t.key} className={`tx-toc-row tx-toc-${t.level}`}>
                    <span>{t.number}</span> {inline(t.title, ctx)}
                  </div>
                ))}
            </div>
          );
          break;
        case 'listoffigures':
        case 'listoftables':
          body = <div className="tx-h tx-h2">{block.name === 'listoffigures' ? 'List of Figures' : 'List of Tables'}</div>;
          break;
        case 'newpage':
        case 'clearpage':
        case 'cleardoublepage':
        case 'pagebreak':
          body = <div className="tx-pagebreak" aria-label="Page break" />;
          break;
        case 'appendix':
          body = <div className="tx-appendix-mark">Appendix</div>;
          break;
        case 'bibliography': {
          const g = readGroup(block.text, block.text.indexOf('{'));
          body = <Bibliography doc={doc} ctx={ctx} keys={[g?.content ?? '']} />;
          break;
        }
        case 'printbibliography': {
          const mainText = ctx.project?.files[doc.mainPath]?.text ?? '';
          const add = [...maskTex(mainText).matchAll(/\\addbibresource\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)].map((m) => m[1]);
          body = <Bibliography doc={doc} ctx={ctx} keys={add} />;
          break;
        }
        default:
          body = null;
      }
      break;
  }
  return (
    <>
      {body}
      {ctx.footnotes.length > 0 && <ol className="tx-footnotes">{ctx.footnotes}</ol>}
    </>
  );
});

function caretFor(b: Block, after: boolean): Caret {
  return { file: b.file, offset: after ? b.end : b.start, after, indent: b.indent, blockKey: b.key };
}

export function DocumentPreview() {
  useEngineVersion();
  const doc = useProject((s) => s.doc);
  const project = useProject((s) => s.project);
  const version = useProject((s) => s.version);
  const caret = useProject((s) => s.caret);
  const frame = useProject((s) => s.frame);
  const zoom = useProject((s) => s.zoom);
  const setZoom = useProject((s) => s.setZoom);
  const setCaret = useProject((s) => s.setCaret);
  const openFrame = useProject((s) => s.openFrame);
  const editFigure = useProject((s) => s.editFigure);
  const removeFigure = useProject((s) => s.removeFigure);
  const pendingShape = useEditor((s) => s.pendingShape);
  const [selectedFigure, setSelectedFigure] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const width = useWidth(scrollRef);

  const geo = useMemo(() => (doc && project ? pageGeometry(doc, project.files[doc.mainPath]?.text ?? '') : null), [doc, project]);
  const numbering = useMemo(() => (doc && geo ? numberDocument(doc, geo) : null), [doc, geo]);
  const visible = useMemo(() => (doc ? doc.blocks.filter((b) => !b.hidden) : []), [doc]);
  // Paragraphs straight after a heading are not indented, as in LaTeX.
  const afterHeadingAt = useMemoAfterHeading(visible);

  // Keep the caret's "Draw here" button in view.
  useEffect(() => {
    if (!caret) return;
    const el = scrollRef.current?.querySelector('.tx-caret');
    (el as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [caret]);
  useEffect(() => {
    if (!frame) return;
    const el = scrollRef.current?.querySelector('.tx-frame');
    (el as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [frame?.figureId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc || !project || !geo || !numbering) return null;

  const fit = Math.max(0.3, (width - 56) / (geo.paperW * PT));
  const px = PT * fit * zoom;
  const ctxBase = {
    labels: numbering.labels,
    citations: numbering.citations,
    macros: doc.preamble.macros,
    project,
    mainDir: doc.mainDir,
    graphicsPaths: doc.preamble.graphicsPaths,
    px,
    textWidthPt: (geo.textWidth - (geo.columns - 1) * geo.columnSep) / geo.columns,
    fontPt: geo.fontPt,
  };


  const choose = (b: Block, e: React.MouseEvent) => {
    if (frame) return;
    if ((e.target as HTMLElement).closest('a, button, input, .tx-frame')) return;
    if (b.kind === 'flowtikz') {
      setSelectedFigure(b.key);
      setCaret(null);
      return;
    }
    setSelectedFigure(null);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = r.height === 0 || e.clientY - r.top > r.height / 2;
    const c = caretFor(b, after);
    // A shape picked in the palette first: open the board straight away.
    if (pendingShape) openFrame(c);
    else setCaret(c);
  };

  /**
   * The gap between two blocks (or before the first / after the last). It
   * answers to a caret or drawing placed after the block above it as well as
   * before the block below it.
   */
  const gap = (prev: Block | null, next: Block | null) => {
    const matches = (t: { blockKey: string; after: boolean }) =>
      (prev !== null && t.blockKey === prev.key && t.after) || (next !== null && t.blockKey === next.key && !t.after);
    const key = `${prev?.key ?? 'start'}|${next?.key ?? 'end'}`;
    const isFrame = frame && frame.mode === 'new' && matches(frame.target);
    if (isFrame) return <DrawingFrame key={`frame-${key}`} widthPx={Math.max(geo.textWidth * px, 520)} />;
    const isCaret = !frame && caret && matches(caret);
    if (isCaret) {
      return (
        <div className="tx-caret" key={`caret-${key}`} role="group" aria-label="Drawing position">
          <span className="tx-caret-line" />
          <button className="btn primary tiny" onClick={() => openFrame(caret!)} data-action="draw-here" autoFocus>
            <Icon name="plus" size={14} /> Draw here
          </button>
          <button className="btn tiny ghost" onClick={() => setCaret(null)} aria-label="Cancel">
            Cancel
          </button>
        </div>
      );
    }
    if (frame) return null;
    const target = prev ? caretFor(prev, true) : caretFor(next!, false);
    return (
      <div
        key={`gap-${key}`}
        className="tx-gap"
        onClick={(e) => {
          e.stopPropagation();
          setSelectedFigure(null);
          if (pendingShape) openFrame(target);
          else setCaret(target);
        }}
        title="Add a drawing here"
      >
        <span>+ Add a drawing here</span>
      </div>
    );
  };


  /** One row: the block (or the drawing frame replacing it) and the gap after it. */
  const renderRow = (n: number): ReactNode => {
    const b = visible[n];
    const out: ReactNode[] = [];
    if (n === 0) out.push(gap(null, b));
    const editing = frame && frame.mode === 'edit' && frame.blockKey === b.key;
    if (editing) {
      out.push(<DrawingFrame key={`frame-${b.key}`} widthPx={Math.max(geo.textWidth * px, 520)} />);
    } else {
      const selected = selectedFigure === b.key;
      out.push(
        <div
          key={b.key}
          className={`tx-block tx-k-${b.kind}${selected ? ' selected' : ''}`}
          data-block-key={b.key}
          data-file={b.file}
          onClick={(e) => choose(b, e)}
          onDoubleClick={(e) => {
            if (frame) return;
            if (b.kind === 'flowtikz') void editFigure(b);
            else {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              openFrame(caretFor(b, r.height === 0 || e.clientY - r.top > r.height / 2));
            }
          }}
        >
          <RenderedBlock block={b} doc={doc} ctxBase={ctxBase} numbering={numbering} geo={geo} px={px} afterHeading={afterHeadingAt[n]} version={version} />
          {selected && b.kind === 'flowtikz' && !frame && (
            <div className="tx-figure-tools" role="toolbar" aria-label="Figure">
              <button className="btn tiny primary" onClick={() => void editFigure(b)} data-action="edit-figure">
                Edit drawing
              </button>
              <button className="btn tiny" onClick={() => openFrame(caretFor(b, true))}>
                Add a drawing below
              </button>
              <button className="btn tiny danger" onClick={() => removeFigure(b)} data-action="remove-figure">
                Remove
              </button>
            </div>
          )}
        </div>,
      );
    }
    out.push(gap(b, visible[n + 1] ?? null));
    return out;
  };

  /* Long documents are windowed: only the rows near the screen exist. */
  const virtual = visible.length > VIRTUAL_FROM;
  const activeRow = frame
    ? visible.findIndex((b) => b.key === frame.target.blockKey || b.key === frame.blockKey)
    : caret
      ? visible.findIndex((b) => b.key === caret.blockKey)
      : -1;

  const page: React.CSSProperties = {
    width: geo.paperW * px,
    padding: `${Math.min(geo.top, 90) * px}px ${(geo.paperW - geo.left - geo.textWidth) * px}px ${60 * px}px ${geo.left * px}px`,
    fontSize: geo.fontPt * px,
  };

  return (
    <div className="tx-preview" data-tour="preview">
      <div className="tx-toolbar">
        <span className="eyebrow">Document preview</span>
        <span className="tx-meta">
          {geo.className || 'document'} · {geo.fontPt}pt · {geo.columns === 2 ? 'two columns' : 'one column'} · text width {Math.round(geo.textWidth)}pt
        </span>
        <span className="spacer" />
        <span className="tx-hint">{frame ? 'Drawing in the page: use the symbols on the left, then press Insert.' : 'Click anywhere in the document to add a drawing there.'}</span>
        <div className="tool-group" role="group" aria-label="Preview zoom">
          <button className="btn icon-only" onClick={() => setZoom(zoom / 1.15)} aria-label="Smaller preview" title="Smaller preview">
            <Icon name="minus" />
          </button>
          <button className="btn zoom-readout" onClick={() => setZoom(1)} title="Fit the page width">
            {Math.round(zoom * 100)}%
          </button>
          <button className="btn icon-only" onClick={() => setZoom(zoom * 1.15)} aria-label="Larger preview" title="Larger preview">
            <Icon name="plus" />
          </button>
        </div>
      </div>
      {doc.missing.length > 0 && (
        <div className="tx-banner" role="note">
          Some files the document includes are not in the zip: {doc.missing.slice(0, 4).join(', ')}
          {doc.missing.length > 4 ? ` and ${doc.missing.length - 4} more` : ''}.
        </div>
      )}
      <div
        className="tx-scroll"
        ref={scrollRef}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setCaret(null);
            setSelectedFigure(null);
          }
        }}
      >
        <div className={`tx-paper${geo.slides ? ' tx-slides' : ''}`} style={page} data-columns={geo.columns}>
          <div
            className="tx-body"
            style={
              geo.columns === 2 && !virtual
                ? { columnCount: 2, columnGap: geo.columnSep * px }
                : geo.columns === 2
                  ? { width: ((geo.textWidth - geo.columnSep) / 2) * px, margin: '0 auto' }
                  : undefined
            }
          >
            {visible.length === 0 ? (
              frame && frame.target.blockKey === '__empty__' ? (
                <DrawingFrame widthPx={Math.max(geo.textWidth * px, 520)} />
              ) : (
                <div className="tx-empty">
                  This document has no content yet.{' '}
                  <button className="btn tiny primary" onClick={() => useProject.getState().ensureFrame()}>
                    Draw here
                  </button>
                </div>
              )
            ) : virtual ? (
              <VirtualRows
                count={visible.length}
                rowKey={(n) => visible[n].key}
                estimate={(n) => estimateHeight(visible[n], geo, px) + 8}
                render={renderRow}
                scrollRef={scrollRef}
                activeRow={activeRow}
                resetKey={`${px}`}
              />
            ) : (
              visible.map((_, n) => <Fragment key={visible[n].key}>{renderRow(n)}</Fragment>)
            )}
          </div>
        </div>
        {virtual && geo.columns === 2 && (
          <div className="tx-note">This long two-column document is shown one column at a time to keep the preview fast.</div>
        )}
        <div className="tx-note">
          Preview for placing drawings. Fonts, line breaks and float positions are decided when the document is compiled
          (for example in Overleaf).
        </div>
      </div>
    </div>
  );
}

export { flow };
