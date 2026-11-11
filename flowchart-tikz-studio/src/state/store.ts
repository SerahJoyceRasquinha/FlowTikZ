import { create } from 'zustand';
import type {
  Diagram,
  Edge,
  Node,
  Point,
  Rect,
  ShapeStyle,
  TextStyle,
} from '../model/types';
import { emptyDiagram, makeEdge, makeNode } from '../model/defaults';
import { adoptIds, nextId } from '../model/ids';
import {
  AlignMode,
  ZCommand,
  alignNodes,
  computeSnap,
  diagramBounds,
  distributeNodes,
  expandSelectionToGroups,
  nodeBounds,
  normalizeOrder,
  removeObjects,
  reorder,
  selectionBounds,
  SnapGuide,
} from '../model/diagram';
import type { OutputMode } from '../latex/generator';
import { remapDiagramIds } from '../import/conversion/ids';
import type { ChartSpec } from '../charts/types';
import { DEFAULT_CHART_SIZE } from '../charts/defaults';
import type { ScienceSpec } from '../science/types';
import { emptyCircuitSpec } from '../science/types';
import { isCircuitKind, CIRCUIT_BY_ID } from '../science/physics/circuits';
import { mirrorMolecule } from '../science/chem/molecule';
import { getShapeDef } from '../model/shapes';
import { distanceToSegment } from '../model/geometry';
import { routeEdge } from '../model/routing';

export type Tool = 'select' | 'pan' | 'connect' | 'text' | 'shape';

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface DraftConnection {
  fromNodeId: string;
  fromPort: string;
  to: Point;
  hoverNodeId?: string;
  hoverPort?: string;
}

interface Clipboard {
  nodes: Node[];
  edges: Edge[];
}

/** Which scientific editor is open, and on what. */
export type ScienceDialog =
  | { kind: 'math'; nodeId?: string; library?: 'math' | 'physics' }
  | { kind: 'chem'; nodeId?: string; tab?: 'formula' | 'reaction' }
  | { kind: 'molecule'; nodeId?: string };

/** Which set of symbols the left palette is showing. */
export type PaletteDomain = 'flow' | 'circuit' | 'physics';

export interface EditorState {
  doc: Diagram;
  selection: string[];
  tool: Tool;
  /** Shape kind armed for placement when `tool === 'shape'`. */
  pendingShape: string | null;
  view: Viewport;
  editingNodeId: string | null;
  editingEdgeId: string | null;
  draft: DraftConnection | null;
  guides: SnapGuide[];
  /**
   * True while the drawing board owns keyboard focus.
   *
   * Transient UI state, deliberately outside the diagram: it is never
   * committed, never snapshotted, never saved, so focusing the canvas cannot
   * create an undo step or change a byte of the generated LaTeX.
   */
  boardFocused: boolean;
  past: Diagram[];
  future: Diagram[];
  clipboard: Clipboard | null;
  outputMode: OutputMode;
  showComments: boolean;
  dirty: boolean;
  lastSavedAt: number | null;
  statusMessage: string | null;

  /* -------- history -------- */
  snapshot: Diagram | null;
  beginInteraction: () => void;
  endInteraction: () => void;
  commit: (fn: (d: Diagram) => void) => void;
  update: (fn: (d: Diagram) => void) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  /* -------- document -------- */
  loadDocument: (d: Diagram, opts?: { markSaved?: boolean }) => void;
  /**
   * Commit an imported diagram. `replace` and `insert` are a single undoable
   * step; `new` opens it as a fresh document (with a fresh history). Ids are
   * re-allocated from the editor's counters so they never collide. Returns
   * the new object ids and the translation applied to the incoming content.
   */
  applyImport: (
    incoming: Diagram,
    mode: 'replace' | 'insert' | 'new',
  ) => { ids: string[]; offset: Point; idMap: Map<string, string> };
  newDocument: () => void;
  renameDocument: (name: string) => void;
  markSaved: () => void;
  setStatus: (msg: string | null) => void;

  /* -------- selection -------- */
  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;

