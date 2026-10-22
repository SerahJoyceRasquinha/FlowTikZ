import type { MetaValue, Point, PortId } from '../../model/types';
import type { Seg } from '../../model/path';
import { parseColor } from '../conversion/color';
import { segsBounds } from './shapes';
import { ImportError } from '../types';
import type { ReportBuilder } from '../report';
import {
  DEFAULT_IR_STYLE,
  DEFAULT_IR_TEXT,
  IR_ARROWS,
  IR_DASHES,
  IR_ROUTINGS,
  IR_SHAPE_TYPES,
  IR_VERSION,
  IRArrow,
  IRConnector,
  IRConnectorLabel,
  IRDash,
  IRDiagram,
  IREndpoint,
  IRGradient,
  IRGroup,
  IRObject,
  IRRouting,
  IRShapeType,
  IRStyle,
  IRText,
} from './types';

/**
 * Validation of an intermediate representation that arrived from outside:
 * the offline recogniser's result, or a structured-JSON file.
 *
 * Nothing is trusted. Every field is type-checked, range-checked and coerced
 * to a well-formed value; anything that cannot be salvaged is dropped *and
 * recorded in the report*, and one bad object never sinks the rest. The only
 * hard failure is an answer with no usable structure at all.
 */

export interface ValidateOptions {
  report: ReportBuilder;
  maxObjects?: number;
  maxConnectors?: number;
}

const ABS_LIMIT = 100_000;
const MAX_TEXT = 10_000;
const MAX_ID = 100;
const PORTS: PortId[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'c', 'auto'];

type Raw = Record<string, unknown>;

function isObj(v: unknown): v is Raw {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function finiteOrNull(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Plain text only: control characters other than tab and newline are removed. */
export function cleanText(v: unknown, max = MAX_TEXT): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .slice(0, max);
}

function cleanId(v: unknown): string {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).replace(/[^\w.:-]/g, '_').slice(0, MAX_ID);
}

function enumOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function normAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return Math.round(a * 1000) / 1000;
}

export function colorOr(
  v: unknown,
  fallback: string | null,
  report: ReportBuilder | undefined,
  ref: string | undefined,
  what: string,
): { hex: string | null; alpha: number } {
  if (v === null || v === undefined || v === '') return { hex: fallback, alpha: 1 };
  const c = parseColor(v);
  if (!c) {
    report?.add('approximated', `Unreadable ${what} colour "${String(v).slice(0, 30)}" replaced with ${fallback ?? 'none'}.`, ref);
    return { hex: fallback, alpha: 1 };
  }
  if (c.alpha === 0) return { hex: null, alpha: 0 };
  return { hex: c.hex, alpha: c.alpha };
}

/* ---------------------------------------------------------- geometry */

class Bounds {
  constructor(readonly limit: number) {}
  ok(p: Point): boolean {
    return Math.abs(p.x) <= this.limit && Math.abs(p.y) <= this.limit;
  }
}

function readPoint(v: unknown, b: Bounds): Point | null {
  if (Array.isArray(v) && v.length >= 2) {
    const x = finiteOrNull(v[0]);
    const y = finiteOrNull(v[1]);
    if (x === null || y === null) return null;
    const p = { x, y };
    return b.ok(p) ? p : null;
  }
  if (!isObj(v)) return null;
  const x = finiteOrNull(v.x);
  const y = finiteOrNull(v.y);
  if (x === null || y === null) return null;
  const p = { x, y };
  return b.ok(p) ? p : null;
}

function readSegs(v: unknown, b: Bounds): Seg[] | null {
  if (!Array.isArray(v) || v.length < 2 || v.length > 20_000) return null;
  const out: Seg[] = [];
  for (const raw of v) {
    if (!isObj(raw)) return null;
    const c = raw.c ?? raw.cmd ?? raw.type;
    if (c === 'Z' || c === 'z') {
      out.push({ c: 'Z' });
    } else if (c === 'M' || c === 'L') {
      const p = readPoint(raw.p ?? raw, b);
      if (!p) return null;
      out.push({ c, p });
    } else if (c === 'C') {
      const c1 = readPoint(raw.c1, b);
      const c2 = readPoint(raw.c2, b);
      const p = readPoint(raw.p, b);
      if (!c1 || !c2 || !p) return null;
      out.push({ c: 'C', c1, c2, p });
    } else {
      return null;
    }
  }
  return out[0]?.c === 'M' ? out : null;
}

