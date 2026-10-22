import type { IRArrow, IRShapeType } from '../ir/types';

/**
 * draw.io (mxGraph) style strings and vocabulary.
 *
 * A style is `name;key=value;key=value;` where bare tokens are named styles.
 * This module turns one into a lookup that records which keys the importer
 * consumed, so every *unconsumed* key can be kept verbatim as metadata - the
 * importer never silently drops a style property.
 */

export class DrawioStyle {
  readonly names: string[] = [];
  private map = new Map<string, string>();
  private used = new Set<string>();

  constructor(src: string | undefined) {
    for (const part of (src ?? '').split(';')) {
      const t = part.trim();
      if (!t) continue;
      const k = t.indexOf('=');
      if (k < 0) this.names.push(t);
      else this.map.set(t.slice(0, k).trim(), t.slice(k + 1).trim());
    }
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): string | undefined {
    this.used.add(key);
    return this.map.get(key);
  }

  num(key: string, fallback: number): number {
    const v = this.get(key);
    if (v === undefined || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  flag(key: string, fallback = false): boolean {
    const v = this.get(key);
    if (v === undefined) return fallback;
    return v === '1' || v === 'true';
  }

  hasName(name: string): boolean {
    return this.names.includes(name);
  }

  /** Mark keys as understood without reading them (layout-only keys). */
  consume(...keys: string[]): void {
    for (const k of keys) this.used.add(k);
  }

  /** Keys present in the style that nothing read. */
  unconsumed(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.map) if (!this.used.has(k)) out[k] = v;
    return out;
  }
}

/**
 * Keys that only affect draw.io's own editor behaviour (or are fully
 * expressed by the geometry we already read) and so carry no visual
 * information worth preserving.
 */
export const EDITOR_ONLY_KEYS = [
  'html',
  'whiteSpace',
  'overflow',
  'points',
  'perimeter',
  'perimeterSpacing',
  'orthogonalLoop',
  'jettySize',
  'connectable',
  'container',
  'collapsible',
  'recursiveResize',
  'expand',
  'resizable',
  'rotatable',
  'deletable',
  'editable',
  'cloneable',
  'pointerEvents',
  'outlineConnect',
  'snapToPoint',
  'treeFolding',
  'treeMoving',
  'childLayout',
  'resizeParent',
  'resizeParentMax',
  'resizeLast',
  'horizontalStack',
  'marginBottom',
  'autosize',
  'fixDash',
  'metaEdit',
  'backgroundOutline',
  'part',
  'portConstraint',
  'noLabel',
  'aspect',
  'imageAspect',
  'fillStyle',
  'sketch',
  'comic',
  'jiggle',
  'hachureGap',
  'curveFitting',
  'simplification',
  'disableMultiStroke',
  'bowing',
];

/** `shape=` values and named styles -> IR shape type. */
export const SHAPE_MAP: Record<string, IRShapeType> = {
  rectangle: 'rectangle',
  rect: 'rectangle',
  label: 'rectangle',
  ellipse: 'ellipse',
  doubleEllipse: 'ellipse',
  rhombus: 'diamond',
  parallelogram: 'parallelogram',
  hexagon: 'hexagon',
  trapezoid: 'trapezoid',
  process: 'predefined-process',
  document: 'document',
  cylinder: 'cylinder',
  cylinder2: 'cylinder',
  cylinder3: 'cylinder',
  datastore: 'cylinder',
  dataStorage: 'stored-data',
  internalStorage: 'internal-storage',
  manualInput: 'manual-input',
  delay: 'delay',
  display: 'display',
  offPageConnector: 'off-page',
  note: 'note',
  note2: 'note',
  card: 'card',
  loopLimit: 'loop-limit',
  orEllipse: 'or',
  sumEllipse: 'summing-junction',
  triangle: 'triangle',
  'mxgraph.flowchart.terminator': 'terminator',
  'mxgraph.flowchart.process': 'rectangle',
  'mxgraph.flowchart.decision': 'diamond',
  'mxgraph.flowchart.data': 'parallelogram',
  'mxgraph.flowchart.document': 'document',
  'mxgraph.flowchart.multi-document': 'multi-document',
  'mxgraph.flowchart.database': 'cylinder',
  'mxgraph.flowchart.direct_data': 'direct-access-storage',
  'mxgraph.flowchart.stored_data': 'stored-data',
  'mxgraph.flowchart.internal_storage': 'internal-storage',
  'mxgraph.flowchart.predefined_process': 'predefined-process',
  'mxgraph.flowchart.preparation': 'hexagon',
  'mxgraph.flowchart.manual_input': 'manual-input',
  'mxgraph.flowchart.manual_operation': 'trapezoid',
  'mxgraph.flowchart.delay': 'delay',
  'mxgraph.flowchart.display': 'display',
  'mxgraph.flowchart.on-page_reference': 'circle',
  'mxgraph.flowchart.off-page_reference': 'off-page',
  'mxgraph.flowchart.merge_or_storage': 'inverted-triangle',
  'mxgraph.flowchart.extract_or_measurement': 'triangle',
  'mxgraph.flowchart.or': 'or',
  'mxgraph.flowchart.summing_function': 'summing-junction',
  'mxgraph.flowchart.card': 'card',
  'mxgraph.flowchart.loop_limit': 'loop-limit',
  'mxgraph.flowchart.annotation_1': 'annotation',
  'mxgraph.flowchart.annotation_2': 'annotation',
  'mxgraph.flowchart.start_1': 'ellipse',
  'mxgraph.flowchart.start_2': 'circle',
  'mxgraph.flowchart.transfer': 'off-page',
};

/** draw.io arrow names -> IR arrow, given whether the head is filled. */
export function mapDrawioArrow(name: string | undefined, filled: boolean): { arrow: IRArrow; exact: boolean } {
  switch (name) {
    case undefined:
    case '':
    case 'none':
      return { arrow: 'none', exact: true };
    case 'classic':
    case 'classicThin':
      return { arrow: filled ? 'stealth' : 'open-triangle', exact: filled };
    case 'block':
    case 'blockThin':
      return { arrow: filled ? 'triangle' : 'open-triangle', exact: true };
    case 'open':
    case 'openThin':
    case 'openAsync':
      return { arrow: 'open', exact: name === 'open' };
    case 'oval':
      return { arrow: filled ? 'circle' : 'open-circle', exact: true };
    case 'diamond':
    case 'diamondThin':
      return { arrow: filled ? 'diamond' : 'open-diamond', exact: true };
    case 'dash':
      return { arrow: 'bar', exact: false };
    case 'cross':
    case 'ERone':
    case 'ERmandOne':
    case 'ERmany':
    case 'ERoneToMany':
    case 'ERzeroToOne':
    case 'ERzeroToMany':
    case 'halfCircle':
    case 'box':
    case 'async':
    case 'circle':
    case 'circlePlus':
    case 'baseDash':
    case 'doubleBlock':
      return { arrow: filled && name !== 'async' ? 'triangle' : 'open-triangle', exact: false };
    default:
      return { arrow: 'stealth', exact: false };
  }
}