  /* -------- tools & view -------- */
  setTool: (t: Tool) => void;
  armShape: (kind: string | null) => void;
  setView: (v: Partial<Viewport>) => void;
  zoomBy: (factor: number, centre?: Point) => void;
  resetZoom: () => void;
  fitToView: (size: { width: number; height: number }) => void;
  setGuides: (g: SnapGuide[]) => void;
  setBoardFocused: (v: boolean) => void;

  /* -------- editing -------- */
  addNode: (kind: string, at: Point) => string;
  updateNode: (id: string, patch: Partial<Node>) => void;
  updateNodeStyle: (ids: string[], patch: Partial<ShapeStyle>) => void;
  updateTextStyle: (ids: string[], patch: Partial<TextStyle>) => void;
  moveSelection: (dx: number, dy: number, useSnap?: boolean) => void;
  setEditingNode: (id: string | null) => void;
  setEditingEdge: (id: string | null) => void;
  addEdge: (edge: Partial<Edge>) => string;
  updateEdge: (id: string, patch: Partial<Edge>) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  copySelection: () => void;
  cutSelection: () => void;
  paste: (at?: Point) => void;
  align: (mode: AlignMode) => void;
  distribute: (axis: 'h' | 'v') => void;
  reorderSelection: (cmd: ZCommand) => void;
  group: () => void;
  ungroup: () => void;
  toggleLock: () => void;
  clearCanvas: () => void;

  /* -------- settings -------- */
  updateSettings: (patch: Partial<Diagram['settings']>) => void;
  setOutputMode: (m: OutputMode) => void;
  setShowComments: (v: boolean) => void;

  /* -------- draft connection -------- */
  setDraft: (d: DraftConnection | null) => void;

  /* -------- charts -------- */
  /** The chart builder dialog: creating a new chart, or editing one's data and fields. */
  chartBuilder: { mode: 'new' } | { mode: 'edit'; nodeId: string } | null;
  openChartBuilder: (b: EditorState['chartBuilder']) => void;
  /** Ask the inspector to bring a chart's settings into view (Enter / double-click). */
  chartFocus: { id: string; nonce: number } | null;
  requestChartFocus: (id: string) => void;
  /** Insert a chart centred on `at` (diagram units). One undo step. */
  insertChart: (
    spec: ChartSpec,
    at: Point,
    size?: { w: number; h: number },
    viewport?: { width: number; height: number },
  ) => string;
  /** Zoom out and pan, if needed, so an object is fully visible. View only. */
  revealNode: (id: string, viewport: { width: number; height: number }) => void;
  /** Change a chart's spec. One undo step per call. */
  updateChart: (id: string, fn: (spec: ChartSpec) => void) => void;

  /* ------------------------------------------------------------- science */
  scienceDialog: ScienceDialog | null;
  openScienceDialog: (d: ScienceDialog | null) => void;
  paletteDomain: PaletteDomain;
  setPaletteDomain: (d: PaletteDomain) => void;
  /** Insert a typeset or drawn object centred in the view. One undo step. */
  insertScience: (
    kind: 'math' | 'chem' | 'molecule',
    spec: ScienceSpec,
    size: { w: number; h: number },
    at: Point,
  ) => string;
  /** Replace an object's payload and (keeping its centre) its size. */
  updateScience: (id: string, spec: ScienceSpec, size?: { w: number; h: number }) => void;
  /** Mirror the selected flippable objects. One undo step. */
  flipSelection: (axis: 'h' | 'v') => void;
  /** Turn the selection by a fixed angle, each about its own centre. */
  rotateSelectionBy: (deg: number) => void;
  /**
   * Tie a wire into another wire: a junction dot at the nearest point of `edgeId`
   * and the wire split around it. Returns the junction's id.
   */
  addJunctionOnWire: (edgeId: string, at: Point) => string | null;
}

const HISTORY_LIMIT = 100;

function deepClone<T>(v: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(v)
    : (JSON.parse(JSON.stringify(v)) as T);
}

/*
 * Chart data tables can hold tens of thousands of rows. They are treated as
 * immutable - every edit replaces a table, nothing writes into one - so the
 * copies made for undo history share them instead of duplicating them. That
 * keeps a long history of edits to a big chart cheap in time and memory.
 */
