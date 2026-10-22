import type { Point } from '../../model/types';
import { segsToSvgPath, type Seg } from '../../model/path';
import { getShapeDef } from '../../model/shapes';
import { escapeXml } from '../xml/parser';
import type { IRArrow, IRConnector, IRDiagram, IRObject } from '../ir/types';
import { kindForObject, nativeOutline, probeNode, translate } from '../ir/shapes';

/**
 * IR -> SVG, deterministically.
 *
 * This is the "SVG representation" stage of the image pipeline. It draws each
 * object with the very outline the editor will use for it (so the SVG and the
 * canvas agree), and annotates every element with `data-fc-*` attributes that
 * carry the semantics - shape type, box, connector endpoints, text alignment,
 * recognition confidence. The SVG importer reads those annotations back, so
 * the round trip IR -> SVG -> IR is lossless, and the file is also a perfectly
 * ordinary SVG that any viewer can open for comparison with the source image.
 *
 * Same input, same bytes: no randomness, no timestamps, fixed precision.
 */

const r3 = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};

function attrs(map: Record<string, string | number | boolean | undefined | null>): string {
  return Object.entries(map)
    .filter(([, v]) => v !== undefined && v !== null && v !== false && v !== '')
    .map(([k, v]) => ` ${k}="${escapeXml(v === true ? '1' : String(typeof v === 'number' ? r3(v) : v))}"`)
    .join('');
}

function dashAttr(dash: string, dashArray: number[] | undefined, width: number): string | undefined {
  if (dashArray?.length) return dashArray.map(r3).join(' ');
  const w = Math.max(width, 0.4);
  switch (dash) {
    case 'dashed':
      return `${r3(w * 3)} ${r3(w * 3)}`;
    case 'dotted':
      return `${r3(w * 0.01)} ${r3(w * 2.6)}`;
    case 'dashdot':
      return `${r3(w * 3.5)} ${r3(w * 2)} ${r3(w * 0.01)} ${r3(w * 2)}`;
    default:
      return undefined;
  }
}

function markerId(kind: IRArrow, color: string) {
  return `fc-arrow-${kind}-${color.replace('#', '')}`;
}

function markerDef(kind: IRArrow, color: string): string {
  const id = markerId(kind, color);
  const open = kind.startsWith('open');
  const fill = open ? 'none' : color;
  let body: string;
  switch (kind) {
    case 'bar':
      body = `<path d="M 5 0 L 5 10" stroke="${color}" stroke-width="1.5" fill="none"/>`;
      break;
    case 'circle':
    case 'open-circle':
      body = `<circle cx="5" cy="5" r="4" fill="${fill}" stroke="${color}"/>`;
      break;
    case 'diamond':
    case 'open-diamond':
      body = `<path d="M 0 5 L 5 0 L 10 5 L 5 10 Z" fill="${fill}" stroke="${color}"/>`;
      break;
    case 'open':
      body = `<path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="${color}" stroke-width="1.5"/>`;
      break;
    case 'stealth':
      body = `<path d="M 0 0 L 10 5 L 0 10 L 3 5 Z" fill="${color}"/>`;
      break;
    default:
      body = `<path d="M 0 0 L 10 5 L 0 10 Z" fill="${fill}" stroke="${color}"/>`;
  }
  return `<marker id="${id}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">${body}</marker>`;
}

/** Local outline of an object, in absolute (unrotated) coordinates. */
export function objectOutline(o: IRObject): { outline: Seg[]; decorations: Seg[][] } {
  if (o.path && (o.shape === 'path' || o.shape === 'polygon')) return { outline: o.path, decorations: [] };
  const kind = kindForObject(o);
  const box = { x: o.x, y: o.y, w: o.w, h: o.h };
  const def = getShapeDef(kind);
  const outline = nativeOutline(kind, box, o.style.cornerRadius);
  const node = probeNode(kind, box, o.style.cornerRadius);
  const decorations = (def.decorations ? def.decorations(o.w, o.h, node) : []).map((d) => translate(d, o.x, o.y));
  return { outline, decorations };
}

