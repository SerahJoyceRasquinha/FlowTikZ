import type { Point } from '../../model/types';
import type { Seg } from '../../model/path';
import { base64ToBytes, inflate, utf8Decode } from '../binary';
import { parseColor } from '../conversion/color';
import type { ReportBuilder } from '../report';
import { ImportError } from '../types';
import { validateIR } from '../ir/validate';
import type { IRDiagram, IRShapeType } from '../ir/types';
import { XmlElement, childElements, decodeEntities, localName, parseXml, textContent } from '../xml/parser';
import { DrawioStyle, EDITOR_ONLY_KEYS, SHAPE_MAP, mapDrawioArrow } from './style';

/**
 * draw.io / diagrams.net -> IR.
 *
 * The file's own structure is read - cells, geometry, styles, parents,
 * terminals - and nothing is ever rasterised. Every style key the importer
 * does not translate is kept on the object as metadata, and anything that
 * cannot be represented is listed in the report.
 */

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
  relative: boolean;
  points: Point[];
  sourcePoint?: Point;
  targetPoint?: Point;
  offset?: Point;
}

interface Cell {
  id: string;
  value: string;
  style: DrawioStyle;
  styleSrc: string;
  vertex: boolean;
  edge: boolean;
  parent?: string;
  source?: string;
  target?: string;
  geo: Geometry;
  visible: boolean;
  order: number;
  /** Attributes of a wrapping <UserObject>/<object>, other than id/label. */
  userAttrs: Record<string, string>;
  placeholders: boolean;
}

export interface DrawioPage {
  name: string;
  model: XmlElement;
}

/* ------------------------------------------------------------- pages */

async function decodeDiagramText(text: string): Promise<string> {
  const t = text.trim();
  if (t.startsWith('<')) return t;
  // Compressed page: base64( deflateRaw( encodeURIComponent(xml) ) ).
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(t);
  } catch {
    throw new ImportError('invalid-file', 'A page of this draw.io file is not readable (bad encoding).');
  }
  let inflated: string;
  try {
    inflated = utf8Decode(await inflate(bytes, 'deflate-raw'));
  } catch (err) {
    throw new ImportError('invalid-file', 'A compressed page of this draw.io file could not be decompressed.', {
      detail: err instanceof Error ? err.message : undefined,
    });
  }
  try {
    return decodeURIComponent(inflated);
  } catch {
    return inflated;
  }
}

export async function readDrawioPages(xml: string): Promise<DrawioPage[]> {
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (err) {
    throw new ImportError('invalid-file', 'The draw.io file is not well-formed XML.', {
      detail: err instanceof Error ? err.message : undefined,
    });
  }
  const name = localName(root.name);
  if (name === 'mxgraphmodel') return [{ name: 'Page-1', model: root }];
  if (name !== 'mxfile') throw new ImportError('no-diagram', 'This XML file is not a draw.io diagram.');
  const pages: DrawioPage[] = [];
  let i = 0;
  for (const d of childElements(root)) {
    if (localName(d.name) !== 'diagram') continue;
    i++;
    const pageName = d.attrs.name || `Page-${i}`;
    const inline = childElements(d).find((c) => localName(c.name) === 'mxgraphmodel');
    if (inline) {
      pages.push({ name: pageName, model: inline });
      continue;
    }
    const text = textContent(d);
    if (!text.trim()) continue;
    const decoded = await decodeDiagramText(text);
    try {
      const model = parseXml(decoded);
      if (localName(model.name) === 'mxgraphmodel') pages.push({ name: pageName, model });
    } catch (err) {
      throw new ImportError('invalid-file', `Page "${pageName}" of this draw.io file is damaged.`, {
        detail: err instanceof Error ? err.message : undefined,
      });
    }
  }
  if (!pages.length) throw new ImportError('no-diagram', 'This draw.io file contains no diagram pages.');
  return pages;
}

/* ------------------------------------------------------------- cells */

