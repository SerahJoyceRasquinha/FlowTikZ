import { memo, useMemo } from 'react';
import type { Node } from '../model/types';
import { chemTex, renderTex, useEngineVersion } from '../science/math/engine';
import { CIRCUIT_BY_ID, bipoleUnit } from '../science/physics/circuits';
import type { MolAtom, MolBond, MoleculeSpec } from '../science/types';
import { emptyCircuitSpec } from '../science/types';
import {
  atomText,
  chargeText,
  findRingCentreForBond,
  parseAtomLabel,
  placeMolecule,
} from '../science/chem/molecule';

/**
 * Canvas views of the typeset and drawn objects. Formulas are the same
 * MathJax paths everywhere: they sit inside the live SVG, so the existing
 * SVG/PNG/PDF exporters need no knowledge of them.
 */

/** Typeset TeX fitted into a box. */
export const TexBox = memo(function TexBox({
  tex,
  display = true,
  x,
  y,
  w,
  h,
  color,
}: {
  tex: string;
  display?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}) {
  useEngineVersion();
  const r = renderTex(tex, display);
  if (!r) {
    return (
      <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="middle" fill={color} opacity={0.45} style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>
        {tex.length > 24 ? `${tex.slice(0, 24)}…` : tex}
      </text>
    );
  }
  if (!r.ok) {
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} fill="#fee2e2" stroke="#dc2626" strokeWidth={1} />
        <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="middle" fill="#b91c1c" style={{ fontSize: 11 }}>
          invalid formula
        </text>
      </g>
    );
  }
  return (
    <svg
      x={x}
      y={y}
      width={w}
      height={h}
      viewBox={r.viewBox.join(' ')}
      preserveAspectRatio="xMidYMid meet"
      overflow="visible"
      color={color}
      pointerEvents="none"
    >
      <g dangerouslySetInnerHTML={{ __html: r.markup }} />
    </svg>
  );
});

export function FormulaContent({ node }: { node: Node }) {
  const sci = node.science;
  if (sci?.type !== 'math' && sci?.type !== 'chem') return null;
  const base = sci.type === 'math' ? sci.latex : chemTex(sci.source);
  const tex = node.textStyle.bold ? `\\boldsymbol{${base}}` : base;
  return <TexBox tex={tex} display={sci.type === 'math' ? sci.display : true} x={0} y={0} w={node.w} h={node.h} color={node.textStyle.color} />;
}

/* --------------------------------------------------------------- circuits */

/** Natural-size TeX placed by its centre, kept upright under rotation. */
function UprightLabel({ tex, cx, cy, size, color, angle }: { tex: string; cx: number; cy: number; size: number; color: string; angle: number }) {
  useEngineVersion();
  const r = renderTex(tex, false);
  const w = r?.ok ? r.natural.w * size : tex.length * size * 0.5;
  const h = r?.ok ? r.natural.h * size : size;
  return (
    <g transform={`rotate(${-angle} ${cx} ${cy})`}>
      <TexBox tex={tex} display={false} x={cx - w / 2} y={cy - h / 2} w={w} h={h} color={color} />
    </g>
  );
}

