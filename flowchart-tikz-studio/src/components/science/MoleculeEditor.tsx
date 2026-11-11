import { useCallback, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../state/store';
import { useDialogFocus } from './useDialogFocus';
import { Icon } from '../Icon';
import { MoleculeDrawing } from '../../canvas/ScienceView';
import type { BondOrder, BondStereo, MolAtom, MolBond, MoleculeSpec } from '../../science/types';
import {
  FUNCTIONAL_GROUPS,
  MOLECULE_TEMPLATES,
  emptyMolecule,
  freeDirection,
  fromBlueprint,
  makeAtom,
  mirrorMolecule,
  molId,
  moleculeNaturalSize,
  rotateMolecule,
} from '../../science/chem/molecule';
import { validAtomLabel } from '../../science/chem/chemfig';
import { viewCentre } from '../../science/editing';

/**
 * Structure editor: click and drag on a small sheet to place atoms and bonds.
 * It edits the same `MoleculeSpec` the canvas draws and the generator writes.
 */

type Tool =
  | { kind: 'atom' }
  | { kind: 'bond'; order: BondOrder; stereo: BondStereo }
  | { kind: 'erase' }
  | { kind: 'move' }
  | { kind: 'charge'; delta: 1 | -1 }
  | { kind: 'lone' }
  | { kind: 'radical' }
  | { kind: 'group'; id: string };

const SHEET = { w: 620, h: 340 };
const UNIT = 44; // sheet pixels per bond length
const QUICK_ATOMS = ['C', 'H', 'O', 'N', 'S', 'P', 'F', 'Cl', 'Br', 'I'];
const BONDS: { label: string; title: string; order: BondOrder; stereo: BondStereo; art: string }[] = [
  { label: 'Single', title: 'Single bond', order: 1, stereo: 'none', art: 'M3 11H21' },
  { label: 'Double', title: 'Double bond', order: 2, stereo: 'none', art: 'M3 9H21M3 14H21' },
  { label: 'Triple', title: 'Triple bond', order: 3, stereo: 'none', art: 'M3 7H21M3 12H21M3 17H21' },
  { label: 'Wedge', title: 'Wedge bond (towards you)', order: 1, stereo: 'wedge', art: 'M3 12L21 7V17Z' },
  { label: 'Dash', title: 'Dashed wedge (away from you)', order: 1, stereo: 'dash', art: 'M4 11V13M8 10V14M12 9V15M16 8V16M20 7V17' },
];

const clone = (m: MoleculeSpec): MoleculeSpec => JSON.parse(JSON.stringify(m));
const SNAP = 0.25;
const snapCoord = (v: number) => Math.round(v / SNAP) * SNAP;

export function MoleculeEditor({ nodeId }: { nodeId?: string }) {
  const close = useEditor((s) => s.openScienceDialog);
  const node = useEditor((s) => (nodeId ? s.doc.nodes[nodeId] : undefined));
  const insertScience = useEditor((s) => s.insertScience);
  const updateScience = useEditor((s) => s.updateScience);
  const setStatus = useEditor((s) => s.setStatus);
  const existing = node?.science?.type === 'molecule' ? node.science : null;

  const [mol, setMol] = useState<MoleculeSpec>(() => (existing ? clone(existing) : emptyMolecule()));
  const [past, setPast] = useState<MoleculeSpec[]>([]);
  const [future, setFuture] = useState<MoleculeSpec[]>([]);
  const [tool, setTool] = useState<Tool>({ kind: 'bond', order: 1, stereo: 'none' });
  const [element, setElement] = useState('C');
  const [custom, setCustom] = useState('');
  const [selectedAtom, setSelectedAtom] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ from: MolAtom | { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { ref: focusRef, onTab } = useDialogFocus();
  const gesture = useRef<{ type: 'bond' | 'move'; atom: string | null; start: { x: number; y: number }; moved: boolean } | null>(null);

  const commit = useCallback(
    (next: MoleculeSpec) => {
      setPast((p) => [...p, mol].slice(-100));
      setFuture([]);
      setMol(next);
    },
    [mol],
  );

  /* The sheet shows molecule coordinates directly, centred on the origin. */
  const toSheet = (x: number, y: number) => ({ x: SHEET.w / 2 + x * UNIT, y: SHEET.h / 2 + y * UNIT });
  const fromEvent = (e: React.PointerEvent | React.MouseEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    const sx = r && r.width > 0 ? SHEET.w / r.width : 1;
    const sy = r && r.height > 0 ? SHEET.h / r.height : 1;
    const px = (e.clientX - (r?.left ?? 0)) * sx;
    const py = (e.clientY - (r?.top ?? 0)) * sy;
    return { x: (px - SHEET.w / 2) / UNIT, y: (py - SHEET.h / 2) / UNIT };
  };

  const atomAt = (p: { x: number; y: number }, except?: string) => {
    let best: MolAtom | null = null;
    let d = 0.34;
    for (const a of mol.atoms) {
      if (a.id === except) continue;
      const dist = Math.hypot(a.x - p.x, a.y - p.y);
      if (dist < d) {
        d = dist;
        best = a;
      }
    }
    return best;
  };

  const bondAt = (p: { x: number; y: number }): MolBond | null => {
    const byId = new Map(mol.atoms.map((a) => [a.id, a]));
    let best: MolBond | null = null;
    let d = 0.22;
    for (const b of mol.bonds) {
      const a = byId.get(b.a) as MolAtom;
      const c = byId.get(b.b) as MolAtom;
      const l2 = (c.x - a.x) ** 2 + (c.y - a.y) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * (c.x - a.x) + (p.y - a.y) * (c.y - a.y)) / l2));
      const dist = Math.hypot(p.x - (a.x + (c.x - a.x) * t), p.y - (a.y + (c.y - a.y) * t));
      if (dist < d) {
        d = dist;
        best = b;
      }
    }
    return best;
  };

  /** Where a bond dragged from `from` towards `to` should land: 30° steps. */
  const snapBondEnd = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 6)) * (Math.PI / 6);
    return { x: from.x + Math.cos(angle), y: from.y + Math.sin(angle) };
  };

  const taken = () => new Set([...mol.atoms.map((a) => a.id), ...mol.bonds.map((b) => b.id)]);

  const addSubstituent = (m: MoleculeSpec, atomId: string, label: string, order: BondOrder = 1, stereo: BondStereo = 'none'): void => {
    const ids = new Set([...m.atoms.map((a) => a.id), ...m.bonds.map((b) => b.id)]);
    const self = m.atoms.find((a) => a.id === atomId) as MolAtom;
    const deg = freeDirection(m, atomId);
    const na = makeAtom(molId('a', ids), self.x + Math.cos((deg * Math.PI) / 180), self.y - Math.sin((deg * Math.PI) / 180), label);
    m.atoms.push(na);
    m.bonds.push({ id: molId('b', ids), a: atomId, b: na.id, order, stereo });
  };

  const bondMark = (next: MoleculeSpec, a: string, b: string, t: Extract<Tool, { kind: 'bond' }>) => {
    const ids = taken();
    const ex = next.bonds.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    if (ex) {
      ex.order = t.order;
      ex.stereo = t.stereo;
    } else {
      next.bonds.push({ id: molId('b', ids), a, b, order: t.order, stereo: t.stereo });
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = fromEvent(e);
    const hit = atomAt(p);
    const bond = hit ? null : bondAt(p);

    switch (tool.kind) {
      case 'erase': {
        if (hit) {
          commit({
            ...mol,
            atoms: mol.atoms.filter((a) => a.id !== hit.id),
            bonds: mol.bonds.filter((b) => b.a !== hit.id && b.b !== hit.id),
            aromaticRings: mol.aromaticRings.filter((r) => !r.includes(hit.id)),
          });
        } else if (bond) {
          commit({
            ...mol,
            bonds: mol.bonds.filter((b) => b.id !== bond.id),
            aromaticRings: mol.aromaticRings.filter((r) => !(r.includes(bond.a) && r.includes(bond.b))),
          });
        }
        return;
      }
      case 'atom': {
        const next = clone(mol);
        if (hit) {
          (next.atoms.find((a) => a.id === hit.id) as MolAtom).label = element === 'C' ? '' : element;
        } else {
          const ids = taken();
          next.atoms.push(makeAtom(molId('a', ids), snapCoord(p.x), snapCoord(p.y), element));
        }
        commit(next);
        return;
      }
      case 'charge': {
        if (!hit) return;
        const next = clone(mol);
        const a = next.atoms.find((x) => x.id === hit.id) as MolAtom;
        a.charge = Math.max(-4, Math.min(4, a.charge + tool.delta));
        commit(next);
        return;
      }
      case 'lone':
      case 'radical': {
        if (!hit) return;
        const next = clone(mol);
        const a = next.atoms.find((x) => x.id === hit.id) as MolAtom;
        const list = tool.kind === 'lone' ? a.lonePairs : a.radicals;
        if (list.length >= 4) list.length = 0;
        else {
          const free = [90, 270, 180, 0, 45, 135, 225, 315].find((d) => !a.lonePairs.includes(d) && !a.radicals.includes(d));
          list.push(free ?? 90);
        }
        commit(next);
        return;
      }
      case 'group': {
        const g = FUNCTIONAL_GROUPS.find((x) => x.id === tool.id);
        if (!g) return;
        const next = clone(mol);
        if (hit) {
          addSubstituent(next, hit.id, g.label);
        } else {
          next.atoms.push(makeAtom(molId('a', taken()), snapCoord(p.x), snapCoord(p.y), g.label));
        }
        commit(next);
        return;
      }
      case 'move':
        if (hit) {
          setSelectedAtom(hit.id);
          gesture.current = { type: 'move', atom: hit.id, start: p, moved: false };
          setPast((old) => [...old, mol].slice(-100));
          setFuture([]);
        } else {
          setSelectedAtom(null);
        }
        return;
      case 'bond': {
        if (bond) {
          // Clicking an existing bond applies this bond type to it.
          const next = clone(mol);
          bondMark(next, bond.a, bond.b, tool);
          commit(next);
          return;
        }
        gesture.current = { type: 'bond', atom: hit?.id ?? null, start: hit ? { x: hit.x, y: hit.y } : { x: snapCoord(p.x), y: snapCoord(p.y) }, moved: false };
        setDraft({ from: gesture.current.start, to: gesture.current.start });
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const p = fromEvent(e);
    if (g.type === 'move' && g.atom) {
      g.moved = true;
      setMol((m) => ({ ...m, atoms: m.atoms.map((a) => (a.id === g.atom ? { ...a, x: snapCoord(p.x), y: snapCoord(p.y) } : a)) }));
    } else if (g.type === 'bond') {
      if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > 0.25) g.moved = true;
      const over = atomAt(p, g.atom ?? undefined);
      setDraft({ from: g.start, to: over ?? snapBondEnd(g.start, p) });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    setDraft(null);
    if (!g || g.type !== 'bond' || tool.kind !== 'bond') return;
    const p = fromEvent(e);
    const next = clone(mol);
    const ids = new Set([...next.atoms.map((a) => a.id), ...next.bonds.map((b) => b.id)]);
    let from = g.atom;
    if (!from) {
      const a = makeAtom(molId('a', ids), g.start.x, g.start.y, '');
      next.atoms.push(a);
      from = a.id;
    }
    let to: string;
    const over = g.moved ? atomAt(p, g.atom ?? undefined) : null;
    if (!g.moved) {
      // A click with no drag grows a bond in the most open direction.
      const deg = freeDirection(next, from);
      const self = next.atoms.find((a) => a.id === from) as MolAtom;
      const a = makeAtom(molId('a', ids), self.x + Math.cos((deg * Math.PI) / 180), self.y - Math.sin((deg * Math.PI) / 180), '');
      next.atoms.push(a);
      to = a.id;
    } else if (over) {
      to = over.id;
    } else {
      const end = snapBondEnd(g.start, p);
      const a = makeAtom(molId('a', ids), Math.round(end.x * 1e4) / 1e4, Math.round(end.y * 1e4) / 1e4, '');
      next.atoms.push(a);
      to = a.id;
    }
    if (from !== to) {
      const ex = next.bonds.find((x) => (x.a === from && x.b === to) || (x.a === to && x.b === from));
      if (ex) {
        ex.order = tool.order;
        ex.stereo = tool.stereo;
      } else {
        next.bonds.push({ id: molId('b', ids), a: from, b: to, order: tool.order, stereo: tool.stereo });
      }
    }
    commit(next);
  };

  const undo = () => {
    const last = past[past.length - 1];
    if (!last) return;
    setFuture((f) => [mol, ...f]);
    setPast((p) => p.slice(0, -1));
    setMol(last);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setPast((p) => [...p, mol]);
    setFuture((f) => f.slice(1));
    setMol(next);
  };

  const applyTemplate = (id: string) => {
    const t = MOLECULE_TEMPLATES.find((x) => x.id === id);
    if (t) commit(fromBlueprint(t.blueprint));
  };

  const align = () => commit({ ...mol, atoms: mol.atoms.map((a) => ({ ...a, x: snapCoord(a.x), y: snapCoord(a.y) })) });

  const selected = mol.atoms.find((a) => a.id === selectedAtom) ?? null;
  const patchSelected = (patch: Partial<MolAtom>) => commit({ ...mol, atoms: mol.atoms.map((a) => (a.id === selectedAtom ? { ...a, ...patch } : a)) });

  const finish = () => {
    if (mol.atoms.length === 0) return;
    const nat = moleculeNaturalSize(mol);
    if (nodeId && node) {
      const oldNat = existing ? moleculeNaturalSize(existing) : nat;
      const k = Math.min(node.w / oldNat.w, node.h / oldNat.h);
      updateScience(nodeId, mol, { w: nat.w * k, h: nat.h * k });
      setStatus('Molecule updated.');
    } else {
      insertScience('molecule', mol, nat, viewCentre());
      setStatus('Molecule inserted. Double-click it to edit.');
    }
    close(null);
  };

  const invalidLabel = mol.atoms.find((a) => !validAtomLabel(a.label));

  const toolBtn = (t: Tool, title: string, label: React.ReactNode, active: boolean, key: string) => (
    <button key={key} type="button" className={`btn tiny${active ? ' on' : ''}`} title={title} aria-pressed={active} onClick={() => setTool(t)}>
      {label}
    </button>
  );

  /* Draw through MoleculeDrawing on a box that maps 1:1 onto the sheet. */
  const sheetSpec = useMemo<MoleculeSpec>(() => mol, [mol]);
  const offset = useMemo(() => {
    if (!mol.atoms.length) return { sx: 0, sy: 0 };
    const xs = mol.atoms.map((a) => a.x);
    const ys = mol.atoms.map((a) => a.y);
    return { sx: ((Math.min(...xs) + Math.max(...xs)) / 2) * UNIT, sy: ((Math.min(...ys) + Math.max(...ys)) / 2) * UNIT };
  }, [mol.atoms]);
  const nat = moleculeNaturalSize(mol);
  const boxW = (nat.w / 34) * UNIT;
  const boxH = (nat.h / 34) * UNIT;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(null)}>
      <div
        className="modal sci-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Molecule editor"
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
            <h2>{nodeId ? 'Edit molecule' : 'New molecule'}</h2>
          </div>
          <div className="sci-head-tools">
            <button className="btn icon-only" onClick={() => close(null)} aria-label="Close" title="Close (Esc)"><Icon name="x" /></button>
          </div>
        </header>

        <div className="mol-tools" role="toolbar" aria-label="Structure tools">
          <div className="mol-tool-group">
            <span className="note">Bonds</span>
            {BONDS.map((b) =>
              toolBtn(
                { kind: 'bond', order: b.order, stereo: b.stereo },
                `${b.title}. Drag on the sheet, or click an existing bond to change it.`,
                <svg width="24" height="20" viewBox="0 0 24 24" aria-label={b.label}><path d={b.art} stroke="currentColor" strokeWidth="1.8" fill={b.stereo === 'wedge' ? 'currentColor' : 'none'} /></svg>,
                tool.kind === 'bond' && tool.order === b.order && tool.stereo === b.stereo,
                b.label,
              ),
            )}
          </div>
          <div className="mol-tool-group">
            <span className="note">Atom</span>
            {QUICK_ATOMS.map((el) => (
              <button key={el} type="button" className={`btn tiny${tool.kind === 'atom' && element === el ? ' on' : ''}`} title={`Place ${el}, or click an atom to change it`} onClick={() => { setElement(el); setTool({ kind: 'atom' }); }}>
                {el}
              </button>
            ))}
            <input
              className="mol-custom"
              aria-label="Custom atom label"
              placeholder="NH_2"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && custom.trim() && validAtomLabel(custom.trim())) {
                  setElement(custom.trim());
                  setTool({ kind: 'atom' });
                }
              }}
            />
          </div>
          <div className="mol-tool-group">
            <span className="note">Mark</span>
            {toolBtn({ kind: 'charge', delta: 1 }, 'Add a positive charge: click an atom', '⊕', tool.kind === 'charge' && tool.delta === 1, 'plus')}
            {toolBtn({ kind: 'charge', delta: -1 }, 'Add a negative charge: click an atom', '⊖', tool.kind === 'charge' && tool.delta === -1, 'minus')}
            {toolBtn({ kind: 'lone' }, 'Add a lone pair: click an atom repeatedly', '∶ pair', tool.kind === 'lone', 'lone')}
            {toolBtn({ kind: 'radical' }, 'Add an unpaired electron: click an atom', '· dot', tool.kind === 'radical', 'radical')}
            {toolBtn({ kind: 'move' }, 'Move atoms by dragging; click one to style it', 'Move', tool.kind === 'move', 'move')}
            {toolBtn({ kind: 'erase' }, 'Erase: click an atom or a bond', 'Erase', tool.kind === 'erase', 'erase')}
          </div>
        </div>

        <div className="mol-body">
          <div className="mol-side">
            <h4>Common molecules</h4>
            <div className="mol-list">
              {MOLECULE_TEMPLATES.map((t) => (
                <button key={t.id} type="button" className="btn tiny" title={t.keywords} onClick={() => applyTemplate(t.id)}>{t.name}</button>
              ))}
            </div>
            <h4>Functional groups</h4>
            <div className="mol-list">
              {FUNCTIONAL_GROUPS.map((g) => (
                <button key={g.id} type="button" className={`btn tiny${tool.kind === 'group' && tool.id === g.id ? ' on' : ''}`} title={`${g.name}: click an atom to attach it`} onClick={() => setTool({ kind: 'group', id: g.id })}>{g.label.replace(/_/g, '')}</button>
              ))}
            </div>
            {selected && (
              <div className="mol-atom-panel">
                <h4>Selected atom</h4>
                <label>Label
                  <input value={selected.label} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => patchSelected({ label: e.target.value })} />
                </label>
                <label>Colour
                  <input type="color" value={selected.color ?? '#12161c'} onChange={(e) => patchSelected({ color: e.target.value })} />
                </label>
                {selected.color && <button type="button" className="btn tiny" onClick={() => patchSelected({ color: undefined })}>Default colour</button>}
              </div>
            )}
          </div>

          <div className="mol-sheet-wrap">
            <svg
              ref={svgRef}
              className="mol-sheet"
              viewBox={`0 0 ${SHEET.w} ${SHEET.h}`}
              role="application"
              aria-label="Molecule sheet"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <rect width={SHEET.w} height={SHEET.h} fill="#ffffff" />
              {mol.atoms.length > 0 && (
                <g transform={`translate(${SHEET.w / 2 + offset.sx - boxW / 2} ${SHEET.h / 2 + offset.sy - boxH / 2})`}>
                  <MoleculeDrawing spec={sheetSpec} w={boxW} h={boxH} stroke="#1f2933" strokeWidth={1.8} textColor="#12161c" fontSize={19} />
                </g>
              )}
              {mol.atoms.map((a) => {
                const p = toSheet(a.x, a.y);
                return (
                  <circle key={a.id} data-atom={a.id} cx={p.x} cy={p.y} r={a.id === selectedAtom ? 8 : 5.5} fill={a.id === selectedAtom ? 'var(--select)' : 'var(--port)'} fillOpacity={a.id === selectedAtom ? 0.3 : 0.14} />
                );
              })}
              {draft && (() => {
                const a = toSheet(draft.from.x, draft.from.y);
                const b = toSheet(draft.to.x, draft.to.y);
                return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--port)" strokeWidth={2} strokeDasharray="5 4" />;
              })()}
              {mol.atoms.length === 0 && (
                <text x={SHEET.w / 2} y={SHEET.h / 2} textAnchor="middle" fill="#7a8aa0" style={{ fontSize: 14 }}>
                  Click to start a chain, drag to draw a bond, or pick a common molecule.
                </text>
              )}
            </svg>
          </div>
        </div>

        <div className="sci-actions">
          <button className="btn tiny" onClick={undo} disabled={!past.length} title="Undo"><Icon name="undo" size={15} />Undo</button>
          <button className="btn tiny" onClick={redo} disabled={!future.length} title="Redo"><Icon name="redo" size={15} />Redo</button>
          <button className="btn tiny" onClick={() => commit(emptyMolecule())} disabled={!mol.atoms.length}><Icon name="eraser" size={15} />Clear</button>
          <span className="divider-v" />
          <button className="btn tiny" onClick={() => commit(rotateMolecule(mol, 30))} disabled={!mol.atoms.length} title="Rotate 30 degrees">Rotate 30°</button>
          <button className="btn tiny" onClick={() => commit(mirrorMolecule(mol, 'h'))} disabled={!mol.atoms.length}>Flip ↔</button>
          <button className="btn tiny" onClick={() => commit(mirrorMolecule(mol, 'v'))} disabled={!mol.atoms.length}>Flip ↕</button>
          <button className="btn tiny" onClick={align} disabled={!mol.atoms.length} title="Snap every atom to the quarter-bond grid">Align</button>
        </div>

        <footer className="sci-footer">
          <span className={`note${invalidLabel ? ' sci-error' : ''}`}>
            {invalidLabel ? `Atom label "${invalidLabel.label}" has characters chemfig cannot accept.` : 'Empty corners are implicit carbon. The LaTeX uses chemfig.'}
          </span>
          <button className="btn" onClick={() => close(null)}>Cancel</button>
          <button className="btn success" onClick={finish} disabled={mol.atoms.length === 0 || !!invalidLabel} data-action="insert-molecule">{nodeId ? 'Apply changes' : 'Insert molecule'}</button>
        </footer>
      </div>
    </div>
  );
}
