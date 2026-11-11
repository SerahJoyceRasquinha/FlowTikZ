import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../state/store';
import { useDialogFocus } from './useDialogFocus';
import { Icon } from '../Icon';
import { TexBox } from '../../canvas/ScienceView';
import { chemTex, renderTex, useEngineVersion } from '../../science/math/engine';
import { CHEMISTRY_TOKENS, SymbolDef } from '../../science/math/symbols';
import { SymbolPicker } from './SymbolPicker';
import { ELEMENTS, blankReaction, blankStage, blankTerm, checkBalance, reactionToSource } from '../../science/chem/reaction';
import type { ChemSpec, ReactionArrow, ReactionSpec, ReactionTerm } from '../../science/types';
import { DEFAULT_FORMULA_FONT, sizeForFont, viewCentre } from '../../science/editing';
import { effectiveFontSize } from '../../latex/science';

const ARROWS: { value: ReactionArrow; label: string }[] = [
  { value: '->', label: '→ forward' },
  { value: '<-', label: '← backward' },
  { value: '<=>', label: '⇌ equilibrium' },
  { value: '<=>>', label: '⇌ favours products' },
  { value: '<<=>', label: '⇌ favours reactants' },
  { value: '<->', label: '↔ resonance' },
];

const stop = (e: React.KeyboardEvent) => e.stopPropagation();

function TermRow({ term, onChange, onRemove, label }: { term: ReactionTerm; onChange: (t: ReactionTerm) => void; onRemove?: () => void; label: string }) {
  return (
    <div className="rx-term" role="group" aria-label={label}>
      <input className="rx-coef" aria-label={`${label} coefficient`} placeholder="n" value={term.coefficient} onKeyDown={stop} onChange={(e) => onChange({ ...term, coefficient: e.target.value })} />
      <input className="rx-formula" aria-label={`${label} formula`} placeholder="H2O" value={term.formula} spellCheck={false} onKeyDown={stop} onChange={(e) => onChange({ ...term, formula: e.target.value })} />
      <select aria-label={`${label} state`} value={term.state} onKeyDown={stop} onChange={(e) => onChange({ ...term, state: e.target.value as ReactionTerm['state'] })}>
        <option value="">–</option>
        <option value="s">(s)</option>
        <option value="l">(l)</option>
        <option value="g">(g)</option>
        <option value="aq">(aq)</option>
      </select>
      {onRemove && <button type="button" className="btn tiny ghost" aria-label={`Remove ${label}`} title="Remove" onClick={onRemove}>×</button>}
    </div>
  );
}

function TermList({ title, terms, onChange }: { title: string; terms: ReactionTerm[]; onChange: (t: ReactionTerm[]) => void }) {
  return (
    <div className="rx-list">
      <h4>{title}</h4>
      {terms.map((t, i) => (
        <TermRow
          key={i}
          term={t}
          label={`${title} ${i + 1}`}
          onChange={(next) => onChange(terms.map((x, j) => (j === i ? next : x)))}
          onRemove={terms.length > 1 ? () => onChange(terms.filter((_, j) => j !== i)) : undefined}
        />
      ))}
      <button type="button" className="btn tiny" onClick={() => onChange([...terms, blankTerm()])}>+ add</button>
    </div>
  );
}

