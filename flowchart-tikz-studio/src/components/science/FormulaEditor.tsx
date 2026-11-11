import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../state/store';
import { useDialogFocus } from './useDialogFocus';
import { Icon } from '../Icon';
import { TexBox } from '../../canvas/ScienceView';
import { renderTex, useEngineVersion } from '../../science/math/engine';
import { MATH_CATEGORIES, PHYSICS_CATEGORIES, SymbolDef } from '../../science/math/symbols';
import {
  BIGOP_GLYPH,
  Caret,
  DELIMS,
  MNode,
  MRow,
  MStruct,
  RowPath,
  STRUCT_TEMPLATES,
  StructTemplate,
  colorTemplate,
  countEmptySlots,
  deleteBefore,
  editable,
  insertStructure,
  insertSymbol,
  parseTex,
  resizeTable,
  rowEmpty,
  rowToTex,
  setText,
  slotLabels,
  slotOptional,
} from '../../science/math/ast';
import { unicodeToTex, validateTex } from '../../science/math/validate';
import { SymbolPicker } from './SymbolPicker';
import type { MathSpec } from '../../science/types';
import { DEFAULT_FORMULA_FONT, sizeForFont, viewCentre } from '../../science/editing';
import { effectiveFontSize } from '../../latex/science';
import { copyToClipboard } from '../../export/file';

/* --------------------------------------------------------- structure editor */

interface EditCtx {
  onChange: (path: RowPath, node: number, value: string) => void;
  onCaret: (c: Caret) => void;
  onKey: (e: React.KeyboardEvent<HTMLInputElement>, c: Caret) => void;
  onResize: (path: RowPath, node: number, drows: number, dcols: number) => void;
}

const key = (path: RowPath, node: number) => `${path.join('.')}|${node}`;

function TextBox({ path, node, value, label, required, ctx }: {
  path: RowPath;
  node: number;
  value: string;
  label: string;
  required: boolean;
  ctx: EditCtx;
}) {
  const caretOf = (el: HTMLInputElement): Caret => ({
    path,
    node,
    offset: el.selectionStart ?? el.value.length,
    end: el.selectionEnd ?? undefined,
  });
  const ch = Math.max(required ? 2.2 : 1, value.length + 0.6);
  return (
    <input
      className={`mx-input${required ? ' empty' : ''}`}
      style={{ width: `${ch * 0.62}em` }}
      value={value}
      aria-label={label}
      data-mx={key(path, node)}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => {
        ctx.onChange(path, node, e.target.value);
        ctx.onCaret(caretOf(e.target));
      }}
      onFocus={(e) => ctx.onCaret(caretOf(e.target))}
      onSelect={(e) => ctx.onCaret(caretOf(e.target as HTMLInputElement))}
      onKeyDown={(e) => {
        e.stopPropagation();
        ctx.onKey(e, caretOf(e.target as HTMLInputElement));
      }}
    />
  );
}

function RowEditor({ row, path, label, required, ctx }: {
  row: MRow;
  path: RowPath;
  label: string;
  required: boolean;
  ctx: EditCtx;
}) {
  const empty = rowEmpty(row);
  return (
    <span className="mx-row">
      {row.map((n, i) =>
        n.t === 'text' ? (
          <TextBox key={i} path={path} node={i} value={n.v} label={label} required={required && empty} ctx={ctx} />
        ) : n.t === 'sym' ? (
          <span key={i} className="mx-sym" title={n.tex}>
            {n.glyph}
          </span>
        ) : (
          <StructEditor key={i} st={n} path={path} node={i} ctx={ctx} />
        ),
      )}
    </span>
  );
}

