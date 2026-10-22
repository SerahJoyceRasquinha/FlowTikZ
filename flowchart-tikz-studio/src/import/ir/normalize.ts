import type { Point } from '../../model/types';
import type { Seg } from '../../model/path';
import { distanceToSegment } from '../../model/geometry';
import { colorDistance, hexToRgb } from '../conversion/color';
import type { ReportBuilder } from '../report';
import type { BackgroundAnalysis } from '../raster/background';
import { backgroundShare } from '../raster/background';
import type { IRConnector, IRDiagram, IRObject } from './types';

/**
 * Normalisation of an IR after validation.
 *
 * Structured sources (draw.io, SVG) are already normalised by their parsers;
 * this pass matters most for the recognised picture, which can contain
 * duplicates, text found beside its shape instead of inside it, labels
 * found as loose text, or a rectangle for the page itself.
 */

export interface NormalizeOptions {
  report: ReportBuilder;
  /** Merge text objects into the shape or connector they sit on. */
  attachText?: boolean;
  /** Remove a rectangle that is really the canvas/page background. */
  removeCanvasBackground?: boolean;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function centre(o: IRObject): Point {
  return { x: o.x + o.w / 2, y: o.y + o.h / 2 };
}

function inside(o: IRObject, p: Point, pad = 0): boolean {
  return p.x >= o.x - pad && p.x <= o.x + o.w + pad && p.y >= o.y - pad && p.y <= o.y + o.h + pad;
}

function distToPolyline(p: Point, pts: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distanceToSegment(p, pts[i - 1], pts[i]));
  return best;
}

/**
 * Where a point sits relative to a polyline: the fraction along it of the
 * nearest point, and the signed perpendicular offset in the model's label
 * convention (positive = left of the direction of travel, n = (-ty, tx)).
 */
export function projectOnPath(pts: Point[], p: Point): { position: number; offset: number } {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = lens[lens.length - 1] || 1;
  let best = { d: Infinity, at: 0, offset: 0 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const qx = a.x + dx * t;
    const qy = a.y + dy * t;
    const d = Math.hypot(p.x - qx, p.y - qy);
    if (d < best.d) {
      const len = Math.sqrt(l2);
      best = { d, at: lens[i - 1] + len * t, offset: (p.x - qx) * (-dy / len) + (p.y - qy) * (dx / len) };
    }
  }
  return { position: Math.round((best.at / total) * 1000) / 1000, offset: Math.round(best.offset * 100) / 100 };
}

export function projectFraction(pts: Point[], p: Point): number {
  return projectOnPath(pts, p).position;
}

