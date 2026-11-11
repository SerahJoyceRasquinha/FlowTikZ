import { useEditor } from '../../state/store';
import type { Node } from '../../model/types';
import { getShapeDef } from '../../model/shapes';
import { ColorField } from '../ColorField';
import { Icon } from '../Icon';
import { CIRCUIT_BY_ID, isCircuitKind } from '../../science/physics/circuits';
import type { CircuitSpec } from '../../science/types';
import { emptyCircuitSpec } from '../../science/types';
import { openScienceEditor, sizeForFont } from '../../science/editing';
import { effectiveFontSize } from '../../latex/science';
import { unicodeToTex } from '../../science/math/validate';
import { moleculeNaturalSize } from '../../science/chem/molecule';

/**
 * Inspector pane for a selected formula, molecule or component. It writes the
 * same style fields as every other shape and uses the existing field styles.
 */

const stop = (e: React.KeyboardEvent) => e.stopPropagation();

function Num({ label, value, step = 1, min, onChange }: { label: string; value: number; step?: number; min?: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="num-row">
        <input
          type="number"
          aria-label={label}
          value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
          step={step}
          min={min}
          onKeyDown={stop}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(min !== undefined ? Math.max(min, v) : v);
          }}
        />
      </div>
    </div>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <label>{label} <span className="value">{Math.round(value * 100)}%</span></label>
      <input type="range" aria-label={label} min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function isSciencePaneNode(n: Node): boolean {
  return !!n.science && n.science.type !== undefined;
}