function num(v: string | undefined, d = 0): number {
  if (v === undefined || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function readPoint(el: XmlElement): Point {
  return { x: num(el.attrs.x), y: num(el.attrs.y) };
}

function readGeometry(cell: XmlElement): Geometry {
  const g = childElements(cell).find((c) => localName(c.name) === 'mxgeometry');
  const geo: Geometry = { x: 0, y: 0, w: 0, h: 0, relative: false, points: [] };
  if (!g) return geo;
  geo.x = num(g.attrs.x);
  geo.y = num(g.attrs.y);
  geo.w = num(g.attrs.width);
  geo.h = num(g.attrs.height);
  geo.relative = g.attrs.relative === '1';
  for (const c of childElements(g)) {
    const n = localName(c.name);
    if (n === 'mxpoint') {
      if (c.attrs.as === 'sourcePoint') geo.sourcePoint = readPoint(c);
      else if (c.attrs.as === 'targetPoint') geo.targetPoint = readPoint(c);
      else if (c.attrs.as === 'offset') geo.offset = readPoint(c);
    } else if (n === 'array' && c.attrs.as === 'points') {
      geo.points = childElements(c).filter((p) => localName(p.name) === 'mxpoint').map(readPoint);
    }
  }
  return geo;
}

function readCells(model: XmlElement): Cell[] {
  const root = childElements(model).find((c) => localName(c.name) === 'root');
  if (!root) return [];
  const cells: Cell[] = [];
  let order = 0;
  for (const el of childElements(root)) {
    const n = localName(el.name);
    let cellEl: XmlElement | undefined;
    let id: string | undefined;
    let value: string | undefined;
    const userAttrs: Record<string, string> = {};
    let placeholders = false;
    if (n === 'mxcell') {
      cellEl = el;
      id = el.attrs.id;
      value = el.attrs.value;
    } else if (n === 'userobject' || n === 'object') {
      cellEl = childElements(el).find((c) => localName(c.name) === 'mxcell');
      id = el.attrs.id;
      value = el.attrs.label ?? '';
      placeholders = el.attrs.placeholders === '1';
      for (const [k, v] of Object.entries(el.attrs)) {
        if (k !== 'id' && k !== 'label' && k !== 'placeholders') userAttrs[k] = v;
      }
    }
    if (!cellEl || id === undefined) continue;
    const styleSrc = cellEl.attrs.style ?? '';
    cells.push({
      id,
      value: value ?? '',
      style: new DrawioStyle(styleSrc),
      styleSrc,
      vertex: cellEl.attrs.vertex === '1',
      edge: cellEl.attrs.edge === '1',
      parent: cellEl.attrs.parent,
      source: cellEl.attrs.source,
      target: cellEl.attrs.target,
      geo: readGeometry(cellEl),
      visible: cellEl.attrs.visible !== '0',
      order: order++,
      userAttrs,
      placeholders,
    });
  }
  return cells;
}

/* ------------------------------------------------------------ labels */

interface LabelText {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** True when the HTML carried formatting that plain text cannot. */
  richLost: boolean;
}

/** draw.io HTML labels -> plain text, keeping line breaks. */
export function htmlLabelToText(html: string): LabelText {
  const src = html ?? '';
  const whole = (tag: string) => new RegExp(`^\\s*<${tag}\\b[^>]*>[\\s\\S]*</${tag}>\\s*$`, 'i').test(src);
  const bold = whole('b') || whole('strong');
  const italic = whole('i') || whole('em');
  const underline = whole('u');
  // <br> is an explicit break (two in a row is a deliberate blank line);
  // block elements only separate their contents, so adjacent block
  // boundaries collapse into a single break.
  let t = src
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(div|p|li|h[1-6]|tr)\b[^>]*>/gi, '\u0001')
    .replace(/<[^>]*>/g, '');
  t = t.replace(/\n?\u0001+\n?/g, '\u0001').replace(/\u0001/g, '\n');
  t = decodeEntities(t).replace(/\u00a0/g, ' ');
  const lines = t.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const collapsed = lines;
  const tagsLeft = src.replace(/<\/?(br|div|p|span|font)\b[^>]*>/gi, '');
  const richLost = /<(b|strong|i|em|u|sub|sup|font|span[^>]*style)/i.test(tagsLeft) && !(bold || italic || underline);
  return { text: collapsed.join('\n'), bold, italic, underline, richLost };
}

function labelOf(cell: Cell): LabelText {
  let value = cell.value ?? '';
  if (cell.placeholders) {
    value = value.replace(/%([\w-]+)%/g, (m, k: string) => cell.userAttrs[k] ?? m);
  }
  const html = cell.style.get('html') === '1';
  if (html) return htmlLabelToText(value);
  return { text: value.replace(/\r\n?/g, '\n'), bold: false, italic: false, underline: false, richLost: false };
}

/* ------------------------------------------------------------ colours */

function colorValue(v: string | undefined, fallback: string | null): string | null {
  if (v === undefined) return fallback;
  if (v === 'none' || v === '') return null;
  if (v === 'default') return fallback;
  if (v === 'inherit' || v === 'swimlane') return fallback;
  return parseColor(v)?.hex ?? fallback;
}

/* -------------------------------------------------------- the import */

export interface DrawioImportOptions {
  report: ReportBuilder;
  pageIndex?: number;
}

export async function drawioToIR(xml: string, opts: DrawioImportOptions): Promise<IRDiagram> {
  const { report } = opts;
  const pages = await readDrawioPages(xml);
  const index = Math.min(Math.max(0, opts.pageIndex ?? 0), pages.length - 1);
  const page = pages[index];
  if (pages.length > 1) {
    report.add(
      'info',
      `The file has ${pages.length} pages; imported "${page.name}". Other pages: ${pages
        .filter((_, i) => i !== index)
        .map((p) => `"${p.name}"`)
        .join(', ')}.`,
    );
  }
  const model = page.model;
  const cells = readCells(model);
  if (!cells.length) throw new ImportError('no-diagram', 'The draw.io page is empty.');

  const byId = new Map(cells.map((c) => [c.id, c]));
  const rootCell = cells.find((c) => !c.parent);
  const layers = new Set(cells.filter((c) => c.parent && c.parent === rootCell?.id && !c.vertex && !c.edge).map((c) => c.id));
  if (!layers.size && rootCell) layers.add(rootCell.id);

  const hiddenLayers = [...layers].filter((id) => byId.get(id)?.visible === false);
  if (layers.size > 1) {
    report.add('info', `The page has ${layers.size} layers; they were merged, keeping their stacking order.`);
  }
  for (const id of hiddenLayers) {
    report.add('info', `Layer "${byId.get(id)?.value || id}" was hidden in draw.io; its objects were imported and are visible.`);
  }

  /* ---- absolute geometry, honouring parent containers */
  const absCache = new Map<string, Point>();
  const origin = (id: string | undefined, depth = 0): Point => {
    if (!id || layers.has(id) || depth > 50) return { x: 0, y: 0 };
    const cached = absCache.get(id);
    if (cached) return cached;
    const c = byId.get(id);
    if (!c || !c.vertex) return { x: 0, y: 0 };
    const p = origin(c.parent, depth + 1);
    const out = { x: p.x + c.geo.x, y: p.y + c.geo.y };
    absCache.set(id, out);
    return out;
  };

  const layerOf = (c: Cell): Cell | undefined => {
    let cur: Cell | undefined = c;
    let guard = 0;
    while (cur && cur.parent && !layers.has(cur.parent) && guard++ < 100) cur = byId.get(cur.parent);
    return cur?.parent ? byId.get(cur.parent) : undefined;
  };

  const objects: Record<string, unknown>[] = [];
  const connectors: Record<string, unknown>[] = [];
  const groups: Record<string, unknown>[] = [];
  const objectIds = new Set<string>();
  const groupIds = new Set<string>();

  const isGroupCell = (c: Cell) => c.vertex && (c.style.hasName('group') || (c.styleSrc.trim() === '' && !c.value && cells.some((k) => k.parent === c.id)));

  /* ---- vertices */
  for (const c of cells) {
    if (!c.vertex || layers.has(c.id)) continue;
    const parent = c.parent ? byId.get(c.parent) : undefined;
    if (parent?.edge) continue; // edge labels, handled with their edge
    if (!c.visible) report.add('info', 'A cell hidden in draw.io was imported as visible.', c.id);
    if (isGroupCell(c)) {
      groupIds.add(c.id);
      continue;
    }
    if (c.geo.relative && !parent?.edge) {
      report.add('partial', 'A cell positioned relative to its parent was placed approximately.', c.id);
    }
    const o = mapVertex(c, origin(c.parent), report);
    if (!o) continue;
    const layer = layerOf(c);
    if (layer && layers.size > 1) (o.preserved as Record<string, string>).layer = labelOf(layer).text || 'Background';
    objects.push(o);
    objectIds.add(c.id);
    // An outside label becomes its own text object next to the shape.
    const outside = outsideLabel(c, o, report);
    if (outside) objects.push(outside);
  }

  /* ---- groups: invisible group cells and containers */
  for (const c of cells) {
    if (!c.vertex) continue;
    const kids = cells.filter((k) => k.parent === c.id && (objectIds.has(k.id) || groupIds.has(k.id)));
    if (!kids.length) continue;
    if (!groupIds.has(c.id) && !objectIds.has(c.id)) continue;
    const members = kids.filter((k) => objectIds.has(k.id)).map((k) => k.id);
    if (objectIds.has(c.id)) members.unshift(c.id);
    const parentGroup = c.parent && (groupIds.has(c.parent) || (objectIds.has(c.parent) && cells.some((k) => k.parent === c.parent))) ? `grp_${c.parent}` : undefined;
    groups.push({
      id: `grp_${c.id}`,
      memberIds: members,
      ...(c.value ? { name: labelOf(c).text.slice(0, 80) } : {}),
      ...(parentGroup ? { parentId: parentGroup } : {}),
    });
  }
  // Members of nested groups also belong to their ancestors, so flattening
  // keeps a nested group's objects together with the outer group.
  const gById = new Map(groups.map((g) => [g.id as string, g]));
  for (const g of groups) {
    let p = g.parentId as string | undefined;
    let guard = 0;
    while (p && gById.has(p) && guard++ < 50) {
      const parent = gById.get(p)!;
      for (const m of g.memberIds as string[]) {
        if (!(parent.memberIds as string[]).includes(m)) (parent.memberIds as string[]).push(m);
      }
      p = parent.parentId as string | undefined;
    }
  }

  /* ---- edges */
  for (const c of cells) {
    if (!c.edge) continue;
    const e = mapEdge(c, byId, objectIds, origin, cells, report);
    if (e) connectors.push(e.connector);
    if (e?.extraLabels.length) objects.push(...e.extraLabels);
  }

  const bg = colorValue(model.attrs.background, null);
  if (bg && bg !== '#ffffff') {
    report.add('info', `The page background (${bg}) was not carried over; the imported diagram has a transparent background.`);
  }

  const raw = {
    canvas: {},
    background: { color: bg, transparent: !bg, removed: !!bg, method: 'source' },
    objects,
    connectors,
    groups,
    metadata: { format: 'drawio', title: page.name, generator: 'draw.io', notes: [] },
  };
  return validateIR(raw, { report });
}

/* ------------------------------------------------------------ vertices */

function shapeTypeOf(c: Cell, report: ReportBuilder): { shape: IRShapeType; exact: boolean; name?: string; unknown?: string } {
  const s = c.style;
  const shapeKey = s.get('shape');
  const direction = s.get('direction') ?? 'east';
  if (shapeKey === 'triangle' || (!shapeKey && s.hasName('triangle'))) {
    if (direction === 'south') return { shape: 'inverted-triangle', exact: true };
    if (direction === 'north') return { shape: 'triangle', exact: true };
    return { shape: 'polygon', exact: true, name: `triangle-${direction}` };
  }
  if (shapeKey === 'swimlane' || s.hasName('swimlane')) return { shape: 'polygon', exact: true, name: 'swimlane' };
  if (shapeKey === 'line' || s.hasName('line')) return { shape: 'polygon', exact: true, name: 'line' };
  if (shapeKey === 'image' || s.hasName('image')) return { shape: 'image', exact: true };
  if (s.hasName('text') || shapeKey === 'text') return { shape: 'text', exact: true };
  if (shapeKey) {
    const mapped = SHAPE_MAP[shapeKey];
    if (mapped) return { shape: mapped, exact: shapeKey !== 'doubleEllipse' };
    report.add('partial', `Unknown draw.io shape "${shapeKey}" imported as a rectangle.`, c.id);
    return { shape: 'rectangle', exact: true, unknown: shapeKey };
  }
  for (const n of s.names) {
    const mapped = SHAPE_MAP[n];
    if (mapped) return { shape: mapped, exact: n !== 'doubleEllipse' };
  }
  return { shape: 'rectangle', exact: true };
}

function polygonFor(name: string, x: number, y: number, w: number, h: number, startSize: number): Seg[] {
  const P = (px: number, py: number) => ({ x: x + px, y: y + py });
  switch (name) {
    case 'triangle-east':
      return [{ c: 'M', p: P(0, 0) }, { c: 'L', p: P(w, h / 2) }, { c: 'L', p: P(0, h) }, { c: 'Z' }];
    case 'triangle-west':
      return [{ c: 'M', p: P(w, 0) }, { c: 'L', p: P(0, h / 2) }, { c: 'L', p: P(w, h) }, { c: 'Z' }];
    case 'swimlane':
      // Frame plus the header rule, as one outline with an inner stroke.
      return [
        { c: 'M', p: P(0, 0) },
        { c: 'L', p: P(w, 0) },
        { c: 'L', p: P(w, h) },
        { c: 'L', p: P(0, h) },
        { c: 'Z' },
        { c: 'M', p: P(0, startSize) },
        { c: 'L', p: P(w, startSize) },
      ];
    case 'line':
      return [{ c: 'M', p: P(0, h / 2) }, { c: 'L', p: P(w, h / 2) }];
    default:
      return [{ c: 'M', p: P(0, 0) }, { c: 'L', p: P(w, 0) }, { c: 'L', p: P(w, h) }, { c: 'L', p: P(0, h) }, { c: 'Z' }];
  }
}

function dashFor(s: DrawioStyle, strokeWidth: number): { dash: string; dashArray?: number[] } {
  if (!s.flag('dashed')) {
    s.consume('dashPattern');
    return { dash: 'solid' };
  }
  const pattern = s.get('dashPattern');
  const fix = s.flag('fixDash');
  const base = pattern
    ? pattern
        .split(/\s+/)
        .map(Number)
        .filter((v) => Number.isFinite(v) && v >= 0)
    : [3, 3];
  const arr = base.map((v) => Math.round(v * (fix ? 1 : Math.max(1, strokeWidth)) * 100) / 100);
  return { dash: 'dashed', dashArray: arr.length >= 2 ? arr : undefined };
}

function gradientFor(s: DrawioStyle, fill: string | null) {
  const to = colorValue(s.get('gradientColor'), null);
  const dir = s.get('gradientDirection') ?? 'south';
  if (!to || !fill) return null;
  if (dir === 'radial') return { type: 'radial', from: fill, to, angle: 180 };
  const angle = dir === 'north' ? 0 : dir === 'east' ? 90 : dir === 'west' ? 270 : 180;
  return { type: 'linear', from: fill, to, angle };
}

function textStyleFor(c: Cell, label: LabelText, defaults: { align: string; valign: string }) {
  const s = c.style;
  const fontStyle = s.num('fontStyle', 0);
  return {
    content: label.text,
    fontSize: s.num('fontSize', 12),
    fontFamily: s.get('fontFamily') ?? 'Helvetica',
    bold: label.bold || (fontStyle & 1) === 1,
    italic: label.italic || (fontStyle & 2) === 2,
    underline: label.underline || (fontStyle & 4) === 4,
    color: colorValue(s.get('fontColor'), '#000000') ?? '#000000',
    align: s.get('align') ?? defaults.align,
    valign: s.get('verticalAlign') ?? defaults.valign,
  };
}

function preservedOf(c: Cell): Record<string, string> {
  const s = c.style;
  s.consume(...EDITOR_ONLY_KEYS);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.unconsumed())) out[k] = v;
  for (const [k, v] of Object.entries(c.userAttrs)) out[`data:${k}`] = v;
  return out;
}

