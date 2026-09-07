import { useMemo, useState } from 'react';
import { SHAPE_LIST, SHAPE_CATEGORIES, ShapeDef } from '../model/shapes';
import { segsToSvgPath } from '../model/path';
import { useEditor } from '../state/store';

/** Miniature of a shape, drawn with the very same outline function. */
function ShapeThumb({ def }: { def: ShapeDef }) {
  const w = 46;
  const h = 30;
  const outline = def.outline(w, h);
  const decorations = def.decorations ? def.decorations(w, h) : [];
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

export function ShapePalette() {
  const pendingShape = useEditor((s) => s.pendingShape);
  const armShape = useEditor((s) => s.armShape);
  const addNode = useEditor((s) => s.addNode);
  const view = useEditor((s) => s.view);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return SHAPE_CATEGORIES.map((cat) => ({
      cat,
      shapes: SHAPE_LIST.filter(
        (d) =>
          d.category === cat &&
          (!q || d.label.toLowerCase().includes(q) || d.id.includes(q)),
      ),
    })).filter((g) => g.shapes.length > 0);
  }, [filter]);

  /** Drop a shape into the middle of the current viewport. */
  const placeCentre = (kind: string) => {
    const el = document.querySelector('.canvas-svg') as SVGSVGElement | null;
    const rect = el?.getBoundingClientRect();
    const cx = ((rect?.width ?? 800) / 2 - view.panX) / view.zoom;
    const cy = ((rect?.height ?? 600) / 2 - view.panY) / view.zoom;
    addNode(kind, { x: cx, y: cy });
  };

  return (
    <aside className="palette" aria-label="Shape library">
      <div className="palette-head">
        <span className="eyebrow">Symbols</span>
        <input
          value={filter}
          placeholder="Filter shapes"
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
                {g.shapes.map((def) => (
                  <button
                    key={def.id}
                    className={`shape-btn${pendingShape === def.id ? ' on' : ''}`}
                    title={`${def.label} — click to arm, double-click to place`}
                    onClick={() => armShape(pendingShape === def.id ? null : def.id)}
                    onDoubleClick={() => {
                      armShape(null);
                      placeCentre(def.id);
                    }}
                  >
                    <ShapeThumb def={def} />
                    <span>{def.label}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      <p className="palette-hint">
        {pendingShape
          ? 'Click the canvas to place it.'
          : 'Click a symbol, then click the canvas.'}
      </p>
    </aside>
  );
}