/* ------------------------------------------------------------- style */

function readDash(v: unknown, arr: unknown): { dash: IRDash; dashArray?: number[] } {
  const dash = enumOf(v, IR_DASHES) ?? 'solid';
  if (Array.isArray(arr)) {
    const nums = arr.map((x) => finiteOrNull(x)).filter((x): x is number => x !== null && x >= 0 && x < 1000);
    if (nums.length >= 2 && nums.length <= 16) return { dash, dashArray: nums };
  }
  return { dash };
}

function readGradient(v: unknown, report: ReportBuilder | undefined, ref: string): IRGradient | null {
  if (!isObj(v)) return null;
  const type = v.type === 'radial' ? 'radial' : 'linear';
  const from = colorOr(v.from, null, report, ref, 'gradient');
  const to = colorOr(v.to, null, report, ref, 'gradient');
  if (!from.hex || !to.hex) return null;
  const g: IRGradient = { type, from: from.hex, to: to.hex, angle: num(v.angle, 180) };
  const stops = finiteOrNull(v.stops);
  if (stops !== null && stops > 2) g.stops = Math.round(stops);
  return g;
}

export function readStyle(v: unknown, report: ReportBuilder | undefined, ref: string, isText: boolean): IRStyle {
  const s = isObj(v) ? v : {};
  const base = isText
    ? { ...DEFAULT_IR_STYLE, fill: null, stroke: null }
    : { ...DEFAULT_IR_STYLE };
  const fill = 'fill' in s ? colorOr(s.fill, null, report, ref, 'fill') : { hex: base.fill, alpha: 1 };
  const stroke = 'stroke' in s ? colorOr(s.stroke, null, report, ref, 'stroke') : { hex: base.stroke, alpha: 1 };
  const style: IRStyle = {
    fill: fill.hex,
    fillOpacity: clamp(num(s.fillOpacity, 1) * fill.alpha, 0, 1),
    stroke: stroke.hex,
    strokeOpacity: clamp(num(s.strokeOpacity, 1) * stroke.alpha, 0, 1),
    strokeWidth: clamp(num(s.strokeWidth, base.strokeWidth), 0, 100),
    ...readDash(s.dash, s.dashArray),
    opacity: clamp(num(s.opacity, 1), 0, 1),
    cornerRadius: clamp(num(s.cornerRadius, 0), 0, 10_000),
    shadow: s.shadow === true,
    gradient: readGradient(s.gradient, report, ref),
  };
  return style;
}

function readText(v: unknown, report: ReportBuilder | undefined, ref: string): IRText | undefined {
  if (typeof v === 'string') v = { content: v };
  if (!isObj(v)) return undefined;
  const content = cleanText(v.content ?? v.text);
  if (!content.trim()) return undefined;
  const color = colorOr(v.color, DEFAULT_IR_TEXT.color, report, ref, 'text');
  const t: IRText = {
    content,
    fontSize: clamp(num(v.fontSize, DEFAULT_IR_TEXT.fontSize), 1, 400),
    fontFamily: typeof v.fontFamily === 'string' ? v.fontFamily.slice(0, 120) : DEFAULT_IR_TEXT.fontFamily,
    bold: v.bold === true,
    italic: v.italic === true,
    underline: v.underline === true,
    color: color.hex ?? DEFAULT_IR_TEXT.color,
    align: enumOf(v.align, ['left', 'center', 'right'] as const) ?? 'center',
    valign: enumOf(v.valign, ['top', 'middle', 'bottom'] as const) ?? 'middle',
  };
  const conf = finiteOrNull(v.confidence);
  if (conf !== null) t.confidence = clamp(conf, 0, 1);
  return t;
}


