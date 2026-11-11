import { useMemo, useState } from 'react';
import { SHAPE_LIST, SHAPE_CATEGORIES, ShapeDef } from '../model/shapes';
import { segsToSvgPath } from '../model/path';
import { useEditor } from '../state/store';
import type { PaletteDomain } from '../state/store';
import { CIRCUIT_DEFS, CIRCUIT_GROUPS, CIRCUIT_BY_ID } from '../science/physics/circuits';
import { PHYSICS_GROUPS, PHYSICS_SHAPE_DEFS } from '../science/physics/diagramShapes';
import { SHAPE_DEFS } from '../model/shapes';
import { SHAPE_DRAG_TYPE } from '../science/editing';

/** Miniature of a shape, drawn with the very same outline function. */
function ShapeThumb({ def }: { def: ShapeDef }) {
  const circuit = CIRCUIT_BY_ID[def.id];
  // Science parts are drawn at their own proportions, then fitted to the tile.
  const w = circuit || def.flippable ? def.defaultSize.w : 46;
  const h = circuit || def.flippable ? def.defaultSize.h : 30;
  const outline = def.outline(w, h);
  const decorations = def.decorations ? def.decorations(w, h) : [];
  if (circuit || def.flippable) {
    const m = Math.max(w, h) * 0.08;
    const bodies = def.bodies ? def.bodies(w, h) : [];
    const solids = def.solids ? def.solids(w, h) : [];
    const stroke = Math.max(w / 46, h / 30) * 1.2;
    return (
      <svg viewBox={`${-m} ${-m} ${w + 2 * m} ${h + 2 * m}`} width={50} height={34} aria-hidden="true">
        <path d={segsToSvgPath(outline)} fill={outline.some((s) => s.c === 'Z') ? 'var(--paper)' : 'none'} stroke="currentColor" strokeWidth={stroke} />
        {bodies.map((d, i) => <path key={`b${i}`} d={segsToSvgPath(d)} fill="var(--paper)" stroke="currentColor" strokeWidth={stroke} />)}
        {decorations.map((d, i) => <path key={i} d={segsToSvgPath(d)} fill="none" stroke="currentColor" strokeWidth={stroke} />)}
        {solids.map((d, i) => <path key={`s${i}`} d={segsToSvgPath(d)} fill="currentColor" stroke="none" />)}
        {circuit?.glyph && <text x={w / 2} y={h / 2} textAnchor="middle" dominantBaseline="central" fill="currentColor" style={{ fontSize: h * 0.42 }}>{circuit.glyph}</text>}
      </svg>
    );
  }
  const closed = outline.some((s) => s.c === 'Z');
  const fill = def.noOutline && closed ? 'none' : 'var(--paper)';
  return (
    <svg viewBox={`-2 -2 ${w + 4} ${h + 4}`} width={w + 4} height={h + 4} aria-hidden="true">
      <path
        d={segsToSvgPath(outline)}
        fill={closed ? fill : 'none'}
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      {decorations.map((d, i) => (
        <path
          key={i}
          d={segsToSvgPath(d)}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.1}
        />
      ))}
      {def.id === 'text' && (
        <text
          x={w / 2}
          y={h / 2 + 4}
          textAnchor="middle"
          fill="currentColor"
          style={{ fontSize: 12 }}
        >
          Aa
        </text>
      )}
    </svg>
  );
}

const DOMAIN_LABEL: Record<PaletteDomain, string> = { flow: 'Flow', circuit: 'Circuit', physics: 'Physics' };
const DOMAIN_TITLE: Record<PaletteDomain, string> = {
  flow: 'Flowchart symbols',
  circuit: 'Circuit components',
  physics: 'Physics diagram parts',
};