export function SciencePane({ nodes }: { nodes: Node[] }) {
  const commit = useEditor((s) => s.commit);
  const updateNodeStyle = useEditor((s) => s.updateNodeStyle);
  const updateTextStyle = useEditor((s) => s.updateTextStyle);
  const rotateBy = useEditor((s) => s.rotateSelectionBy);
  const flip = useEditor((s) => s.flipSelection);

  const ids = nodes.map((n) => n.id);
  const first = nodes[0];
  const many = nodes.length > 1;
  const def = getShapeDef(first.kind);
  const circuit = isCircuitKind(first.kind);
  const circuitDef = CIRCUIT_BY_ID[first.kind];
  const isMolecule = first.science?.type === 'molecule';
  const isTypeset = first.science?.type === 'math' || first.science?.type === 'chem';
  const canFlip = isMolecule || !!def.flippable;
  const sameKind = nodes.every((n) => n.kind === first.kind);

  const patchNodes = (fn: (n: Node) => void) =>
    commit((d) => {
      for (const id of ids) {
        const n = d.nodes[id];
        if (n) fn(n);
      }
    });

  const patchCircuit = (patch: Partial<CircuitSpec>) =>
    patchNodes((n) => {
      if (!isCircuitKind(n.kind)) return;
      const cur = n.science?.type === 'circuit' ? n.science : emptyCircuitSpec();
      n.science = { ...cur, ...patch };
    });

  const spec = first.science?.type === 'circuit' ? first.science : emptyCircuitSpec();

  const circuitField = (label: string, key: 'label' | 'value' | 'voltage' | 'current', hint: string) => (
    <div className="field">
      <label>{label}</label>
      <input
        value={spec[key]}
        placeholder={hint}
        aria-label={label}
        spellCheck={false}
        data-field={key === 'label' ? 'circuit-label' : undefined}
        onKeyDown={stop}
        onChange={(e) => patchCircuit({ [key]: unicodeToTex(e.target.value) } as Partial<CircuitSpec>)}
      />
    </div>
  );

  const sizeNow = isTypeset
    ? effectiveFontSize(first, first.science?.type === 'math' || first.science?.type === 'chem' ? first.science.natural : null)
    : first.textStyle.fontSize;

  const setFormulaFont = (v: number) =>
    patchNodes((n) => {
      if (n.science?.type !== 'math' && n.science?.type !== 'chem') return;
      n.textStyle.fontSize = v;
      if (n.science.natural) {
        const size = sizeForFont(n.science.natural, v);
        n.x += (n.w - size.w) / 2;
        n.y += (n.h - size.h) / 2;
        n.w = size.w;
        n.h = size.h;
      }
    });

  const moleculeScale = isMolecule && first.science?.type === 'molecule' ? first.w / moleculeNaturalSize(first.science).w : 1;

  return (
    <>
      <div className="inspector-head">
        <span className="eyebrow">{many ? `${nodes.length} objects` : def.label}</span>
        <h3 title={`Object id ${first.id} (used in the LaTeX comments)`}>{many ? 'Batch edit' : `${def.label} ${first.id}`}</h3>
        {def.note && !many && <p className="note">{def.note}</p>}
        {!many && (first.science?.type === 'math' || first.science?.type === 'chem' || isMolecule) && (
          <button className="btn tiny" onClick={() => openScienceEditor(first)} data-action="edit-science">
            <Icon name="text" size={15} /> Edit content
          </button>
        )}
      </div>

      {circuit && !many && circuitDef && (
        <section>
          <h4>Labels</h4>
          {circuitField('Name', 'label', 'R_1')}
          {circuitField('Value', 'value', '10\\,\\mathrm{k\\Omega}')}
          {circuitDef.mode === 'bipole' && circuitField('Voltage', 'voltage', 'V_1')}
          {circuitDef.mode === 'bipole' && circuitField('Current', 'current', 'I_1')}
          {circuitDef.mode === 'bipole' && spec.current && (
            <div className="field">
              <label>Current direction</label>
              <select aria-label="Current direction" value={spec.currentDir} onKeyDown={stop} onChange={(e) => patchCircuit({ currentDir: e.target.value as CircuitSpec['currentDir'] })}>
                <option value="forward">Left to right</option>
                <option value="backward">Right to left</option>
              </select>
            </div>
          )}
          <p className="note">Written as LaTeX maths, for example R_1 or 10\,\mathrm{'{k\\Omega}'}.</p>
        </section>
      )}

      <section>
        <h4>Geometry</h4>
        <div className="grid-2">
          <Num label="X" value={first.x} onChange={(v) => patchNodes((n) => void (n.x = v))} />
          <Num label="Y" value={first.y} onChange={(v) => patchNodes((n) => void (n.y = v))} />
          <Num label="Width" value={first.w} min={4} onChange={(v) => patchNodes((n) => void (n.w = v))} />
          <Num label="Height" value={first.h} min={4} onChange={(v) => patchNodes((n) => void (n.h = v))} />
          <Num label="Rotation" value={first.rotation} step={15} onChange={(v) => patchNodes((n) => void (n.rotation = v))} />
        </div>
        <div className="button-row">
          <button className="btn tiny" onClick={() => rotateBy(90)} title="Turn clockwise by 90 degrees">Rotate 90°</button>
          {canFlip && (
            <>
              <button className="btn tiny" onClick={() => flip('h')} title="Mirror left to right">Flip ↔</button>
              <button className="btn tiny" onClick={() => flip('v')} title="Mirror top to bottom">Flip ↕</button>
            </>
          )}
        </div>
        {isMolecule && <p className="note">Scale {Math.round(moleculeScale * 100)}%: drag a corner to resize.</p>}
      </section>

      <section>
        <h4>{circuit || isMolecule ? 'Line and fill' : 'Background and border'}</h4>
        <ColorField label={circuit ? 'Line colour' : isMolecule ? 'Bond colour' : 'Border'} value={first.style.stroke} onChange={(hex) => updateNodeStyle(ids, { stroke: hex })} />
        {!isMolecule && <ColorField label={circuit ? 'Symbol fill' : 'Background'} value={first.style.fill} onChange={(hex) => updateNodeStyle(ids, { fill: hex, fillOpacity: first.style.fillOpacity || 1 })} />}
        <div className="grid-2">
          <Num label={circuit ? 'Line width' : isMolecule ? 'Bond width' : 'Border width'} value={first.style.strokeWidth} step={0.2} min={0} onChange={(v) => updateNodeStyle(ids, { strokeWidth: v })} />
          {isTypeset && (
            <div className="field">
              <label>Border</label>
              <select aria-label="Border" value={first.style.strokeStyle === 'none' ? 'none' : 'solid'} onKeyDown={stop} onChange={(e) => updateNodeStyle(ids, { strokeStyle: e.target.value as 'none' | 'solid' })}>
                <option value="none">None</option>
                <option value="solid">Solid</option>
              </select>
            </div>
          )}
        </div>
        {!isMolecule && <Slider label={circuit ? 'Symbol fill opacity' : 'Background opacity'} value={first.style.fillOpacity} onChange={(v) => updateNodeStyle(ids, { fillOpacity: v })} />}
        <Slider label="Overall opacity" value={first.style.opacity} onChange={(v) => updateNodeStyle(ids, { opacity: v })} />
      </section>

      <section>
        <h4>{isMolecule ? 'Atom labels' : circuit ? 'Label text' : 'Formula text'}</h4>
        <ColorField label="Colour" value={first.textStyle.color} onChange={(hex) => updateTextStyle(ids, { color: hex })} />
        {isTypeset && sameKind && <Num label="Font size" value={sizeNow} min={4} onChange={setFormulaFont} />}
        {isMolecule && <Num label="Font size" value={first.textStyle.fontSize} min={4} onChange={(v) => updateTextStyle(ids, { fontSize: v })} />}
        {isTypeset && (
          <div className="button-row">
            <button className={`btn tiny${first.textStyle.bold ? ' on' : ''}`} onClick={() => updateTextStyle(ids, { bold: !first.textStyle.bold })} title="Bold (uses \boldsymbol)">B</button>
          </div>
        )}
        {isTypeset && <p className="note">Maths keeps its LaTeX fonts, so colour, size and bold apply. Use Colour part in the editor to colour a single term.</p>}
      </section>

      <section>
        <h4>Object</h4>
        <label className="checkline">
          <input type="checkbox" checked={first.locked} onChange={(e) => patchNodes((n) => void (n.locked = e.target.checked))} />
          Locked
        </label>
      </section>
    </>
  );
}