function textElement(o: IRObject): string {
  const t = o.text;
  if (!t) return '';
  const lines = t.content.split('\n');
  const lh = t.fontSize * 1.2;
  const block = lines.length * lh;
  const pad = 4;
  const x = t.align === 'left' ? o.x + pad : t.align === 'right' ? o.x + o.w - pad : o.x + o.w / 2;
  const top = t.valign === 'top' ? o.y + pad : t.valign === 'bottom' ? o.y + o.h - pad - block : o.y + (o.h - block) / 2;
  const anchor = t.align === 'left' ? 'start' : t.align === 'right' ? 'end' : 'middle';
  const spans = lines
    .map((l, i) => `<tspan x="${r3(x)}" y="${r3(top + lh * i + t.fontSize * 0.95)}">${escapeXml(l || ' ')}</tspan>`)
    .join('');
  return `<text${attrs({
    'data-fc-part': 'text',
    'data-fc-align': t.align,
    'data-fc-valign': t.valign,
    'data-fc-font-family': t.fontFamily,
    'data-fc-confidence': t.confidence,
    'font-size': t.fontSize,
    'font-family': t.fontFamily,
    'font-weight': t.bold ? 'bold' : undefined,
    'font-style': t.italic ? 'italic' : undefined,
    'text-decoration': t.underline ? 'underline' : undefined,
    fill: t.color,
    'text-anchor': anchor,
    'xml:space': 'preserve',
  })}>${spans}</text>`;
}

function objectElement(o: IRObject, defs: string[]): string {
  const s = o.style;
  const { outline, decorations } = objectOutline(o);
  let fill = s.fill ?? 'none';
  if (s.gradient) {
    const gid = `fc-grad-${o.id}`;
    const g = s.gradient;
    if (g.type === 'radial') {
      defs.push(`<radialGradient id="${escapeXml(gid)}"><stop offset="0" stop-color="${g.from}"/><stop offset="1" stop-color="${g.to}"/></radialGradient>`);
    } else {
      const a = (g.angle * Math.PI) / 180;
      const dx = Math.sin(a);
      const dy = -Math.cos(a);
      defs.push(
        `<linearGradient id="${escapeXml(gid)}" x1="${r3(0.5 - dx / 2)}" y1="${r3(0.5 - dy / 2)}" x2="${r3(0.5 + dx / 2)}" y2="${r3(0.5 + dy / 2)}"><stop offset="0" stop-color="${g.from}"/><stop offset="1" stop-color="${g.to}"/></linearGradient>`,
      );
    }
    fill = `url(#${gid})`;
  }
  const textOnly = o.shape === 'text';
  const strokeW = s.stroke ? s.strokeWidth : 0;
  const shared = {
    stroke: s.stroke ?? 'none',
    'stroke-width': s.stroke ? strokeW : undefined,
    'stroke-opacity': s.stroke && s.strokeOpacity < 1 ? s.strokeOpacity : undefined,
    'stroke-dasharray': s.stroke ? dashAttr(s.dash, s.dashArray, strokeW) : undefined,
    'stroke-linejoin': 'round',
  };
  const meta: Record<string, unknown> = {};
  if (o.preserved && Object.keys(o.preserved).length) meta.preserved = o.preserved;
  if (o.notes?.length) meta.notes = o.notes;
  if (o.image) meta.image = o.image;
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const parts: string[] = [];
  if (!textOnly) {
    parts.push(
      `<path${attrs({
        'data-fc-part': 'outline',
        d: segsToSvgPath(outline),
        fill,
        'fill-opacity': s.fill && s.fillOpacity < 1 ? s.fillOpacity : undefined,
        ...shared,
        filter: s.shadow ? 'url(#fc-shadow)' : undefined,
      })}/>`,
    );
    for (const dec of decorations) {
      parts.push(`<path${attrs({ 'data-fc-part': 'decoration', d: segsToSvgPath(dec), fill: 'none', ...shared })}/>`);
    }
  }
  parts.push(textElement(o));
  return `<g${attrs({
    'data-fc-role': 'object',
    'data-fc-id': o.id,
    'data-fc-shape': o.shape,
    'data-fc-box': `${r3(o.x)} ${r3(o.y)} ${r3(o.w)} ${r3(o.h)}`,
    'data-fc-rotation': o.rotation || undefined,
    'data-fc-z': o.z,
    'data-fc-group': o.groupId,
    'data-fc-locked': o.locked,
    'data-fc-confidence': o.confidence,
    'data-fc-source-id': o.sourceId,
    'data-fc-corner-radius': s.cornerRadius || undefined,
    'data-fc-dash': s.dash !== 'solid' ? s.dash : undefined,
    'data-fc-dash-array': s.dashArray?.map(r3).join(' '),
    'data-fc-stroke': s.stroke ?? 'none',
    'data-fc-stroke-width': s.strokeWidth,
    'data-fc-stroke-opacity': s.strokeOpacity,
    'data-fc-shadow': s.shadow,
    'data-fc-fill': s.fill ?? 'none',
    'data-fc-fill-opacity': s.fillOpacity,
    'data-fc-gradient': s.gradient ? JSON.stringify(s.gradient) : undefined,
    'data-fc-meta': Object.keys(meta).length ? JSON.stringify(meta) : undefined,
    transform: o.rotation ? `rotate(${r3(o.rotation)} ${r3(cx)} ${r3(cy)})` : undefined,
    opacity: s.opacity < 1 ? s.opacity : undefined,
  })}>${parts.join('')}</g>`;
}