function mapVertex(c: Cell, offset: Point, report: ReportBuilder): Record<string, unknown> | null {
  const s = c.style;
  const x = offset.x + c.geo.x;
  const y = offset.y + c.geo.y;
  const w = c.geo.w;
  const h = c.geo.h;
  if (!(w > 0) || !(h > 0)) {
    report.add('unsupported', 'A draw.io cell with no size was skipped.', c.id);
    return null;
  }
  const { shape, exact, name, unknown } = shapeTypeOf(c, report);
  const isText = shape === 'text';
  const label = labelOf(c);
  if (label.richLost) {
    report.tally('style-difference', 'Mixed rich-text formatting inside a label simplified to plain text');
  }

  const fill = colorValue(s.get('fillColor'), isText ? null : '#ffffff');
  const stroke = colorValue(s.get('strokeColor'), isText ? null : '#000000');
  const strokeWidth = s.num('strokeWidth', 1);
  const rounded = s.flag('rounded');
  let cornerRadius = 0;
  if (rounded && (shape === 'rectangle' || shape === 'polygon')) {
    const arc = s.num('arcSize', 15);
    cornerRadius = s.flag('absoluteArcSize') ? Math.min(w / 2, h / 2, arc / 2) : Math.min(w, h) * (arc / 100);
  } else {
    s.consume('arcSize', 'absoluteArcSize');
  }
  if (rounded && shape !== 'rectangle' && shape !== 'polygon') {
    report.tally('approximated', 'Rounded corners requested on a symbol that has fixed corners in the editor');
  }

  const obj: Record<string, unknown> = {
    id: c.id,
    sourceId: c.id,
    shape: rounded && shape === 'rectangle' ? 'rounded-rectangle' : shape,
    x,
    y,
    w,
    h,
    rotation: s.num('rotation', 0),
    z: c.order,
    style: {
      fill,
      fillOpacity: s.num('fillOpacity', 100) / 100,
      stroke,
      strokeOpacity: s.num('strokeOpacity', 100) / 100,
      strokeWidth,
      ...dashFor(s, strokeWidth),
      opacity: s.num('opacity', 100) / 100,
      cornerRadius,
      shadow: s.flag('shadow'),
      gradient: gradientFor(s, fill),
    },
  };
  if (s.flag('locked') || s.get('movable') === '0') obj.locked = true;

  const labelOutside = s.get('labelPosition');
  const vOutside = s.get('verticalLabelPosition');
  const labelIsInside = (!labelOutside || labelOutside === 'center') && (!vOutside || vOutside === 'middle');
  if (label.text && labelIsInside) {
    obj.text = textStyleFor(c, label, {
      align: 'center',
      valign: name === 'swimlane' ? 'top' : 'middle',
    });
    // A swimlane's title sits in its header whatever the style says.
    if (name === 'swimlane') (obj.text as Record<string, unknown>).valign = 'top';
  }
  if (name) {
    obj.path = polygonFor(name, x, y, w, h, s.num('startSize', 26));
    if (name === 'swimlane') {
      // In draw.io `fillColor` paints only the header; the body uses
      // `swimlaneFillColor` and is otherwise see-through.
      report.add('partial', 'Swimlane imported as a container frame with its header rule; the header colour is kept as metadata.', c.id);
      const body = colorValue(s.get('swimlaneFillColor'), null);
      (obj.style as Record<string, unknown>).fill = body;
      (obj.style as Record<string, unknown>).gradient = null;
      if (fill) obj.headerFill = fill;
    }
    if (name === 'line') (obj.style as Record<string, unknown>).fill = null;
  }
  if (shape === 'image') {
    const href = s.get('image') ?? '';
    obj.image = { href: href.startsWith('data:') ? href.replace(/^data:image\/(\w+),/, 'data:image/$1;base64,') : href };
    if (href && !href.startsWith('data:')) {
      report.add('partial', 'Image linked from an external URL kept only as a reference (external files are never fetched).', c.id);
    }
  }
  if (!exact) {
    report.tally('approximated', 'Double-outline or specialised symbols drawn with the nearest standard symbol');
  }
  if (s.has('labelBackgroundColor') && s.get('labelBackgroundColor') !== 'none') {
    report.tally('style-difference', 'Label background colours on shapes are not shown (kept as metadata)');
  }
  obj.preserved = preservedOf(c);
  if (unknown) (obj.preserved as Record<string, string>).shape = unknown;
  if (obj.headerFill) {
    (obj.preserved as Record<string, string>).headerFill = obj.headerFill as string;
    delete obj.headerFill;
  }
  if (label.richLost && c.value.length <= 2000) (obj.preserved as Record<string, string>).labelHtml = c.value;
  return obj;
}

