import type { Point, Rect } from '../../model/types';
import type { Seg } from '../../model/path';
import { flattenOutline, pointInRing } from '../../model/hittest';
import { distanceToSegment } from '../../model/geometry';
import { parseColor } from '../conversion/color';
import type { ReportBuilder } from '../report';
import type { IRArrow, IRDiagram, IRGradient, IRShapeType, IRStyle } from '../ir/types';
import { validateIR } from '../ir/validate';
import { segsBounds } from '../ir/shapes';
import { XmlElement, attr, childElements, localName, parseXml, textContent } from '../xml/parser';
import { sanitizeSvg } from './sanitize';
import { CssRule, cascade, parseCss, parseDeclarations } from './css';
import { Matrix, apply, decompose, meanScale, multiply, parseTransform, transformSegs, translateM } from './transform';
import { parsePathData, polygonVertices, subpaths } from './pathData';
import { readAnnotatedSvg } from './annotated';

/**
 * SVG -> IR.
 *
 * The parser rebuilds *meaning* from drawing primitives: rectangles become
 * rectangles, a filled triangle sitting at the end of a line becomes that
 * line's arrowhead, text inside a shape becomes the shape's label, and a line
 * whose end touches a shape becomes a connector bound to it (in the mapper).
 * Only geometry that matches nothing is kept as an exact outline.
 */

/* ------------------------------------------------------------ styles */

const INHERITED = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-dasharray',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'visibility',
  'marker-start',
  'marker-end',
  'color',
  'text-decoration',
  'white-space',
] as const;

const PRESENTATION = new Set<string>([
  ...INHERITED,
  'opacity',
  'display',
  'filter',
  'rx',
  'ry',
  'alignment-baseline',
]);

type Computed = Record<string, string>;

const DEFAULTS: Computed = {
  fill: '#000000',
  stroke: 'none',
  'stroke-width': '1',
  'font-size': '16',
  'font-family': 'serif',
  'font-weight': 'normal',
  'font-style': 'normal',
  'text-anchor': 'start',
  visibility: 'visible',
  color: '#000000',
};

/* ------------------------------------------------------------- items */

interface BaseItem {
  id: string;
  z: number;
  groups: string[];
  sourceId?: string;
}

interface ShapeItem extends BaseItem {
  kind: 'shape';
  shape: IRShapeType;
  /** World-space outline. */
  segs: Seg[];
  /** Semantic box for rect/ellipse, in the unrotated frame. */
  box?: Rect & { rotation: number };
  style: IRStyle;
  text?: TextItem[];
  absorbed?: boolean;
}

interface LineItem extends BaseItem {
  kind: 'line';
  absorbed?: boolean;
  segs: Seg[];
  style: IRStyle;
  arrowStart: IRArrow;
  arrowEnd: IRArrow;
  arrowSize?: number;
  label?: TextItem;
  labelPlate?: boolean;
}

interface TextItem extends BaseItem {
  kind: 'text';
  lines: string[];
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  anchor: 'start' | 'middle' | 'end';
  /** World-space box of the text block (unrotated frame). */
  box: Rect;
  rotation: number;
  attached?: boolean;
}

interface ImageItem extends BaseItem {
  kind: 'image';
  box: Rect & { rotation: number };
  href: string;
}

type Item = ShapeItem | LineItem | TextItem | ImageItem;

/* ------------------------------------------------------------- units */

function parseLength(v: string | undefined, ref = 0, fontSize = 16): number | null {
  if (v === undefined) return null;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in|em|ex|%)?\s*$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  switch ((m[2] ?? '').toLowerCase()) {
    case 'pt':
      return n * (4 / 3);
    case 'pc':
      return n * 16;
    case 'mm':
      return n * (96 / 25.4);
    case 'cm':
      return n * (96 / 2.54);
    case 'in':
      return n * 96;
    case 'em':
      return n * fontSize;
    case 'ex':
      return n * fontSize * 0.5;
    case '%':
      return (n / 100) * ref;
    default:
      return n;
  }
}

/* ------------------------------------------------------------ parser */

class SvgReader {
  items: Item[] = [];
  private z = 0;
  private seq = 0;
  private rules: CssRule[] = [];
  private byId = new Map<string, XmlElement>();
  private gradients = new Map<string, IRGradient>();
  private shadows = new Set<string>();
  private markers = new Map<string, IRArrow>();
  groupNames = new Map<string, string>();
  groupParents = new Map<string, string | undefined>();
  counts = { hidden: 0, invisible: 0, clipped: 0, patterns: 0, unsupported: new Map<string, number>(), foreignNoPos: 0, gradientTransform: 0 };
  viewport = { width: 0, height: 0 };

  constructor(
    private root: XmlElement,
    private report: ReportBuilder,
  ) {}

  private nextId(prefix: string) {
    return `${prefix}${++this.seq}`;
  }

  rootBackground: string | null = null;

  run() {
    const rootCss = parseDeclarations(this.root.attrs.style ?? '');
    const bg = parseColor(rootCss['background-color'] ?? rootCss.background ?? '');
    if (bg && bg.alpha > 0) this.rootBackground = bg.hex;
    this.index(this.root);
    for (const st of this.findAll(this.root, 'style')) this.rules.push(...parseCss(textContent(st), this.rules.length));
    this.collectDefs();
    const rootM = this.viewportTransform(this.root, true);
    this.walk(this.root, rootM, this.computeStyle(this.root, [], DEFAULTS), [], [], 1);
  }

  private findAll(el: XmlElement, name: string, out: XmlElement[] = []) {
    for (const c of childElements(el)) {
      if (localName(c.name) === name) out.push(c);
      this.findAll(c, name, out);
    }
    return out;
  }

  private index(el: XmlElement) {
    if (el.attrs.id && !this.byId.has(el.attrs.id)) this.byId.set(el.attrs.id, el);
    for (const c of childElements(el)) this.index(c);
  }

  /* ------------------------------------------------------ viewports */

  private viewportTransform(el: XmlElement, isRoot: boolean, wOverride?: number, hOverride?: number): Matrix {
    const vb = (attr(el, 'viewBox') ?? '').split(/[\s,]+/).map(Number);
    const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
    let w = wOverride ?? parseLength(attr(el, 'width'), hasVb ? vb[2] : 0) ?? (hasVb ? vb[2] : 0);
    let h = hOverride ?? parseLength(attr(el, 'height'), hasVb ? vb[3] : 0) ?? (hasVb ? vb[3] : 0);
    if (!(w > 0) && hasVb) w = vb[2];
    if (!(h > 0) && hasVb) h = vb[3];
    if (isRoot) this.viewport = { width: w || 0, height: h || 0 };
    const x = isRoot ? 0 : parseLength(attr(el, 'x')) ?? 0;
    const y = isRoot ? 0 : parseLength(attr(el, 'y')) ?? 0;
    if (!hasVb || !(w > 0) || !(h > 0)) return translateM(x, y);
    const par = (attr(el, 'preserveAspectRatio') ?? 'xMidYMid meet').trim();
    let sx = w / vb[2];
    let sy = h / vb[3];
    let tx = x - vb[0] * sx;
    let ty = y - vb[1] * sy;
    if (!par.startsWith('none')) {
      const slice = /slice/.test(par);
      const s = slice ? Math.max(sx, sy) : Math.min(sx, sy);
      const alignX = /xMin/.test(par) ? 0 : /xMax/.test(par) ? 1 : 0.5;
      const alignY = /YMin/.test(par) ? 0 : /YMax/.test(par) ? 1 : 0.5;
      tx = x - vb[0] * s + (w - vb[2] * s) * alignX;
      ty = y - vb[1] * s + (h - vb[3] * s) * alignY;
      sx = sy = s;
    }
    return [sx, 0, 0, sy, tx, ty];
  }