export const CircuitOverlay = memo(function CircuitOverlay({ node }: { node: Node }) {
  const def = CIRCUIT_BY_ID[node.kind];
  if (!def) return null;
  const spec = node.science?.type === 'circuit' ? node.science : emptyCircuitSpec();
  const { w, h } = node;
  const color = node.textStyle.color;
  const size = 11.5;

  const glyph = def.glyph && def.mode === 'bipole' && (
    <g transform={`rotate(${-node.rotation} ${w / 2} ${h / 2})`}>
      <text x={w / 2} y={h / 2} textAnchor="middle" dominantBaseline="central" fill={node.style.stroke} style={{ fontSize: bipoleUnit(h) * 0.26, fontFamily: 'serif', userSelect: 'none' }}>
        {def.glyph}
      </text>
    </g>
  );

  if (def.mode !== 'bipole') {
    const text = [spec.label.trim(), spec.value.trim()].filter(Boolean).join('=');
    if (!text) return <>{glyph}</>;
    return <UprightLabel tex={text} cx={w + 6 + Math.max(10, text.length * 2.4)} cy={h / 2} size={size} color={color} angle={node.rotation} />;
  }

  const u = bipoleUnit(h);
  const half = Math.max(((def.body ?? 0.8) * u) / 2, 0);
  const rise = Math.max(0.3 * u, 10) + 9;
  // Text stays on the visually upper side of the component.
  const a = ((node.rotation % 360) + 360) % 360;
  const upper = a > 90 && a <= 270 ? 1 : -1;
  const label = spec.label.trim();
  const value = spec.value.trim();
  const voltage = spec.voltage.trim();
  const current = spec.current.trim();
  const main = voltage && value ? (label ? `${label}=${value}` : value) : label || value;
  const under = !voltage && label ? value : '';
  const cx = w / 2;
  const cy = h / 2;
  // In a mirrored part, travel runs right to left: polarity and current follow it.
  const dir = node.flipH ? -1 : 1;
  const leadOffset = (w / 2 + half) / 2;
  const forward = spec.currentDir !== 'backward';
  const arrowX = cx + (forward ? dir : -dir) * leadOffset;
  const arrowDir = forward ? dir : -dir;

  return (
    <>
      {glyph}
      {main && <UprightLabel tex={main} cx={cx} cy={cy + upper * rise} size={size} color={color} angle={node.rotation} />}
      {under && <UprightLabel tex={under} cx={cx} cy={cy - upper * rise} size={size} color={color} angle={node.rotation} />}
      {voltage && (
        <>
          <UprightLabel tex="+" cx={cx - dir * half} cy={cy - upper * (rise - 3)} size={size} color={color} angle={node.rotation} />
          <UprightLabel tex="-" cx={cx + dir * half} cy={cy - upper * (rise - 3)} size={size} color={color} angle={node.rotation} />
          <UprightLabel tex={voltage} cx={cx} cy={cy - upper * rise} size={size} color={color} angle={node.rotation} />
        </>
      )}
      {current && (
        <>
          <path d={`M ${arrowX + arrowDir * 5} ${cy} l ${-arrowDir * 8} -3.4 l 0 6.8 Z`} fill={node.style.stroke} />
          <UprightLabel tex={current} cx={arrowX} cy={cy + upper * 11} size={size} color={color} angle={node.rotation} />
        </>
      )}
    </>
  );
});

/* -------------------------------------------------------------- molecules */

export interface MolecularDrawProps {
  spec: MoleculeSpec;
  w: number;
  h: number;
  stroke: string;
  strokeWidth: number;
  textColor: string;
  fontSize: number;
}

function AtomLabel({ atom, x, y, size, color }: { atom: MolAtom; x: number; y: number; size: number; color: string }) {
  const text = atomText(atom);
  if (!text) return null;
  const runs = parseAtomLabel(text);
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill={atom.color ?? color} style={{ fontSize: size, fontFamily: 'serif', userSelect: 'none' }}>
      {runs.map((r, i) => {
        const prev = i > 0 ? runs[i - 1].shift : 'none';
        const offset = (s: string) => (s === 'sub' ? 0.28 : s === 'sup' ? -0.36 : 0);
        return (
          <tspan key={i} dy={(offset(r.shift) - offset(prev)) * size} style={{ fontSize: r.shift === 'none' ? size : size * 0.7 }}>
            {r.text}
          </tspan>
        );
      })}
    </text>
  );
}

function BondLines({ spec, bond, px, py, scale, stroke, strokeWidth, gapA, gapB }: {
  spec: MoleculeSpec;
  bond: MolBond;
  px: (x: number) => number;
  py: (y: number) => number;
  scale: number;
  stroke: string;
  strokeWidth: number;
  gapA: number;
  gapB: number;
}) {
  const a = spec.atoms.find((x) => x.id === bond.a);
  const b = spec.atoms.find((x) => x.id === bond.b);
  if (!a || !b) return null;
  const ax = px(a.x);
  const ay = py(a.y);
  const bx = px(b.x);
  const by = py(b.y);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const nx = -uy;
  const ny = ux;
  const x1 = ax + ux * gapA;
  const y1 = ay + uy * gapA;
  const x2 = bx - ux * gapB;
  const y2 = by - uy * gapB;
  const pen = { stroke, strokeWidth, strokeLinecap: 'round' as const };

  if (bond.stereo === 'wedge') {
    const half = 0.1 * scale;
    return <polygon points={`${x1},${y1} ${x2 + nx * half},${y2 + ny * half} ${x2 - nx * half},${y2 - ny * half}`} fill={stroke} stroke="none" />;
  }
  if (bond.stereo === 'dash') {
    const count = Math.max(4, Math.round(len / 4.5));
    const lines = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const cx = x1 + (x2 - x1) * t;
      const cy = y1 + (y2 - y1) * t;
      const half = 0.1 * scale * t;
      lines.push(<line key={i} x1={cx + nx * half} y1={cy + ny * half} x2={cx - nx * half} y2={cy - ny * half} {...pen} />);
    }
    return <g>{lines}</g>;
  }
  const line = (off: number, key: string, trim = 0) => (
    <line key={key} x1={x1 + ux * trim + nx * off} y1={y1 + uy * trim + ny * off} x2={x2 - ux * trim + nx * off} y2={y2 - uy * trim + ny * off} {...pen} />
  );
  const gap = 0.09 * scale;
  if (bond.order === 3) return <g>{line(0, 'm')}{line(gap * 1.3, 'p')}{line(-gap * 1.3, 'q')}</g>;
  if (bond.order === 2) {
    const ring = findRingCentreForBond(spec, bond);
    if (ring) {
      const side = Math.sign((px(ring.x) - ax) * nx + (py(ring.y) - ay) * ny) || 1;
      return <g>{line(0, 'm')}{line(side * gap * 1.7, 'i', 0.14 * scale)}</g>;
    }
    return <g>{line(gap * 0.9, 'p')}{line(-gap * 0.9, 'q')}</g>;
  }
  return line(0, 'm');
}