function StructEditor({ st, path, node, ctx }: { st: MStruct; path: RowPath; node: number; ctx: EditCtx }) {
  const labels = slotLabels(st);
  const slot = (i: number, extra?: string) => (
    <span className={`mx-slot ${extra ?? ''}`}>
      <RowEditor row={st.slots[i]} path={[...path, node, i]} label={labels[i]} required={!slotOptional(st, i)} ctx={ctx} />
    </span>
  );

  switch (st.type) {
    case 'frac':
      return (
        <span className="mx-frac" role="group" aria-label="Fraction">
          {slot(0)}
          <span className="mx-frac-bar" aria-hidden="true" />
          {slot(1)}
        </span>
      );
    case 'binom':
      return (
        <span className="mx-fence" role="group" aria-label="Binomial">
          <span className="mx-delim">(</span>
          <span className="mx-stack">{slot(0)}{slot(1)}</span>
          <span className="mx-delim">)</span>
        </span>
      );
    case 'sup':
      return <span className="mx-script" role="group" aria-label="Superscript">{slot(0)}<span className="mx-up">{slot(1, 'small')}</span></span>;
    case 'sub':
      return <span className="mx-script" role="group" aria-label="Subscript">{slot(0)}<span className="mx-down">{slot(1, 'small')}</span></span>;
    case 'subsup':
      return (
        <span className="mx-script" role="group" aria-label="Subscript and superscript">
          {slot(0)}
          <span className="mx-stack left">{slot(2, 'small')}{slot(1, 'small')}</span>
        </span>
      );
    case 'sqrt':
      return <span className="mx-root" role="group" aria-label="Square root"><span className="mx-rad">√</span><span className="mx-under">{slot(0)}</span></span>;
    case 'nroot':
      return (
        <span className="mx-root" role="group" aria-label="n-th root">
          <span className="mx-up">{slot(0, 'small')}</span>
          <span className="mx-rad">√</span>
          <span className="mx-under">{slot(1)}</span>
        </span>
      );
    case 'group': {
      const d = DELIMS[st.op ?? 'paren'];
      return <span className="mx-fence" role="group" aria-label={d.name}><span className="mx-delim">{d.gl}</span>{slot(0)}<span className="mx-delim">{d.gr}</span></span>;
    }
    case 'bigop':
      return (
        <span className="mx-bigop" role="group" aria-label={`Operator ${st.op}`}>
          {slot(1, 'small')}
          <span className="mx-opglyph">{BIGOP_GLYPH[st.op ?? 'int'] ?? st.op}</span>
          {slot(0, 'small')}
        </span>
      );
    case 'lim':
      return <span className="mx-bigop" role="group" aria-label={st.op}><span className="mx-opname">{st.op}</span>{slot(0, 'small')}</span>;
    case 'accent':
    case 'font':
      return <span className="mx-tag" role="group" aria-label={st.op}><span className="mx-tagname">{st.op}</span>{slot(0)}</span>;
    case 'text':
      return <span className="mx-tag" role="group" aria-label="Text"><span className="mx-tagname">text</span>{slot(0)}</span>;
    case 'color': {
      const m = /\[RGB\]\{(\d+),(\d+),(\d+)\}/.exec(st.op ?? '');
      return (
        <span className="mx-tag" role="group" aria-label="Coloured" style={m ? { borderColor: `rgb(${m[1]},${m[2]},${m[3]})` } : undefined}>
          <span className="mx-tagname" style={m ? { color: `rgb(${m[1]},${m[2]},${m[3]})` } : undefined}>colour</span>
          {slot(0)}
        </span>
      );
    }
    case 'overset':
    case 'underset':
      return <span className="mx-stack" role="group" aria-label={st.type}>{st.type === 'overset' ? <>{slot(0, 'small')}{slot(1)}</> : <>{slot(1)}{slot(0, 'small')}</>}</span>;
    case 'matrix':
    case 'cases':
    case 'aligned':
    case 'gathered': {
      const rows = st.rows ?? 1;
      const cols = st.cols ?? 1;
      const isMatrix = st.type === 'matrix';
      const delim = isMatrix ? { pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'] }[st.op ?? ''] ?? ['', ''] : st.type === 'cases' ? ['{', ''] : ['', ''];
      return (
        <span className="mx-fence" role="group" aria-label={isMatrix ? 'Matrix' : st.type}>
          <span className="mx-delim">{delim[0]}</span>
          <span className="mx-table">
            <span className="mx-grid" style={{ gridTemplateColumns: `repeat(${cols}, auto)` }}>
              {st.slots.map((_, i) => <span key={i}>{slot(i)}</span>)}
            </span>
            <span className="mx-table-tools">
              <button type="button" title="Add a row" onClick={() => ctx.onResize(path, node, 1, 0)}>+ row</button>
              <button type="button" title="Remove the last row" disabled={rows <= 1} onClick={() => ctx.onResize(path, node, -1, 0)}>− row</button>
              {(isMatrix || st.type === 'aligned') && (
                <>
                  <button type="button" title="Add a column" onClick={() => ctx.onResize(path, node, 0, 1)}>+ col</button>
                  <button type="button" title="Remove the last column" disabled={cols <= 1} onClick={() => ctx.onResize(path, node, 0, -1)}>− col</button>
                </>
              )}
            </span>
          </span>
          <span className="mx-delim">{delim[1]}</span>
        </span>
      );
    }
  }
}

/* ------------------------------------------------------------- the dialog */

interface Snapshot {
  root: MRow;
  caret: Caret;
}

const START: Caret = { path: [], node: 0, offset: 0 };
const blankRoot = (): MRow => [{ t: 'text', v: '' }];
const HISTORY = 100;

function moveFocus(from: HTMLElement, dir: 1 | -1, scope: HTMLElement | null): boolean {
  if (!scope) return false;
  const all = Array.from(scope.querySelectorAll<HTMLInputElement>('input.mx-input'));
  const next = all[all.indexOf(from as HTMLInputElement) + dir];
  if (!next) return false;
  next.focus();
  const at = dir > 0 ? 0 : next.value.length;
  next.setSelectionRange(at, at);
  return true;
}

export function FormulaEditor({ nodeId, library }: { nodeId?: string; library?: 'math' | 'physics' }) {
  useEngineVersion();
  const close = useEditor((s) => s.openScienceDialog);
  const node = useEditor((s) => (nodeId ? s.doc.nodes[nodeId] : undefined));
  const insertScience = useEditor((s) => s.insertScience);
  const updateScience = useEditor((s) => s.updateScience);
  const setStatus = useEditor((s) => s.setStatus);
  const existing = node?.science?.type === 'math' ? node.science : null;

  const [mode, setMode] = useState<'visual' | 'latex'>('visual');
  const [root, setRoot] = useState<MRow>(() => (existing ? parseTex(existing.latex) : blankRoot()));
  const [source, setSource] = useState(existing?.latex ?? '');
  const [display, setDisplay] = useState(existing?.display ?? true);
  const [lib, setLib] = useState<'math' | 'physics'>(library ?? 'math');
  const [colour, setColour] = useState('#dc2626');
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const caretRef = useRef<Caret>(START);
  const pendingFocus = useRef<Caret | null>(START);
  const editorRef = useRef<HTMLDivElement>(null);
  const { ref: focusRef, onTab } = useDialogFocus();
  const lastTyped = useRef(0);

  /* What the formula currently is, in the active mode. */
  const latex = useMemo(() => (mode === 'visual' ? rowToTex(root).trim() : unicodeToTex(source).trim()), [mode, root, source]);
  const previewTex = useMemo(() => (mode === 'visual' ? rowToTex(root, { placeholders: true }).trim() : unicodeToTex(source).trim()), [mode, root, source]);
  const render = previewTex ? renderTex(previewTex, display) : null;
  const finalRender = latex ? renderTex(latex, display) : null;
  const empties = mode === 'visual' ? countEmptySlots(root) : 0;

  const problem = !latex
    ? 'Nothing to insert yet.'
    : empties > 0
      ? `${empties} box${empties > 1 ? 'es are' : ' is'} still empty.`
      : (validateTex(latex) ?? (finalRender && !finalRender.ok ? finalRender.error ?? 'This is not valid LaTeX.' : null));

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target || mode !== 'visual') return;
    pendingFocus.current = null;
    const el = editorRef.current?.querySelector<HTMLInputElement>(`[data-mx="${key(target.path, target.node)}"]`);
    if (el) {
      el.focus();
      el.setSelectionRange(target.offset, target.offset);
      caretRef.current = target;
    }
  });

  const pushHistory = useCallback(
    (coalesce = false) => {
      const now = Date.now();
      if (coalesce && now - lastTyped.current < 600) {
        lastTyped.current = now;
        return;
      }
      lastTyped.current = coalesce ? now : 0;
      setPast((p) => [...p, { root, caret: caretRef.current }].slice(-HISTORY));
      setFuture([]);
    },
    [root],
  );

  const apply = useCallback(
    (result: { root: MRow; caret: Caret }) => {
      pushHistory();
      setRoot(editable(result.root));
      pendingFocus.current = result.caret;
      setNotice(null);
    },
    [pushHistory],
  );

  const insertStruct = (t: MStruct) => {
    if (mode === 'visual') {
      apply(insertStructure(root, caretRef.current, t));
    } else {
      setSource((s) => `${s}${s && !s.endsWith(' ') ? ' ' : ''}${rowToTex([t], { placeholders: false })}`);
      textareaRef.current?.focus();
    }
  };

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertSym = (s: SymbolDef) => {
    if (mode === 'latex') {
      const el = textareaRef.current;
      const at = el?.selectionStart ?? source.length;
      const to = el?.selectionEnd ?? source.length;
      const piece = /^\\[a-zA-Z]+$/.test(s.tex) ? `${s.tex} ` : s.tex;
      setSource(source.slice(0, at) + piece + source.slice(to));
      requestAnimationFrame?.(() => {
        el?.focus();
        el?.setSelectionRange(at + piece.length, at + piece.length);
      });
      return;
    }
    const isSimple = /^\\[a-zA-Z]+$/.test(s.tex) && !s.tex.startsWith('\\mathrm');
    if (isSimple) {
      apply(insertSymbol(root, caretRef.current, s.tex, s.glyph));
    } else {
      // Multi-token library entries are parsed so they stay editable.
      const c = caretRef.current;
      const row = parseTex(s.tex);
      let working = root;
      let caret = c;
      const target = rowOf(working, caret);
      const text = target[caret.node] as { v: string };
      const before = text.v.slice(0, caret.offset);
      const after = text.v.slice(caret.end ?? caret.offset);
      const next: MNode[] = [...target.slice(0, caret.node), { t: 'text', v: before }, ...row, { t: 'text', v: after }, ...target.slice(caret.node + 1)];
      working = replaceRow(working, caret.path, next);
      const merged = editable(rowOf(working, caret));
      caret = { path: caret.path, node: merged.length - 1 - (target.length - 1 - caret.node), offset: 0 };
      apply({ root: replaceRow(working, c.path, merged), caret });
    }
  };

  const undo = () => {
    if (mode === 'latex') return;
    const last = past[past.length - 1];
    if (!last) return;
    setFuture((f) => [{ root, caret: caretRef.current }, ...f].slice(0, HISTORY));
    setPast((p) => p.slice(0, -1));
    setRoot(last.root);
    pendingFocus.current = last.caret;
  };

  const redo = () => {
    if (mode === 'latex') return;
    const next = future[0];
    if (!next) return;
    setPast((p) => [...p, { root, caret: caretRef.current }].slice(-HISTORY));
    setFuture((f) => f.slice(1));
    setRoot(next.root);
    pendingFocus.current = next.caret;
  };

  const clear = () => {
    if (mode === 'visual') {
      pushHistory();
      setRoot(blankRoot());
      pendingFocus.current = START;
    } else {
      setSource('');
    }
    setNotice(null);
  };

  const switchMode = (m: 'visual' | 'latex') => {
    if (m === mode) return;
    if (m === 'latex') {
      setSource(rowToTex(root).trim());
    } else {
      pushHistory();
      setRoot(parseTex(source));
      pendingFocus.current = START;
    }
    setMode(m);
  };

  const commit = () => {
    if (problem || !finalRender?.ok) {
      setNotice(problem ?? 'The typesetter is still loading; try again in a moment.');
      return;
    }
    const natural = finalRender.natural;
    const spec: MathSpec = { type: 'math', latex, display, natural };
    if (nodeId && node) {
      const font = effectiveFontSize(node, existing?.natural ?? null);
      updateScience(nodeId, spec, sizeForFont(natural, font));
      setStatus('Formula updated.');
    } else {
      insertScience('math', spec, sizeForFont(natural, DEFAULT_FORMULA_FONT), viewCentre());
      setStatus('Formula inserted. Double-click it to edit.');
    }
    close(null);
  };

  const ctx: EditCtx = {
    onChange: (path, n, value) => {
      pushHistory(true);
      setRoot((r) => setText(r, path, n, value));
      setNotice(null);
    },
    onCaret: (c) => {
      caretRef.current = c;
    },
    onResize: (path, n, dr, dc) => {
      pushHistory();
      setRoot((r) => resizeTable(r, path, n, dr, dc));
    },
    onKey: (e, c) => {
      const el = e.target as HTMLInputElement;
      const noSel = c.end === undefined || c.end === c.offset;
      if (e.key === '^' || e.key === '_') {
        e.preventDefault();
        const t = STRUCT_TEMPLATES.find((x) => x.id === (e.key === '^' ? 'sup' : 'sub')) as StructTemplate;
        apply(insertStructure(root, c, t.make()));
      } else if (e.key === 'Backspace' && noSel && c.offset === 0) {
        const r = deleteBefore(root, c);
        if (r) {
          e.preventDefault();
          apply(r);
        } else if (moveFocus(el, -1, editorRef.current)) {
          e.preventDefault();
        }
      } else if (e.key === 'ArrowRight' && noSel && c.offset === el.value.length) {
        if (moveFocus(el, 1, editorRef.current)) e.preventDefault();
      } else if (e.key === 'ArrowLeft' && noSel && c.offset === 0) {
        if (moveFocus(el, -1, editorRef.current)) e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
    },
  };

  const structGroups = useMemo(() => {
    const groups = new Map<string, StructTemplate[]>();
    for (const t of STRUCT_TEMPLATES) groups.set(t.group, [...(groups.get(t.group) ?? []), t]);
    return [...groups.entries()];
  }, []);

  const envCopy = async (env: 'inline' | 'display' | 'align') => {
    const text = env === 'inline' ? `$${latex}$` : env === 'display' ? `\\[\n  ${latex}\n\\]` : `\\begin{align*}\n  ${latex}\n\\end{align*}`;
    const ok = await copyToClipboard(text);
    setStatus(ok ? 'Formula copied.' : 'Copy failed.');
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(null)}>
      <div
        className="modal sci-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Formula editor"
        tabIndex={-1}
        ref={focusRef}
        // Capture: inner fields stop propagation, and Esc must work from any of them.
        onKeyDownCapture={(e) => {
          if (e.key === 'Escape') close(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          onTab(e);
        }}
      >
        <header className="sci-head">
          <div>
            <span className="eyebrow">Mathematics</span>
            <h2>{nodeId ? 'Edit formula' : 'New formula'}</h2>
          </div>
          <div className="sci-head-tools">
            <div className="segmented" role="group" aria-label="Editing mode">
              <button className={mode === 'visual' ? 'on' : ''} onClick={() => switchMode('visual')} title="Build the formula from boxes">Visual</button>
              <button className={mode === 'latex' ? 'on' : ''} onClick={() => switchMode('latex')} title="Type LaTeX directly">LaTeX</button>
            </div>
            <button className="btn icon-only" onClick={() => close(null)} aria-label="Close" title="Close (Esc)"><Icon name="x" /></button>
          </div>
        </header>

        <div className="sci-preview" aria-live="polite" data-testid="formula-preview">
          {render?.ok ? (
            <svg
              width={Math.min(render.natural.w * 26, 760)}
              height={render.natural.h * 26}
              viewBox="0 0 1 1"
              style={{ maxWidth: '100%' }}
              role="img"
              aria-label={`Preview of ${previewTex}`}
            >
              <TexBox tex={previewTex} display={display} x={0} y={0} w={1} h={1} color="#0b1324" />
            </svg>
          ) : (
            <span className="note">{!previewTex ? 'The formula appears here as you build it.' : render ? '' : 'Loading the typesetter…'}</span>
          )}
          {render && !render.ok && <span className="sci-error">{render.error}</span>}
        </div>

        {mode === 'visual' ? (
          <div className="mx-editor" ref={editorRef} data-testid="formula-boxes">
            <RowEditor row={root} path={[]} label="Formula" required={false} ctx={ctx} />
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            className="sci-source"
            rows={3}
            value={source}
            spellCheck={false}
            aria-label="LaTeX source"
            placeholder="\frac{a}{b} + \sqrt{x}"
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') commit();
              if (e.key === 'Escape') close(null);
            }}
          />
        )}

        <div className="sci-actions">
          <button className="btn tiny" onClick={undo} disabled={mode === 'latex' || past.length === 0} title="Undo (Ctrl+Z)"><Icon name="undo" size={15} />Undo</button>
          <button className="btn tiny" onClick={redo} disabled={mode === 'latex' || future.length === 0} title="Redo (Ctrl+Y)"><Icon name="redo" size={15} />Redo</button>
          <button className="btn tiny" onClick={clear} title="Empty the formula"><Icon name="eraser" size={15} />Clear</button>
          <span className="divider-v" />
          <label className="checkline" title="Display style sets limits above and below and enlarges fractions">
            <input type="checkbox" checked={display} onChange={(e) => setDisplay(e.target.checked)} />
            Display style
          </label>
          <span className="divider-v" />
          <label className="sci-colour" title="Colour part of the formula: pick a colour, then press Colour part">
            <input type="color" value={colour} aria-label="Colour for part of the formula" onChange={(e) => setColour(e.target.value)} />
          </label>
          <button className="btn tiny" onClick={() => insertStruct(colorTemplate(colour))} title="Wrap the selected text, or start a coloured box, in this colour">Colour part</button>
          <span className="spacer" />
          <div className="sci-copy" role="group" aria-label="Copy for use outside a picture">
            <span className="note">Copy as</span>
            <button className="btn tiny" disabled={!!problem} onClick={() => void envCopy('inline')} title="$ ... $">inline</button>
            <button className="btn tiny" disabled={!!problem} onClick={() => void envCopy('display')} title="\[ ... \]">display</button>
            <button className="btn tiny" disabled={!!problem} onClick={() => void envCopy('align')} title="align* environment">align</button>
          </div>
        </div>

        <div className="sci-library">
          <div className="sci-structs" aria-label="Structures">
            {structGroups.map(([group, list]) => (
              <section key={group}>
                <h4>{group}</h4>
                <div className="struct-grid">
                  {list.map((t) => (
                    <button key={t.id} type="button" className="struct-btn" title={t.name} aria-label={t.name} data-struct={t.id} onClick={() => insertStruct(t.make())}>
                      {t.glyph}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="sci-symbols">
            <div className="segmented small" role="group" aria-label="Symbol library">
              <button className={lib === 'math' ? 'on' : ''} onClick={() => setLib('math')}>Mathematics</button>
              <button className={lib === 'physics' ? 'on' : ''} onClick={() => setLib('physics')}>Physics</button>
            </div>
            <SymbolPicker key={lib} library={lib} categories={lib === 'math' ? MATH_CATEGORIES : PHYSICS_CATEGORIES} onPick={insertSym} />
          </div>
        </div>

        <footer className="sci-footer">
          <span className={`note${notice ? ' sci-error' : ''}`}>{notice ?? (problem && latex ? problem : 'Tip: type ^ for a superscript and _ for a subscript. Ctrl+Enter inserts.')}</span>
          <button className="btn" onClick={() => close(null)}>Cancel</button>
          <button className="btn success" onClick={commit} disabled={!!problem || !finalRender?.ok} data-action="insert-formula">
            {nodeId ? 'Apply changes' : 'Insert formula'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function rowOf(root: MRow, caret: Caret): MRow {
  let row = root;
  for (let i = 0; i < caret.path.length; i += 2) row = (row[caret.path[i]] as MStruct).slots[caret.path[i + 1]];
  return row;
}

function replaceRow(root: MRow, path: RowPath, next: MRow): MRow {
  if (path.length === 0) return next;
  const copy: MRow = JSON.parse(JSON.stringify(root));
  let row = copy;
  for (let i = 0; i < path.length - 2; i += 2) row = (row[path[i]] as MStruct).slots[path[i + 1]];
  (row[path[path.length - 2]] as MStruct).slots[path[path.length - 1]] = next;
  return copy;
}