function connectorPath(c: IRConnector): string {
  if (c.routing === 'curved' && c.curve?.length) return segsToSvgPath(c.curve);
  const pts = c.points;
  if (!pts.length) return '';
  return pts.map((p: Point, i: number) => `${i ? 'L' : 'M'} ${r3(p.x)} ${r3(p.y)}`).join(' ');
}

function endpointAttrs(prefix: 'source' | 'target', ep: IRConnector['source']) {
  if (!ep) return {};
  return {
    [`data-fc-${prefix}`]: ep.objectId,
    [`data-fc-${prefix}-port`]: ep.port,
    [`data-fc-${prefix}-fx`]: ep.fx,
    [`data-fc-${prefix}-fy`]: ep.fy,
    [`data-fc-${prefix}-floating`]: ep.floating,
  };
}

function connectorElement(c: IRConnector, markers: Map<string, string>): string {
  const st = c.style;
  const useMarker = (kind: IRArrow) => {
    if (kind === 'none') return undefined;
    const id = markerId(kind, st.stroke);
    if (!markers.has(id)) markers.set(id, markerDef(kind, st.stroke));
    return `url(#${id})`;
  };
  const label = c.label
    ? (() => {
        const l = c.label;
        const mid = pointAlong(c.points, l.position);
        return `<text${attrs({
          'data-fc-part': 'label',
          'data-fc-position': l.position,
          'data-fc-offset': l.offset || undefined,
          'data-fc-background': l.background,
          'data-fc-confidence': l.confidence,
          x: mid.x,
          y: mid.y + l.fontSize * 0.35,
          'font-size': l.fontSize,
          'font-family': 'sans-serif',
          'font-weight': l.bold ? 'bold' : undefined,
          'font-style': l.italic ? 'italic' : undefined,
          fill: l.color,
          'text-anchor': 'middle',
          'xml:space': 'preserve',
        })}>${escapeXml(l.text)}</text>`;
      })()
    : '';
  const meta: Record<string, unknown> = {};
  if (c.preserved && Object.keys(c.preserved).length) meta.preserved = c.preserved;
  if (c.notes?.length) meta.notes = c.notes;
  return `<g${attrs({
    'data-fc-role': 'connector',
    'data-fc-id': c.id,
    'data-fc-z': c.z,
    'data-fc-routing': c.routing,
    'data-fc-rounded': c.rounded,
    'data-fc-corner-radius': c.cornerRadius,
    'data-fc-arrow-start': c.arrowStart,
    'data-fc-arrow-end': c.arrowEnd,
    'data-fc-arrow-size': c.arrowSize,
    'data-fc-points': c.points.map((p) => `${r3(p.x)},${r3(p.y)}`).join(' '),
    'data-fc-dash': st.dash !== 'solid' ? st.dash : undefined,
    'data-fc-dash-array': st.dashArray?.map(r3).join(' '),
    'data-fc-confidence': c.confidence,
    'data-fc-source-id': c.sourceId,
    'data-fc-meta': Object.keys(meta).length ? JSON.stringify(meta) : undefined,
    ...endpointAttrs('source', c.source),
    ...endpointAttrs('target', c.target),
    opacity: st.opacity < 1 ? st.opacity : undefined,
  })}><path${attrs({
    'data-fc-part': 'line',
    d: connectorPath(c),
    fill: 'none',
    stroke: st.stroke,
    'stroke-width': st.strokeWidth,
    'stroke-opacity': st.strokeOpacity < 1 ? st.strokeOpacity : undefined,
    'stroke-dasharray': dashAttr(st.dash, st.dashArray, st.strokeWidth),
    'marker-start': useMarker(c.arrowStart),
    'marker-end': useMarker(c.arrowEnd),
  })}/>${label}</g>`;
}

