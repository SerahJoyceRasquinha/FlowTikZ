import type { MetaValue, Point, PortId } from '../../model/types';
import type { Seg } from '../../model/path';

/**
 * The normalised diagram representation (IR).
 *
 * Every import path converges here before it touches the application model:
 *
 *   raster image --(offline recogniser + OCR)--> IR JSON --(validate)--> IR --> SVG --> IR
 *   SVG          --(sanitise, parse)---------------------------------> IR
 *   draw.io XML  --(parse)-------------------------------------------> IR
 *
 *   IR --(diagramMapper)--> Diagram  (the single source of truth)
 *
 * The IR is deliberately *semantic* rather than visual: a rectangle is a
 * rectangle with a box, a connector knows which objects it joins. That is what
 * lets the mapper produce native, editable shapes and connectors instead of a
 * pile of anonymous paths, and it is also the contract the offline
 * recogniser fills, so its output can be validated field by field.
 *
 * Coordinates are in source pixels, origin top-left, y down - the same
 * convention as the diagram model, so mapping is a translation, not a flip.
 */

export const IR_VERSION = 1;

/** Semantic shape vocabulary. Kept in step with `IR_SHAPE_TYPES` below. */
export type IRShapeType =
  | 'rectangle'
  | 'rounded-rectangle'
  | 'terminator'
  | 'ellipse'
  | 'circle'
  | 'diamond'
  | 'parallelogram'
  | 'hexagon'
  | 'trapezoid'
  | 'triangle'
  | 'inverted-triangle'
  | 'document'
  | 'multi-document'
  | 'cylinder'
  | 'predefined-process'
  | 'manual-input'
  | 'delay'
  | 'display'
  | 'off-page'
  | 'note'
  | 'card'
  | 'stored-data'
  | 'internal-storage'
  | 'direct-access-storage'
  | 'loop-limit'
  | 'or'
  | 'summing-junction'
  | 'annotation'
  | 'text'
  | 'polygon'
  | 'path'
  | 'image';

export const IR_SHAPE_TYPES: readonly IRShapeType[] = [
  'rectangle',
  'rounded-rectangle',
  'terminator',
  'ellipse',
  'circle',
  'diamond',
  'parallelogram',
  'hexagon',
  'trapezoid',
  'triangle',
  'inverted-triangle',
  'document',
  'multi-document',
  'cylinder',
  'predefined-process',
  'manual-input',
  'delay',
  'display',
  'off-page',
  'note',
  'card',
  'stored-data',
  'internal-storage',
  'direct-access-storage',
  'loop-limit',
  'or',
  'summing-junction',
  'annotation',
  'text',
  'polygon',
  'path',
  'image',
];

export type IRDash = 'solid' | 'dashed' | 'dotted' | 'dashdot';
export const IR_DASHES: readonly IRDash[] = ['solid', 'dashed', 'dotted', 'dashdot'];

export type IRArrow =
  | 'none'
  | 'stealth'
  | 'latex'
  | 'triangle'
  | 'open-triangle'
  | 'open'
  | 'bar'
  | 'circle'
  | 'open-circle'
  | 'diamond'
  | 'open-diamond';

export const IR_ARROWS: readonly IRArrow[] = [
  'none',
  'stealth',
  'latex',
  'triangle',
  'open-triangle',
  'open',
  'bar',
  'circle',
  'open-circle',
  'diamond',
  'open-diamond',
];

export type IRRouting = 'straight' | 'orthogonal' | 'curved' | 'polyline';
export const IR_ROUTINGS: readonly IRRouting[] = ['straight', 'orthogonal', 'curved', 'polyline'];

export interface IRGradient {
  type: 'linear' | 'radial';
  from: string;
  to: string;
  /**
   * Direction of a linear gradient in degrees, measured like CSS: 180 runs top
   * to bottom, 90 left to right.
   */
  angle: number;
  /** Number of colour stops in the source, when there were more than two. */
  stops?: number;
}

export interface IRStyle {
  /** Hex colour, or null for no fill. */
  fill: string | null;
  fillOpacity: number;
  /** Hex colour, or null for no outline. */
  stroke: string | null;
  strokeOpacity: number;
  strokeWidth: number;
  dash: IRDash;
  /** The exact source dash pattern, when one was specified. */
  dashArray?: number[];
  opacity: number;
  cornerRadius: number;
  shadow: boolean;
  gradient?: IRGradient | null;
}

