/**
 * Core diagram model.
 *
 * This module is the single source of truth for the application. Nothing here
 * knows about React, SVG, the DOM or LaTeX. The renderer and the TikZ generator
 * are both pure functions of this model.
 *
 * Coordinate system
 * -----------------
 * Diagram units ("du") are logical, viewport independent. Origin is top-left,
 * +x right, +y DOWN (screen convention). Nodes are stored by their top-left
 * corner plus size, and rotate about their own centre.
 *
 * The canvas renders 1 du = 1 CSS px at zoom 1. The TikZ generator converts
 * du -> cm using `Diagram.settings.unitsPerCm` and flips the y axis.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Registry key of a shape definition (see model/shapes.ts). */
export type ShapeKind = string;

export type StrokeStyle = 'solid' | 'dashed' | 'dotted' | 'dashdotted' | 'none';

export type ShadingKind =
  | 'none'
  | 'axis-vertical'
  | 'axis-horizontal'
  | 'radial';

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';

/** Font families we can honestly reproduce on both sides of the pipeline. */
export type FontFamily = 'sans' | 'serif' | 'mono';

export interface TextStyle {
  color: string;
  fontSize: number; // in diagram units (px at zoom 1)
  fontFamily: FontFamily;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: HAlign;
  valign: VAlign;
  /** Wrap width in du. 0 = no wrapping (only explicit newlines break lines). */
  wrapWidth: number;
  lineHeight: number; // multiplier
}

export interface ShapeStyle {
  fill: string; // hex, e.g. "#ffffff"
  fillOpacity: number; // 0..1
  stroke: string; // hex
  strokeOpacity: number; // 0..1
  strokeWidth: number; // du
  strokeStyle: StrokeStyle;
  opacity: number; // 0..1 applied to the whole object
  /** Corner radius in du. Only honoured by shapes that declare `roundable`. */
  cornerRadius: number;
  shadow: boolean;
  shading: ShadingKind;
  /** Second colour of the gradient when `shading !== 'none'`. */
  shadingColor: string;
}

export interface Node {
  id: string;
  kind: ShapeKind;
  x: number; // top-left, du
  y: number;
  w: number;
  h: number;
  rotation: number; // degrees, clockwise, about the node centre
  text: string; // raw user text; may contain "\n"
  style: ShapeStyle;
  textStyle: TextStyle;
  locked: boolean;
  z: number; // paint order; higher = in front
  groupId?: string;
}

/** Where a connector attaches. */
export type PortId =
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw'
  | 'c'
  /** "auto" picks the nearest sensible port each time geometry changes. */
  | 'auto';

export interface Endpoint {
  /** Attached to a node ... */
  nodeId?: string;
  port?: PortId;
  /** ... or floating at a fixed diagram coordinate. */
  point?: Point;
}

export type RoutingKind =
  | 'straight'
  | 'orthogonal'
  | 'rounded-orthogonal'
  | 'curved'
  | 'bezier'
  | 'zigzag'
  | 'polyline';

export type ArrowHead =
  | 'none'
  | 'stealth'
  | 'latex'
  | 'triangle'
  | 'open-triangle'
  | 'bar'
  | 'circle'
  | 'diamond';

export interface EdgeLabel {
  text: string;
  /** Position along the path, 0..1. */
  pos: number;
  /** Perpendicular offset in du (positive = left of travel direction). */
  offset: number;
  fontSize: number;
  color: string;
  /** Paint an opaque plate behind the label so it stays legible over lines. */
  background: boolean;
}

export interface Edge {
  id: string;
  source: Endpoint;
  target: Endpoint;
  routing: RoutingKind;
  /** Intermediate points, in du. Used by `polyline`; optional elsewhere. */
  waypoints: Point[];
  /** Curvature for `curved`/`bezier`, in du of perpendicular displacement. */
  bend: number;
  arrowStart: ArrowHead;
  arrowEnd: ArrowHead;
  arrowSize: number; // du
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  opacity: number;
  /** Corner radius for orthogonal routing. */
  cornerRadius: number;
  label?: EdgeLabel;
  z: number;
}

export interface Group {
  id: string;
  memberIds: string[];
  name?: string;
}

export interface DiagramSettings {
  /** Diagram units per centimetre in the generated TikZ. */
  unitsPerCm: number;
  gridSize: number;
  showGrid: boolean;
  snapToGrid: boolean;
  snapToObjects: boolean;
  /** Background of the exported canvas; the editor always paints white paper. */
  background: string;
}

export interface Diagram {
  /** Schema version, used by the persistence layer for migrations. */
  version: number;
  id: string;
  name: string;
  nodes: Record<string, Node>;
  edges: Record<string, Edge>;
  groups: Record<string, Group>;
  /** Explicit ordering of node and edge ids, back to front. */
  order: string[];
  settings: DiagramSettings;
}

export type DiagramObject = Node | Edge;

export function isNode(o: DiagramObject | undefined): o is Node {
  return !!o && (o as Node).kind !== undefined;
}

export function isEdge(o: DiagramObject | undefined): o is Edge {
  return !!o && (o as Edge).routing !== undefined;
}