export function ShapePalette() {
  const pendingShape = useEditor((s) => s.pendingShape);
  const armShape = useEditor((s) => s.armShape);
  const addNode = useEditor((s) => s.addNode);
  const view = useEditor((s) => s.view);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // The whole palette can fold away to a thin rail, giving the canvas room.
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('flowtikz:palette-hidden') === '1';
    } catch {
      return false;
    }
  });
  const toggleHidden = (v: boolean) => {
    setHidden(v);
    try {
      localStorage.setItem('flowtikz:palette-hidden', v ? '1' : '0');
    } catch {
      /* storage may be disabled */
    }
  };

  const domain = useEditor((s) => s.paletteDomain);
  const setDomain = useEditor((s) => s.setPaletteDomain);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const hit = (label: string, id: string, keywords = '') =>
      !q || label.toLowerCase().includes(q) || id.includes(q) || keywords.includes(q);
    if (domain === 'circuit') {
      return CIRCUIT_GROUPS.map((cat) => ({
        cat: cat as string,
        shapes: CIRCUIT_DEFS.filter((d) => d.group === cat && hit(d.label, d.id, d.keywords)).map((d) => SHAPE_DEFS[d.id]),
      })).filter((g) => g.shapes.length > 0);
    }
    if (domain === 'physics') {
      return PHYSICS_GROUPS.map((cat) => ({
        cat: cat as string,
        shapes: PHYSICS_SHAPE_DEFS.filter((d) => d.group === cat && hit(d.label, d.id, d.keywords)) as ShapeDef[],
      })).filter((g) => g.shapes.length > 0);
    }
    return SHAPE_CATEGORIES.map((cat) => ({
      cat: cat as string,
      shapes: SHAPE_LIST.filter((d) => {
        if (d.category !== cat) return false;
        return hit(d.label, d.id);
      }),
    })).filter((g) => g.shapes.length > 0);
  }, [filter, domain]);

  /** Drop a shape into the middle of the current viewport. */
  const placeCentre = (kind: string) => {
    const el = document.querySelector('.canvas-svg') as SVGSVGElement | null;
    const rect = el?.getBoundingClientRect();
    const cx = ((rect?.width ?? 800) / 2 - view.panX) / view.zoom;
    const cy = ((rect?.height ?? 600) / 2 - view.panY) / view.zoom;
    addNode(kind, { x: cx, y: cy });
  };

  if (hidden) {
    return (
      <aside className="palette rail" aria-label="Shape library (collapsed)" data-tour="palette">
        <button className="rail-btn" onClick={() => toggleHidden(false)} title="Show the flowchart symbols">
          <span aria-hidden="true">»</span>
          <span className="rail-label">Symbols</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className={`palette${domain === 'flow' ? '' : ' palette-sci'}`} aria-label="Shape library" data-tour="palette">
      <div className="palette-head">
        <div className="palette-title">
          <span className="eyebrow">{DOMAIN_TITLE[domain]}</span>
          <button className="icon-btn" onClick={() => toggleHidden(true)} title="Hide the symbols to make the canvas wider" aria-label="Hide symbols">
            «
          </button>
        </div>
        <div className="segmented small palette-domains" role="group" aria-label="Symbol set">
          {(['flow', 'circuit', 'physics'] as PaletteDomain[]).map((d) => (
            <button key={d} className={domain === d ? 'on' : ''} onClick={() => setDomain(d)} title={DOMAIN_TITLE[d]} aria-pressed={domain === d}>
              {DOMAIN_LABEL[d]}
            </button>
          ))}
        </div>
        <input
          value={filter}
          placeholder="Search symbols…"
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <div className="palette-scroll">
        {groups.map((g) => (
          <section key={g.cat}>
            <button
              className="palette-cat"
              onClick={() =>
                setCollapsed((c) => ({ ...c, [g.cat]: !c[g.cat] }))
              }
            >
              {g.cat}
              <span>{collapsed[g.cat] ? '+' : '\u2212'}</span>
            </button>
            {!collapsed[g.cat] && (
              <div className="palette-grid">
                {g.shapes.map((def) => {
                  return (
                    <button
                      key={def.id}
                      className={`shape-btn${pendingShape === def.id ? ' on' : ''}`}
                      title={`${def.label}: drag onto the canvas, or click then click the canvas. Double-click to drop it in the middle.`}
                      aria-label={def.label}
                      aria-pressed={pendingShape === def.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(SHAPE_DRAG_TYPE, def.id);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => armShape(pendingShape === def.id ? null : def.id)}
                      onDoubleClick={() => {
                        armShape(null);
                        placeCentre(def.id);
                      }}
                    >
                      <ShapeThumb def={def} />
                      <span className="shape-name">{def.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>
      <p className="palette-hint">
        {pendingShape
          ? 'Click the canvas to place it.'
          : domain === 'circuit'
            ? 'Drag a part onto the canvas, then drag from a round terminal to another to wire it. R turns the selection.'
            : 'Click a symbol, then click the canvas. Double-click a symbol to drop it in the middle.'}
      </p>
    </aside>
  );
}