function readPreserved(v: unknown): Record<string, MetaValue> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, MetaValue> = {};
  let n = 0;
  for (const [k, val] of Object.entries(v)) {
    if (n >= 60) break;
    if (typeof val === 'string') out[k.slice(0, 80)] = cleanText(val, 4000);
    else if (typeof val === 'boolean' || (typeof val === 'number' && Number.isFinite(val))) out[k.slice(0, 80)] = val;
    else continue;
    n++;
  }
  return n ? out : undefined;
}

function readNotes(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const notes = v.filter((n): n is string => typeof n === 'string').slice(0, 10).map((n) => cleanText(n, 300));
  return notes.length ? notes : undefined;
}

/* ----------------------------------------------------------- objects */

function readObject(
  raw: unknown,
  index: number,
  b: Bounds,
  report: ReportBuilder,
  ids: Set<string>,
): IRObject | null {
  if (!isObj(raw)) {
    report.add('unsupported', `Object #${index + 1} was not an object and was skipped.`);
    return null;
  }
  let id = cleanId(raw.id) || `o${index + 1}`;
  while (ids.has(id)) id = `${id}_`;

  let shape = enumOf(raw.shape ?? raw.type, IR_SHAPE_TYPES) as IRShapeType | null;
  const path = raw.path !== undefined ? readSegs(raw.path, b) : null;
  if (raw.path !== undefined && !path) {
    report.add('approximated', 'An outline had invalid path data; its bounding box was used instead.', id);
  }
  if (!shape) {
    const said = typeof (raw.shape ?? raw.type) === 'string' ? String(raw.shape ?? raw.type).slice(0, 40) : '';
    shape = path ? 'path' : 'rectangle';
    report.add(
      'approximated',
      said ? `Unknown shape type "${said}" was imported as ${shape === 'path' ? 'its outline' : 'a rectangle'}.` : 'An object without a shape type was imported as a rectangle.',
      id,
    );
  }
  if ((shape === 'path' || shape === 'polygon') && !path) shape = 'rectangle';
  if (path && (shape === 'path' || shape === 'polygon')) {
    // For an explicit outline the geometry is the truth; a stated box that
    // disagrees with it is ignored.
    const box = segsBounds(path);
    if (box.w > 0 || box.h > 0) {
      return finishObject(raw, id, shape, box.x, box.y, Math.max(box.w, 0.5), Math.max(box.h, 0.5), path, report, ids, index);
    }
  }

  const x = finiteOrNull(raw.x);
  const y = finiteOrNull(raw.y);
  let w = finiteOrNull(raw.w ?? raw.width);
  let h = finiteOrNull(raw.h ?? raw.height);
  if (x === null || y === null || w === null || h === null) {
    // A path alone is enough to recover the box.
    if (path) {
      const pts = path.flatMap((s) => (s.c === 'Z' ? [] : s.c === 'C' ? [s.c1, s.c2, s.p] : [s.p]));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const bx = Math.min(...xs);
      const by = Math.min(...ys);
      return finishObject(raw, id, shape, bx, by, Math.max(...xs) - bx, Math.max(...ys) - by, path, report, ids, index);
    }
    report.add('unsupported', 'An object had no valid position or size and was skipped.', id);
    return null;
  }
  if (!b.ok({ x, y }) || !b.ok({ x: x + w, y: y + h })) {
    report.add('unsupported', 'An object lay far outside the diagram (invalid coordinates) and was skipped.', id);
    return null;
  }
  if (w < 0) w = -w;
  if (h < 0) h = -h;
  return finishObject(raw, id, shape, x, y, w, h, path, report, ids, index);
}

