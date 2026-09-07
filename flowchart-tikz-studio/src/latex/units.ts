import { round } from '../model/geometry';
import type { Point } from '../model/types';

/**
 * Unit conversion between diagram units (du) and LaTeX lengths.
 *
 * The whole fidelity story rests on this file. One scale factor,
 * `unitsPerCm`, governs every conversion, so a diagram drawn at any size
 * compiles to a proportionally identical picture.
 */

export const PT_PER_CM = 28.4527559;

export interface UnitContext {
  unitsPerCm: number;
  /** Diagram-space origin that maps to TikZ (0,0). */
  originX: number;
  originY: number;
}

export function makeUnitContext(unitsPerCm: number, originX = 0, originY = 0): UnitContext {
  return { unitsPerCm: unitsPerCm > 0 ? unitsPerCm : 50, originX, originY };
}

/** Length in du -> centimetres. */
export function cm(du: number, ctx: UnitContext): number {
  return round(du / ctx.unitsPerCm, 4);
}

/** Length in du -> TeX points. */
export function toPt(du: number, ctx: UnitContext): number {
  return round((du / ctx.unitsPerCm) * PT_PER_CM, 3);
}

/**
 * Diagram point -> TikZ coordinate string.
 * The y axis is flipped because the canvas grows downwards and TikZ upwards.
 */
export function coord(p: Point, ctx: UnitContext): string {
  const x = round((p.x - ctx.originX) / ctx.unitsPerCm, 4);
  const y = round(-(p.y - ctx.originY) / ctx.unitsPerCm, 4);
  return `(${fmt(x)},${fmt(y)})`;
}

export function lengthCm(du: number, ctx: UnitContext): string {
  return `${fmt(cm(du, ctx))}cm`;
}

export function lengthPt(du: number, ctx: UnitContext): string {
  return `${fmt(toPt(du, ctx))}pt`;
}

/** Fixed formatting so regenerating an unchanged diagram is byte-identical. */
export function fmt(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const s = v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