/** The picture of a molecule. Shared by the canvas and the structure editor. */
export function MoleculeDrawing({ spec, w, h, stroke, strokeWidth, textColor, fontSize }: MolecularDrawProps) {
  const place = useMemo(() => placeMolecule(spec, w, h), [spec, w, h]);
  const { scale, tx, ty } = place;
  const gapFor = (a: MolAtom | undefined) => (a && atomText(a) ? Math.min(0.3 * scale, fontSize * 0.6) : 0);
  const byId = new Map(spec.atoms.map((a) => [a.id, a]));
  const dot = (cx: number, cy: number, key: string, color: string, size: number) => <circle key={key} cx={cx} cy={cy} r={size * 0.075} fill={color} />;

  return (
    <g>
      {spec.bonds.map((b) => (
        <BondLines key={b.id} spec={spec} bond={b} px={tx} py={ty} scale={scale} stroke={stroke} strokeWidth={strokeWidth} gapA={gapFor(byId.get(b.a))} gapB={gapFor(byId.get(b.b))} />
      ))}
      {spec.aromaticRings.map((ring, i) => {
        const pts = ring.map((id) => byId.get(id)).filter(Boolean) as MolAtom[];
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const dist = Math.hypot(pts[0].x - cx, pts[0].y - cy);
        return <circle key={i} cx={tx(cx)} cy={ty(cy)} r={dist * scale * 0.62} fill="none" stroke={stroke} strokeWidth={strokeWidth} />;
      })}
      {spec.atoms.map((a) => {
        const x = tx(a.x);
        const y = ty(a.y);
        const color = a.color ?? textColor;
        const ring = fontSize * 0.85;
        const at = (deg: number) => ({ cx: x + Math.cos((deg * Math.PI) / 180) * ring, cy: y - Math.sin((deg * Math.PI) / 180) * ring });
        return (
          <g key={a.id}>
            <AtomLabel atom={a} x={x} y={y} size={fontSize} color={textColor} />
            {a.charge !== 0 && (
              <text x={x + fontSize * 0.72} y={y - fontSize * 0.62} textAnchor="middle" dominantBaseline="central" fill={color} style={{ fontSize: fontSize * 0.68, fontFamily: 'serif', userSelect: 'none' }}>
                {chargeText(a.charge)}
              </text>
            )}
            {a.lonePairs.map((deg, i) => {
              const p = at(deg);
              const nx = -Math.sin((deg * Math.PI) / 180) * fontSize * 0.19;
              const ny = -Math.cos((deg * Math.PI) / 180) * fontSize * 0.19;
              return <g key={`lp${i}`}>{dot(p.cx + nx, p.cy + ny, 'a', color, fontSize)}{dot(p.cx - nx, p.cy - ny, 'b', color, fontSize)}</g>;
            })}
            {a.radicals.map((deg, i) => {
              const p = at(deg);
              return dot(p.cx, p.cy, `r${i}`, color, fontSize);
            })}
          </g>
        );
      })}
    </g>
  );
}

export function MoleculeContent({ node }: { node: Node }) {
  if (node.science?.type !== 'molecule') return null;
  const nat = placeMolecule(node.science, node.w, node.h);
  const fontSize = (node.textStyle.fontSize * nat.scale) / 34;
  return (
    <MoleculeDrawing spec={node.science} w={node.w} h={node.h} stroke={node.style.stroke} strokeWidth={node.style.strokeWidth} textColor={node.textStyle.color} fontSize={fontSize} />
  );
}