function finishObject(
  raw: Raw,
  id: string,
  shape: IRShapeType,
  x: number,
  y: number,
  w: number,
  h: number,
  path: Seg[] | null,
  report: ReportBuilder,
  ids: Set<string>,
  index: number,
): IRObject | null {
  const text = readText(raw.text, report, id);
  if (w < 0.5 || h < 0.5) {
    if (shape !== 'text' || !text) {
      report.add('unsupported', 'A zero-size object was skipped.', id);
      return null;
    }
    w = Math.max(w, 1);
    h = Math.max(h, 1);
  }
  ids.add(id);
  const o: IRObject = {
    id,
    shape,
    x,
    y,
    w,
    h,
    rotation: normAngle(num(raw.rotation, 0)),
    style: readStyle(raw.style, report, id, shape === 'text'),
    z: num(raw.z, index),
  };
  if (path) o.path = path;
  if (text) o.text = text;
  const gid = cleanId(raw.groupId);
  if (gid) o.groupId = gid;
  if (raw.locked === true) o.locked = true;
  const conf = finiteOrNull(raw.confidence);
  if (conf !== null) o.confidence = clamp(conf, 0, 1);
  if (typeof raw.sourceId === 'string') o.sourceId = raw.sourceId.slice(0, 200);
  if (shape === 'image' && isObj(raw.image) && typeof raw.image.href === 'string') {
    o.image = { href: raw.image.href.slice(0, 2_000_000) };
  }
  const notes = readNotes(raw.notes);
  if (notes) o.notes = notes;
  const preserved = readPreserved(raw.preserved);
  if (preserved) o.preserved = preserved;
  return o;
}

/* -------------------------------------------------------- connectors */

function readEndpoint(v: unknown, objectIds: Set<string>, report: ReportBuilder, ref: string): IREndpoint | undefined {
  if (typeof v === 'string') v = { objectId: v };
  if (!isObj(v)) return undefined;
  const ep: IREndpoint = {};
  const oid = cleanId(v.objectId ?? v.id);
  if (oid) {
    if (objectIds.has(oid)) ep.objectId = oid;
    else report.add('unmapped-connector', `A connector referred to an unknown object "${oid}"; that end was left free.`, ref);
  }
  const port = enumOf(v.port, PORTS);
  if (port) ep.port = port;
  const fx = finiteOrNull(v.fx);
  const fy = finiteOrNull(v.fy);
  if (fx !== null && fy !== null) {
    ep.fx = clamp(fx, -1, 2);
    ep.fy = clamp(fy, -1, 2);
  }
  if (v.floating === true) ep.floating = true;
  return Object.keys(ep).length ? ep : undefined;
}

function readArrow(v: unknown, report: ReportBuilder, ref: string): IRArrow {
  if (v === undefined || v === null || v === '') return 'none';
  const a = enumOf(v, IR_ARROWS);
  if (a) return a;
  report.add('approximated', `Unknown arrowhead "${String(v).slice(0, 30)}" drawn as a standard arrow.`, ref);
  return 'stealth';
}

function readLabel(v: unknown, report: ReportBuilder, ref: string): IRConnectorLabel | undefined {
  if (typeof v === 'string') v = { text: v };
  if (!isObj(v)) return undefined;
  const text = cleanText(v.text ?? v.content, 2000);
  if (!text.trim()) return undefined;
  const color = colorOr(v.color, '#000000', report, ref, 'label');
  const label: IRConnectorLabel = {
    text,
    position: clamp(num(v.position, 0.5), 0, 1),
    offset: clamp(num(v.offset, 0), -1000, 1000),
    fontSize: clamp(num(v.fontSize, 11), 1, 200),
    color: color.hex ?? '#000000',
    background: v.background !== false,
  };
  if (v.bold === true) label.bold = true;
  if (v.italic === true) label.italic = true;
  const conf = finiteOrNull(v.confidence);
  if (conf !== null) label.confidence = clamp(conf, 0, 1);
  return label;
}