  /* ---------------------------------------------------------- defs */

  private stopsOf(el: XmlElement, depth = 0): XmlElement[] {
    const stops = childElements(el).filter((c) => localName(c.name) === 'stop');
    if (stops.length || depth > 5) return stops;
    const href = attr(el, 'href');
    const ref = href?.startsWith('#') ? this.byId.get(href.slice(1)) : undefined;
    return ref ? this.stopsOf(ref, depth + 1) : [];
  }

  private stopColor(stop: XmlElement): string | null {
    const decl = parseDeclarations(stop.attrs.style ?? '');
    return parseColor(decl['stop-color'] ?? attr(stop, 'stop-color') ?? '#000000')?.hex ?? null;
  }

  private collectDefs() {
    for (const [id, el] of this.byId) {
      const name = localName(el.name);
      if (name === 'lineargradient' || name === 'radialgradient') {
        const stops = this.stopsOf(el);
        if (stops.length === 0) continue;
        const from = this.stopColor(stops[0]);
        const to = this.stopColor(stops[stops.length - 1]);
        if (!from || !to) continue;
        let angle = 90;
        if (name === 'lineargradient') {
          const num = (k: string, d: number) => {
            const v = attr(el, k);
            if (v === undefined) return d;
            return v.trim().endsWith('%') ? parseFloat(v) / 100 : Number(v);
          };
          const dx = num('x2', 1) - num('x1', 0);
          const dy = num('y2', 0) - num('y1', 0);
          angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
          if (attr(el, 'gradientTransform')) this.counts.gradientTransform++;
        }
        const g: IRGradient = { type: name === 'radialgradient' ? 'radial' : 'linear', from, to, angle };
        if (stops.length > 2) g.stops = stops.length;
        this.gradients.set(id, g);
      } else if (name === 'filter') {
        const kids = this.findAll(el, 'fedropshadow').length + this.findAll(el, 'feoffset').length;
        if (kids) this.shadows.add(id);
      } else if (name === 'marker') {
        this.markers.set(id, this.classifyMarker(el));
      }
    }
  }

  private classifyMarker(marker: XmlElement): IRArrow {
    const shapes = childElements(marker).filter((c) => localName(c.name) !== 'title');
    const first = shapes[0];
    if (!first) return 'stealth';
    const name = localName(first.name);
    const style = { ...parseDeclarations(first.attrs.style ?? '') };
    const fill = style.fill ?? attr(first, 'fill') ?? '#000';
    const filled = fill !== 'none' && fill !== 'transparent';
    if (name === 'circle' || name === 'ellipse') return filled ? 'circle' : 'open-circle';
    let pts: Point[] | null = null;
    let closed = true;
    if (name === 'path') {
      try {
        const segs = parsePathData(attr(first, 'd') ?? '');
        closed = segs.some((s) => s.c === 'Z');
        pts = polygonVertices(segs);
      } catch {
        return 'stealth';
      }
    } else if (name === 'polygon' || name === 'polyline') {
      closed = name === 'polygon';
      pts = parsePoints(attr(first, 'points') ?? '');
    } else if (name === 'line') {
      return 'bar';
    } else if (name === 'rect') {
      return filled ? 'diamond' : 'open-diamond';
    }
    return arrowFromVertices(pts, filled && closed, closed);
  }

  /* ------------------------------------------------------- styling */

  private computeStyle(el: XmlElement, ancestors: XmlElement[], parent: Computed): Computed {
    const own: Computed = {};
    for (const [k, v] of Object.entries(el.attrs)) {
      const key = localName(k);
      if (PRESENTATION.has(key)) own[key] = v;
    }
    Object.assign(own, cascade(this.rules, el, ancestors));
    if (el.attrs.style) Object.assign(own, parseDeclarations(el.attrs.style));
    const out: Computed = {};
    for (const k of INHERITED) {
      const v = own[k];
      out[k] = v === undefined || v === 'inherit' ? parent[k] ?? DEFAULTS[k] : v;
    }
    // Not inherited, but read per element.
    for (const k of ['opacity', 'display', 'filter', 'rx', 'ry']) if (own[k] !== undefined) out[k] = own[k];
    return out;
  }

