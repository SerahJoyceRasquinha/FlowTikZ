import type { XmlElement } from '../xml/parser';
import { childElements, textContent, localName } from '../xml/parser';
import { parsePathData } from './pathData';

/**
 * Reader for SVG written by `irToSvg`.
 *
 * The `data-fc-*` annotations carry the semantics that plain SVG cannot
 * (which object a connector joins, how text is aligned, how confident the
 * recognition was), so this reader rebuilds the IR exactly instead of
 * inferring it. The output is still handed to `validateIR` - annotations in a
 * file are just as untrusted as anything else in it.
 */

function json(v: string | undefined): unknown {
  if (!v) return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

function numAttr(el: XmlElement, k: string): number | undefined {
  const v = el.attrs[k];
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function part(g: XmlElement, name: string): XmlElement | undefined {
  return childElements(g).find((c) => c.attrs['data-fc-part'] === name);
}

function dashArrayOf(v: string | undefined): number[] | undefined {
  if (!v) return undefined;
  const nums = v.split(/[\s,]+/).map(Number).filter(Number.isFinite);
  return nums.length >= 2 ? nums : undefined;
}

function textLines(t: XmlElement): string {
  const spans = childElements(t).filter((c) => localName(c.name) === 'tspan');
  if (!spans.length) return textContent(t);
  return spans.map((s) => (textContent(s) === ' ' ? '' : textContent(s))).join('\n');
}

function endpoint(g: XmlElement, prefix: 'source' | 'target') {
  const objectId = g.attrs[`data-fc-${prefix}`];
  const port = g.attrs[`data-fc-${prefix}-port`];
  const fx = numAttr(g, `data-fc-${prefix}-fx`);
  const fy = numAttr(g, `data-fc-${prefix}-fy`);
  const floating = g.attrs[`data-fc-${prefix}-floating`] === '1';
  if (!objectId && !port && fx === undefined) return undefined;
  return { objectId, port, fx, fy, ...(floating ? { floating: true } : {}) };
}

export function readAnnotatedSvg(root: XmlElement): Record<string, unknown> {
  const objects: Record<string, unknown>[] = [];
  const connectors: Record<string, unknown>[] = [];

  const visit = (el: XmlElement) => {
    for (const g of childElements(el)) {
      const role = g.attrs['data-fc-role'];
      if (role === 'object') objects.push(readObject(g));
      else if (role === 'connector') connectors.push(readConnector(g));
      else if (localName(g.name) === 'g') visit(g);
    }
  };
  visit(root);

  return {
    canvas: { width: Number(root.attrs.width), height: Number(root.attrs.height) },
    background: {
      color: root.attrs['data-fc-bg-color'] ?? null,
      removed: root.attrs['data-fc-bg-removed'] === '1',
      transparent: root.attrs['data-fc-bg-transparent'] === '1',
    },
    objects,
    connectors,
    groups: json(root.attrs['data-fc-groups']) ?? [],
    metadata: {
      format: root.attrs['data-fc-format'] ?? 'svg',
      title: root.attrs['data-fc-title'],
      notes: json(root.attrs['data-fc-notes']) ?? [],
    },
  };
}

function readObject(g: XmlElement): Record<string, unknown> {
  const [x, y, w, h] = (g.attrs['data-fc-box'] ?? '').split(/\s+/).map(Number);
  const shape = g.attrs['data-fc-shape'];
  const outline = part(g, 'outline');
  const text = part(g, 'text');
  const meta = (json(g.attrs['data-fc-meta']) ?? {}) as Record<string, unknown>;
  const fillAttr = g.attrs['data-fc-fill'];
  const stroke = g.attrs['data-fc-stroke'] ?? outline?.attrs.stroke;
  const obj: Record<string, unknown> = {
    id: g.attrs['data-fc-id'],
    shape,
    x,
    y,
    w,
    h,
    rotation: numAttr(g, 'data-fc-rotation') ?? 0,
    z: numAttr(g, 'data-fc-z'),
    style: {
      fill: fillAttr === 'none' ? null : fillAttr,
      fillOpacity: numAttr(g, 'data-fc-fill-opacity') ?? 1,
      stroke: !stroke || stroke === 'none' ? null : stroke,
      strokeOpacity: numAttr(g, 'data-fc-stroke-opacity') ?? (outline ? numAttr(outline, 'stroke-opacity') ?? 1 : 1),
      strokeWidth: numAttr(g, 'data-fc-stroke-width') ?? (outline ? numAttr(outline, 'stroke-width') ?? 0 : 0),
      dash: g.attrs['data-fc-dash'] ?? 'solid',
      // Only an explicit source pattern is a dash array; the drawn one is derived.
      dashArray: dashArrayOf(g.attrs['data-fc-dash-array']),
      opacity: numAttr(g, 'opacity') ?? 1,
      cornerRadius: numAttr(g, 'data-fc-corner-radius') ?? 0,
      shadow: g.attrs['data-fc-shadow'] === '1',
      gradient: json(g.attrs['data-fc-gradient']) ?? null,
    },
  };
  if (shape === 'text' && !g.attrs['data-fc-stroke']) obj.style = { ...(obj.style as object), fill: null, stroke: null };
  if ((shape === 'path' || shape === 'polygon') && outline?.attrs.d) {
    try {
      obj.path = parsePathData(outline.attrs.d);
    } catch {
      /* the validator reports the missing outline */
    }
  }
  if (text) {
    obj.text = {
      content: textLines(text),
      fontSize: numAttr(text, 'font-size'),
      fontFamily: text.attrs['data-fc-font-family'] ?? text.attrs['font-family'],
      bold: text.attrs['font-weight'] === 'bold',
      italic: text.attrs['font-style'] === 'italic',
      underline: text.attrs['text-decoration'] === 'underline',
      color: text.attrs.fill,
      align: text.attrs['data-fc-align'],
      valign: text.attrs['data-fc-valign'],
      confidence: numAttr(text, 'data-fc-confidence'),
    };
  }
  if (g.attrs['data-fc-group']) obj.groupId = g.attrs['data-fc-group'];
  if (g.attrs['data-fc-locked'] === '1') obj.locked = true;
  const conf = numAttr(g, 'data-fc-confidence');
  if (conf !== undefined) obj.confidence = conf;
  if (g.attrs['data-fc-source-id']) obj.sourceId = g.attrs['data-fc-source-id'];
  if (meta.image) obj.image = meta.image;
  if (meta.notes) obj.notes = meta.notes;
  if (meta.preserved) obj.preserved = meta.preserved;
  return obj;
}

function readConnector(g: XmlElement): Record<string, unknown> {
  const line = part(g, 'line');
  const label = part(g, 'label');
  const meta = (json(g.attrs['data-fc-meta']) ?? {}) as Record<string, unknown>;
  const points = (g.attrs['data-fc-points'] ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x, y };
    });
  const routing = g.attrs['data-fc-routing'];
  const c: Record<string, unknown> = {
    id: g.attrs['data-fc-id'],
    z: numAttr(g, 'data-fc-z'),
    points,
    routing,
    arrowStart: g.attrs['data-fc-arrow-start'] ?? 'none',
    arrowEnd: g.attrs['data-fc-arrow-end'] ?? 'none',
    style: {
      stroke: line?.attrs.stroke,
      strokeWidth: line ? numAttr(line, 'stroke-width') : undefined,
      strokeOpacity: line ? numAttr(line, 'stroke-opacity') ?? 1 : 1,
      dash: g.attrs['data-fc-dash'] ?? 'solid',
      dashArray: dashArrayOf(g.attrs['data-fc-dash-array']),
      opacity: numAttr(g, 'opacity') ?? 1,
    },
  };
  const source = endpoint(g, 'source');
  const target = endpoint(g, 'target');
  if (source) c.source = source;
  if (target) c.target = target;
  if (g.attrs['data-fc-rounded'] === '1') c.rounded = true;
  const cr = numAttr(g, 'data-fc-corner-radius');
  if (cr !== undefined) c.cornerRadius = cr;
  const as = numAttr(g, 'data-fc-arrow-size');
  if (as !== undefined) c.arrowSize = as;
  if (routing === 'curved' && line?.attrs.d) {
    try {
      c.curve = parsePathData(line.attrs.d);
    } catch {
      /* straight fallback */
    }
  }
  if (label) {
    c.label = {
      text: textContent(label),
      position: numAttr(label, 'data-fc-position') ?? 0.5,
      offset: numAttr(label, 'data-fc-offset') ?? 0,
      fontSize: numAttr(label, 'font-size'),
      color: label.attrs.fill,
      background: label.attrs['data-fc-background'] === '1',
      bold: label.attrs['font-weight'] === 'bold',
      italic: label.attrs['font-style'] === 'italic',
      confidence: numAttr(label, 'data-fc-confidence'),
    };
  }
  const conf = numAttr(g, 'data-fc-confidence');
  if (conf !== undefined) c.confidence = conf;
  if (g.attrs['data-fc-source-id']) c.sourceId = g.attrs['data-fc-source-id'];
  if (meta.notes) c.notes = meta.notes;
  if (meta.preserved) c.preserved = meta.preserved;
  return c;
}