export function ChemEditor({ nodeId, tab: initial }: { nodeId?: string; tab?: 'formula' | 'reaction' }) {
  useEngineVersion();
  const close = useEditor((s) => s.openScienceDialog);
  const node = useEditor((s) => (nodeId ? s.doc.nodes[nodeId] : undefined));
  const insertScience = useEditor((s) => s.insertScience);
  const updateScience = useEditor((s) => s.updateScience);
  const setStatus = useEditor((s) => s.setStatus);
  const existing = node?.science?.type === 'chem' ? node.science : null;

  const [tab, setTab] = useState<'formula' | 'reaction'>(initial ?? (existing?.reaction ? 'reaction' : 'formula'));
  const [source, setSource] = useState(existing && !existing.reaction ? existing.source : '');
  const [reaction, setReaction] = useState<ReactionSpec>(existing?.reaction ?? blankReaction());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { ref: focusRef, onTab } = useDialogFocus();

  const text = tab === 'formula' ? source.trim() : reactionToSource(reaction);
  const r = text ? renderTex(chemTex(text), true) : null;
  const balance = useMemo(() => (tab === 'reaction' ? checkBalance(reaction) : null), [tab, reaction]);
  const problem = !text ? 'Nothing to insert yet.' : r && !r.ok ? (r.error ?? 'mhchem could not read this.') : null;

  useEffect(() => {
    if (tab === 'formula') inputRef.current?.focus();
  }, [tab]);

  const addToken = (piece: string) => {
    if (tab !== 'formula') return;
    const el = inputRef.current;
    const at = el?.selectionStart ?? source.length;
    const to = el?.selectionEnd ?? source.length;
    setSource(source.slice(0, at) + piece + source.slice(to));
    const caret = at + piece.length;
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    }, 0);
  };

  const commit = () => {
    if (problem || !r?.ok) return;
    const spec: ChemSpec = {
      type: 'chem',
      source: text,
      natural: r.natural,
      ...(tab === 'reaction' ? { reaction } : {}),
    };
    if (nodeId && node) {
      updateScience(nodeId, spec, sizeForFont(r.natural, effectiveFontSize(node, existing?.natural ?? null)));
      setStatus('Chemical formula updated.');
    } else {
      insertScience('chem', spec, sizeForFont(r.natural, DEFAULT_FORMULA_FONT), viewCentre());
      setStatus('Chemical formula inserted. Double-click it to edit.');
    }
    close(null);
  };

  const setStage = (i: number, patch: Partial<ReactionSpec['stages'][number]>) =>
    setReaction({ ...reaction, stages: reaction.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(null)}>
      <div
        className="modal sci-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Chemistry editor"
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
            <span className="eyebrow">Chemistry</span>
            <h2>{nodeId ? 'Edit chemical formula' : tab === 'formula' ? 'New chemical formula' : 'New reaction'}</h2>
          </div>
          <div className="sci-head-tools">
            <div className="segmented" role="group" aria-label="Chemistry mode">
              <button className={tab === 'formula' ? 'on' : ''} onClick={() => setTab('formula')}>Formula</button>
              <button className={tab === 'reaction' ? 'on' : ''} onClick={() => setTab('reaction')}>Reaction</button>
            </div>
            <button className="btn icon-only" onClick={() => close(null)} aria-label="Close" title="Close (Esc)"><Icon name="x" /></button>
          </div>
        </header>

        <div className="sci-preview" aria-live="polite" data-testid="chem-preview">
          {r?.ok ? (
            <svg width={Math.min(r.natural.w * 26, 760)} height={r.natural.h * 26} viewBox="0 0 1 1" style={{ maxWidth: '100%' }} role="img" aria-label={`Preview of ${text}`}>
              <TexBox tex={chemTex(text)} x={0} y={0} w={1} h={1} color="#0b1324" />
            </svg>
          ) : (
            <span className="note">{text ? (r ? '' : 'Loading the typesetter…') : 'The formula appears here as you type.'}</span>
          )}
          {r && !r.ok && <span className="sci-error">{r.error}</span>}
        </div>

        {tab === 'formula' ? (
          <>
            <textarea
              ref={inputRef}
              className="sci-source"
              rows={2}
              value={source}
              spellCheck={false}
              aria-label="Chemical formula"
              placeholder="H2SO4   or   SO4^2-   or   2H2 + O2 -> 2H2O"
              onChange={(e) => setSource(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') commit();
                if (e.key === 'Escape') close(null);
              }}
            />
            <p className="note sci-hint">Numbers after an element become subscripts automatically. Write charges with ^, for example Fe^3+ or SO4^2-.</p>
            <div className="sci-library chem">
              <div className="sci-symbols">
                <SymbolPicker library="chem" categories={CHEMISTRY_TOKENS} onPick={(s: SymbolDef) => addToken(s.tex)} />
              </div>
              <div className="sci-elements">
                <h4>Elements</h4>
                <div className="element-grid" role="group" aria-label="Elements">
                  {ELEMENTS.map((el) => (
                    <button key={el} type="button" className="element-btn" onClick={() => addToken(el)}>{el}</button>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="rx-editor">
            <TermList title="Reactant" terms={reaction.reactants} onChange={(reactants) => setReaction({ ...reaction, reactants })} />
            {reaction.stages.map((st, i) => (
              <div className="rx-stage" key={i}>
                <div className="rx-arrow" role="group" aria-label={`Step ${i + 1} arrow`}>
                  <h4>Step {i + 1}</h4>
                  <select aria-label={`Step ${i + 1} arrow type`} value={st.arrow} onKeyDown={stop} onChange={(e) => setStage(i, { arrow: e.target.value as ReactionArrow })}>
                    {ARROWS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                  <input aria-label={`Step ${i + 1} above the arrow`} placeholder="above: catalyst, e.g. Pt" value={st.above} onKeyDown={stop} onChange={(e) => setStage(i, { above: e.target.value })} />
                  <input aria-label={`Step ${i + 1} below the arrow`} placeholder="below: e.g. 450 °C" value={st.below} onKeyDown={stop} onChange={(e) => setStage(i, { below: e.target.value })} />
                  <button type="button" className="btn tiny" title="Heat symbol above the arrow" onClick={() => setStage(i, { above: `${st.above}$\\Delta$` })}>+ Δ heat</button>
                  {reaction.stages.length > 1 && (
                    <button type="button" className="btn tiny ghost" onClick={() => setReaction({ ...reaction, stages: reaction.stages.filter((_, j) => j !== i) })}>Remove step</button>
                  )}
                </div>
                <TermList title={`Product (step ${i + 1})`} terms={st.products} onChange={(products) => setStage(i, { products })} />
              </div>
            ))}
            <div className="rx-foot">
              <button type="button" className="btn tiny" onClick={() => setReaction({ ...reaction, stages: [...reaction.stages, blankStage()] })}>+ Add another step</button>
              {balance?.balanced === true && <span className="rx-ok" role="status">Balanced</span>}
              {balance?.balanced === false && <span className="rx-bad" role="status" title={balance.problems.join('\n')}>Not balanced: {balance.problems[0]}</span>}
            </div>
          </div>
        )}

        <footer className="sci-footer">
          <span className="note">The LaTeX uses mhchem: \ce{'{'}{text || '…'}{'}'}</span>
          <button className="btn" onClick={() => close(null)}>Cancel</button>
          <button className="btn success" onClick={commit} disabled={!!problem || !r?.ok} data-action="insert-chem">{nodeId ? 'Apply changes' : 'Insert'}</button>
        </footer>
      </div>
    </div>
  );
}