/** A label placed outside its shape (labelPosition / verticalLabelPosition). */
function outsideLabel(c: Cell, o: Record<string, unknown>, report: ReportBuilder): Record<string, unknown> | null {
  const s = c.style;
  const lp = s.get('labelPosition');
  const vp = s.get('verticalLabelPosition');
  if ((!lp || lp === 'center') && (!vp || vp === 'middle')) return null;
  const label = labelOf(c);
  if (!label.text) return null;
  const x = o.x as number;
  const y = o.y as number;
  const w = o.w as number;
  const h = o.h as number;
  const size = s.num('fontSize', 12);
  const lines = label.text.split('\n');
  const tw = Math.max(w, Math.max(...lines.map((l) => l.length)) * size * 0.55 + 8);
  const th = lines.length * size * 1.25 + 6;
  let lx = x + (w - tw) / 2;
  let ly = y + (h - th) / 2;
  if (lp === 'left') lx = x - tw;
  if (lp === 'right') lx = x + w;
  if (vp === 'top') ly = y - th;
  if (vp === 'bottom') ly = y + h;
  report.add('partial', 'A label drawn outside its shape was imported as a separate text object beside it.', c.id);
  return {
    id: `${c.id}__label`,
    shape: 'text',
    x: lx,
    y: ly,
    w: tw,
    h: th,
    rotation: 0,
    z: c.order + 0.5,
    text: textStyleFor(c, label, { align: 'center', valign: 'middle' }),
    style: { fill: null, stroke: null },
    groupId: undefined,
  };
}