function readConnector(
  raw: unknown,
  index: number,
  b: Bounds,
  report: ReportBuilder,
  objectIds: Set<string>,
  ids: Set<string>,
): IRConnector | null {
  if (!isObj(raw)) {
    report.add('unmapped-connector', `Connector #${index + 1} was not an object and was skipped.`);
    return null;
  }
  let id = cleanId(raw.id) || `c${index + 1}`;
  while (ids.has(id) || objectIds.has(id)) id = `${id}_`;

  const source = readEndpoint(raw.source, objectIds, report, id);
  const target = readEndpoint(raw.target, objectIds, report, id);
  const rawPoints = Array.isArray(raw.points) ? raw.points : [];
  const points: Point[] = [];
  let dropped = 0;
  for (const p of rawPoints.slice(0, 5000)) {
    const q = readPoint(p, b);
    if (q) points.push(q);
    else dropped++;
  }
  if (dropped) report.add('approximated', `${dropped} invalid bend point(s) were ignored.`, id);

  const bothBound = !!source?.objectId && !!target?.objectId;
  if (points.length < 2 && !bothBound) {
    report.add('unmapped-connector', 'A connector had neither a usable path nor two connected objects and was skipped.', id);
    return null;
  }

  let routing = enumOf(raw.routing, IR_ROUTINGS) as IRRouting | null;
  if (!routing) routing = points.length > 2 ? 'polyline' : 'straight';
  const curve = raw.curve !== undefined ? readSegs(raw.curve, b) ?? undefined : undefined;

  const st = isObj(raw.style) ? raw.style : {};
  const stroke = colorOr(st.stroke, '#000000', report, id, 'line');
  const c: IRConnector = {
    id,
    points,
    routing,
    arrowStart: readArrow(raw.arrowStart, report, id),
    arrowEnd: readArrow(raw.arrowEnd, report, id),
    style: {
      stroke: stroke.hex ?? '#000000',
      strokeWidth: clamp(num(st.strokeWidth, 1), 0.1, 100),
      strokeOpacity: clamp(num(st.strokeOpacity, 1) * (stroke.hex ? stroke.alpha : 1), 0, 1),
      ...readDash(st.dash, st.dashArray),
      opacity: clamp(num(st.opacity, 1), 0, 1),
    },
    z: num(raw.z, 10_000 + index),
  };
  if (source) c.source = source;
  if (target) c.target = target;
  if (curve) c.curve = curve;
  if (raw.rounded === true) c.rounded = true;
  const cr = finiteOrNull(raw.cornerRadius);
  if (cr !== null) c.cornerRadius = clamp(cr, 0, 500);
  const as = finiteOrNull(raw.arrowSize);
  if (as !== null) c.arrowSize = clamp(as, 1, 200);
  const label = readLabel(raw.label, report, id);
  if (label) c.label = label;
  const conf = finiteOrNull(raw.confidence);
  if (conf !== null) c.confidence = clamp(conf, 0, 1);
  if (typeof raw.sourceId === 'string') c.sourceId = raw.sourceId.slice(0, 200);
  const notes = readNotes(raw.notes);
  if (notes) c.notes = notes;
  const preserved = readPreserved(raw.preserved);
  if (preserved) c.preserved = preserved;
  ids.add(id);
  return c;
}

/* ------------------------------------------------------------- entry */

/**
 * Validate and coerce an untrusted IR. Throws only when there is nothing
 * usable at all; everything else degrades with a report entry.
 */
