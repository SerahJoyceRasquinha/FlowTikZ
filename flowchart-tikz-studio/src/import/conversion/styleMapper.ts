import type { ArrowHead, MetaValue, ShadingKind, ShapeStyle, StrokeStyle } from '../../model/types';
import { DEFAULT_SHAPE_STYLE } from '../../model/defaults';
import { getShapeDef } from '../../model/shapes';
import type { IRArrow, IRDash, IRGradient, IRStyle } from '../ir/types';
import type { ReportBuilder } from '../report';

/**
 * Style translation: IR (source vocabulary) -> ShapeStyle / edge fields.
 *
 * Every property the model can carry exactly is carried exactly. Where the
 * model's vocabulary is narrower than the source's (a custom dash pattern, a
 * gradient at 30 degrees, a three-stop gradient, an open arrowhead) the
 * closest native value is used, the difference is tallied in the report, and
 * the exact source value is written to `preserved` so it is never lost.
 */

export interface MappedStyle {
  style: ShapeStyle;
  preserved: Record<string, MetaValue>;
}

export function mapDash(
  dash: IRDash,
  dashArray: number[] | undefined,
  strokeWidth: number,
  report: ReportBuilder,
  preserved: Record<string, MetaValue>,
): StrokeStyle {
  if (dashArray && dashArray.length >= 2) {
    preserved.dashArray = dashArray.join(' ');
    const w = Math.max(strokeWidth, 0.4);
    const on = dashArray.filter((_, i) => i % 2 === 0);
    const shortOn = on.filter((v) => v <= Math.max(1, w * 0.6)).length;
    let native: StrokeStyle;
    if (dashArray.length >= 4 && shortOn > 0 && shortOn < on.length) native = 'dashdotted';
    else if (shortOn === on.length) native = 'dotted';
    else native = 'dashed';
    // The native dashed pattern is 3w on, 3w off. Anything visibly different
    // is an approximation and is reported as one.
    const exact =
      native === 'dashed' &&
      dashArray.length === 2 &&
      Math.abs(dashArray[0] - w * 3) <= w * 0.75 &&
      Math.abs(dashArray[1] - w * 3) <= w * 0.75;
    if (!exact) {
      report.tally('style-difference', `Custom dash pattern shown with the nearest standard ${native} line; the original pattern is kept as metadata`);
    }
    return native;
  }
  switch (dash) {
    case 'dashed':
      return 'dashed';
    case 'dotted':
      return 'dotted';
    case 'dashdot':
      return 'dashdotted';
    default:
      return 'solid';
  }
}

export function mapGradient(
  g: IRGradient,
  report: ReportBuilder,
  preserved: Record<string, MetaValue>,
): { shading: ShadingKind; from: string; to: string } {
  if (g.stops && g.stops > 2) {
    preserved.gradientStops = g.stops;
    report.tally('approximated', 'Gradient with more than two colour stops reduced to its first and last colour');
  }
  if (g.type === 'radial') return { shading: 'radial', from: g.from, to: g.to };
  const a = ((g.angle % 360) + 360) % 360;
  // Nearest of the four axis directions the model offers.
  const options: { angle: number; shading: ShadingKind; swap: boolean }[] = [
    { angle: 180, shading: 'axis-vertical', swap: false },
    { angle: 0, shading: 'axis-vertical', swap: true },
    { angle: 360, shading: 'axis-vertical', swap: true },
    { angle: 90, shading: 'axis-horizontal', swap: false },
    { angle: 270, shading: 'axis-horizontal', swap: true },
  ];
  let best = options[0];
  for (const o of options) if (Math.abs(o.angle - a) < Math.abs(best.angle - a)) best = o;
  if (Math.abs(best.angle - a) > 3) {
    preserved.gradientAngle = g.angle;
    report.tally('approximated', 'Diagonal gradient aligned to the nearest horizontal or vertical direction');
  }
  return best.swap
    ? { shading: best.shading, from: g.to, to: g.from }
    : { shading: best.shading, from: g.from, to: g.to };
}

/** IR style -> native ShapeStyle for a node of `kind`. */
export function mapShapeStyle(
  s: IRStyle,
  kind: string,
  scale: number,
  report: ReportBuilder,
): MappedStyle {
  const preserved: Record<string, MetaValue> = {};
  const style: ShapeStyle = { ...DEFAULT_SHAPE_STYLE };

  if (s.fill) {
    style.fill = s.fill;
    style.fillOpacity = s.fillOpacity;
  } else {
    // No fill: the model has no "none", but a zero-opacity fill is exactly that
    // on the canvas and in TikZ, and the colour stays editable.
    style.fill = '#ffffff';
    style.fillOpacity = 0;
  }

  if (s.stroke && s.strokeWidth > 0) {
    style.stroke = s.stroke;
    style.strokeOpacity = s.strokeOpacity;
    style.strokeWidth = round2(s.strokeWidth * scale);
    style.strokeStyle = mapDash(s.dash, s.dashArray, s.strokeWidth, report, preserved);
  } else {
    style.strokeStyle = 'none';
    if (s.stroke) style.stroke = s.stroke;
  }

  style.opacity = s.opacity;
  style.shadow = s.shadow;

  if (s.cornerRadius > 0) {
    if (getShapeDef(kind).roundable) {
      style.cornerRadius = round2(s.cornerRadius * scale);
    } else if (kind !== 'terminator') {
      preserved.cornerRadius = s.cornerRadius;
      report.tally('approximated', 'Rounded corners are not available on this symbol; drawn with its standard corners');
    }
  }

  if (s.gradient) {
    const g = mapGradient(s.gradient, report, preserved);
    style.shading = g.shading;
    style.fill = g.from;
    style.shadingColor = g.to;
    if (!s.fill) style.fillOpacity = 1;
  }

  return { style, preserved };
}

/** IR arrowhead -> native. Returns the native head and whether it is exact. */
export function mapArrow(a: IRArrow, report: ReportBuilder): ArrowHead {
  switch (a) {
    case 'none':
    case 'stealth':
    case 'latex':
    case 'triangle':
    case 'open-triangle':
    case 'bar':
    case 'circle':
    case 'diamond':
      return a;
    case 'open':
      report.tally('approximated', 'Open (line) arrowhead drawn as an open triangle');
      return 'open-triangle';
    case 'open-circle':
      report.tally('approximated', 'Hollow circle arrowhead drawn filled');
      return 'circle';
    case 'open-diamond':
      report.tally('approximated', 'Hollow diamond arrowhead drawn filled');
      return 'diamond';
    default:
      return 'stealth';
  }
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