/* --------------------------------------------------------------- edges */

function clipToBox(centre: Point, towards: Point, box: { x: number; y: number; w: number; h: number }): Point {
  const dx = towards.x - centre.x;
  const dy = towards.y - centre.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return centre;
  const tx = dx !== 0 ? box.w / 2 / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? box.h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: centre.x + dx * t, y: centre.y + dy * t };
}

function mapEdge(
  c: Cell,
  byId: Map<string, Cell>,
  objectIds: Set<string>,
  origin: (id: string | undefined) => Point,
  cells: Cell[],
  report: ReportBuilder,
): { connector: Record<string, unknown>; extraLabels: Record<string, unknown>[] } | null {
  const s = c.style;
  const off = origin(c.parent);
  const shift = (p: Point) => ({ x: p.x + off.x, y: p.y + off.y });
  const waypoints = c.geo.points.map(shift);

  const endBox = (id: string | undefined) => {
    if (!id || !objectIds.has(id)) return null;
    const cell = byId.get(id)!;
    const o = origin(cell.parent);
    return { x: o.x + cell.geo.x, y: o.y + cell.geo.y, w: cell.geo.w, h: cell.geo.h };
  };
  const srcBox = endBox(c.source);
  const dstBox = endBox(c.target);
  if (c.source && !srcBox) {
    const other = byId.get(c.source);
    report.add(other?.edge ? 'unsupported' : 'unmapped-connector', other?.edge ? 'A connector attached to another connector was left free at that end.' : 'A connector referred to a missing shape; that end was left free.', c.id);
  }
  if (c.target && !dstBox) {
    const other = byId.get(c.target);
    report.add(other?.edge ? 'unsupported' : 'unmapped-connector', other?.edge ? 'A connector attached to another connector was left free at that end.' : 'A connector referred to a missing shape; that end was left free.', c.id);
  }

  const exitX = s.get('exitX');
  const exitY = s.get('exitY');
  const entryX = s.get('entryX');
  const entryY = s.get('entryY');
  s.consume('exitDx', 'exitDy', 'entryDx', 'entryDy', 'exitPerimeter', 'entryPerimeter');

  const centre = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  let start: Point | undefined;
  let end: Point | undefined;
  const source: Record<string, unknown> = {};
  const target: Record<string, unknown> = {};
  if (srcBox) {
    source.objectId = c.source;
    if (exitX !== undefined && exitY !== undefined) {
      source.fx = Number(exitX);
      source.fy = Number(exitY);
      start = { x: srcBox.x + srcBox.w * Number(exitX), y: srcBox.y + srcBox.h * Number(exitY) };
    } else {
      source.floating = true;
    }
  } else if (c.geo.sourcePoint) {
    start = shift(c.geo.sourcePoint);
  }
  if (dstBox) {
    target.objectId = c.target;
    if (entryX !== undefined && entryY !== undefined) {
      target.fx = Number(entryX);
      target.fy = Number(entryY);
      end = { x: dstBox.x + dstBox.w * Number(entryX), y: dstBox.y + dstBox.h * Number(entryY) };
    } else {
      target.floating = true;
    }
  } else if (c.geo.targetPoint) {
    end = shift(c.geo.targetPoint);
  }
  // Floating ends: meet the perimeter on the way to the next point.
  if (!start && srcBox) start = clipToBox(centre(srcBox), waypoints[0] ?? end ?? (dstBox ? centre(dstBox) : centre(srcBox)), srcBox);
  if (!end && dstBox) end = clipToBox(centre(dstBox), waypoints[waypoints.length - 1] ?? start ?? centre(dstBox), dstBox);
  if (!start || !end) {
    report.add('unmapped-connector', 'A connector without endpoints was skipped.', c.id);
    return null;
  }

  const edgeStyle = s.get('edgeStyle');
  const curved = s.flag('curved');
  const orthogonal = !!edgeStyle && /orthogonal|elbow|entityRelation|segment|isometric/i.test(edgeStyle);
  const routing = curved ? 'curved' : orthogonal ? 'orthogonal' : waypoints.length ? 'polyline' : 'straight';
  if (edgeStyle && !orthogonal && edgeStyle !== 'none') {
    report.tally('approximated', `Connector style "${edgeStyle}" drawn with the nearest standard routing`);
  }
  const strokeWidth = s.num('strokeWidth', 1);
  const endFill = s.get('endFill') !== '0';
  const startFill = s.get('startFill') !== '0';
  const endA = mapDrawioArrow(s.has('endArrow') ? s.get('endArrow') : 'classic', endFill);
  const startA = mapDrawioArrow(s.get('startArrow'), startFill);
  if (!endA.exact || !startA.exact) report.tally('approximated', 'Specialised arrowheads (ER, async, cross...) drawn with the nearest standard head');
  const markerSize = Math.max(s.num('endSize', 6), s.num('startSize', 6));

  const connector: Record<string, unknown> = {
    id: c.id,
    sourceId: c.id,
    z: c.order,
    points: [start, ...waypoints, end],
    routing,
    rounded: s.flag('rounded'),
    arrowStart: startA.arrow,
    arrowEnd: endA.arrow,
    arrowSize: markerSize * 1.5 + strokeWidth,
    style: {
      stroke: colorValue(s.get('strokeColor'), '#000000') ?? '#000000',
      strokeWidth,
      strokeOpacity: s.num('strokeOpacity', 100) / 100,
      ...dashFor(s, strokeWidth),
      opacity: s.num('opacity', 100) / 100,
    },
    ...(Object.keys(source).length ? { source } : {}),
    ...(Object.keys(target).length ? { target } : {}),
  };
  if (s.get('strokeColor') === 'none') {
    report.add('style-difference', 'A connector with no stroke colour was imported with a visible line.', c.id);
  }

  /* ---- labels: the edge's own value, and child label cells */
  const labels: { text: LabelText; cell: Cell; position: number; offset: number }[] = [];
  const own = labelOf(c);
  if (own.text) labels.push({ text: own, cell: c, position: (Math.max(-1, Math.min(1, c.geo.x)) + 1) / 2, offset: c.geo.y + (c.geo.offset?.y ?? 0) });
  for (const k of cells) {
    if (k.parent !== c.id || !k.vertex) continue;
    const t = labelOf(k);
    if (!t.text) continue;
    labels.push({ text: t, cell: k, position: (Math.max(-1, Math.min(1, k.geo.x)) + 1) / 2, offset: k.geo.y + (k.geo.offset?.y ?? 0) });
  }
  const extraLabels: Record<string, unknown>[] = [];
  labels.forEach((l, i) => {
    const st = l.cell.style;
    const fontStyle = st.num('fontStyle', 0);
    const bgRaw = st.get('labelBackgroundColor');
    const label = {
      text: l.text.text,
      position: l.position,
      offset: -l.offset,
      fontSize: st.num('fontSize', 11),
      color: colorValue(st.get('fontColor'), '#000000') ?? '#000000',
      background: !!bgRaw && bgRaw !== 'none',
      bold: l.text.bold || (fontStyle & 1) === 1,
      italic: l.text.italic || (fontStyle & 2) === 2,
    };
    if (i === 0) {
      connector.label = label;
    } else {
      // The editor carries one label per connector; the others become text.
      const pts = connector.points as Point[];
      const p = pointAlong(pts, l.position);
      const w = Math.max(...label.text.split('\n').map((t) => t.length)) * label.fontSize * 0.55 + 8;
      const h = label.text.split('\n').length * label.fontSize * 1.25 + 4;
      extraLabels.push({
        id: `${l.cell.id}__label`,
        shape: 'text',
        x: p.x - w / 2,
        y: p.y - h / 2,
        w,
        h,
        z: c.order + 0.5,
        text: { content: label.text, fontSize: label.fontSize, color: label.color, bold: label.bold, italic: label.italic, fontFamily: 'Helvetica', align: 'center', valign: 'middle' },
        style: { fill: null, stroke: null },
      });
      report.add('partial', 'A connector with several labels keeps the first as its label; the others were imported as text objects.', c.id);
    }
  });

  s.consume('endArrow', 'startArrow', 'endFill', 'startFill', 'endSize', 'startSize');
  connector.preserved = preservedOf(c);
  return { connector, extraLabels };
}

function pointAlong(points: Point[], t: number): Point {
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