export interface IRText {
  content: string;
  fontSize: number;
  /** Source family name; classified into sans / serif / mono by the mapper. */
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  /** OCR confidence 0..1, when the text was recognised from pixels. */
  confidence?: number;
}

export interface IRObject {
  id: string;
  shape: IRShapeType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise about the centre. */
  rotation: number;
  /**
   * Exact outline in absolute source coordinates for `polygon` and `path`
   * (and optionally for any other type, to override the template outline).
   */
  path?: Seg[];
  text?: IRText;
  style: IRStyle;
  /** Paint order within the whole diagram, back to front. */
  z: number;
  groupId?: string;
  locked?: boolean;
  confidence?: number;
  sourceId?: string;
  /** Embedded image reference for `image` objects. */
  image?: { href: string; mime?: string };
  preserved?: Record<string, MetaValue>;
  notes?: string[];
}

export interface IREndpoint {
  objectId?: string;
  /** Named port, when the source says exactly where the line attaches. */
  port?: PortId;
  /** Attachment as a fraction of the object's box (draw.io exit/entry). */
  fx?: number;
  fy?: number;
  /**
   * The source does not fix where this end meets its object (draw.io's
   * "floating" terminals): the first/last point of `points` is then only
   * indicative and the router chooses the attachment.
   */
  floating?: boolean;
}

export interface IRConnectorLabel {
  text: string;
  /** Position along the connector, 0..1. */
  position: number;
  /** Perpendicular offset in source pixels. */
  offset: number;
  fontSize: number;
  color: string;
  background: boolean;
  bold?: boolean;
  italic?: boolean;
  confidence?: number;
}

export interface IRConnector {
  id: string;
  source?: IREndpoint;
  target?: IREndpoint;
  /** Polyline through the connector, absolute; first is the start, last the end. */
  points: Point[];
  routing: IRRouting;
  /** Exact curve geometry, absolute, for curved connectors. */
  curve?: Seg[];
  rounded?: boolean;
  cornerRadius?: number;
  arrowStart: IRArrow;
  arrowEnd: IRArrow;
  arrowSize?: number;
  style: {
    stroke: string;
    strokeWidth: number;
    strokeOpacity: number;
    dash: IRDash;
    dashArray?: number[];
    opacity: number;
  };
  label?: IRConnectorLabel;
  z: number;
  confidence?: number;
  sourceId?: string;
  preserved?: Record<string, MetaValue>;
  notes?: string[];
}

export interface IRGroup {
  id: string;
  memberIds: string[];
  name?: string;
  /** Enclosing group, for nested groups. */
  parentId?: string;
}

export interface IRBackground {
  /** Detected background colour of the source, if any. */
  color: string | null;
  /** True when the source already had no background. */
  transparent: boolean;
  /** True once the background has been excluded from the reconstruction. */
  removed: boolean;
  confidence?: number;
  method?: string;
}

export interface IRDiagram {
  version: typeof IR_VERSION;
  canvas: { width: number; height: number };
  background: IRBackground;
  objects: IRObject[];
  connectors: IRConnector[];
  groups: IRGroup[];
  metadata: {
    format: string;
    title?: string;
    generator?: string;
    notes: string[];
  };
}

export function emptyIR(format: string, width = 0, height = 0): IRDiagram {
  return {
    version: IR_VERSION,
    canvas: { width, height },
    background: { color: null, transparent: true, removed: false },
    objects: [],
    connectors: [],
    groups: [],
    metadata: { format, notes: [] },
  };
}

export const DEFAULT_IR_STYLE: IRStyle = {
  fill: '#ffffff',
  fillOpacity: 1,
  stroke: '#000000',
  strokeOpacity: 1,
  strokeWidth: 1,
  dash: 'solid',
  opacity: 1,
  cornerRadius: 0,
  shadow: false,
  gradient: null,
};

export const DEFAULT_IR_TEXT: Omit<IRText, 'content'> = {
  fontSize: 12,
  fontFamily: 'sans-serif',
  bold: false,
  italic: false,
  underline: false,
  color: '#000000',
  align: 'center',
  valign: 'middle',
};