function clone<T>(v: T): T {
  const d = v as unknown as Diagram;
  // Only whole documents (nodes keyed by id); anything else is copied deeply.
  if (!d || typeof d !== 'object' || !d.nodes || typeof d.nodes !== 'object' || Array.isArray(d.nodes)) {
    return deepClone(v);
  }
  const detached: [Node, ChartSpec['data']][] = [];
  for (const n of Object.values(d.nodes)) {
    if (n?.chart?.data) {
      detached.push([n, n.chart.data]);
      n.chart.data = null as unknown as ChartSpec['data'];
    }
  }
  try {
    const copy = deepClone(v) as unknown as Diagram;
    for (const [n, data] of detached) {
      const twin = copy.nodes[n.id];
      if (twin?.chart) twin.chart.data = data;
    }
    return copy as unknown as T;
  } finally {
    for (const [n, data] of detached) n.chart!.data = data;
  }
}

const tableIds = new WeakMap<object, number>();
let nextTableId = 1;
function tableId(t: object): number {
  let id = tableIds.get(t);
  if (!id) {
    id = nextTableId++;
    tableIds.set(t, id);
  }
  return id;
}

function sameDoc(a: Diagram, b: Diagram): boolean {
  // Tables compare by identity (they are never edited in place).
  const replacer = (key: string, value: unknown) =>
    key === 'data' && value && typeof value === 'object' && Array.isArray((value as { rows?: unknown }).rows)
      ? `table#${tableId(value as object)}`
      : value;
  return JSON.stringify(a, replacer) === JSON.stringify(b, replacer);
}

