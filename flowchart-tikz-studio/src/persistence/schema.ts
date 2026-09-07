import type { Diagram, Edge, Node } from '../model/types';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SHAPE_STYLE,
  DEFAULT_TEXT_STYLE,
  SCHEMA_VERSION,
  emptyDiagram,
} from '../model/defaults';
import { normalizeOrder } from '../model/diagram';

/**
 * Save file format.
 *
 * The saved document is the diagram model itself, not the generated LaTeX.
 * Generated code is a projection; reconstructing a model from it would be
 * lossy, so it is never the source of truth.
 */

export interface SaveFile {
  format: 'flowchart-tikz-studio';
  version: number;
  savedAt: string;
  diagram: Diagram;
}

export function serialize(d: Diagram): string {
  const payload: SaveFile = {
    format: 'flowchart-tikz-studio',
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    diagram: d,
  };
  return JSON.stringify(payload, null, 2);
}

export class LoadError extends Error {}

function coerceNode(raw: any, id: string): Node | null {
  if (!raw || typeof raw !== 'object') return null;
  const n: Node = {
    id,
    kind: typeof raw.kind === 'string' ? raw.kind : 'process',
    x: Number(raw.x) || 0,
    y: Number(raw.y) || 0,
    w: Math.max(1, Number(raw.w) || 100),
    h: Math.max(1, Number(raw.h) || 60),
    rotation: Number(raw.rotation) || 0,
    text: typeof raw.text === 'string' ? raw.text : '',
    style: { ...DEFAULT_SHAPE_STYLE, ...(raw.style ?? {}) },
    textStyle: { ...DEFAULT_TEXT_STYLE, ...(raw.textStyle ?? {}) },
    locked: !!raw.locked,
    z: Number(raw.z) || 0,
    groupId: typeof raw.groupId === 'string' ? raw.groupId : undefined,
  };
  return n;
}

function coerceEdge(raw: any, id: string): Edge | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id,
    source: raw.source ?? {},
    target: raw.target ?? {},
    routing: raw.routing ?? 'orthogonal',
    waypoints: Array.isArray(raw.waypoints) ? raw.waypoints : [],
    bend: Number(raw.bend) || 0,
    arrowStart: raw.arrowStart ?? 'none',
    arrowEnd: raw.arrowEnd ?? 'stealth',
    arrowSize: Number(raw.arrowSize) || 9,
    stroke: raw.stroke ?? '#1f2933',
    strokeOpacity: raw.strokeOpacity ?? 1,
    strokeWidth: Number(raw.strokeWidth) || 1.6,
    strokeStyle: raw.strokeStyle ?? 'solid',
    opacity: raw.opacity ?? 1,
    cornerRadius: Number(raw.cornerRadius) || 0,
    label: raw.label,
    z: Number(raw.z) || 0,
  };
}

/**
 * Parse a save file defensively: a corrupt or hand-edited file should degrade
 * to "as much of the diagram as we can read", never to a crashed editor.
 */
export function deserialize(json: string): { diagram: Diagram; warnings: string[] } {
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new LoadError('That file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new LoadError('That file does not contain a diagram.');
  }
  const raw = parsed.diagram ?? parsed;
  if (!raw || typeof raw !== 'object' || (!raw.nodes && !raw.edges)) {
    throw new LoadError('That file does not contain a diagram.');
  }

  const warnings: string[] = [];
  if (typeof parsed.version === 'number' && parsed.version > SCHEMA_VERSION) {
    warnings.push(
      `The file was written by a newer version (v${parsed.version}); unknown fields were ignored.`,
    );
  }

  const d: Diagram = emptyDiagram(typeof raw.name === 'string' ? raw.name : 'Untitled diagram');
  d.version = SCHEMA_VERSION;
  d.settings = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) };

  for (const [id, value] of Object.entries(raw.nodes ?? {})) {
    const n = coerceNode(value, id);
    if (n) d.nodes[id] = n;
    else warnings.push(`Shape ${id} was unreadable and was skipped.`);
  }
  for (const [id, value] of Object.entries(raw.edges ?? {})) {
    const e = coerceEdge(value, id);
    if (!e) {
      warnings.push(`Connector ${id} was unreadable and was skipped.`);
      continue;
    }
    const srcOk = e.source.nodeId ? !!d.nodes[e.source.nodeId] : !!e.source.point;
    const dstOk = e.target.nodeId ? !!d.nodes[e.target.nodeId] : !!e.target.point;
    if (!srcOk || !dstOk) {
      warnings.push(`Connector ${id} pointed at a missing shape and was skipped.`);
      continue;
    }
    d.edges[id] = e;
  }
  for (const [id, value] of Object.entries(raw.groups ?? {})) {
    const g = value as any;
    const members = (g?.memberIds ?? []).filter((m: string) => d.nodes[m]);
    if (members.length >= 2) d.groups[id] = { id, memberIds: members, name: g?.name };
  }
  d.order = Array.isArray(raw.order)
    ? raw.order.filter((id: string) => d.nodes[id] || d.edges[id])
    : [];
  normalizeOrder(d);
  return { diagram: d, warnings };
}