  private paint(value: string | undefined, cs: Computed): { hex: string | null; alpha: number; gradient?: IRGradient; pattern?: boolean } {
    if (!value || value === 'none') return { hex: null, alpha: 0 };
    const url = /url\(\s*#([^)\s]+)\s*\)\s*(.*)$/.exec(value);
    if (url) {
      const g = this.gradients.get(url[1]);
      if (g) return { hex: g.from, alpha: 1, gradient: g };
      const target = this.byId.get(url[1]);
      if (target && localName(target.name) === 'pattern') {
        const fallback = parseColor(url[2]);
        return { hex: fallback?.hex ?? '#cccccc', alpha: 1, pattern: true };
      }
      const fb = parseColor(url[2]);
      return fb ? { hex: fb.hex, alpha: fb.alpha } : { hex: null, alpha: 0 };
    }
    const v = value.trim().toLowerCase() === 'currentcolor' ? cs.color : value;
    const c = parseColor(v);
    if (!c) return { hex: null, alpha: 0 };
    return { hex: c.alpha > 0 ? c.hex : null, alpha: c.alpha };
  }

  private irStyle(cs: Computed, m: Matrix, groupOpacity: number, ref: string): IRStyle {
    const fill = this.paint(cs.fill, cs);
    const stroke = this.paint(cs.stroke, cs);
    if (fill.pattern || stroke.pattern) {
      this.counts.patterns++;
      this.report.add('approximated', 'Pattern fill replaced by a flat colour.', ref);
    }
    const scale = meanScale(m);
    const sw = parseLength(cs['stroke-width']) ?? 1;
    const dashArray = (cs['stroke-dasharray'] ?? '')
      .split(/[\s,]+/)
      .map((v) => parseLength(v))
      .filter((v): v is number => v !== null && v >= 0)
      .map((v) => Math.round(v * scale * 100) / 100);
    const dash = dashArray.length >= 2 && dashArray.some((v) => v > 0) ? dashArray : undefined;
    const filterRef = /url\(\s*#([^)\s]+)\s*\)/.exec(cs.filter ?? '');
    return {
      fill: fill.hex,
      fillOpacity: clamp01(fill.alpha * num(cs['fill-opacity'], 1)),
      stroke: stroke.hex,
      strokeOpacity: clamp01(stroke.alpha * num(cs['stroke-opacity'], 1)),
      strokeWidth: stroke.hex ? Math.max(0, sw * scale) : 0,
      dash: dash ? 'dashed' : 'solid',
      ...(dash ? { dashArray: dash.length % 2 ? [...dash, ...dash] : dash } : {}),
      opacity: clamp01(num(cs.opacity, 1) * groupOpacity),
      cornerRadius: 0,
      shadow: !!filterRef && this.shadows.has(filterRef[1]),
      gradient: fill.gradient ?? null,
    };
  }

  /* ---------------------------------------------------------- walk */

  private walk(
    el: XmlElement,
    m: Matrix,
    cs: Computed,
    ancestors: XmlElement[],
    groups: string[],
    groupOpacity: number,
    useDepth = 0,
  ) {
    for (const child of childElements(el)) {
      const name = localName(child.name);
      const childAnc = [...ancestors, el];
      const ccs = this.computeStyle(child, childAnc, cs);
      if (ccs.display === 'none') {
        this.counts.hidden++;
        continue;
      }
      if (ccs.visibility === 'hidden' || ccs.visibility === 'collapse') {
        this.counts.hidden++;
        continue;
      }
      const cm = multiply(m, parseTransform(child.attrs.transform));
      if (child.attrs['clip-path'] || child.attrs.mask) this.counts.clipped++;

      switch (name) {
        case 'g':
        case 'a': {
          const gid = child.attrs.id ? `g:${child.attrs.id}` : this.nextId('g:');
          this.groupParents.set(gid, groups[groups.length - 1]);
          const label = attr(child, 'label') ?? child.attrs['inkscape:label'] ?? child.attrs.id;
          if (label) this.groupNames.set(gid, label);
          this.walk(child, cm, ccs, childAnc, [...groups, gid], groupOpacity * num(ccs.opacity, 1), useDepth);
          break;
        }
        case 'switch': {
          // Render what the fallback renders: draw.io puts an HTML label in a
          // foreignObject and a positioned <text> after it.
          const kids = childElements(child);
          const pick = kids.find((k) => localName(k.name) === 'text') ?? kids[0];
          if (pick) {
            const wrapper: XmlElement = { ...child, children: [pick] };
            this.walk(wrapper, cm, ccs, childAnc, groups, groupOpacity * num(ccs.opacity, 1), useDepth);
          }
          break;
        }
        case 'svg': {
          const vm = multiply(cm, this.viewportTransform(child, false));
          this.walk(child, vm, ccs, childAnc, groups, groupOpacity * num(ccs.opacity, 1), useDepth);
          break;
        }
        case 'use': {
          const href = attr(child, 'href');
          const target = href?.startsWith('#') ? this.byId.get(href.slice(1)) : undefined;
          if (!target || useDepth > 8) {
            if (!target) this.report.add('unsupported', 'A <use> reference to a missing element was skipped.');
            break;
          }
          const tx = parseLength(attr(child, 'x')) ?? 0;
          const ty = parseLength(attr(child, 'y')) ?? 0;
          let um = multiply(cm, translateM(tx, ty));
          const tname = localName(target.name);
          const wrapper: XmlElement = { type: 'element', name: 'g', attrs: Object.create(null), children: [target] };
          if (tname === 'symbol') {
            const w = parseLength(attr(child, 'width'));
            const h = parseLength(attr(child, 'height'));
            um = multiply(um, this.viewportTransform(target, false, w ?? undefined, h ?? undefined));
            wrapper.children = target.children;
          }
          this.walk(wrapper, um, ccs, childAnc, groups, groupOpacity * num(ccs.opacity, 1), useDepth + 1);
          break;
        }
        case 'defs':
        case 'symbol':
        case 'marker':
        case 'clippath':
        case 'mask':
        case 'pattern':
        case 'lineargradient':
        case 'radialgradient':
        case 'filter':
        case 'style':
        case 'title':
        case 'desc':
        case 'metadata':
          break;
        case 'rect':
        case 'circle':
        case 'ellipse':
        case 'line':
        case 'polyline':
        case 'polygon':
        case 'path':
          this.readGeometry(child, name, cm, ccs, groups, groupOpacity);
          break;
        case 'text':
          this.readText(child, cm, ccs, groups);
          break;
        case 'foreignobject':
          this.readForeignObject(child, cm, ccs, groups);
          break;
        case 'image':
          this.readImage(child, cm, groups);
          break;
        default: {
          if (name.startsWith('sodipodi') || name.startsWith('inkscape') || child.name.includes(':')) break;
          const count = this.counts.unsupported.get(name) ?? 0;
          this.counts.unsupported.set(name, count + 1);
        }
      }
    }
  }

  /* ------------------------------------------------------ geometry */

  private readGeometry(el: XmlElement, name: string, m: Matrix, cs: Computed, groups: string[], gOpacity: number) {
    const ref = el.attrs.id ?? `${name}#${this.z}`;
    const style = this.irStyle(cs, m, gOpacity, ref);
    const invisible = (!style.fill || style.fillOpacity === 0) && (!style.stroke || style.strokeOpacity === 0 || style.strokeWidth === 0);
    if (invisible || style.opacity === 0) {
      this.counts.invisible++;
      return;
    }
    const vp = this.viewport;
    const base = { groups, sourceId: el.attrs.id, z: this.z++ };

    if (name === 'rect' || name === 'circle' || name === 'ellipse') {
      let local: Rect;
      let shape: IRShapeType;
      let r = 0;
      if (name === 'rect') {
        const x = parseLength(attr(el, 'x'), vp.width) ?? 0;
        const y = parseLength(attr(el, 'y'), vp.height) ?? 0;
        const w = parseLength(attr(el, 'width'), vp.width) ?? 0;
        const h = parseLength(attr(el, 'height'), vp.height) ?? 0;
        if (!(w > 0) || !(h > 0)) return;
        const rx = parseLength(cs.rx ?? attr(el, 'rx'), vp.width);
        const ry = parseLength(cs.ry ?? attr(el, 'ry'), vp.height);
        r = Math.min(rx ?? ry ?? 0, w / 2, h / 2);
        local = { x, y, w, h };
        shape = r > 0 ? 'rounded-rectangle' : 'rectangle';
      } else {
        const cx = parseLength(attr(el, 'cx'), vp.width) ?? 0;
        const cy = parseLength(attr(el, 'cy'), vp.height) ?? 0;
        let rx: number;
        let ry: number;
        if (name === 'circle') {
          rx = ry = parseLength(attr(el, 'r'), Math.hypot(vp.width, vp.height) / Math.SQRT2) ?? 0;
        } else {
          rx = parseLength(cs.rx ?? attr(el, 'rx'), vp.width) ?? 0;
          ry = parseLength(cs.ry ?? attr(el, 'ry'), vp.height) ?? rx;
        }
        if (!(rx > 0) || !(ry > 0)) return;
        local = { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 };
        shape = 'ellipse';
      }
      const localSegs = name === 'rect' ? rectSegs(local, r) : ellipseSegs(local);
      const world = transformSegs(localSegs, m);
      const dm = decompose(m);
      if (dm.skewed) {
        this.items.push({ ...base, kind: 'shape', id: this.nextId('s'), shape: 'path', segs: world, style });
        return;
      }
      const centre = apply(m, { x: local.x + local.w / 2, y: local.y + local.h / 2 });
      const w = local.w * dm.sx;
      const h = local.h * dm.sy;
      if (name !== 'rect' && Math.abs(w - h) < 0.01 * Math.max(w, h)) shape = 'circle';
      style.cornerRadius = r * Math.min(dm.sx, dm.sy);
      this.items.push({
        ...base,
        kind: 'shape',
        id: this.nextId('s'),
        shape,
        segs: world,
        box: { x: centre.x - w / 2, y: centre.y - h / 2, w, h, rotation: normDeg(dm.rotation) },
        style,
      });
      return;
    }

    let segs: Seg[];
    try {
      if (name === 'line') {
        const p1 = { x: parseLength(attr(el, 'x1'), vp.width) ?? 0, y: parseLength(attr(el, 'y1'), vp.height) ?? 0 };
        const p2 = { x: parseLength(attr(el, 'x2'), vp.width) ?? 0, y: parseLength(attr(el, 'y2'), vp.height) ?? 0 };
        segs = [
          { c: 'M', p: p1 },
          { c: 'L', p: p2 },
        ];
      } else if (name === 'polyline' || name === 'polygon') {
        const pts = parsePoints(attr(el, 'points') ?? '');
        if (pts.length < 2) return;
        segs = pts.map((p, i) => (i === 0 ? { c: 'M' as const, p } : { c: 'L' as const, p }));
        if (name === 'polygon') segs.push({ c: 'Z' });
      } else {
        segs = parsePathData(attr(el, 'd') ?? '');
      }
    } catch {
      this.report.add('unsupported', `A <${name}> with malformed geometry was skipped.`, ref);
      return;
    }
    if (segs.length < 2) return;
    const world = transformSegs(segs, m);
    const closed = world.some((s) => s.c === 'Z');
    const fillVisible = !!style.fill && style.fillOpacity > 0 && name !== 'line';
    const markerStart = this.markerFor(cs['marker-start']);
    const markerEnd = this.markerFor(cs['marker-end']);

    if (closed || (fillVisible && name !== 'polyline' && vertexCount(world) >= 3 && !markerStart && !markerEnd)) {
      const shapeSegs = closed ? world : [...world, { c: 'Z' as const }];
      this.items.push({ ...base, kind: 'shape', id: this.nextId('s'), shape: name === 'polygon' ? 'polygon' : 'path', segs: shapeSegs, style });
      return;
    }
    if (!style.stroke) {
      this.counts.invisible++;
      return;
    }
    // Each open subpath is its own line.
    for (const sp of subpaths(world)) {
      this.items.push({
        ...base,
        kind: 'line',
        id: this.nextId('l'),
        segs: sp,
        style: { ...style, fill: null },
        arrowStart: markerStart ?? 'none',
        arrowEnd: markerEnd ?? 'none',
        z: base.z,
      });
    }
  }

  private markerFor(v: string | undefined): IRArrow | null {
    const m = /url\(\s*#([^)\s]+)\s*\)/.exec(v ?? '');
    return m ? this.markers.get(m[1]) ?? 'stealth' : null;
  }

  /* ---------------------------------------------------------- text */

  private textStyleOf(cs: Computed, m: Matrix) {
    const scale = meanScale(m);
    const fontSize = (parseLength(cs['font-size']) ?? 16) * scale;
    const weight = cs['font-weight'] ?? 'normal';
    return {
      fontSize,
      fontFamily: cs['font-family'] ?? 'serif',
      bold: weight === 'bold' || weight === 'bolder' || Number(weight) >= 600,
      italic: /italic|oblique/.test(cs['font-style'] ?? ''),
      underline: /underline/.test(cs['text-decoration'] ?? ''),
      color: this.paint(cs.fill, cs).hex ?? '#000000',
    };
  }

  private readText(el: XmlElement, m: Matrix, cs: Computed, groups: string[]) {
    const preserve = el.attrs['xml:space'] === 'preserve' || cs['white-space'] === 'pre';
    const ts = this.textStyleOf(cs, m);
    const baseFont = parseLength(cs['font-size']) ?? 16;
    let x = parseLength(firstNum(attr(el, 'x'))) ?? 0;
    let y = parseLength(firstNum(attr(el, 'y'))) ?? 0;
    const chunks: { x: number; y: number; text: string; anchor: string }[] = [];
    const push = (text: string, cx: number, cy: number, anchor: string) => {
      const t = preserve ? text.replace(/[\r\n\t]/g, ' ') : text.replace(/\s+/g, ' ');
      if (!t.trim() && !chunks.length) return;
      const last = chunks[chunks.length - 1];
      if (last && Math.abs(last.y - cy) < baseFont * 0.4 && Math.abs(cx - x) < 1e-9) last.text += t;
      else chunks.push({ x: cx, y: cy, text: t, anchor });
    };
    const visit = (node: XmlElement, anchor: string, depth: number) => {
      for (const c of node.children) {
        if (c.type === 'text') {
          push(c.value, x, y, anchor);
          continue;
        }
        const n = localName(c.name);
        if (n !== 'tspan' && n !== 'a' && n !== 'textpath') continue;
        const tcs = parseDeclarations(c.attrs.style ?? '');
        if (tcs.display === 'none' || c.attrs.display === 'none') continue;
        const nx = parseLength(firstNum(attr(c, 'x')));
        const ny = parseLength(firstNum(attr(c, 'y')));
        const dy = parseLength(firstNum(attr(c, 'dy')), 0, baseFont);
        const dx = parseLength(firstNum(attr(c, 'dx')), 0, baseFont);
        if (nx !== null) x = nx;
        if (ny !== null) y = ny;
        if (dy !== null) y += dy;
        if (dx !== null) x += dx;
        const a = c.attrs['text-anchor'] ?? tcs['text-anchor'] ?? anchor;
        if (depth < 8) visit(c, a, depth + 1);
      }
    };
    visit(el, cs['text-anchor'] ?? 'start', 0);
    const lines = chunks.map((c) => (preserve ? c.text : c.text.trim())).filter((l, i, all) => l.length || (i > 0 && i < all.length - 1));
    if (!lines.join('').trim()) return;

    const scale = meanScale(m);
    const dm = decompose(m);
    const first = chunks[0];
    const anchor = (first.anchor === 'middle' || first.anchor === 'end' ? first.anchor : 'start') as TextItem['anchor'];
    const lineHeight = chunks.length > 1 ? Math.abs(chunks[chunks.length - 1].y - first.y) / (chunks.length - 1) : baseFont * 1.2;
    const longest = lines.reduce((a, l) => Math.max(a, l.length), 0);
    const wLocal = longest * baseFont * avgChar(ts.fontFamily);
    const hLocal = (lines.length - 1) * lineHeight + baseFont * 1.2;
    const db = cs['dominant-baseline'] ?? '';
    // Top of the block from the first baseline, per dominant-baseline.
    let topLocal = first.y - baseFont * 0.9;
    if (/middle|central/.test(db)) topLocal = first.y - baseFont * 0.6;
    if (/hanging|text-before-edge/.test(db)) topLocal = first.y - baseFont * 0.1;
    const leftLocal = anchor === 'middle' ? first.x - wLocal / 2 : anchor === 'end' ? first.x - wLocal : first.x;
    const centreWorld = apply(m, { x: leftLocal + wLocal / 2, y: topLocal + hLocal / 2 });
    const w = wLocal * scale;
    const h = hLocal * scale;
    this.items.push({
      kind: 'text',
      id: this.nextId('t'),
      z: this.z++,
      groups,
      sourceId: el.attrs.id,
      lines,
      ...ts,
      anchor,
      box: { x: centreWorld.x - w / 2, y: centreWorld.y - h / 2, w, h },
      rotation: dm.skewed ? 0 : normDeg(dm.rotation),
    });
  }

  private readForeignObject(el: XmlElement, m: Matrix, cs: Computed, groups: string[]) {
    const text = textContent(el).trim();
    if (!text) return;
    const w = parseLength(attr(el, 'width'), this.viewport.width) ?? 0;
    const h = parseLength(attr(el, 'height'), this.viewport.height) ?? 0;
    if (w < 4 || h < 4 || String(attr(el, 'width')).includes('%')) {
      this.counts.foreignNoPos++;
      return;
    }
    const x = parseLength(attr(el, 'x')) ?? 0;
    const y = parseLength(attr(el, 'y')) ?? 0;
    const ts = this.textStyleOf(cs, m);
    const tl = apply(m, { x, y });
    const s = meanScale(m);
    this.items.push({
      kind: 'text',
      id: this.nextId('t'),
      z: this.z++,
      groups,
      lines: text.split('\n'),
      ...ts,
      anchor: 'middle',
      box: { x: tl.x, y: tl.y, w: w * s, h: h * s },
      rotation: 0,
    });
  }

  private readImage(el: XmlElement, m: Matrix, groups: string[]) {
    const href = attr(el, 'href');
    const w = parseLength(attr(el, 'width'), this.viewport.width) ?? 0;
    const h = parseLength(attr(el, 'height'), this.viewport.height) ?? 0;
    if (!(w > 0) || !(h > 0)) return;
    const x = parseLength(attr(el, 'x')) ?? 0;
    const y = parseLength(attr(el, 'y')) ?? 0;
    const dm = decompose(m);
    const c = apply(m, { x: x + w / 2, y: y + h / 2 });
    const ww = w * dm.sx;
    const hh = h * dm.sy;
    if (!href) this.report.add('unsupported', 'An image that referenced an external file was imported as an empty frame (external files are never fetched).');
    this.items.push({
      kind: 'image',
      id: this.nextId('i'),
      z: this.z++,
      groups,
      sourceId: el.attrs.id,
      href: href ?? '',
      box: { x: c.x - ww / 2, y: c.y - hh / 2, w: ww, h: hh, rotation: normDeg(dm.rotation) },
    });
  }
}

/* ------------------------------------------------------------- utils */

function num(v: string | undefined, d: number): number {
  if (v === undefined) return d;
  const t = v.trim();
  const n = t.endsWith('%') ? parseFloat(t) / 100 : Number(t);
  return Number.isFinite(n) ? n : d;
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function normDeg(d: number): number {
  let a = Math.round(d * 1000) / 1000;
  if (Math.abs(a) < 0.001) a = 0;
  while (a > 180) a -= 360;
  while (a <= -180) a += 360;
  return a;
}

function firstNum(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return v.trim().split(/[\s,]+/)[0];
}

function avgChar(family: string): number {
  return /mono|courier/i.test(family) ? 0.6 : 0.55;
}

export function parsePoints(s: string): Point[] {
  const nums = s
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const pts: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    if (Number.isFinite(nums[i]) && Number.isFinite(nums[i + 1])) pts.push({ x: nums[i], y: nums[i + 1] });
  }
  return pts;
}

function rectSegs(r: Rect, radius: number): Seg[] {
  if (radius <= 0) {
    return [
      { c: 'M', p: { x: r.x, y: r.y } },
      { c: 'L', p: { x: r.x + r.w, y: r.y } },
      { c: 'L', p: { x: r.x + r.w, y: r.y + r.h } },
      { c: 'L', p: { x: r.x, y: r.y + r.h } },
      { c: 'Z' },
    ];
  }
  const k = radius * 0.5523;
  const { x, y, w, h } = r;
  return [
    { c: 'M', p: { x: x + radius, y } },
    { c: 'L', p: { x: x + w - radius, y } },
    { c: 'C', c1: { x: x + w - radius + k, y }, c2: { x: x + w, y: y + radius - k }, p: { x: x + w, y: y + radius } },
    { c: 'L', p: { x: x + w, y: y + h - radius } },
    { c: 'C', c1: { x: x + w, y: y + h - radius + k }, c2: { x: x + w - radius + k, y: y + h }, p: { x: x + w - radius, y: y + h } },
    { c: 'L', p: { x: x + radius, y: y + h } },
    { c: 'C', c1: { x: x + radius - k, y: y + h }, c2: { x, y: y + h - radius + k }, p: { x, y: y + h - radius } },
    { c: 'L', p: { x, y: y + radius } },
    { c: 'C', c1: { x, y: y + radius - k }, c2: { x: x + radius - k, y }, p: { x: x + radius, y } },
    { c: 'Z' },
  ];
}

function ellipseSegs(r: Rect): Seg[] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rx = r.w / 2;
  const ry = r.h / 2;
  const kx = rx * 0.5523;
  const ky = ry * 0.5523;
  return [
    { c: 'M', p: { x: cx, y: cy - ry } },
    { c: 'C', c1: { x: cx + kx, y: cy - ry }, c2: { x: cx + rx, y: cy - ky }, p: { x: cx + rx, y: cy } },
    { c: 'C', c1: { x: cx + rx, y: cy + ky }, c2: { x: cx + kx, y: cy + ry }, p: { x: cx, y: cy + ry } },
    { c: 'C', c1: { x: cx - kx, y: cy + ry }, c2: { x: cx - rx, y: cy + ky }, p: { x: cx - rx, y: cy } },
    { c: 'C', c1: { x: cx - rx, y: cy - ky }, c2: { x: cx - kx, y: cy - ry }, p: { x: cx, y: cy - ry } },
    { c: 'Z' },
  ];
}

function vertexCount(segs: Seg[]): number {
  return segs.filter((s) => s.c !== 'Z').length;
}

function cross(o: Point, a: Point, b: Point) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Classify an arrowhead drawn as a polygon. */
export function arrowFromVertices(pts: Point[] | null, filled: boolean, closed: boolean): IRArrow {
  if (!pts || pts.length < 2) return filled ? 'triangle' : 'open';
  if (!closed) return pts.length === 2 ? 'bar' : 'open';
  if (pts.length === 3) return filled ? 'triangle' : 'open-triangle';
  if (pts.length === 4) {
    // Concave quadrilateral = the notched "stealth"/"classic" head; convex = diamond.
    let pos = 0;
    let neg = 0;
    for (let i = 0; i < 4; i++) {
      const c = cross(pts[i], pts[(i + 1) % 4], pts[(i + 2) % 4]);
      if (c > 0) pos++;
      else if (c < 0) neg++;
    }
    const concave = pos > 0 && neg > 0;
    if (concave) return 'stealth';
    return filled ? 'diamond' : 'open-diamond';
  }
  return filled ? 'circle' : 'open-circle';
}

function segsVertices(segs: Seg[]): Point[] {
  const out: Point[] = [];
  for (const s of segs) if (s.c !== 'Z') out.push(s.p);
  return out;
}

function endpointOf(segs: Seg[], end: 'start' | 'end'): { p: Point; dir: Point } {
  const pts = segsVertices(segs);
  if (end === 'start') {
    const p = pts[0];
    const first = segs[1];
    const q = first && first.c === 'C' ? first.c1 : pts[1] ?? p;
    const len = Math.hypot(p.x - q.x, p.y - q.y) || 1;
    return { p, dir: { x: (p.x - q.x) / len, y: (p.y - q.y) / len } };
  }
  const p = pts[pts.length - 1];
  const last = segs[segs.length - 1];
  const q = last && last.c === 'C' ? last.c2 : pts[pts.length - 2] ?? p;
  const len = Math.hypot(p.x - q.x, p.y - q.y) || 1;
  return { p, dir: { x: (p.x - q.x) / len, y: (p.y - q.y) / len } };
}

function ringsOf(segs: Seg[]) {
  return flattenOutline(segs);
}

function distToSegs(p: Point, segs: Seg[]): number {
  let best = Infinity;
  for (const ring of ringsOf(segs)) {
    for (let i = 1; i < ring.length; i++) best = Math.min(best, distanceToSegment(p, ring[i - 1], ring[i]));
  }
  return best;
}

function containsPoint(segs: Seg[], p: Point): boolean {
  return ringsOf(segs).some((r) => pointInRing(r, p));
}

function boxContains(outer: Rect, inner: Rect, slack = 1): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.w <= outer.x + outer.w + slack &&
    inner.y + inner.h <= outer.y + outer.h + slack
  );
}

