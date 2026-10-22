import type { Diagram, Edge, Node, Point, Rect } from '../../model/types';
import { DEFAULT_SETTINGS, SCHEMA_VERSION, makeNode } from '../../model/defaults';
import { normalizeOrder } from '../../model/diagram';
import { rotatedBounds } from '../../model/geometry';
import type { Seg } from '../../model/path';
import type { IRDiagram, IRObject } from '../ir/types';
import { kindForObject, matchOutline } from '../ir/shapes';
import type { ReportBuilder } from '../report';
import { IdAllocator, localAllocator } from './ids';
import { mapShapeStyle, round2 } from './styleMapper';
import { mapText, minTextHeight, minTextWidth } from './textMapper';
import { mapConnector } from './connectorMapper';

/**
 * IR -> Diagram. The one place every import path turns into the native
 * model.
 *
 * Nothing here is special to imported objects: the output is built with the
 * same factories (`makeNode`, `makeEdge`) and the same registry kinds a user
 * gets from the palette, so the canvas, the inspector, undo, persistence and
 * the TikZ generator all treat the result exactly as a hand-drawn diagram.
 */

export interface MapOptions {
  report: ReportBuilder;
  /** Recorded on each object's provenance, e.g. "drawio". */
  format: string;
  name?: string;
  alloc?: IdAllocator;
  /** Where the content's top-left lands, in diagram units. */
  origin?: Point;
  /** Source px -> diagram units. */
  scale?: number;
  /** Attach free connector ends to shapes they visibly touch. */
  inferAttachments?: boolean;
}

export interface MapResult {
  diagram: Diagram;
  /** IR id -> diagram id. */
  idMap: Map<string, string>;
  transform: { scale: number; offsetX: number; offsetY: number };
  counts: { shapes: number; texts: number; connectors: number; groups: number };
}

