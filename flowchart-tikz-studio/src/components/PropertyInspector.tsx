import { useEditor } from '../state/store';
import type {
  ArrowHead,
  Edge,
  Node,
  ObjectMeta,
  RoutingKind,
  ShadingKind,
  StrokeStyle,
} from '../model/types';
import { getShapeDef } from '../model/shapes';
import { ColorField } from './ColorField';
import { isTransparentBackground } from '../model/meta';

/** Read-only provenance of an imported object, including preserved source properties. */
function ImportedFrom({ meta }: { meta: ObjectMeta | undefined }) {
  const imp = meta?.import;
  if (!imp) return null;
  const preserved = Object.entries(imp.preserved ?? {});
  return (
    <section className="imported-from">
      <h4>Imported</h4>
      <p className="note">
        From {imp.format || 'an external file'}
        {imp.sourceId ? ` (source id ${imp.sourceId})` : ''}
        {imp.confidence !== undefined ? ` · recognised with ${Math.round(imp.confidence * 100)}% confidence` : ''}.
      </p>
      {imp.notes?.map((n, i) => (
        <p key={i} className="note">
          {n}
        </p>
      ))}
      {preserved.length > 0 && (
        <details>
          <summary>{preserved.length} source propert{preserved.length === 1 ? 'y' : 'ies'} kept as metadata</summary>
          <dl className="meta-list">
            {preserved.slice(0, 40).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd title={String(v)}>{String(v).slice(0, 80)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ primitives */

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="num-row">
        <input
          type="number"
          value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(v);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <label>
        {label} <span className="value">{Math.round(value * 100)}%</span>
      </label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const STROKE_STYLES: { value: StrokeStyle; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'dashdotted', label: 'Dash-dot' },
  { value: 'none', label: 'No line' },
];

const SHADINGS: { value: ShadingKind; label: string }[] = [
  { value: 'none', label: 'Flat fill' },
  { value: 'axis-vertical', label: 'Gradient, top to bottom' },
  { value: 'axis-horizontal', label: 'Gradient, left to right' },
  { value: 'radial', label: 'Gradient, radial' },
];

const ROUTINGS: { value: RoutingKind; label: string }[] = [
  { value: 'straight', label: 'Straight' },
  { value: 'orthogonal', label: 'Elbow' },
  { value: 'rounded-orthogonal', label: 'Elbow, rounded' },
  { value: 'curved', label: 'Curved' },
  { value: 'bezier', label: 'Bezier' },
  { value: 'zigzag', label: 'Zig-zag' },
  { value: 'polyline', label: 'Polyline' },
];

const ARROWS: { value: ArrowHead; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'stealth', label: 'Stealth' },
  { value: 'latex', label: 'LaTeX' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'open-triangle', label: 'Open triangle' },
  { value: 'bar', label: 'Bar' },
  { value: 'circle', label: 'Circle' },
  { value: 'diamond', label: 'Diamond' },
];

/* ----------------------------------------------------------------- panes */

function ShapePane({ nodes }: { nodes: Node[] }) {
  const commit = useEditor((s) => s.commit);
  const updateNodeStyle = useEditor((s) => s.updateNodeStyle);
  const updateTextStyle = useEditor((s) => s.updateTextStyle);
  const ids = nodes.map((n) => n.id);
  const first = nodes[0];
  const many = nodes.length > 1;
  const def = getShapeDef(first.kind);

  const patchNodes = (fn: (n: Node) => void) =>
    commit((d) => {
      for (const id of ids) {
        const n = d.nodes[id];
        if (n) fn(n);
      }
    });

  return (
    <>
      <div className="inspector-head">
        <span className="eyebrow">{many ? `${nodes.length} shapes` : def.label}</span>
        <h3>{many ? 'Batch edit' : first.id}</h3>
        {def.note && !many && <p className="note">{def.note}</p>}
      </div>

      {!many && (
        <section>
          <h4>Text</h4>
          <div className="field">
            <label>Content</label>
            <textarea
              rows={3}
              value={first.text}
              placeholder="Type here or double-click the shape"
              onChange={(e) => patchNodes((n) => void (n.text = e.target.value))}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
        </section>
      )}

      <section>
        <h4>Geometry</h4>
        <div className="grid-2">
          <NumberField
            label="X"
            value={first.x}
            onChange={(v) => patchNodes((n) => void (n.x = v))}
          />
          <NumberField
            label="Y"
            value={first.y}
            onChange={(v) => patchNodes((n) => void (n.y = v))}
          />
          <NumberField
            label="Width"
            value={first.w}
            min={4}
            onChange={(v) => patchNodes((n) => void (n.w = Math.max(4, v)))}
          />
          <NumberField
            label="Height"
            value={first.h}
            min={4}
            onChange={(v) => patchNodes((n) => void (n.h = Math.max(4, v)))}
          />
          <NumberField
            label="Rotation"
            value={first.rotation}
            step={5}
            suffix="deg"
            onChange={(v) => patchNodes((n) => void (n.rotation = v))}
          />
          {def.roundable && (
            <NumberField
              label="Corner radius"
              value={first.style.cornerRadius}
              min={0}
              onChange={(v) => updateNodeStyle(ids, { cornerRadius: Math.max(0, v) })}
            />
          )}
        </div>
      </section>

      <section>
        <h4>Fill and border</h4>
        <ColorField
          label="Fill"
          value={first.style.fill}
          onChange={(hex) => updateNodeStyle(ids, { fill: hex })}
        />
        <SelectField
          label="Shading"
          value={first.style.shading}
          options={SHADINGS}
          onChange={(v) => updateNodeStyle(ids, { shading: v })}
        />
        {first.style.shading !== 'none' && (
          <ColorField
            label="Gradient to"
            value={first.style.shadingColor}
            onChange={(hex) => updateNodeStyle(ids, { shadingColor: hex })}
          />
        )}
        <ColorField
          label="Border"
          value={first.style.stroke}
          onChange={(hex) => updateNodeStyle(ids, { stroke: hex })}
        />
        <div className="grid-2">
          <NumberField
            label="Border width"
            value={first.style.strokeWidth}
            step={0.2}
            min={0}
            onChange={(v) => updateNodeStyle(ids, { strokeWidth: Math.max(0, v) })}
          />
          <SelectField
            label="Border style"
            value={first.style.strokeStyle}
            options={STROKE_STYLES}
            onChange={(v) => updateNodeStyle(ids, { strokeStyle: v })}
          />
        </div>
        <SliderField
          label="Fill opacity"
          value={first.style.fillOpacity}
          onChange={(v) => updateNodeStyle(ids, { fillOpacity: v })}
        />
        <SliderField
          label="Border opacity"
          value={first.style.strokeOpacity}
          onChange={(v) => updateNodeStyle(ids, { strokeOpacity: v })}
        />
        <SliderField
          label="Overall opacity"
          value={first.style.opacity}
          onChange={(v) => updateNodeStyle(ids, { opacity: v })}
        />
        <label className="checkline">
          <input
            type="checkbox"
            checked={first.style.shadow}
            onChange={(e) => updateNodeStyle(ids, { shadow: e.target.checked })}
          />
          Drop shadow
        </label>
      </section>

      <section>
        <h4>Typography</h4>
        <ColorField
          label="Text colour"
          value={first.textStyle.color}
          onChange={(hex) => updateTextStyle(ids, { color: hex })}
        />
        <div className="grid-2">
          <NumberField
            label="Size"
            value={first.textStyle.fontSize}
            min={1}
            onChange={(v) => updateTextStyle(ids, { fontSize: Math.max(1, v) })}
          />
          <SelectField
            label="Family"
            value={first.textStyle.fontFamily}
            options={[
              { value: 'sans', label: 'Sans serif' },
              { value: 'serif', label: 'Serif' },
              { value: 'mono', label: 'Monospace' },
            ]}
            onChange={(v) => updateTextStyle(ids, { fontFamily: v })}
          />
        </div>
        <div className="button-row">
          {(['bold', 'italic', 'underline'] as const).map((k) => (
            <button
              key={k}
              className={`btn tiny${first.textStyle[k] ? ' on' : ''}`}
              onClick={() => updateTextStyle(ids, { [k]: !first.textStyle[k] } as never)}
            >
              {k === 'bold' ? 'B' : k === 'italic' ? 'I' : 'U'}
            </button>
          ))}
          <span className="divider-v" />
          {(['left', 'center', 'right'] as const).map((a) => (
            <button
              key={a}
              className={`btn tiny${first.textStyle.align === a ? ' on' : ''}`}
              onClick={() => updateTextStyle(ids, { align: a })}
            >
              {a[0].toUpperCase()}
            </button>
          ))}
          <span className="divider-v" />
          {(['top', 'middle', 'bottom'] as const).map((a) => (
            <button
              key={a}
              className={`btn tiny${first.textStyle.valign === a ? ' on' : ''}`}
              onClick={() => updateTextStyle(ids, { valign: a })}
            >
              {a[0].toUpperCase()}
            </button>
          ))}
        </div>
        <NumberField
          label="Wrap width (0 = off)"
          value={first.textStyle.wrapWidth}
          min={0}
          onChange={(v) => updateTextStyle(ids, { wrapWidth: Math.max(0, v) })}
        />
      </section>

      <section>
        <h4>Object</h4>
        <label className="checkline">
          <input
            type="checkbox"
            checked={first.locked}
            onChange={(e) => patchNodes((n) => void (n.locked = e.target.checked))}
          />
          Locked
        </label>
      </section>
      {!many && <ImportedFrom meta={first.meta} />}
    </>
  );
}

function EdgePane({ edges }: { edges: Edge[] }) {
  const commit = useEditor((s) => s.commit);
  const ids = edges.map((e) => e.id);
  const first = edges[0];
  const many = edges.length > 1;

  const patch = (fn: (e: Edge) => void) =>
    commit((d) => {
      for (const id of ids) {
        const e = d.edges[id];
        if (e) fn(e);
      }
    });

  const label = first.label ?? {
    text: '',
    pos: 0.5,
    offset: -10,
    fontSize: 12,
    color: '#12161c',
    background: true,
  };

  return (
    <>
      <div className="inspector-head">
        <span className="eyebrow">{many ? `${edges.length} connectors` : 'Connector'}</span>
        <h3>{many ? 'Batch edit' : first.id}</h3>
      </div>

      <section>
        <h4>Route</h4>
        <SelectField
          label="Style"
          value={first.routing}
          options={ROUTINGS}
          onChange={(v) => patch((e) => void (e.routing = v))}
        />
        {(first.routing === 'curved' || first.routing === 'bezier') && (
          <NumberField
            label="Curvature"
            value={first.bend}
            step={5}
            onChange={(v) => patch((e) => void (e.bend = v))}
          />
        )}
        {first.routing === 'rounded-orthogonal' && (
          <NumberField
            label="Corner radius"
            value={first.cornerRadius}
            min={0}
            onChange={(v) => patch((e) => void (e.cornerRadius = Math.max(0, v)))}
          />
        )}
        {first.waypoints.length > 0 && (
          <button
            className="btn tiny"
            onClick={() => patch((e) => void (e.waypoints = []))}
          >
            Clear {first.waypoints.length} waypoints
          </button>
        )}
      </section>

      <section>
        <h4>Line</h4>
        <ColorField
          label="Colour"
          value={first.stroke}
          onChange={(hex) => patch((e) => void (e.stroke = hex))}
        />
        <div className="grid-2">
          <NumberField
            label="Width"
            value={first.strokeWidth}
            step={0.2}
            min={0.1}
            onChange={(v) => patch((e) => void (e.strokeWidth = Math.max(0.1, v)))}
          />
          <SelectField
            label="Style"
            value={first.strokeStyle}
            options={STROKE_STYLES}
            onChange={(v) => patch((e) => void (e.strokeStyle = v))}
          />
        </div>
        <SliderField
          label="Opacity"
          value={first.strokeOpacity}
          onChange={(v) => patch((e) => void (e.strokeOpacity = v))}
        />
      </section>

      <section>
        <h4>Arrowheads</h4>
        <div className="grid-2">
          <SelectField
            label="Start"
            value={first.arrowStart}
            options={ARROWS}
            onChange={(v) => patch((e) => void (e.arrowStart = v))}
          />
          <SelectField
            label="End"
            value={first.arrowEnd}
            options={ARROWS}
            onChange={(v) => patch((e) => void (e.arrowEnd = v))}
          />
        </div>
        <NumberField
          label="Arrow size"
          value={first.arrowSize}
          min={1}
          onChange={(v) => patch((e) => void (e.arrowSize = Math.max(1, v)))}
        />
      </section>

      <section>
        <h4>Label</h4>
        <div className="field">
          <label>Text</label>
          <input
            value={label.text}
            placeholder="Yes / No / condition"
            onChange={(e) =>
              patch((edge) => {
                edge.label = { ...label, text: e.target.value };
              })
            }
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <div className="button-row">
          {['Yes', 'No', 'True', 'False'].map((quick) => (
            <button
              key={quick}
              className="btn tiny"
              onClick={() => patch((edge) => void (edge.label = { ...label, text: quick }))}
            >
              {quick}
            </button>
          ))}
        </div>
        <div className="grid-2">
          <NumberField
            label="Position"
            value={label.pos}
            step={0.05}
            min={0}
            max={1}
            onChange={(v) =>
              patch((edge) => void (edge.label = { ...label, pos: Math.min(1, Math.max(0, v)) }))
            }
          />
          <NumberField
            label="Offset"
            value={label.offset}
            step={2}
            onChange={(v) => patch((edge) => void (edge.label = { ...label, offset: v }))}
          />
        </div>
        <div className="grid-2">
          <NumberField
            label="Size"
            value={label.fontSize}
            min={1}
            onChange={(v) => patch((edge) => void (edge.label = { ...label, fontSize: v }))}
          />
          <div className="field">
            <label>Plate</label>
            <label className="checkline">
              <input
                type="checkbox"
                checked={label.background}
                onChange={(e) =>
                  patch((edge) => void (edge.label = { ...label, background: e.target.checked }))
                }
              />
              Opaque backing
            </label>
          </div>
        </div>
        <ColorField
          label="Label colour"
          value={label.color}
          onChange={(hex) => patch((edge) => void (edge.label = { ...label, color: hex }))}
        />
      </section>
      {!many && <ImportedFrom meta={first.meta} />}
    </>
  );
}

function CanvasPane() {
  const doc = useEditor((s) => s.doc);
  const updateSettings = useEditor((s) => s.updateSettings);
  const commit = useEditor((s) => s.commit);

  return (
    <>
      <div className="inspector-head">
        <span className="eyebrow">Nothing selected</span>
        <h3>Canvas</h3>
        <p className="note">
          Select a shape or connector to edit it. These settings apply to the whole
          diagram.
        </p>
      </div>
      <section>
        <h4>Document</h4>
        <div className="field">
          <label>Name</label>
          <input
            value={doc.name}
            onChange={(e) => commit((d) => void (d.name = e.target.value))}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
      </section>
      <section>
        <h4>Grid</h4>
        <NumberField
          label="Grid size"
          value={doc.settings.gridSize}
          min={2}
          onChange={(v) => updateSettings({ gridSize: Math.max(2, v) })}
        />
        <label className="checkline">
          <input
            type="checkbox"
            checked={doc.settings.showGrid}
            onChange={(e) => updateSettings({ showGrid: e.target.checked })}
          />
          Show grid
        </label>
        <label className="checkline">
          <input
            type="checkbox"
            checked={doc.settings.snapToGrid}
            onChange={(e) => updateSettings({ snapToGrid: e.target.checked })}
          />
          Snap to grid
        </label>
        <label className="checkline">
          <input
            type="checkbox"
            checked={doc.settings.snapToObjects}
            onChange={(e) => updateSettings({ snapToObjects: e.target.checked })}
          />
          Snap to other shapes
        </label>
      </section>
      <section>
        <h4>Export background</h4>
        <label className="checkline">
          <input
            type="checkbox"
            checked={isTransparentBackground(doc.settings.background)}
            onChange={(e) => updateSettings({ background: e.target.checked ? 'none' : '#ffffff' })}
          />
          Transparent (SVG and PNG export)
        </label>
        {!isTransparentBackground(doc.settings.background) && (
          <ColorField
            label="Background colour"
            value={doc.settings.background || '#ffffff'}
            onChange={(hex) => updateSettings({ background: hex })}
          />
        )}
      </section>
      <section>
        <h4>LaTeX scale</h4>
        <NumberField
          label="Units per centimetre"
          value={doc.settings.unitsPerCm}
          min={5}
          step={5}
          onChange={(v) => updateSettings({ unitsPerCm: Math.max(5, v) })}
        />
        <p className="note">
          Lower values make the compiled figure larger. At {doc.settings.unitsPerCm}{' '}
          units/cm a {doc.settings.unitsPerCm * 3}-unit shape prints 3 cm wide.
        </p>
      </section>
    </>
  );
}

export function PropertyInspector() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);

  const nodes = selection.map((id) => doc.nodes[id]).filter(Boolean) as Node[];
  const edges = selection.map((id) => doc.edges[id]).filter(Boolean) as Edge[];

  return (
    <aside className="inspector" aria-label="Properties">
      {nodes.length > 0 && edges.length === 0 && <ShapePane nodes={nodes} />}
      {edges.length > 0 && nodes.length === 0 && <EdgePane edges={edges} />}
      {nodes.length > 0 && edges.length > 0 && (
        <>
          <div className="inspector-head">
            <span className="eyebrow">Mixed selection</span>
            <h3>
              {nodes.length} shapes, {edges.length} connectors
            </h3>
            <p className="note">
              Shapes and connectors share no editable properties. Select one kind at a
              time to edit, or use the alignment and order tools in the toolbar.
            </p>
          </div>
        </>
      )}
      {selection.length === 0 && <CanvasPane />}
    </aside>
  );
}
