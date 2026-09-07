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
}

const HISTORY_LIMIT = 100;

function clone<T>(v: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(v)
    : (JSON.parse(JSON.stringify(v)) as T);
}

function sameDoc(a: Diagram, b: Diagram): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
  past: [],
  future: [],
  clipboard: null,
  outputMode: 'standalone',
  showComments: true,
  dirty: false,
  lastSavedAt: null,
  statusMessage: null,
  snapshot: null,

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

  /* ------------------------------------------------------------- editing */
  addNode: (kind, at) => {
    const id = nextId('n');
    get().commit((d) => {
      const node = makeNode(kind, at.x, at.y, { id });
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
      d.edges[id] = makeEdge({ ...edge, id });
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
}));

/** Bounds helper used by several components. */
export function useSelectionBounds(): Rect | null {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  return selectionBounds(doc, selection);
}

export { nodeBounds };