function irBounds(ir: IRDiagram): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const o of ir.objects) {
    const b = rotatedBounds({ x: o.x, y: o.y, w: o.w, h: o.h }, o.rotation);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  for (const c of ir.connectors) {
    for (const p of c.points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Express an absolute outline as fractions of its box, for `Node.path`. */
function normalizePath(path: Seg[], box: Rect): Node['path'] {
  const w = box.w || 1;
  const h = box.h || 1;
  const t = (p: Point) => ({ x: round4((p.x - box.x) / w), y: round4((p.y - box.y) / h) });
  return path.map((s) =>
    s.c === 'Z' ? { c: 'Z' as const } : s.c === 'C' ? { c: 'C' as const, c1: t(s.c1), c2: t(s.c2), p: t(s.p) } : { c: s.c, p: t(s.p) },
  );
}

function round4(v: number) {
  return Math.round(v * 10000) / 10000;
}

function mapObject(
  o: IRObject,
  id: string,
  opts: Required<Pick<MapOptions, 'report' | 'format'>> & { scale: number; tf: (p: Point) => Point },
): Node {
  const { report, scale, tf } = opts;
  let kind = kindForObject(o);
  let cornerRadius = o.style.cornerRadius;
  const notes = [...(o.notes ?? [])];

  // Explicit outlines: recognise native symbols first, keep the exact path otherwise.
  let path: Seg[] | undefined = o.path;
  if (path && (o.shape === 'polygon' || o.shape === 'path')) {
    const m = matchOutline(path);
    if (m) {
      kind = m.kind;
      cornerRadius = m.cornerRadius || cornerRadius;
      if (m.deviation > 1) {
        report.tally('approximated', `Outline matched to the standard "${kind}" symbol (within ${Math.ceil(m.deviation)} px)`);
      }
      path = undefined;
    } else {
      kind = 'freeform';
    }
  }

  if ((o.shape === 'rounded-rectangle' || o.shape === 'rectangle') && cornerRadius >= Math.min(o.w, o.h) / 2 - 0.5 && cornerRadius > 0) {
    kind = 'terminator';
  }
  // The semantic type wins: a shape reported as rounded is drawn rounded even
  // when the radius itself was not measured.
  if (o.shape === 'rounded-rectangle' && cornerRadius <= 0) {
    cornerRadius = Math.round(Math.min(o.w, o.h) * 0.15 * 100) / 100;
    report.tally('approximated', 'Rounded corners without a measured radius drawn with a proportional radius');
  }

  const hasBox = !!o.style.fill || !!o.style.stroke;
  if (o.shape === 'text' && hasBox) kind = 'process';

  const tl = tf({ x: o.x, y: o.y });
  const w = round2(o.w * scale);
  const h = round2(o.h * scale);
  const style = mapShapeStyle({ ...o.style, cornerRadius }, kind, scale, report);
  const text = mapText(o.text, scale, report, o.id);

  const node = makeNode(kind, round2(tl.x), round2(tl.y), {
    id,
    w: Math.max(1, w),
    h: Math.max(1, h),
    rotation: o.rotation,
    text: text.text,
    style: style.style,
    textStyle: text.textStyle,
    locked: !!o.locked,
  });

  if (kind === 'freeform' && path) {
    node.path = normalizePath(path, { x: o.x, y: o.y, w: o.w, h: o.h });
  }

  if (o.shape === 'image') {
    // The model has no bitmap object. Rather than drop the image, keep a
    // clearly marked frame in its place and the reference to it as metadata.
    node.kind = 'process';
    node.style.strokeStyle = 'dashed';
    node.style.stroke = '#7c8a9b';
    node.style.fillOpacity = 0;
    if (!node.text) node.text = '[image]';
    report.add('partial', 'Embedded image kept as a placeholder frame; the image itself cannot be edited or exported to TikZ.', o.id);
    if (o.image?.href && o.image.href.length <= 100_000) {
      notes.push('Image reference kept in metadata (preserved.imageHref).');
    } else if (o.image?.href) {
      notes.push('Image data too large to keep as metadata.');
    }
  }

  // Free text needs room for its longest line, or the canvas would wrap it.
  if (kind === 'text' && node.text) {
    const needW = minTextWidth(node.text, node.textStyle);
    if (needW > node.w) {
      const grow = needW - node.w;
      if (node.textStyle.align === 'center') node.x = round2(node.x - grow / 2);
      else if (node.textStyle.align === 'right') node.x = round2(node.x - grow);
      node.w = needW;
    }
    const needH = minTextHeight(node.text, node.textStyle);
    if (needH > node.h) {
      const grow = needH - node.h;
      if (node.textStyle.valign === 'middle') node.y = round2(node.y - grow / 2);
      else if (node.textStyle.valign === 'bottom') node.y = round2(node.y - grow);
      node.h = needH;
    }
  }

  const preserved = { ...(o.preserved ?? {}), ...style.preserved, ...text.preserved };
  if (o.shape === 'image' && o.image?.href && o.image.href.length <= 100_000) preserved.imageHref = o.image.href;
  const confidence = o.confidence ?? text.confidence;
  node.meta = {
    import: {
      format: opts.format,
      ...(o.sourceId ? { sourceId: o.sourceId } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(Object.keys(preserved).length ? { preserved } : {}),
      ...(notes.length ? { notes } : {}),
    },
  };
  return node;
}

export function irToDiagram(ir: IRDiagram, opts: MapOptions): MapResult {
  const report = opts.report;
  const alloc = opts.alloc ?? localAllocator();
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  const origin = opts.origin ?? { x: 40, y: 40 };
  const bounds = irBounds(ir);
  const offsetX = origin.x - bounds.x * scale;
  const offsetY = origin.y - bounds.y * scale;
  const tf = (p: Point): Point => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY });

  const d: Diagram = {
    version: SCHEMA_VERSION,
    id: 'd-import',
    name: opts.name || ir.metadata.title?.trim() || 'Imported diagram',
    nodes: {},
    edges: {},
    groups: {},
    order: [],
    // The source background is not carried over: an imported diagram exports
    // on a transparent background, and its white shapes stay white.
    settings: { ...DEFAULT_SETTINGS, background: 'none' },
  };

  const idMap = new Map<string, string>();
  const paint: { id: string; z: number; seq: number }[] = [];
  let seq = 0;

  const objects = [...ir.objects].sort((a, b) => a.z - b.z);
  let shapes = 0;
  let texts = 0;
  for (const o of objects) {
    const id = alloc('n');
    try {
      const node = mapObject(o, id, { report, format: opts.format, scale, tf });
      d.nodes[id] = node;
      idMap.set(o.id, id);
      paint.push({ id, z: o.z, seq: seq++ });
      if (node.kind === 'text') texts++;
      else shapes++;
    } catch (err) {
      // One object that cannot be built never costs the rest of the diagram.
      report.add('unsupported', `An object could not be converted and was skipped (${err instanceof Error ? err.message : 'unknown error'}).`, o.id);
    }
  }

  /* --------------------------------------------------------- groups */
  const groupById = new Map(ir.groups.map((g) => [g.id, g]));
  const topGroupOf = (gid: string): string => {
    let cur = gid;
    const seen = new Set<string>();
    while (groupById.get(cur)?.parentId && !seen.has(cur)) {
      seen.add(cur);
      const parent = groupById.get(cur)!.parentId!;
      if (!groupById.has(parent)) break;
      cur = parent;
    }
    return cur;
  };
  // Which top-level group each node belongs to (via direct membership).
  const nodeGroup = new Map<string, string>();
  let nested = 0;
  for (const g of ir.groups) {
    for (const m of g.memberIds) {
      const nid = idMap.get(m);
      if (!nid) continue;
      const top = topGroupOf(g.id);
      if (top !== g.id) nested++;
      if (!nodeGroup.has(nid)) nodeGroup.set(nid, top);
    }
  }
  const members = new Map<string, string[]>();
  for (const [nid, gid] of nodeGroup) {
    if (!members.has(gid)) members.set(gid, []);
    members.get(gid)!.push(nid);
  }
  let groups = 0;
  for (const [gid, list] of members) {
    if (list.length < 2) continue;
    const id = alloc('g');
    const src = groupById.get(gid);
    d.groups[id] = { id, memberIds: list, ...(src?.name ? { name: src.name } : {}) };
    for (const nid of list) d.nodes[nid].groupId = id;
    idMap.set(gid, id);
    groups++;
  }
  if (nested) {
    report.add('partial', 'Nested groups were flattened into their outermost group (the editor groups one level deep).');
  }
  const connectorMembers = ir.groups.some((g) => g.memberIds.some((m) => ir.connectors.some((c) => c.id === m)));
  if (connectorMembers) {
    report.add('info', 'Connectors that belonged to groups are ungrouped; they still follow the grouped shapes they connect.');
  }

  /* ----------------------------------------------------- connectors */
  const diag = Math.hypot(bounds.w * scale, bounds.h * scale);
  const tolerance = Math.max(12, diag * 0.015);
  let inferredEnds = 0;
  let connectors = 0;
  const connectorsSorted = [...ir.connectors].sort((a, b) => a.z - b.z);
  for (const c of connectorsSorted) {
    const id = alloc('e');
    try {
      const { edge, inferred, free } = mapConnector(c, {
        diagram: d,
        nodeFor: (irId) => (irId ? d.nodes[idMap.get(irId) ?? ''] : undefined),
        tf,
        scale,
        report,
        inferAttachments: opts.inferAttachments ?? true,
        tolerance,
        id,
      });
      if (edge.meta?.import) edge.meta.import.format = opts.format;
      d.edges[id] = edge as Edge;
      idMap.set(c.id, id);
      paint.push({ id, z: c.z, seq: seq++ });
      inferredEnds += inferred;
      connectors++;
      if (free) {
        report.add(
          opts.inferAttachments === false ? 'info' : 'unmapped-connector',
          free === 2
            ? 'Connector is not attached to any shape; both ends are free points.'
            : 'One end of this connector is not attached to a shape.',
          c.id,
        );
      }
    } catch (err) {
      report.add('unmapped-connector', `A connector could not be converted and was skipped (${err instanceof Error ? err.message : 'unknown error'}).`, c.id);
    }
  }
  if (inferredEnds) {
    report.add('info', `${inferredEnds} connector end${inferredEnds === 1 ? ' was' : 's were'} attached to the shape the line touched, so ${inferredEnds === 1 ? 'it follows' : 'they follow'} that shape when it moves.`);
  }

  /* -------------------------------------------------------- z-order */
  paint.sort((a, b) => a.z - b.z || a.seq - b.seq);
  d.order = paint.map((p) => p.id);
  normalizeOrder(d);

  report.flushTallies();
  const parts = [
    shapes ? `${shapes} shape${shapes === 1 ? '' : 's'}` : '',
    texts ? `${texts} text label${texts === 1 ? '' : 's'}` : '',
    connectors ? `${connectors} connector${connectors === 1 ? '' : 's'}` : '',
    groups ? `${groups} group${groups === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  report.add('converted', `${parts.join(', ') || 'Nothing'} converted to native, editable objects.`);

  return {
    diagram: d,
    idMap,
    transform: { scale, offsetX, offsetY },
    counts: { shapes, texts, connectors, groups },
  };
}

/** Attach diagram ids to report entries that were recorded against IR ids. */
export function resolveReportRefs(entries: { ref?: string; objectId?: string }[], idMap: Map<string, string>): void {
  for (const e of entries) {
    if (e.ref && !e.objectId) {
      const id = idMap.get(e.ref);
      if (id) e.objectId = id;
    }
  }
}