/* ------------------------------------------------------ post-process */

interface Built {
  raw: Record<string, unknown>;
}

function postProcess(reader: SvgReader, report: ReportBuilder, format: string): Built {
  const items = reader.items;
  const shapes = items.filter((i): i is ShapeItem => i.kind === 'shape');
  const lines = items.filter((i): i is LineItem => i.kind === 'line');
  const texts = items.filter((i): i is TextItem => i.kind === 'text');
  const images = items.filter((i): i is ImageItem => i.kind === 'image');
  const vp = reader.viewport;

  /* ---- background: the root's CSS background, or a full-canvas rectangle at the very back */
  let backgroundColor: string | null = reader.rootBackground;
  let backgroundRemoved = !!backgroundColor;
  if (backgroundColor) {
    report.add('info', `The SVG's page background (${backgroundColor}) was not carried over; the imported diagram has a transparent background.`);
  }
  const contentBox = (() => {
    const all = [...shapes.map((s) => segsBounds(s.segs)), ...lines.map((l) => segsBounds(l.segs)), ...texts.map((t) => t.box)];
    if (!all.length) return { x: 0, y: 0, w: vp.width, h: vp.height };
    const x0 = Math.min(...all.map((b) => b.x));
    const y0 = Math.min(...all.map((b) => b.y));
    const x1 = Math.max(...all.map((b) => b.x + b.w));
    const y1 = Math.max(...all.map((b) => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  })();
  const canvasArea = Math.max(1, (vp.width || contentBox.w) * (vp.height || contentBox.h));
  const lowest = shapes.slice().sort((a, b) => a.z - b.z)[0];
  if (lowest && (lowest.shape === 'rectangle' || lowest.shape === 'path' || lowest.shape === 'polygon') && lowest.style.fill) {
    const b = segsBounds(lowest.segs);
    const coversCanvas = (b.w * b.h) / canvasArea >= 0.92;
    const coversContent = boxContains(b, contentBox, 2) && (b.w * b.h) >= contentBox.w * contentBox.h * 0.98;
    const others = shapes.length + lines.length + texts.length > 1;
    if (others && coversCanvas && coversContent && lowest.box?.rotation === 0) {
      lowest.absorbed = true;
      backgroundColor = lowest.style.fill;
      backgroundRemoved = true;
      report.add('info', `Removed the full-canvas background rectangle (${lowest.style.fill}); the imported diagram has a transparent background.`);
    }
  }
  const liveShapes = () => shapes.filter((s) => !s.absorbed);

  /* ---- arrowheads drawn as separate small polygons */
  const arrowCandidates = liveShapes().filter((s) => {
    const b = segsBounds(s.segs);
    const verts = polygonVertices(s.segs);
    const small = Math.max(b.w, b.h) <= 30;
    return small && !!s.style.fill && (verts ? verts.length <= 5 : s.shape === 'circle' || s.shape === 'ellipse');
  });
  let arrowsFound = 0;
  for (const line of lines) {
    for (const end of ['start', 'end'] as const) {
      if ((end === 'start' ? line.arrowStart : line.arrowEnd) !== 'none') continue;
      const { p, dir } = endpointOf(line.segs, end);
      let best: { s: ShapeItem; d: number } | null = null;
      for (const s of arrowCandidates) {
        if (s.absorbed) continue;
        const b = segsBounds(s.segs);
        if (Math.max(b.w, b.h) > Math.max(30, line.style.strokeWidth * 12)) continue;
        const d = containsPoint(s.segs, p) ? 0 : distToSegs(p, s.segs);
        if (d <= Math.max(2.5, line.style.strokeWidth * 1.5) && (!best || d < best.d)) best = { s, d };
      }
      if (!best) continue;
      const s = best.s;
      s.absorbed = true;
      arrowsFound++;
      const verts = polygonVertices(s.segs);
      const filled = !!s.style.fill && s.style.fillOpacity > 0 && s.style.fill !== '#ffffff';
      const kind = s.shape === 'circle' || s.shape === 'ellipse' ? (filled ? 'circle' : 'open-circle') : arrowFromVertices(verts, filled || !!s.style.fill, true);
      // Extend the line to the arrow's tip: that is where it meets its target.
      const pts = verts ?? segsVertices(s.segs);
      let tip = p;
      let far = -Infinity;
      for (const v of pts) {
        const along = (v.x - p.x) * dir.x + (v.y - p.y) * dir.y;
        if (along > far) {
          far = along;
          tip = v;
        }
      }
      const b = segsBounds(s.segs);
      line.arrowSize = Math.max(b.w, b.h);
      if (far > 0.5) {
        if (end === 'end') line.segs = [...line.segs, { c: 'L', p: tip }];
        else line.segs = [{ c: 'M', p: tip }, { c: 'L', p: line.segs[0].c === 'M' ? line.segs[0].p : tip }, ...line.segs.slice(1)];
      }
      if (end === 'start') line.arrowStart = kind;
      else line.arrowEnd = kind;
    }
  }
  if (arrowsFound) report.add('info', `${arrowsFound} arrowhead${arrowsFound === 1 ? '' : 's'} drawn as separate shapes ${arrowsFound === 1 ? 'was' : 'were'} recognised and attached to ${arrowsFound === 1 ? 'its' : 'their'} connector.`);

  /* ---- decorations: open strokes that live entirely inside one shape */
  const closedShapes = () => liveShapes().filter((s) => s.shape !== 'text');
  let decorations = 0;
  for (const line of lines) {
    if (line.arrowStart !== 'none' || line.arrowEnd !== 'none') continue;
    const lb = segsBounds(line.segs);
    const hosts = closedShapes().filter((s) => boxContains(segsBounds(s.segs), lb, 1.5));
    if (!hosts.length) continue;
    hosts.sort((a, b) => segsBounds(a.segs).w * segsBounds(a.segs).h - segsBounds(b.segs).w * segsBounds(b.segs).h);
    const host = hosts[0];
    const hb = segsBounds(host.segs);
    // A connector inside a container touches other shapes; a decoration does not.
    const { p: s0 } = endpointOf(line.segs, 'start');
    const { p: s1 } = endpointOf(line.segs, 'end');
    const touchesOther = closedShapes().some(
      (o) => o !== host && !boxContains(segsBounds(o.segs), hb, 0) && (distToSegs(s0, o.segs) < 3 || distToSegs(s1, o.segs) < 3),
    );
    if (touchesOther) continue;
    if (hb.w * hb.h > canvasArea * 0.5) continue;
    host.segs = [...host.segs, ...line.segs];
    host.shape = 'path';
    host.box = undefined;
    line.absorbed = true;
    decorations++;
  }
  if (decorations) report.add('info', `${decorations} inner stroke${decorations === 1 ? '' : 's'} (symbol details such as a cylinder lid) merged into ${decorations === 1 ? 'its' : 'their'} shape.`);
  const liveLines = lines.filter((l) => !l.absorbed);

  /* ---- text attachment */
  const containers = new Set<ShapeItem>();
  for (const s of closedShapes()) {
    const b = segsBounds(s.segs);
    if (closedShapes().some((o) => o !== s && boxContains(b, segsBounds(o.segs), 0) && segsBounds(o.segs).w * segsBounds(o.segs).h < b.w * b.h * 0.9)) {
      containers.add(s);
    }
  }
  for (const t of texts) {
    const c = { x: t.box.x + t.box.w / 2, y: t.box.y + t.box.h / 2 };
    const hosts = closedShapes().filter((s) => s.z < t.z && containsPoint(s.segs, c));
    if (!hosts.length) continue;
    hosts.sort((a, b) => segsBounds(a.segs).w * segsBounds(a.segs).h - segsBounds(b.segs).w * segsBounds(b.segs).h);
    const host = hosts[0];
    const hb = segsBounds(host.segs);
    if (containers.has(host)) {
      // Only a title at the top edge of a container belongs to it.
      if (!(c.y - hb.y < Math.max(30, t.fontSize * 2.5))) continue;
    }
    host.text = [...(host.text ?? []), t];
    t.attached = true;
  }

  /* ---- connector labels */
  for (const t of texts) {
    if (t.attached) continue;
    const c = { x: t.box.x + t.box.w / 2, y: t.box.y + t.box.h / 2 };
    let best: { l: LineItem; d: number } | null = null;
    for (const l of liveLines) {
      if (l.label) continue;
      const d = distToSegs(c, l.segs);
      if (d <= Math.max(10, t.fontSize * 1.1) && (!best || d < best.d)) best = { l, d };
    }
    if (!best) continue;
    best.l.label = t;
    t.attached = true;
    // A small filled rectangle under the label is its backing plate.
    for (const s of closedShapes()) {
      const b = segsBounds(s.segs);
      if (s.z < t.z && containsPoint(s.segs, c) && b.w <= t.box.w * 2 + 16 && b.h <= t.box.h * 2 + 12 && !s.text?.length) {
        s.absorbed = true;
        best.l.labelPlate = true;
      }
    }
  }

  /* ---- raw IR */
  const objects: Record<string, unknown>[] = [];
  for (const s of liveShapes()) {
    const text = s.text?.length ? mergeTexts(s.text, segsBounds(s.segs)) : undefined;
    const common = {
      id: s.id,
      z: s.z,
      style: s.style,
      ...(text ? { text } : {}),
      ...(s.sourceId ? { sourceId: s.sourceId } : {}),
    };
    if (s.box) {
      objects.push({ ...common, shape: s.shape, x: s.box.x, y: s.box.y, w: s.box.w, h: s.box.h, rotation: s.box.rotation });
    } else {
      objects.push({ ...common, shape: 'path', path: s.segs });
    }
  }
  for (const t of texts) {
    if (t.attached) continue;
    objects.push({
      id: t.id,
      z: t.z,
      shape: 'text',
      x: t.box.x,
      y: t.box.y,
      w: t.box.w,
      h: t.box.h,
      rotation: t.rotation,
      text: textOf(t, t.anchor === 'middle' ? 'center' : t.anchor === 'end' ? 'right' : 'left', 'middle'),
      style: { fill: null, stroke: null },
      ...(t.sourceId ? { sourceId: t.sourceId } : {}),
    });
  }
  for (const im of images) {
    objects.push({
      id: im.id,
      z: im.z,
      shape: 'image',
      x: im.box.x,
      y: im.box.y,
      w: im.box.w,
      h: im.box.h,
      rotation: im.box.rotation,
      image: { href: im.href },
      style: { fill: null, stroke: '#7c8a9b' },
    });
  }

  const connectors: Record<string, unknown>[] = [];
  for (const l of liveLines) {
    const geom = lineGeometry(l.segs);
    const label = l.label
      ? (() => {
          const c = { x: l.label.box.x + l.label.box.w / 2, y: l.label.box.y + l.label.box.h / 2 };
          const { position, offset } = projectOnPolyline(geom.points, c);
          return {
            text: l.label.lines.join('\n'),
            position,
            offset,
            fontSize: l.label.fontSize,
            color: l.label.color,
            background: !!l.labelPlate,
            bold: l.label.bold,
            italic: l.label.italic,
          };
        })()
      : undefined;
    connectors.push({
      id: l.id,
      z: l.z,
      points: geom.points,
      routing: geom.routing,
      ...(geom.curve ? { curve: geom.curve } : {}),
      ...(geom.rounded ? { rounded: true } : {}),
      arrowStart: l.arrowStart,
      arrowEnd: l.arrowEnd,
      ...(l.arrowSize ? { arrowSize: l.arrowSize } : {}),
      style: {
        stroke: l.style.stroke,
        strokeWidth: l.style.strokeWidth,
        strokeOpacity: l.style.strokeOpacity,
        dash: l.style.dash,
        ...(l.style.dashArray ? { dashArray: l.style.dashArray } : {}),
        opacity: l.style.opacity,
      },
      ...(label ? { label } : {}),
      ...(l.sourceId ? { sourceId: l.sourceId } : {}),
    });
  }

  /* ---- groups from <g>: only those that gather 2+ objects but not everything */
  const objectIds = new Set(objects.map((o) => o.id as string));
  const members = new Map<string, Set<string>>();
  const itemsById = new Map<string, Item>(items.map((i) => [i.id, i]));
  for (const o of objects) {
    const item = itemsById.get(o.id as string);
    if (!item) continue;
    for (const g of item.groups) {
      if (!members.has(g)) members.set(g, new Set());
      members.get(g)!.add(o.id as string);
    }
  }
  const total = objectIds.size;
  const groups: Record<string, unknown>[] = [];
  const seenSets = new Set<string>();
  for (const [gid, set] of members) {
    if (set.size < 2 || set.size >= total) continue;
    const key = [...set].sort().join('|');
    if (seenSets.has(key)) continue;
    seenSets.add(key);
    let parent = reader.groupParents.get(gid);
    while (parent && (!members.has(parent) || members.get(parent)!.size >= total)) parent = reader.groupParents.get(parent);
    groups.push({
      id: gid.replace(/[^\w.:-]/g, '_'),
      memberIds: [...set],
      ...(reader.groupNames.get(gid) ? { name: reader.groupNames.get(gid) } : {}),
      ...(parent && members.get(parent)!.size >= 2 ? { parentId: parent.replace(/[^\w.:-]/g, '_') } : {}),
    });
  }

  return {
    raw: {
      canvas: { width: vp.width || contentBox.x + contentBox.w, height: vp.height || contentBox.y + contentBox.h },
      background: { color: backgroundColor, transparent: !backgroundColor, removed: backgroundRemoved, method: backgroundRemoved ? 'structural' : undefined },
      objects,
      connectors,
      groups,
      metadata: { format },
    },
  };
}

function textOf(t: TextItem, align: 'left' | 'center' | 'right', valign: 'top' | 'middle' | 'bottom') {
  return {
    content: t.lines.join('\n'),
    fontSize: t.fontSize,
    fontFamily: t.fontFamily,
    bold: t.bold,
    italic: t.italic,
    underline: t.underline,
    color: t.color,
    align,
    valign,
  };
}

/** Combine the text runs inside one shape into its label, in reading order. */
function mergeTexts(ts: TextItem[], host: Rect) {
  const sorted = [...ts].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const first = sorted[0];
  const top = Math.min(...sorted.map((t) => t.box.y));
  const bottom = Math.max(...sorted.map((t) => t.box.y + t.box.h));
  const left = Math.min(...sorted.map((t) => t.box.x));
  const right = Math.max(...sorted.map((t) => t.box.x + t.box.w));
  const cy = (top + bottom) / 2;
  const cx = (left + right) / 2;
  const hc = host.y + host.h / 2;
  const wc = host.x + host.w / 2;
  let valign: 'top' | 'middle' | 'bottom' = 'middle';
  if (Math.abs(cy - hc) > host.h * 0.18) valign = cy < hc ? 'top' : 'bottom';
  let align: 'left' | 'center' | 'right' = 'center';
  if (first.anchor === 'start' && Math.abs(cx - wc) > host.w * 0.12) align = 'left';
  else if (first.anchor === 'end' && Math.abs(cx - wc) > host.w * 0.12) align = 'right';
  return textOf({ ...first, lines: sorted.flatMap((t) => t.lines) }, align, valign);
}

/** Polyline / curve interpretation of an open stroke. */
function lineGeometry(segs: Seg[]): { points: Point[]; routing: string; curve?: Seg[]; rounded?: boolean } {
  const curves = segs.filter((s) => s.c === 'C');
  const vertices = segsVertices(segs);
  if (!curves.length) {
    const pts = mergeCollinear(vertices);
    const aligned = pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 1 || Math.abs(p.y - pts[i - 1].y) < 1);
    return { points: pts, routing: pts.length === 2 ? 'straight' : aligned ? 'orthogonal' : 'polyline' };
  }
  // Short curves between axis-aligned legs are rounded elbow corners.
  const shortCurves = curves.every((c) => {
    if (c.c !== 'C') return false;
    const idx = segs.indexOf(c);
    const prev = segs[idx - 1];
    const from = prev && prev.c !== 'Z' ? prev.p : c.p;
    return Math.hypot(c.p.x - from.x, c.p.y - from.y) <= 24;
  });
  if (shortCurves && segs.some((s) => s.c === 'L')) {
    const pts: Point[] = [];
    let cur: Point = { x: 0, y: 0 };
    for (const s of segs) {
      if (s.c === 'M') {
        pts.push(s.p);
        cur = s.p;
      } else if (s.c === 'L') {
        pts.push(s.p);
        cur = s.p;
      } else if (s.c === 'C') {
        // Recover the corner as the intersection-ish point of the control handles.
        const corner = { x: cur.x + 1.5 * (s.c1.x - cur.x), y: cur.y + 1.5 * (s.c1.y - cur.y) };
        pts.pop();
        pts.push(snapCorner(cur, corner, s.p));
        pts.push(s.p);
        cur = s.p;
      }
    }
    const cleaned = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0.5);
    const merged = mergeCollinear(cleaned);
    return { points: merged, routing: 'orthogonal', rounded: true };
  }
  const start = vertices[0];
  const end = vertices[vertices.length - 1];
  const interior = curves.length > 1 ? curves.slice(0, -1).map((c) => (c.c === 'C' ? c.p : start)) : [];
  return { points: [start, ...interior, end], routing: 'curved', curve: segs };
}