export const useEditor = create<EditorState>((set, get) => ({
  doc: emptyDiagram(),
  selection: [],
  tool: 'select',
  pendingShape: null,
  view: { zoom: 1, panX: 60, panY: 60 },
  editingNodeId: null,
  editingEdgeId: null,
  draft: null,
  guides: [],
  boardFocused: false,
  past: [],
  future: [],
  clipboard: null,
  outputMode: 'standalone',
  showComments: true,
  dirty: false,
  lastSavedAt: null,
  statusMessage: null,
  snapshot: null,
  chartBuilder: null,
  chartFocus: null,
  scienceDialog: null,
  paletteDomain: 'flow',

  /* ------------------------------------------------------------- history */
  beginInteraction: () => {
    if (!get().snapshot) set({ snapshot: clone(get().doc) });
  },

  endInteraction: () => {
    const { snapshot, doc, past } = get();
    if (!snapshot) return;
    if (sameDoc(snapshot, doc)) {
      set({ snapshot: null });
      return;
    }
    set({
      past: [...past, snapshot].slice(-HISTORY_LIMIT),
      future: [],
      snapshot: null,
      dirty: true,
    });
  },

  commit: (fn) => {
    const { doc, past } = get();
    const before = clone(doc);
    const next = clone(doc);
    fn(next);
    normalizeOrder(next);
    if (sameDoc(before, next)) return;
    set({
      doc: next,
      past: [...past, before].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
    });
  },

  update: (fn) => {
    const next = clone(get().doc);
    fn(next);
    normalizeOrder(next);
    set({ doc: next, dirty: true });
  },

  undo: () => {
    const { past, future, doc } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    set({
      doc: previous,
      past: past.slice(0, -1),
      future: [doc, ...future].slice(0, HISTORY_LIMIT),
      selection: get().selection.filter(
        (id) => previous.nodes[id] || previous.edges[id],
      ),
      editingNodeId: null,
      dirty: true,
    });
  },

  redo: () => {
    const { past, future, doc } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      doc: next,
      past: [...past, doc].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      selection: get().selection.filter((id) => next.nodes[id] || next.edges[id]),
      editingNodeId: null,
      dirty: true,
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  /* ------------------------------------------------------------ document */
  loadDocument: (d, opts) => {
    adoptIds([...Object.keys(d.nodes), ...Object.keys(d.edges), ...Object.keys(d.groups)]);
    const next = clone(d);
    normalizeOrder(next);
    set({
      doc: next,
      selection: [],
      past: [],
      future: [],
      editingNodeId: null,
      draft: null,
      dirty: !opts?.markSaved,
      lastSavedAt: opts?.markSaved ? Date.now() : null,
    });
  },

  applyImport: (incoming, mode) => {
    // Deep copy: the committed document must share nothing with the caller.
    const { diagram, idMap } = remapDiagramIds(clone(incoming), (prefix) => nextId(prefix));
    const ids = [...diagram.order];
    let offset: Point = { x: 0, y: 0 };

    if (mode === 'new') {
      diagram.id = nextId('d');
      get().loadDocument(diagram);
      set({ selection: [] });
      return { ids, offset, idMap };
    }

    if (mode === 'insert' && get().doc.order.length > 0) {
      // Land to the right of what is already there, top-aligned, so nothing
      // overlaps and the user's work is untouched.
      const existing = diagramBounds(get().doc);
      const b = diagramBounds(diagram);
      offset = {
        x: Math.round(existing.x + existing.w + 80 - b.x),
        y: Math.round(existing.y - b.y),
      };
      const t = (p: Point) => ({ x: p.x + offset.x, y: p.y + offset.y });
      for (const n of Object.values(diagram.nodes)) {
        n.x += offset.x;
        n.y += offset.y;
      }
      for (const e of Object.values(diagram.edges)) {
        if (e.source.point) e.source.point = t(e.source.point);
        if (e.target.point) e.target.point = t(e.target.point);
        e.waypoints = e.waypoints.map(t);
      }
    }

    get().commit((d) => {
      if (mode === 'replace' || d.order.length === 0) {
        d.nodes = diagram.nodes;
        d.edges = diagram.edges;
        d.groups = diagram.groups;
        d.order = diagram.order;
        d.name = diagram.name;
        // The source background was removed on import.
        d.settings.background = diagram.settings.background;
      } else {
        Object.assign(d.nodes, diagram.nodes);
        Object.assign(d.edges, diagram.edges);
        Object.assign(d.groups, diagram.groups);
        d.order.push(...diagram.order);
      }
    });
    set({
      selection: mode === 'insert' ? ids : [],
      editingNodeId: null,
      editingEdgeId: null,
      draft: null,
    });
    return { ids, offset, idMap };
  },

  newDocument: () => {
    set({
      doc: emptyDiagram(),
      selection: [],
      past: [],
      future: [],
      editingNodeId: null,
      draft: null,
      dirty: false,
      view: { zoom: 1, panX: 60, panY: 60 },
    });
  },

  renameDocument: (name) => get().commit((d) => void (d.name = name)),

  markSaved: () => set({ dirty: false, lastSavedAt: Date.now() }),

  setStatus: (msg) => set({ statusMessage: msg }),

  /* ----------------------------------------------------------- selection */
  setSelection: (ids) =>
    set({ selection: expandSelectionToGroups(get().doc, ids) }),

  toggleSelection: (id) => {
    const sel = new Set(get().selection);
    if (sel.has(id)) sel.delete(id);
    else sel.add(id);
    set({ selection: expandSelectionToGroups(get().doc, [...sel]) });
  },

  selectAll: () => set({ selection: [...get().doc.order] }),
  clearSelection: () => set({ selection: [], editingNodeId: null }),

  /* ------------------------------------------------------- tools & view */
  setTool: (t) => set({ tool: t, pendingShape: t === 'shape' ? get().pendingShape : null }),
  armShape: (kind) =>
    set({ pendingShape: kind, tool: kind ? 'shape' : 'select' }),

  setView: (v) => set({ view: { ...get().view, ...v } }),

  zoomBy: (factor, centre) => {
    const { view } = get();
    const zoom = Math.min(6, Math.max(0.1, view.zoom * factor));
    if (!centre) {
      set({ view: { ...view, zoom } });
      return;
    }
    // Keep the point under the cursor fixed while zooming.
    const wx = (centre.x - view.panX) / view.zoom;
    const wy = (centre.y - view.panY) / view.zoom;
    set({
      view: { zoom, panX: centre.x - wx * zoom, panY: centre.y - wy * zoom },
    });
  },

  resetZoom: () => set({ view: { ...get().view, zoom: 1 } }),

  fitToView: (size) => {
    const b = diagramBounds(get().doc);
    if (b.w <= 0 || b.h <= 0) {
      set({ view: { zoom: 1, panX: 60, panY: 60 } });
      return;
    }
    const pad = 60;
    const zoom = Math.min(
      4,
      Math.max(
        0.1,
        Math.min(
          (size.width - pad * 2) / b.w,
          (size.height - pad * 2) / b.h,
        ),
      ),
    );
    set({
      view: {
        zoom,
        panX: size.width / 2 - (b.x + b.w / 2) * zoom,
        panY: size.height / 2 - (b.y + b.h / 2) * zoom,
      },
    });
  },

  setGuides: (g) => set({ guides: g }),

  setBoardFocused: (v) => {
    if (get().boardFocused !== v) set({ boardFocused: v });
  },

  /* ------------------------------------------------------------- editing */
  addNode: (kind, at) => {
    const id = nextId('n');
    get().commit((d) => {
      const node = makeNode(kind, at.x, at.y, { id });
      if (isCircuitKind(kind)) {
        node.science = emptyCircuitSpec(nextDesignator(d, kind));
        node.style.strokeWidth = 1.2;
      } else if (kind.startsWith('physics.') && getShapeDef(kind).noOutline) {
        node.style.fillOpacity = 0;
      }
      node.x = Math.round(at.x - node.w / 2);
      node.y = Math.round(at.y - node.h / 2);
      if (d.settings.snapToGrid) {
        const g = d.settings.gridSize;
        node.x = Math.round(node.x / g) * g;
        node.y = Math.round(node.y / g) * g;
      }
      d.nodes[id] = node;
      d.order.push(id);
    });
    set({ selection: [id] });
    return id;
  },

  updateNode: (id, patch) =>
    get().update((d) => {
      const n = d.nodes[id];
      if (n) Object.assign(n, patch);
    }),

  updateNodeStyle: (ids, patch) =>
    get().commit((d) => {
      for (const id of ids) {
        const n = d.nodes[id];
        if (n) Object.assign(n.style, patch);
      }
    }),

  updateTextStyle: (ids, patch) =>
    get().commit((d) => {
      for (const id of ids) {
        const n = d.nodes[id];
        if (n) Object.assign(n.textStyle, patch);
      }
    }),

  moveSelection: (dx, dy, useSnap = true) => {
    const { selection, doc } = get();
    const nodeIds = selection.filter((id) => doc.nodes[id]);
    if (nodeIds.length === 0) return;
    let ddx = dx;
    let ddy = dy;
    if (useSnap && (doc.settings.snapToGrid || doc.settings.snapToObjects)) {
      const box = selectionBounds(doc, nodeIds);
      if (box) {
        const moved: Rect = { ...box, x: box.x + dx, y: box.y + dy };
        const snap = computeSnap(doc, moved, nodeIds, {
          grid: doc.settings.snapToGrid,
          objects: doc.settings.snapToObjects,
          gridSize: doc.settings.gridSize,
        });
        ddx += snap.dx;
        ddy += snap.dy;
        set({ guides: snap.guides });
      }
    } else {
      set({ guides: [] });
    }
    get().update((d) => {
      for (const id of nodeIds) {
        const n = d.nodes[id];
        if (n && !n.locked) {
          n.x += ddx;
          n.y += ddy;
        }
      }
    });
  },

  setEditingNode: (id) => set({ editingNodeId: id, editingEdgeId: null }),
  setEditingEdge: (id) => set({ editingEdgeId: id, editingNodeId: null }),

  addEdge: (edge) => {
    const id = nextId('e');
    get().commit((d) => {
      const made = makeEdge({ ...edge, id });
      const touchesCircuit = [made.source.nodeId, made.target.nodeId].some(
        (nid) => nid && isCircuitKind(d.nodes[nid]?.kind ?? ''),
      );
      // Anything wired to a component is a wire unless the caller said otherwise.
      if (touchesCircuit && edge.arrowEnd === undefined) {
        made.wire = true;
        made.arrowEnd = 'none';
        made.strokeWidth = 1.2;
        made.routing = 'orthogonal';
      }
      d.edges[id] = made;
      d.order.push(id);
    });
    set({ selection: [id] });
    return id;
  },

  updateEdge: (id, patch) =>
    get().commit((d) => {
      const e = d.edges[id];
      if (e) Object.assign(e, patch);
    }),

  deleteSelection: () => {
    const { selection } = get();
    if (selection.length === 0) return;
    get().commit((d) => removeObjects(d, selection));
    set({ selection: [], editingNodeId: null });
  },

  copySelection: () => {
    const { doc, selection } = get();
    const set2 = new Set(selection);
    const nodes = selection.map((id) => doc.nodes[id]).filter(Boolean) as Node[];
    const edges = Object.values(doc.edges).filter(
      (e) =>
        set2.has(e.id) ||
        (e.source.nodeId &&
          e.target.nodeId &&
          set2.has(e.source.nodeId) &&
          set2.has(e.target.nodeId)),
    );
    set({ clipboard: clone({ nodes, edges }) });
  },

  cutSelection: () => {
    get().copySelection();
    get().deleteSelection();
  },

  paste: (at) => {
    const { clipboard } = get();
    if (!clipboard || clipboard.nodes.length + clipboard.edges.length === 0) return;
    const idMap = new Map<string, string>();
    const created: string[] = [];
    const offset = at ? null : { x: 24, y: 24 };
    let anchor = { x: 0, y: 0 };
    if (at && clipboard.nodes.length) {
      const minX = Math.min(...clipboard.nodes.map((n) => n.x));
      const minY = Math.min(...clipboard.nodes.map((n) => n.y));
      anchor = { x: at.x - minX, y: at.y - minY };
    }
    get().commit((d) => {
      for (const n of clipboard.nodes) {
        const id = nextId('n');
        idMap.set(n.id, id);
        const copy = clone(n);
        copy.id = id;
        copy.groupId = undefined;
        copy.x += offset ? offset.x : anchor.x;
        copy.y += offset ? offset.y : anchor.y;
        d.nodes[id] = copy;
        d.order.push(id);
        created.push(id);
      }
      for (const e of clipboard.edges) {
        const id = nextId('e');
        const copy = clone(e);
        copy.id = id;
        if (copy.source.nodeId) copy.source.nodeId = idMap.get(copy.source.nodeId) ?? undefined;
        if (copy.target.nodeId) copy.target.nodeId = idMap.get(copy.target.nodeId) ?? undefined;
        if (copy.source.point) {
          copy.source.point = {
            x: copy.source.point.x + (offset ? offset.x : anchor.x),
            y: copy.source.point.y + (offset ? offset.y : anchor.y),
          };
        }
        if (copy.target.point) {
          copy.target.point = {
            x: copy.target.point.x + (offset ? offset.x : anchor.x),
            y: copy.target.point.y + (offset ? offset.y : anchor.y),
          };
        }
        copy.waypoints = copy.waypoints.map((p) => ({
          x: p.x + (offset ? offset.x : anchor.x),
          y: p.y + (offset ? offset.y : anchor.y),
        }));
        if (!copy.source.nodeId && !copy.source.point) continue;
        if (!copy.target.nodeId && !copy.target.point) continue;
        d.edges[id] = copy;
        d.order.push(id);
        created.push(id);
      }
    });
    set({ selection: created });
  },

  duplicateSelection: () => {
    get().copySelection();
    get().paste();
  },

  align: (mode) => {
    const ids = get().selection;
    if (ids.length < 2) return;
    get().commit((d) => alignNodes(d, ids, mode));
  },

  distribute: (axis) => {
    const ids = get().selection;
    if (ids.length < 3) return;
    get().commit((d) => distributeNodes(d, ids, axis));
  },

  reorderSelection: (cmd) => {
    const ids = get().selection;
    if (!ids.length) return;
    get().commit((d) => reorder(d, ids, cmd));
  },

  group: () => {
    const ids = get().selection.filter((id) => get().doc.nodes[id]);
    if (ids.length < 2) return;
    const gid = nextId('g');
    get().commit((d) => {
      d.groups[gid] = { id: gid, memberIds: [...ids] };
      for (const id of ids) if (d.nodes[id]) d.nodes[id].groupId = gid;
    });
  },

  ungroup: () => {
    const ids = get().selection;
    get().commit((d) => {
      const gids = new Set<string>();
      for (const id of ids) {
        const g = d.nodes[id]?.groupId;
        if (g) gids.add(g);
      }
      for (const g of gids) {
        for (const m of d.groups[g]?.memberIds ?? []) {
          if (d.nodes[m]) d.nodes[m].groupId = undefined;
        }
        delete d.groups[g];
      }
    });
  },

  toggleLock: () => {
    const ids = get().selection;
    if (!ids.length) return;
    get().commit((d) => {
      const anyUnlocked = ids.some((id) => d.nodes[id] && !d.nodes[id].locked);
      for (const id of ids) {
        if (d.nodes[id]) d.nodes[id].locked = anyUnlocked;
      }
    });
  },

  clearCanvas: () => {
    get().commit((d) => {
      d.nodes = {};
      d.edges = {};
      d.groups = {};
      d.order = [];
    });
    set({ selection: [], editingNodeId: null });
  },

  /* ------------------------------------------------------------ settings */
  updateSettings: (patch) =>
    get().commit((d) => void Object.assign(d.settings, patch)),

  setOutputMode: (m) => set({ outputMode: m }),
  setShowComments: (v) => set({ showComments: v }),

  setDraft: (d) => set({ draft: d }),

  /* -------------------------------------------------------------- charts */
  openChartBuilder: (b) => set({ chartBuilder: b }),

  requestChartFocus: (id) =>
    set({ chartFocus: { id, nonce: (get().chartFocus?.nonce ?? 0) + 1 }, selection: [id] }),

  insertChart: (spec, at, size = DEFAULT_CHART_SIZE, viewport) => {
    const id = nextId('n');
    get().commit((d) => {
      const node = makeNode('chart', 0, 0, { id, w: size.w, h: size.h });
      node.x = Math.round(at.x - size.w / 2);
      node.y = Math.round(at.y - size.h / 2);
      if (d.settings.snapToGrid) {
        const g = d.settings.gridSize;
        node.x = Math.round(node.x / g) * g;
        node.y = Math.round(node.y / g) * g;
      }
      node.style = { ...node.style, strokeStyle: 'none', fill: '#ffffff', fillOpacity: 0 };
      node.chart = clone(spec);
      d.nodes[id] = node;
      d.order.push(id);
    });
    set({ selection: [id], tool: 'select', pendingShape: null });
    if (viewport) get().revealNode(id, viewport);
    return id;
  },

  revealNode: (id, viewport) => {
    const n = get().doc.nodes[id];
    if (!n || viewport.width <= 0 || viewport.height <= 0) return;
    const { view } = get();
    const pad = 40;
    const fit = Math.min((viewport.width - pad * 2) / n.w, (viewport.height - pad * 2) / n.h);
    const zoom = Math.max(0.1, Math.min(view.zoom, fit));
    const left = n.x * zoom + view.panX;
    const top = n.y * zoom + view.panY;
    const inside =
      zoom === view.zoom &&
      left >= 0 &&
      top >= 0 &&
      left + n.w * zoom <= viewport.width &&
      top + n.h * zoom <= viewport.height;
    if (inside) return;
    set({
      view: {
        zoom,
        panX: viewport.width / 2 - (n.x + n.w / 2) * zoom,
        panY: viewport.height / 2 - (n.y + n.h / 2) * zoom,
      },
    });
  },

  updateChart: (id, fn) =>
    get().commit((d) => {
      const n = d.nodes[id];
      if (n?.chart) fn(n.chart);
    }),

  /* ------------------------------------------------------------- science */
  openScienceDialog: (dialog) => set({ scienceDialog: dialog }),

  setPaletteDomain: (domain) => set({ paletteDomain: domain }),

  insertScience: (kind, spec, size, at) => {
    const id = nextId('n');
    get().commit((d) => {
      const node = makeNode(kind, 0, 0, { id, w: size.w, h: size.h });
      node.x = Math.round(at.x - size.w / 2);
      node.y = Math.round(at.y - size.h / 2);
      node.style = { ...node.style, strokeStyle: spec.type === 'molecule' ? 'solid' : 'none', fillOpacity: 0, strokeWidth: 1.2 };
      node.science = clone(spec);
      d.nodes[id] = node;
      d.order.push(id);
    });
    set({ selection: [id], tool: 'select', pendingShape: null });
    return id;
  },

  updateScience: (id, spec, size) =>
    get().commit((d) => {
      const n = d.nodes[id];
      if (!n) return;
      n.science = clone(spec);
      if (size) {
        n.x += (n.w - size.w) / 2;
        n.y += (n.h - size.h) / 2;
        n.w = size.w;
        n.h = size.h;
      }
    }),

  flipSelection: (axis) => {
    const { selection } = get();
    get().commit((d) => {
      for (const id of selection) {
        const n = d.nodes[id];
        if (!n || n.locked) continue;
        if (n.science?.type === 'molecule') n.science = mirrorMolecule(n.science, axis);
        else if (getShapeDef(n.kind).flippable) {
          if (axis === 'h') n.flipH = !n.flipH || undefined;
          else n.flipV = !n.flipV || undefined;
        }
      }
    });
  },

  rotateSelectionBy: (deg) => {
    const { selection } = get();
    get().commit((d) => {
      for (const id of selection) {
        const n = d.nodes[id];
        if (n && !n.locked && n.kind !== 'chart') n.rotation = ((n.rotation + deg) % 360 + 360) % 360;
      }
    });
  },

  addJunctionOnWire: (edgeId, at) => {
    const { doc } = get();
    const edge = doc.edges[edgeId];
    if (!edge) return null;
    const route = routeEdge(doc, edge);
    if (!route) return null;
    // Project onto the nearest straight run, so the dot sits on the wire.
    let best = { p: route.samples[0], d: Infinity };
    for (let i = 1; i < route.samples.length; i++) {
      const a = route.samples[i - 1];
      const b = route.samples[i];
      const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((at.x - a.x) * (b.x - a.x) + (at.y - a.y) * (b.y - a.y)) / l2)) : 0;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const dist = distanceToSegment(at, a, b);
      if (dist < best.d) best = { p, d: dist };
    }
    const jid = nextId('n');
    const secondId = nextId('e');
    const size = CIRCUIT_BY_ID['circuit.junction'].size;
    get().commit((d) => {
      const dot = makeNode('circuit.junction', 0, 0, { id: jid });
      dot.x = best.p.x - size.w / 2;
      dot.y = best.p.y - size.h / 2;
      dot.science = emptyCircuitSpec();
      dot.style.strokeWidth = edge.strokeWidth;
      dot.style.stroke = edge.stroke;
      d.nodes[jid] = dot;
      d.order.push(jid);
      const first = d.edges[edgeId];
      const second: Edge = { ...clone(first), id: secondId, source: { nodeId: jid, port: 'auto' }, waypoints: [] };
      first.target = { nodeId: jid, port: 'auto' };
      first.waypoints = [];
      d.edges[secondId] = second;
      d.order.push(secondId);
    });
    return jid;
  },
}));

/** First free designator for a component: R1, R2, ... */
function nextDesignator(d: Diagram, kind: string): string {
  const prefix = CIRCUIT_BY_ID[kind]?.designator;
  if (!prefix) return '';
  const used = new Set(
    Object.values(d.nodes)
      .map((n) => (n.science?.type === 'circuit' ? n.science.label : ''))
      .filter(Boolean),
  );
  for (let i = 1; ; i++) {
    const label = `${prefix}_{${i}}`;
    if (!used.has(label)) return label;
  }
}

/** Bounds helper used by several components. */
export function useSelectionBounds(): Rect | null {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  return selectionBounds(doc, selection);
}

export { nodeBounds };