export function normalizeIR(ir: IRDiagram, opts: NormalizeOptions): IRDiagram {
  const { report } = opts;
  let objects = [...ir.objects];
  let connectors = [...ir.connectors];

  /* ---- exact duplicates (same type, same box, same text) */
  const seen = new Set<string>();
  const before = objects.length;
  objects = objects.filter((o) => {
    const key = `${o.shape}|${Math.round(o.x)}|${Math.round(o.y)}|${Math.round(o.w)}|${Math.round(o.h)}|${o.text?.content ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (objects.length < before) report.add('info', `${before - objects.length} duplicated object${before - objects.length === 1 ? '' : 's'} removed.`);
  const cseen = new Set<string>();
  const cbefore = connectors.length;
  connectors = connectors.filter((c) => {
    const key = `${c.source?.objectId}|${c.target?.objectId}|${c.points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}`;
    if (cseen.has(key)) return false;
    cseen.add(key);
    return true;
  });
  if (connectors.length < cbefore) report.add('info', `${cbefore - connectors.length} duplicated connector${cbefore - connectors.length === 1 ? '' : 's'} removed.`);

  /* ---- a rectangle that is the page itself */
  if (opts.removeCanvasBackground && objects.length > 1) {
    const canvasArea = Math.max(1, ir.canvas.width * ir.canvas.height);
    const lowest = [...objects].sort((a, b) => a.z - b.z)[0];
    if (
      lowest &&
      (lowest.shape === 'rectangle' || lowest.shape === 'rounded-rectangle') &&
      !lowest.text &&
      (lowest.w * lowest.h) / canvasArea >= 0.9 &&
      objects.filter((o) => o !== lowest).every((o) => inside(lowest, centre(o), 2))
    ) {
      objects = objects.filter((o) => o !== lowest);
      report.add('info', 'Removed a rectangle covering the whole canvas: it is the page background, not part of the diagram.');
    }
  }

  /* ---- loose text that belongs to a shape or a connector */
  if (opts.attachText) {
    const shapes = objects.filter((o) => o.shape !== 'text' && o.shape !== 'image');
    const merged = new Set<IRObject>();
    let intoShapes = 0;
    let intoConnectors = 0;
    for (const t of objects) {
      if (t.shape !== 'text' || !t.text) continue;
      const c = centre(t);
      const hosts = shapes.filter((s) => inside(s, c) && t.w <= s.w * 1.05 && t.h <= s.h * 1.05);
      hosts.sort((a, b) => a.w * a.h - b.w * b.h);
      const host = hosts[0];
      if (host) {
        const containsOthers = shapes.some((o) => o !== host && inside(host, centre(o)) && o.w * o.h < host.w * host.h);
        if (!containsOthers) {
          if (host.text) host.text = { ...host.text, content: `${host.text.content}\n${t.text.content}` };
          else host.text = { ...t.text };
          merged.add(t);
          intoShapes++;
          continue;
        }
      }
      let best: { c: IRConnector; d: number } | null = null;
      for (const con of connectors) {
        if (con.label || con.points.length < 2) continue;
        const d = distToPolyline(c, con.points);
        // Labels sit on or just beside their line; small text only.
        if (t.w <= 220 && d <= Math.max(16, t.text.fontSize * 1.8) && (!best || d < best.d)) best = { c: con, d };
      }
      if (best) {
        // Keep the label where it was: beside the line, not on top of it.
        const where = projectOnPath(best.c.points, c);
        best.c.label = {
          text: t.text.content,
          position: where.position,
          offset: where.offset,
          fontSize: t.text.fontSize,
          color: t.text.color,
          background: true,
          ...(t.text.bold ? { bold: true } : {}),
          ...(t.text.confidence !== undefined ? { confidence: t.text.confidence } : {}),
        };
        merged.add(t);
        intoConnectors++;
      }
    }
    if (merged.size) {
      objects = objects.filter((o) => !merged.has(o));
      if (intoShapes) report.add('info', `${intoShapes} text block${intoShapes === 1 ? ' was' : 's were'} merged into the shape ${intoShapes === 1 ? 'it sits' : 'they sit'} in.`);
      if (intoConnectors) report.add('info', `${intoConnectors} text block${intoConnectors === 1 ? ' was' : 's were'} attached to ${intoConnectors === 1 ? 'its connector as a label' : 'their connectors as labels'}.`);
    }
  }

  /* ---- label confidence into the report (object text is handled by the mapper) */
  for (const c of connectors) {
    if (c.label?.confidence !== undefined && c.label.confidence < 0.8) {
      report.add('low-confidence-text', `Connector label "${c.label.text.slice(0, 40)}" recognised with ${Math.round(c.label.confidence * 100)}% confidence - check it.`, c.id);
    }
  }

  /* ---- a single, dense paint order */
  const all = [
    ...objects.map((o) => ({ z: o.z, set: (z: number) => (o.z = z) })),
    ...connectors.map((c) => ({ z: c.z, set: (z: number) => (c.z = z) })),
  ].sort((a, b) => a.z - b.z);
  all.forEach((item, i) => item.set(i));

  return { ...ir, objects, connectors };
}

/**
 * Background decisions for shapes the recogniser reported, checked against
 * the measured background mask. `toMask` maps IR (source px) into mask px.
 *
 * - A shape filled with the background colour whose interior is *enclosed*
 *   (not connected to the page) is a genuinely white shape: kept as is.
 * - One whose interior *is* the page: if it has no outline and no text it is
 *   not a shape at all and is removed; otherwise its fill is made transparent
 *   (it was the page showing through, e.g. inside a dashed outline).
 */
export function applyBackgroundAnalysis(ir: IRDiagram, a: BackgroundAnalysis, scale: number, report: ReportBuilder): IRDiagram {
  if (!a.color && !a.transparent) return ir;
  let kept = 0;
  let cleared = 0;
  let removed = 0;
  const objects = ir.objects.filter((o) => {
    if (o.shape === 'text' || o.shape === 'image' || !o.style.fill) return true;
    const sameAsBg = a.color ? colorDistance(o.style.fill, a.color) <= Math.max(10, a.tolerance * 0.8) : false;
    if (!sameAsBg) return true;
    const share = backgroundShare(a, { x: o.x * scale, y: o.y * scale, w: o.w * scale, h: o.h * scale });
    if (share < 0.5) {
      kept++;
      return true;
    }
    if (!o.style.stroke && !o.text) {
      removed++;
      return false;
    }
    o.style = { ...o.style, fill: null };
    cleared++;
    return true;
  });
  if (kept) report.add('info', `${kept} shape${kept === 1 ? '' : 's'} filled with the background colour ${kept === 1 ? 'was' : 'were'} kept: ${kept === 1 ? 'its' : 'their'} interior is enclosed by an outline, so it is a fill, not background.`);
  if (cleared) report.add('info', `${cleared} shape${cleared === 1 ? '' : 's'} showed the page through ${cleared === 1 ? 'its' : 'their'} outline; the fill was made transparent.`);
  if (removed) report.add('info', `${removed} region${removed === 1 ? '' : 's'} reported as shapes turned out to be page background and ${removed === 1 ? 'was' : 'were'} removed.`);
  return { ...ir, objects };
}

/** Scale and translate every coordinate and size in an IR: p' = p * k + (dx, dy). */
export function transformIR(ir: IRDiagram, k: number, dx: number, dy: number, canvas: { width: number; height: number }): IRDiagram {
  const P = (p: Point): Point => ({ x: r2(p.x * k + dx), y: r2(p.y * k + dy) });
  const S = (segs: Seg[] | undefined) =>
    segs?.map((s) => (s.c === 'Z' ? s : s.c === 'C' ? { c: 'C' as const, c1: P(s.c1), c2: P(s.c2), p: P(s.p) } : { c: s.c, p: P(s.p) }));
  return {
    ...ir,
    canvas,
    objects: ir.objects.map((o) => ({
      ...o,
      x: r2(o.x * k + dx),
      y: r2(o.y * k + dy),
      w: r2(o.w * k),
      h: r2(o.h * k),
      path: S(o.path),
      style: { ...o.style, strokeWidth: r2(o.style.strokeWidth * k), cornerRadius: r2(o.style.cornerRadius * k), dashArray: o.style.dashArray?.map((v) => r2(v * k)) },
      text: o.text ? { ...o.text, fontSize: r2(o.text.fontSize * k) } : undefined,
    })),
    connectors: ir.connectors.map((c) => ({
      ...c,
      points: c.points.map(P),
      curve: S(c.curve),
      arrowSize: c.arrowSize !== undefined ? r2(c.arrowSize * k) : undefined,
      cornerRadius: c.cornerRadius !== undefined ? r2(c.cornerRadius * k) : undefined,
      style: { ...c.style, strokeWidth: r2(c.style.strokeWidth * k), dashArray: c.style.dashArray?.map((v) => r2(v * k)) },
      label: c.label ? { ...c.label, fontSize: r2(c.label.fontSize * k), offset: r2(c.label.offset * k) } : undefined,
    })),
  };
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Text that sat directly on a dark page (titles, connector labels) is often
 * white. Once the page is removed it would be white on white - on the canvas
 * and on paper. Such text takes the old page colour instead, so it stays
 * readable; the original colour is kept as metadata. Text inside shapes is
 * untouched: its shape still provides the contrast.
 */
export function keepPageTextReadable(ir: IRDiagram, pageColor: string | null, report: ReportBuilder): IRDiagram {
  if (!pageColor || luminance(pageColor) > 0.3) return ir;
  const light = (c: string | undefined) => !!c && /^#[0-9a-f]{6}$/i.test(c) && luminance(c) >= 0.6;
  let changed = 0;
  const objects = ir.objects.map((o) => {
    if (o.shape !== 'text' || !o.text || !light(o.text.color)) return o;
    if (o.style.fill && !light(o.style.fill) && o.style.fillOpacity > 0.5) return o;
    changed++;
    return { ...o, text: { ...o.text, color: pageColor }, preserved: { ...(o.preserved ?? {}), 'text.originalColor': o.text.color } };
  });
  const connectors = ir.connectors.map((c) => {
    if (!c.label || !light(c.label.color)) return c;
    changed++;
    return { ...c, label: { ...c.label, color: pageColor }, preserved: { ...(c.preserved ?? {}), 'label.originalColor': c.label.color } };
  });
  if (changed) {
    report.add(
      'approximated',
      `${changed} light-coloured text${changed === 1 ? '' : 's'} that sat on the dark page ${changed === 1 ? 'was' : 'were'} recoloured to ${pageColor} so ${changed === 1 ? 'it stays' : 'they stay'} readable on a white page; the original colour is kept as metadata.`,
    );
  }
  return { ...ir, objects, connectors };
}