function snapCorner(a: Point, corner: Point, b: Point): Point {
  // Axis-aligned legs: the corner shares x with one end and y with the other.
  if (Math.abs(a.y - corner.y) < Math.abs(a.x - corner.x)) return { x: b.x, y: a.y };
  return { x: a.x, y: b.y };
}

function mergeCollinear(pts: Point[]): Point[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const crossV = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(crossV) > 0.5) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Fraction along a polyline nearest to `p`, and the signed perpendicular offset. */
export function projectOnPolyline(points: Point[], p: Point): { position: number; offset: number } {
  if (points.length < 2) return { position: 0.5, offset: 0 };
  const lens: number[] = [0];
  for (let i = 1; i < points.length; i++) lens.push(lens[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const total = lens[lens.length - 1] || 1;
  let best = { d: Infinity, at: 0, offset: 0 };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.d) {
      const len = Math.sqrt(l2);
      // The model's label offset is positive to the left of travel: n = (-ty, tx).
      const nx = -dy / len;
      const ny = dx / len;
      best = { d, at: lens[i - 1] + Math.sqrt(l2) * t, offset: (p.x - q.x) * nx + (p.y - q.y) * ny };
    }
  }
  return { position: Math.round((best.at / total) * 1000) / 1000, offset: Math.round(best.offset * 100) / 100 };
}