export function validateIR(raw: unknown, opts: ValidateOptions): IRDiagram {
  const { report } = opts;
  const maxObjects = opts.maxObjects ?? 3000;
  const maxConnectors = opts.maxConnectors ?? 5000;

  if (!isObj(raw)) {
    throw new ImportError('no-diagram', 'Could not identify a valid diagram.', {
      detail: 'Expected a JSON object with "objects" and "connectors".',
    });
  }
  const rawObjects = raw.objects;
  const rawConnectors = raw.connectors ?? raw.edges;
  if (!Array.isArray(rawObjects) && !Array.isArray(rawConnectors)) {
    throw new ImportError('no-diagram', undefined, { detail: 'The result has neither "objects" nor "connectors".' });
  }

  const canvasRaw = isObj(raw.canvas) ? raw.canvas : {};
  let cw = num(canvasRaw.width, 0);
  let ch = num(canvasRaw.height, 0);
  if (!(cw > 0) || cw > ABS_LIMIT) cw = 0;
  if (!(ch > 0) || ch > ABS_LIMIT) ch = 0;
  // Anything more than ten canvases away is an error, not a diagram.
  const limit = Math.min(ABS_LIMIT, Math.max(2000, Math.max(cw, ch) * 10));
  const bounds = new Bounds(limit);

  const objects: IRObject[] = [];
  const objectIds = new Set<string>();
  const list = Array.isArray(rawObjects) ? rawObjects : [];
  if (list.length > maxObjects) {
    report.add('unsupported', `The result listed ${list.length} objects; only the first ${maxObjects} were imported.`);
  }
  list.slice(0, maxObjects).forEach((o, i) => {
    const obj = readObject(o, i, bounds, report, objectIds);
    if (obj) objects.push(obj);
  });

  const connectors: IRConnector[] = [];
  const connectorIds = new Set<string>();
  const clist = Array.isArray(rawConnectors) ? rawConnectors : [];
  if (clist.length > maxConnectors) {
    report.add('unsupported', `The result listed ${clist.length} connectors; only the first ${maxConnectors} were imported.`);
  }
  clist.slice(0, maxConnectors).forEach((c, i) => {
    const con = readConnector(c, i, bounds, report, objectIds, connectorIds);
    if (con) connectors.push(con);
  });

  const groups: IRGroup[] = [];
  if (Array.isArray(raw.groups)) {
    for (const g of raw.groups.slice(0, 2000)) {
      if (!isObj(g)) continue;
      const id = cleanId(g.id);
      if (!id) continue;
      const members = Array.isArray(g.memberIds)
        ? g.memberIds.map(cleanId).filter((m) => objectIds.has(m) || connectorIds.has(m))
        : [];
      const group: IRGroup = { id, memberIds: members };
      if (typeof g.name === 'string') group.name = cleanText(g.name, 200);
      const parent = cleanId(g.parentId);
      if (parent) group.parentId = parent;
      groups.push(group);
    }
  }
  // Objects may name their group directly instead.
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const o of objects) {
    if (!o.groupId) continue;
    let g = byId.get(o.groupId);
    if (!g) {
      g = { id: o.groupId, memberIds: [] };
      byId.set(g.id, g);
      groups.push(g);
    }
    if (!g.memberIds.includes(o.id)) g.memberIds.push(o.id);
  }

  if (objects.length === 0 && connectors.length === 0) {
    throw new ImportError('no-diagram', 'Could not identify a valid diagram.', {
      detail: 'No shapes, text or connectors could be recovered.',
    });
  }

  // Canvas defaults to the content bounds when it was not stated.
  if (!cw || !ch) {
    let maxX = 0;
    let maxY = 0;
    for (const o of objects) {
      maxX = Math.max(maxX, o.x + o.w);
      maxY = Math.max(maxY, o.y + o.h);
    }
    for (const c of connectors) {
      for (const p of c.points) {
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    cw = cw || Math.max(1, Math.ceil(maxX));
    ch = ch || Math.max(1, Math.ceil(maxY));
  }

  const bg = isObj(raw.background) ? raw.background : {};
  const bgColor = colorOr(bg.color, null, undefined, undefined, 'background');
  const meta = isObj(raw.metadata) ? raw.metadata : {};

  return {
    version: IR_VERSION,
    canvas: { width: cw, height: ch },
    background: {
      color: bgColor.hex,
      transparent: bg.transparent === true || (!bgColor.hex && bg.color === undefined),
      removed: bg.removed === true,
      confidence: finiteOrNull(bg.confidence) ?? undefined,
      method: typeof bg.method === 'string' ? bg.method.slice(0, 100) : undefined,
    },
    objects,
    connectors,
    groups: groups.filter((g) => g.memberIds.length > 0),
    metadata: {
      format: typeof meta.format === 'string' ? meta.format.slice(0, 40) : 'ir',
      title: typeof meta.title === 'string' ? cleanText(meta.title, 200) : undefined,
      generator: typeof meta.generator === 'string' ? meta.generator.slice(0, 100) : undefined,
      notes: Array.isArray(meta.notes)
        ? meta.notes.filter((n): n is string => typeof n === 'string').slice(0, 20).map((n) => cleanText(n, 500))
        : [],
    },
  };
}
