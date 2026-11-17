import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../state/store';
import { Icon } from './Icon';
import { ShapeView } from '../canvas/ShapeView';
import { ConnectorView } from '../canvas/ConnectorView';
import { emptyDiagram } from '../model/defaults';
import type { Diagram } from '../model/types';
import { chemTex, loadEngine, renderTex, useEngineVersion } from '../science/math/engine';
import { viewCentre } from '../science/editing';
import { freeSpot } from '../templates/placement';
import {
  TEMPLATE_CATEGORIES,
  buildTemplate,
  groupedTemplates,
  type Fragment,
  type Measure,
  type TemplateCategory,
  type TemplateDef,
} from '../templates/library';

/** Sizes typeset content with the real engine once it has loaded. */
const measure: Measure = (tex, display) => {
  const r = renderTex(tex, display);
  return r?.ok ? r.natural : null;
};

/** Diagram wrapper so connectors can be routed exactly as on the canvas. */
function asDiagram(frag: Fragment): Diagram {
  const d = emptyDiagram('Preview');
  for (const n of frag.nodes) {
    d.nodes[n.id] = n;
    d.order.push(n.id);
  }
  for (const e of frag.edges) {
    d.edges[e.id] = e;
    d.order.push(e.id);
  }
  return d;
}

/** A live miniature, drawn by the canvas's own renderers. */
const Preview = memo(function Preview({ t, engine }: { t: TemplateDef; engine: number }) {
  const frag = useMemo(() => buildTemplate(t, measure, chemTex), [t, engine]); // eslint-disable-line react-hooks/exhaustive-deps
  const doc = useMemo(() => asDiagram(frag), [frag]);
  if (frag.nodes.length === 0) return null;
  const minX = Math.min(...frag.nodes.map((n) => n.x));
  const minY = Math.min(...frag.nodes.map((n) => n.y));
  const maxX = Math.max(...frag.nodes.map((n) => n.x + n.w));
  const maxY = Math.max(...frag.nodes.map((n) => n.y + n.h));
  const pad = Math.max(8, (maxX - minX) * 0.04);
  // Small formulas are not blown up to fill the tile: keep a minimum frame.
  const w = Math.max(maxX - minX + pad * 2, 200);
  const h = Math.max(maxY - minY + pad * 2, 90);
  const x0 = (minX + maxX) / 2 - w / 2;
  const y0 = (minY + maxY) / 2 - h / 2;
  return (
    <svg
      className="tpl-preview"
      viewBox={`${x0} ${y0} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      data-preview=""
    >
      {frag.edges.map((e) => (
        <ConnectorView key={e.id} diagram={doc} edge={e} selected={false} />
      ))}
      {frag.nodes.map((n) => (
        <ShapeView key={n.id} node={n} selected={false} />
      ))}
    </svg>
  );
});

const KIND_LABEL: Record<TemplateDef['kind'], string> = {
  diagram: 'Diagram',
  math: 'Formula',
  chem: 'Reaction',
  molecule: 'Molecule',
};

/**
 * The template library. Picking a template inserts it into the middle of the
 * view as one undo step, selected so it can be moved straight away; every
 * piece of it stays editable.
 */
export function TemplateLibrary() {
  const category = useEditor((s) => s.templatesOpen);
  if (!category) return null;
  return <TemplateDialog initial={category} />;
}

function TemplateDialog({ initial }: { initial: TemplateCategory }) {
  const engine = useEngineVersion();
  const open = useEditor((s) => s.openTemplates);
  const [tab, setTab] = useState<TemplateCategory>(initial);
  const [query, setQuery] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    searchRef.current?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, []);

  const groups = useMemo(() => groupedTemplates(tab, query), [tab, query]);
  const counts = useMemo(
    () => Object.fromEntries(TEMPLATE_CATEGORIES.map((c) => [c.id, groupedTemplates(c.id, query).reduce((n, g) => n + g.items.length, 0)])),
    [query],
  );
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  // Searching moves to the first tab that has a match, so a hit is never hidden.
  useEffect(() => {
    if (query.trim() && counts[tab] === 0) {
      const first = TEMPLATE_CATEGORIES.find((c) => counts[c.id] > 0);
      if (first) setTab(first.id);
    }
  }, [query, counts, tab]);

  const close = () => open(null);

  const insert = async (t: TemplateDef) => {
    // Formulas are sized by the typesetter; wait for it if it is still loading.
    if (t.kind !== 'molecule') await loadEngine();
    const frag = buildTemplate(t, measure, chemTex);
    const s = useEditor.getState();
    // Land in the middle of the view, or the nearest free space, never on top of work.
    const ids = s.insertFragment(frag, freeSpot(frag, viewCentre(), s.doc));
    close();
    if (ids.length === 0) return;
    // Bring the whole template into view if it landed partly off screen.
    const board = document.querySelector('.canvas-shell')?.getBoundingClientRect();
    const st = useEditor.getState();
    if (board && board.width > 0) {
      const nodes = ids.map((id) => st.doc.nodes[id]).filter(Boolean);
      const v = st.view;
      const off = nodes.some(
        (n) => n.x * v.zoom + v.panX < 0 || n.y * v.zoom + v.panY < 0 || (n.x + n.w) * v.zoom + v.panX > board.width || (n.y + n.h) * v.zoom + v.panY > board.height,
      );
      if (off && nodes.length > 1) st.fitToView({ width: board.width, height: board.height });
      else if (off) st.revealNode(nodes[0].id, { width: board.width, height: board.height });
    }
    st.setStatus(`Inserted "${t.name}". Everything in it is editable; Ctrl+Z takes it out again.`);
  };

  /* Arrow keys move between cards, as in a grid of tiles. */
  const onGridKey = (e: React.KeyboardEvent) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const cards = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('.tpl-card') ?? []);
    const at = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const first = cards[0]?.getBoundingClientRect();
    const perRow = Math.max(1, cards.filter((c) => Math.abs(c.getBoundingClientRect().top - (first?.top ?? 0)) < 4).length);
    const next =
      e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'ArrowDown' ? at + perRow : e.key === 'ArrowUp' ? at - perRow : e.key === 'Home' ? 0 : cards.length - 1;
    cards[Math.max(0, Math.min(cards.length - 1, next))]?.focus();
  };

  /* Tab stays inside the dialog. */
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input'));
    if (items.length === 0) return;
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={dialogRef}
        className="modal tpl-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Template library"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            if (query) setQuery('');
            else close();
            return;
          }
          trapTab(e);
        }}
      >
        <header className="tpl-head">
          <div>
            <span className="eyebrow">Templates</span>
            <h2>Start from a ready-made template</h2>
            <p className="note">Click one to add it to your canvas. Everything in it stays editable.</p>
          </div>
          <button className="btn icon-only" onClick={close} aria-label="Close" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </header>

        <div className="tpl-toolbar">
          <div className="segmented tpl-tabs" role="tablist" aria-label="Template categories">
            {TEMPLATE_CATEGORIES.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={tab === c.id}
                className={tab === c.id ? 'on' : ''}
                onClick={() => setTab(c.id)}
                title={c.blurb}
                data-tpl-tab={c.id}
              >
                {c.label}
                <span className="tpl-count">{counts[c.id]}</span>
              </button>
            ))}
          </div>
          <label className="tpl-search">
            <Icon name="search" size={16} />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Search, e.g. loop, quadratic, ohm, photosynthesis"
              aria-label="Search templates"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>

        <div className="tpl-body" onKeyDown={onGridKey}>
          {total === 0 && (
            <div className="tpl-empty" role="status">
              No template matches “{query}”. Try another word, or clear the search.
            </div>
          )}
          {groups.map((g) => (
            <section key={g.group} className="tpl-group" aria-label={g.group}>
              <h3>{g.group}</h3>
              <div className="tpl-grid">
                {g.items.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="tpl-card"
                    onClick={() => void insert(t)}
                    title={`${t.name}: ${t.description} Click to insert.`}
                    aria-label={`Insert ${t.name}`}
                    data-template={t.id}
                  >
                    <span className="tpl-thumb">
                      <Preview t={t} engine={engine} />
                    </span>
                    <span className="tpl-title">
                      <span className="tpl-name">{t.name}</span>
                      <span className="tpl-kind">{KIND_LABEL[t.kind]}</span>
                    </span>
                    <span className="tpl-desc">{t.description}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="tpl-foot">
          <span className="note">
            Tip: after inserting, drag to move it, double-click any part to edit it, and press Ctrl+Z to undo.
          </span>
          <button className="btn" onClick={close}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