function pointAlong(points: Point[], t: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  const lens = [0];
  for (let i = 1; i < points.length; i++) lens.push(lens[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const target = lens[lens.length - 1] * t;
  for (let i = 1; i < points.length; i++) {
    if (lens[i] >= target) {
      const f = (target - lens[i - 1]) / ((lens[i] - lens[i - 1]) || 1);
      return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * f, y: points[i - 1].y + (points[i].y - points[i - 1].y) * f };
    }
  }
  return points[points.length - 1];
}

export function irToSvg(ir: IRDiagram): string {
  const defs: string[] = [];
  const markers = new Map<string, string>();
  const items: { z: number; seq: number; svg: string }[] = [];
  let seq = 0;
  for (const o of ir.objects) items.push({ z: o.z, seq: seq++, svg: objectElement(o, defs) });
  for (const c of ir.connectors) items.push({ z: c.z, seq: seq++, svg: connectorElement(c, markers) });
  items.sort((a, b) => a.z - b.z || a.seq - b.seq);
  const hasShadow = ir.objects.some((o) => o.style.shadow);
  if (hasShadow) {
    defs.push('<filter id="fc-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="3" dy="3" stdDeviation="0" flood-color="#000000" flood-opacity="0.22"/></filter>');
  }
  const { width, height } = ir.canvas;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg"${attrs({
      'data-fc-ir': '1',
      'data-fc-version': ir.version,
      'data-fc-format': ir.metadata.format,
      'data-fc-title': ir.metadata.title,
      'data-fc-bg-color': ir.background.color ?? undefined,
      'data-fc-bg-removed': ir.background.removed,
      'data-fc-bg-transparent': ir.background.transparent,
      'data-fc-groups': ir.groups.length ? JSON.stringify(ir.groups) : undefined,
      'data-fc-notes': ir.metadata.notes.length ? JSON.stringify(ir.metadata.notes) : undefined,
      width: r3(width),
      height: r3(height),
      viewBox: `0 0 ${r3(width)} ${r3(height)}`,
    })}>`,
    // Transparent: the source background is deliberately not reproduced.
    `<defs>${[...defs, ...markers.values()].join('')}</defs>`,
    ...items.map((i) => i.svg),
    '</svg>',
  ].join('\n');
}
