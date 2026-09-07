import type {
  Diagram,
  Edge,
  Node,
  ShapeStyle,
  TextStyle,
  DiagramSettings,
} from './types';
import { getShapeDef } from './shapes';
import { nextId } from './ids';

export const SCHEMA_VERSION = 1;

export const DEFAULT_SHAPE_STYLE: ShapeStyle = {
  fill: '#ffffff',
  fillOpacity: 1,
  stroke: '#1f2933',
  strokeOpacity: 1,
  strokeWidth: 1.6,
  strokeStyle: 'solid',
  opacity: 1,
  cornerRadius: 0,
  shadow: false,
  shading: 'none',
  shadingColor: '#c7d2e0',
};

export const DEFAULT_TEXT_STYLE: TextStyle = {
  color: '#12161c',
  fontSize: 14,
  fontFamily: 'sans',
  bold: false,
  italic: false,
  underline: false,
  align: 'center',
  valign: 'middle',
  wrapWidth: 0,
  lineHeight: 1.25,
};

export const DEFAULT_SETTINGS: DiagramSettings = {
  unitsPerCm: 50,
  gridSize: 10,
  showGrid: true,
  snapToGrid: true,
  snapToObjects: true,
  background: '#ffffff',
};

export function makeNode(
  kind: string,
  x: number,
  y: number,
  overrides: Partial<Node> = {},
): Node {
  const def = getShapeDef(kind);
  return {
    id: overrides.id ?? nextId('n'),
    kind,
    x,
    y,
    w: def.defaultSize.w,
    h: def.defaultSize.h,
    rotation: 0,
    text: def.id === 'text' ? 'Text' : '',
    style: { ...DEFAULT_SHAPE_STYLE },
    textStyle: { ...DEFAULT_TEXT_STYLE },
    locked: false,
    z: 0,
    ...overrides,
  };
}

export function makeEdge(overrides: Partial<Edge> = {}): Edge {
  return {
    id: overrides.id ?? nextId('e'),
    source: {},
    target: {},
    routing: 'orthogonal',
    waypoints: [],
    bend: 40,
    arrowStart: 'none',
    arrowEnd: 'stealth',
    arrowSize: 9,
    stroke: '#1f2933',
    strokeOpacity: 1,
    strokeWidth: 1.6,
    strokeStyle: 'solid',
    opacity: 1,
    cornerRadius: 10,
    z: 0,
    ...overrides,
  };
}

export function emptyDiagram(name = 'Untitled diagram'): Diagram {
  return {
    version: SCHEMA_VERSION,
    id: nextId('d'),
    name,
    nodes: {},
    edges: {},
    groups: {},
    order: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}