/* -------------------------------------------------------------- entry */

export interface SvgImportOptions {
  report: ReportBuilder;
  /** Recorded as the IR source format. */
  format?: string;
}

/** Parse, sanitise and interpret SVG markup into a validated IR. */
export function svgToIR(markup: string, opts: SvgImportOptions): IRDiagram {
  const { report } = opts;
  let root: XmlElement;
  try {
    root = parseXml(markup);
  } catch (err) {
    throw Object.assign(new Error(err instanceof Error ? err.message : 'Invalid SVG'), { svgInvalid: true });
  }
  const { root: clean, stats } = sanitizeSvg(root);
  if (stats.scripts) report.add('info', `${stats.scripts} script${stats.scripts === 1 ? '' : 's'} removed from the SVG (nothing in an imported file is ever executed).`);
  if (stats.eventHandlers) report.add('info', `${stats.eventHandlers} event-handler attribute${stats.eventHandlers === 1 ? '' : 's'} removed.`);
  if (stats.externalRefs) report.add('info', `${stats.externalRefs} external reference${stats.externalRefs === 1 ? '' : 's'} removed (imported files never load anything from the network).`);
  if (stats.activeElements) report.add('unsupported', `${stats.activeElements} embedded or animated element${stats.activeElements === 1 ? '' : 's'} removed.`);

  if (clean.attrs['data-fc-ir'] === '1') {
    const raw = readAnnotatedSvg(clean);
    return validateIR(raw, { report });
  }

  const reader = new SvgReader(clean, report);
  reader.run();
  const { counts } = reader;
  if (counts.hidden) report.addCount('info', counts.hidden, 'hidden element was not imported (display:none or visibility:hidden).', 'hidden elements were not imported (display:none or visibility:hidden).');
  if (counts.clipped) report.add('approximated', `${counts.clipped} clip path or mask${counts.clipped === 1 ? ' was' : 's were'} ignored; the clipped content is imported whole.`);
  if (counts.gradientTransform) report.add('approximated', 'Gradient transforms were ignored; gradients follow the shape box.');
  if (counts.foreignNoPos) report.add('partial', `${counts.foreignNoPos} HTML text block${counts.foreignNoPos === 1 ? '' : 's'} without a fallback position could not be placed.`);
  for (const [name, n] of counts.unsupported) report.add('unsupported', `${n} <${name}> element${n === 1 ? '' : 's'} not supported and skipped.`);

  // Viewport scaling has already been applied: the IR is in viewport pixels.
  const { raw } = postProcess(reader, report, opts.format ?? 'svg');
  return validateIR(raw, { report });
}
