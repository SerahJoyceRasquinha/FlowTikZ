import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Diagram, Node, Point, PortId, Rect } from '../model/types';
import { useEditor } from '../state/store';
import {
  computeSnap,
  nodeBounds,
  selectionBounds,
  snapPoint,
  SnapGuide,
} from '../model/diagram';
import { clamp, normalizeRect, rectIntersects, rotatePoint } from '../model/geometry';
import { hitTest, nodeAtPoint } from '../model/hittest';
import { ShapeView } from './ShapeView';
import { ConnectorView } from './ConnectorView';
import {
  SelectionLayer,
  HandleId,
  PortTarget,
  PORT_HIT_RADIUS,
  portHandlePoint,
  visiblePortIds,
} from './SelectionLayer';
import { TextEditorOverlay } from './TextEditorOverlay';
import { portAnchor } from '../model/routing';
import { EmptyState } from '../components/EmptyState';
import { useImport } from '../state/importStore';

type Interaction =
  | { type: 'none' }
  /**
   * A drag is held as where it started plus where every shape started, not as
   * a running total of deltas. Snapping then applies to the position the
   * pointer is asking for, once, instead of to each increment - see the note
   * on `applyDrag`.
   */
  | {
      type: 'move';
      origin: Point;
      startBox: Rect;
      startPos: Record<string, Point>;
      moved: boolean;
    }
  | {
      type: 'resize';
      handle: HandleId;
      startBox: Rect;
      startNodes: Record<string, Rect>;
      keepAspect: boolean;
    }
  | { type: 'rotate'; centre: Point; startAngle: number; startRotations: Record<string, number> }
  | { type: 'marquee'; origin: Point; current: Point; additive: boolean }
  | { type: 'pan'; startClient: Point; startPan: Point }
  | { type: 'connect'; fromNodeId: string; fromPort: PortId; to: Point };

const MIN_SIZE = 12;

/** Forgiveness margin for picking a shape, in screen pixels. */
const NODE_PICK_SLOP = 3;
/** How close, in screen pixels, the pointer must be to pick a connector. */
const EDGE_PICK_SLOP = 6;
/** How long the "connected here" marker stays up, in milliseconds. */
const FLASH_MS = 700;

export interface CanvasHandle {
  svg: SVGSVGElement | null;
}

interface Props {
  onReady?: (el: SVGSVGElement | null) => void;
}

/** What the pointer is currently over. Kept out of the model and out of undo. */
interface HoverState {
  nodeId: string | null;
  edgeId: string | null;
  port: PortTarget | null;
}

const NO_HOVER: HoverState = { nodeId: null, edgeId: null, port: null };

function sameHover(a: HoverState, b: HoverState): boolean {
  return (
    a.nodeId === b.nodeId &&
    a.edgeId === b.edgeId &&
    a.port?.nodeId === b.port?.nodeId &&
    a.port?.port === b.port?.port
  );
}

export function CanvasStage({ onReady }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const interaction = useRef<Interaction>({ type: 'none' });
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender((v) => v + 1), []);

  const doc = useEditor((s) => s.doc);
  const view = useEditor((s) => s.view);
  const tool = useEditor((s) => s.tool);
  const pendingShape = useEditor((s) => s.pendingShape);
  const selection = useEditor((s) => s.selection);
  const guides = useEditor((s) => s.guides);
  const editingNodeId = useEditor((s) => s.editingNodeId);
  const boardFocused = useEditor((s) => s.boardFocused);
  const setBoardFocused = useEditor((s) => s.setBoardFocused);
  const reference = useImport((s) => s.reference);
  const store = useEditor;

  /*
   * Hover lives in a ref and is published to React only when it actually
   * changes. Moving the pointer across one shape is hundreds of events and
   * zero renders; crossing into the next shape is one render. Before, every
   * single pointermove queued one.
   */
  const hoverRef = useRef<HoverState>(NO_HOVER);
  const [hover, setHover] = useState<HoverState>(NO_HOVER);
  const publishHover = useCallback((next: HoverState) => {
    if (sameHover(hoverRef.current, next)) return;
    hoverRef.current = next;
    setHover(next);
  }, []);

  const [flash, setFlash] = useState<Point | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onReady?.(svgRef.current);
  }, [onReady]);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  /* --------------------------------------------------------- coordinates */
  /*
   * getBoundingClientRect forces layout, so calling it per pointermove was
   * costing a reflow on every frame of every drag. It only changes when the
   * page does, so it is cached and refreshed on the events that can move it.
   */
  const rectRef = useRef<DOMRect | null>(null);
  const refreshRect = useCallback(() => {
    rectRef.current = svgRef.current?.getBoundingClientRect() ?? null;
  }, []);

  useEffect(() => {
    refreshRect();
    window.addEventListener('resize', refreshRect);
    window.addEventListener('scroll', refreshRect, true);
    return () => {
      window.removeEventListener('resize', refreshRect);
      window.removeEventListener('scroll', refreshRect, true);
    };
  }, [refreshRect]);

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      if (!rectRef.current) refreshRect();
      const rect = rectRef.current;
      const v = store.getState().view;
      const x = clientX - (rect?.left ?? 0);
      const y = clientY - (rect?.top ?? 0);
      return { x: (x - v.panX) / v.zoom, y: (y - v.panY) / v.zoom };
    },
    [refreshRect, store],
  );

  /* ------------------------------------------------------------- helpers */
  const findAttr = (target: EventTarget | null, attr: string): string | null => {
    let el = target as Element | null;
    while (el && el !== svgRef.current) {
      const v = el.getAttribute?.(attr);
      if (v) return v;
      el = el.parentElement;
    }
    return null;
  };

  /**
   * Nearest connection point to a world position.
   *
   * Proximity is measured to where the handle is *drawn* - outside the
   * outline - because that is what the user is aiming at. What gets stored on
   * the connector is still the port id, so the attachment itself is unchanged.
   */
  const portAt = useCallback(
    (p: Point, excludeNodeId?: string): PortTarget | null => {
      const s = store.getState();
      const d = s.doc;
      const zoom = s.view.zoom;
      const threshold = PORT_HIT_RADIUS / Math.max(zoom, 0.01);
      const reach = (PORT_HIT_RADIUS + 14) / Math.max(zoom, 0.01);
      let best: { target: PortTarget; dist: number } | null = null;
      for (const id of d.order) {
        const n = d.nodes[id];
        if (!n || n.id === excludeNodeId) continue;
        const b = nodeBounds(n);
        if (
          p.x < b.x - reach ||
          p.x > b.x + b.w + reach ||
          p.y < b.y - reach ||
          p.y > b.y + b.h + reach
        ) {
          continue;
        }
        for (const port of visiblePortIds(n, zoom)) {
          const a = portHandlePoint(n, port, zoom);
          const dist = Math.hypot(a.x - p.x, a.y - p.y);
          if (dist < threshold && (!best || dist < best.dist)) {
            best = { target: { nodeId: n.id, port }, dist };
          }
        }
      }
      return best?.target ?? null;
    },
    [store],
  );

  const pickAt = useCallback(
    (p: Point) => {
      const s = store.getState();
      const zoom = Math.max(s.view.zoom, 0.01);
      return hitTest(s.doc, p, {
        nodeTolerance: NODE_PICK_SLOP / zoom,
        edgeTolerance: EDGE_PICK_SLOP / zoom,
      });
    },
    [store],
  );

  const nodeAt = useCallback(
    (p: Point): Node | null => {
      const s = store.getState();
      const zoom = Math.max(s.view.zoom, 0.01);
      return nodeAtPoint(s.doc, p, NODE_PICK_SLOP / zoom);
    },
    [store],
  );

  /** Give the drawing board keyboard focus without disturbing the gesture. */
  const focusBoard = useCallback(() => {
    const el = containerRef.current;
    if (el && document.activeElement !== el) {
      el.focus({ preventScroll: true });
    }
  }, []);

  /* --------------------------------------------------------- pointerdown */
  const onPointerDown = (e: React.PointerEvent) => {
    refreshRect();
    focusBoard();

    if (e.button === 1 || (e.button === 0 && tool === 'pan') || e.altKey) {
      interaction.current = {
        type: 'pan',
        startClient: { x: e.clientX, y: e.clientY },
        startPan: { x: view.panX, y: view.panY },
      };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      rerender();
      return;
    }
    if (e.button !== 0) return;

    const world = toWorld(e.clientX, e.clientY);
    const s = store.getState();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);

    // 1. Placing an armed shape.
    if (tool === 'shape' && pendingShape) {
      s.addNode(pendingShape, world);
      s.setTool('select');
      return;
    }

    // 2. A connection point, when one was explicitly targeted.
    const portNode = findAttr(e.target, 'data-port-node');
    const portId = findAttr(e.target, 'data-port') as PortId | null;
    if (portNode && portId && s.doc.nodes[portNode]) {
      s.beginInteraction();
      interaction.current = {
        type: 'connect',
        fromNodeId: portNode,
        fromPort: portId,
        to: world,
      };
      publishHover({ ...hoverRef.current, port: null });
      rerender();
      return;
    }

    // 3. Resize / rotate handles, which sit on the selection boundary.
    const handle = findAttr(e.target, 'data-handle');
    if (handle && selection.length) {
      const box = selectionBounds(doc, selection);
      const resizable = selection.filter((id) => doc.nodes[id] && !doc.nodes[id].locked);
      if (box && resizable.length) {
        s.beginInteraction();
        if (handle === 'rotate') {
          const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
          interaction.current = {
            type: 'rotate',
            centre,
            startAngle: Math.atan2(world.y - centre.y, world.x - centre.x),
            startRotations: Object.fromEntries(
              resizable.map((id) => [id, doc.nodes[id].rotation]),
            ),
          };
        } else {
          interaction.current = {
            type: 'resize',
            handle: handle as HandleId,
            startBox: box,
            startNodes: Object.fromEntries(
              resizable.map((id) => [
                id,
                {
                  x: doc.nodes[id].x,
                  y: doc.nodes[id].y,
                  w: doc.nodes[id].w,
                  h: doc.nodes[id].h,
                },
              ]),
            ),
            keepAspect: e.shiftKey,
          };
        }
        rerender();
        return;
      }
    }

    // 4. An object. Shapes are picked from their real geometry, so the whole
    //    interior works and a connector crossing the shape does not steal it.
    const picked = pickAt(world);
    if (picked) {
      const objectId = picked.id;
      const alreadySelected = selection.includes(objectId);
      if (e.shiftKey) {
        s.toggleSelection(objectId);
      } else if (!alreadySelected) {
        s.setSelection([objectId]);
      }
      if (tool === 'connect' && picked.kind === 'node') {
        const near = portAt(world);
        s.beginInteraction();
        interaction.current = {
          type: 'connect',
          fromNodeId: objectId,
          fromPort: near?.nodeId === objectId ? near.port : 'auto',
          to: world,
        };
        rerender();
        return;
      }
      s.beginInteraction();
      startDrag(world);
      rerender();
      return;
    }

    // 5. Empty canvas: marquee select.
    if (!e.shiftKey) s.clearSelection();
    interaction.current = {
      type: 'marquee',
      origin: world,
      current: world,
      additive: e.shiftKey,
    };
    rerender();
  };

  /* --------------------------------------------------------- pointermove */
  /*
   * Pointer hardware reports far faster than the display refreshes - a precise
   * mouse or pen can fire several hundred events a second, and every one of
   * them used to clone the document and queue a render. Moves are coalesced
   * into one update per animation frame instead: the same gesture, the same
   * result, at most one model write per painted frame.
   */
  const pendingMove = useRef<{
    x: number;
    y: number;
    shiftKey: boolean;
    altKey: boolean;
  } | null>(null);
  const frame = useRef<number | null>(null);

  const cancelFrame = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  const applyMove = useCallback(() => {
    frame.current = null;
    const ev = pendingMove.current;
    pendingMove.current = null;
    if (!ev) return;

    const world = toWorld(ev.x, ev.y);
    const s = store.getState();
    const d = s.doc;
    const it = interaction.current;

    switch (it.type) {
      case 'none': {
        const picked = pickAt(world);
        const near = portAt(world);
        publishHover({
          nodeId: picked?.kind === 'node' ? picked.id : null,
          edgeId: picked?.kind === 'edge' ? picked.id : null,
          port: near,
        });
        return;
      }
      case 'pan': {
        s.setView({
          panX: it.startPan.x + (ev.x - it.startClient.x),
          panY: it.startPan.y + (ev.y - it.startClient.y),
        });
        break;
      }
      case 'move': {
        applyDrag(it, world, !ev.altKey, d);
        break;
      }
      case 'resize': {
        applyResize(it, world, ev.shiftKey, d);
        break;
      }
      case 'rotate': {
        const angle = Math.atan2(world.y - it.centre.y, world.x - it.centre.x);
        let deltaDeg = ((angle - it.startAngle) * 180) / Math.PI;
        if (ev.shiftKey) deltaDeg = Math.round(deltaDeg / 15) * 15;
        s.update((dd) => {
          for (const [id, start] of Object.entries(it.startRotations)) {
            const n = dd.nodes[id];
            if (n && !n.locked) n.rotation = Math.round((start + deltaDeg) * 10) / 10;
          }
        });
        break;
      }
      case 'marquee': {
        interaction.current = { ...it, current: world };
        rerender();
        break;
      }
      case 'connect': {
        const near = portAt(world, it.fromNodeId);
        publishHover({
          nodeId: nodeAt(world)?.id ?? null,
          edgeId: null,
          port: near,
        });
        interaction.current = { ...it, to: world };
        rerender();
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeAt, pickAt, portAt, publishHover, rerender, store, toWorld]);

  const onPointerMove = (e: React.PointerEvent) => {
    pendingMove.current = {
      x: e.clientX,
      y: e.clientY,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
    };
    if (frame.current === null) {
      frame.current =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(applyMove)
          : (setTimeout(applyMove, 16) as unknown as number);
    }
  };

  /** Snapshot the selection so the drag can be expressed as an absolute offset. */
  const startDrag = (world: Point) => {
    const s = store.getState();
    const d = s.doc;
    const movable = s.selection.filter((id) => d.nodes[id] && !d.nodes[id].locked);
    const startPos: Record<string, Point> = {};
    for (const id of movable) startPos[id] = { x: d.nodes[id].x, y: d.nodes[id].y };
    interaction.current = {
      type: 'move',
      origin: world,
      startBox: selectionBounds(d, movable) ?? { x: world.x, y: world.y, w: 0, h: 0 },
      startPos,
      moved: false,
    };
  };

  /**
   * Move the selection to where the pointer is asking for it.
   *
   * The subtlety here is snapping. Applying a snap to each incremental delta
   * is self-defeating: a shape that is already on the grid answers a 3 px
   * nudge with a 3 px correction straight back onto it, so a slow drag - the
   * kind a careful hand actually makes - pins the shape in place and the
   * canvas feels broken. Measuring from where the gesture began instead means
   * the snap decides where the shape *lands*, never whether it moves at all:
   * it slides with the pointer and is drawn to alignment as it passes.
   */
  const applyDrag = (
    it: Extract<Interaction, { type: 'move' }>,
    world: Point,
    useSnap: boolean,
    d: Diagram,
  ) => {
    const s = store.getState();
    const ids = Object.keys(it.startPos);
    if (ids.length === 0) return;

    let dx = world.x - it.origin.x;
    let dy = world.y - it.origin.y;

    const wantsSnap =
      useSnap && (d.settings.snapToGrid || d.settings.snapToObjects);
    if (wantsSnap) {
      const moved: Rect = {
        ...it.startBox,
        x: it.startBox.x + dx,
        y: it.startBox.y + dy,
      };
      const snap = computeSnap(d, moved, ids, {
        grid: d.settings.snapToGrid,
        objects: d.settings.snapToObjects,
        gridSize: d.settings.gridSize,
      });
      dx += snap.dx;
      dy += snap.dy;
      setGuidesIfChanged(snap.guides);
    } else {
      setGuidesIfChanged([]);
    }

    if (!it.moved && dx === 0 && dy === 0) return;

    s.update((dd) => {
      for (const id of ids) {
        const n = dd.nodes[id];
        const start = it.startPos[id];
        if (!n || n.locked || !start) continue;
        n.x = start.x + dx;
        n.y = start.y + dy;
      }
    });
    if (!it.moved) interaction.current = { ...it, moved: true };
  };

  /**
   * Guides are recomputed every frame but rarely change; writing an identical
   * array to the store would re-render the canvas for nothing.
   */
  const guideKey = useRef('');
  const setGuidesIfChanged = (next: SnapGuide[]) => {
    const key = next.map((g) => `${g.axis}${g.value}${g.from}${g.to}`).join('|');
    if (key === guideKey.current) return;
    guideKey.current = key;
    store.getState().setGuides(next);
  };

  const applyResize = (
    it: Extract<Interaction, { type: 'resize' }>,
    world: Point,
    keepAspect: boolean,
    d: Diagram,
  ) => {
    const s = store.getState();
    const box = it.startBox;
    const grid = d.settings.gridSize;
    const snapped = snapPoint(world, grid, d.settings.snapToGrid);

    let x = box.x;
    let y = box.y;
    let w = box.w;
    let h = box.h;
    const right = box.x + box.w;
    const bottom = box.y + box.h;

    if (it.handle.includes('e')) w = snapped.x - box.x;
    if (it.handle.includes('s')) h = snapped.y - box.y;
    if (it.handle.includes('w')) {
      x = snapped.x;
      w = right - snapped.x;
    }
    if (it.handle.includes('n')) {
      y = snapped.y;
      h = bottom - snapped.y;
    }

    // Clamping here is what stops a drag past the opposite edge from turning
    // the box inside out; the per-node clamp below repeats it for members of
    // a multi-selection that would otherwise collapse first.
    w = Math.max(MIN_SIZE, w);
    h = Math.max(MIN_SIZE, h);
    if (it.handle.includes('w')) x = Math.min(x, right - MIN_SIZE);
    if (it.handle.includes('n')) y = Math.min(y, bottom - MIN_SIZE);

    if (keepAspect && box.w > 0 && box.h > 0) {
      const ratio = box.w / box.h;
      if (it.handle === 'e' || it.handle === 'w') h = w / ratio;
      else if (it.handle === 'n' || it.handle === 's') w = h * ratio;
      else {
        const scale = Math.max(w / box.w, h / box.h);
        w = box.w * scale;
        h = box.h * scale;
      }
      if (it.handle.includes('w')) x = right - w;
      if (it.handle.includes('n')) y = bottom - h;
    }

    const sx = box.w === 0 ? 1 : w / box.w;
    const sy = box.h === 0 ? 1 : h / box.h;
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;

    s.update((dd) => {
      for (const [id, start] of Object.entries(it.startNodes)) {
        const n = dd.nodes[id];
        if (!n || n.locked) continue;
        n.x = x + (start.x - box.x) * sx;
        n.y = y + (start.y - box.y) * sy;
        n.w = Math.max(MIN_SIZE, start.w * sx);
        n.h = Math.max(MIN_SIZE, start.h * sy);
      }
    });
  };

  /* ----------------------------------------------------------- pointerup */
  const onPointerUp = (e: React.PointerEvent) => {
    // Flush anything the last frame has not applied yet, so the gesture ends
    // exactly where the pointer did rather than up to one frame behind.
    cancelFrame();
    if (pendingMove.current) applyMove();

    const s = store.getState();
    const d = s.doc;
    const it = interaction.current;
    const world = toWorld(e.clientX, e.clientY);

    if (it.type === 'marquee') {
      const box = normalizeRect(it.origin, it.current);
      if (box.w > 2 || box.h > 2) {
        const hits = d.order.filter((id) => {
          const n = d.nodes[id];
          if (n) return rectIntersects(nodeBounds(n), box);
          return false;
        });
        s.setSelection(it.additive ? [...s.selection, ...hits] : hits);
      }
    }

    if (it.type === 'connect') {
      const source = d.nodes[it.fromNodeId];
      if (!source) {
        // The source shape went away mid-gesture (undo, or a delete from
        // another surface). Abandon the connection rather than throw.
        s.endInteraction();
      } else {
        const near = portAt(world, it.fromNodeId);
        const overNode = nodeAt(world);
        const targetNodeId =
          near?.nodeId ?? (overNode && overNode.id !== it.fromNodeId ? overNode.id : null);
        if (targetNodeId) {
          s.addEdge({
            source: { nodeId: it.fromNodeId, port: it.fromPort },
            target: { nodeId: targetNodeId, port: near?.port ?? 'auto' },
          });
          const target = store.getState().doc.nodes[targetNodeId];
          if (target) {
            showFlash(portAnchor(target, near?.port ?? 'auto').p);
          }
        } else {
          s.addEdge({
            source: { nodeId: it.fromNodeId, port: it.fromPort },
            target: { point: snapPoint(world, d.settings.gridSize, d.settings.snapToGrid) },
          });
        }
      }
      s.setTool('select');
    }

    if (it.type !== 'none' && it.type !== 'marquee' && it.type !== 'pan') {
      s.endInteraction();
    }
    setGuidesIfChanged([]);
    interaction.current = { type: 'none' };
    publishHover({ ...hoverRef.current, port: null });
    rerender();
  };

  /** Mark where a connector just landed, briefly. Never touches the model. */
  const showFlash = (p: Point) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(p);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  };

  /* --------------------------------------------------------------- wheel */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const s = store.getState();
      if (!rectRef.current) refreshRect();
      const rect = rectRef.current;
      const centre = {
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
      };
      if (e.ctrlKey || e.metaKey) {
        s.zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08, centre);
      } else if (e.shiftKey) {
        s.setView({ panX: s.view.panX - e.deltaY });
      } else {
        s.setView({ panX: s.view.panX - e.deltaX, panY: s.view.panY - e.deltaY });
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [refreshRect, store]);

  /* Abandon any half-finished gesture if the component goes away. */
  useEffect(() => cancelFrame, [cancelFrame]);

  /* ---------------------------------------------------------- double tap */
  const onDoubleClick = (e: React.MouseEvent) => {
    const world = toWorld(e.clientX, e.clientY);
    const s = store.getState();
    const picked = pickAt(world);
    if (picked?.kind === 'node') {
      s.setEditingNode(picked.id);
      return;
    }
    if (picked?.kind === 'edge') {
      s.setEditingEdge(picked.id);
      return;
    }
    s.addNode('process', world);
    s.setEditingNode(store.getState().selection[0] ?? null);
  };

  /* --------------------------------------------------------------- render */
  const it = interaction.current;
  const bounds = selectionBounds(doc, selection);
  const editingNode = editingNodeId ? doc.nodes[editingNodeId] : null;
  const selectedNodes = selection.filter((id) => doc.nodes[id]);

  /**
   * Whose connection points to show.
   *
   * While a connection is being drawn, the shape under the pointer matters as
   * much as the one it started from - that is where the user is trying to
   * land - so both are offered.
   */
  const portHosts = useMemo(() => {
    const ids: string[] = [];
    const add = (id: string | null | undefined) => {
      if (id && doc.nodes[id] && !ids.includes(id)) ids.push(id);
    };
    if (it.type === 'connect') {
      add(it.fromNodeId);
      add(hover.nodeId);
      add(hover.port?.nodeId);
    } else if (it.type === 'none') {
      add(hover.nodeId);
      add(hover.port?.nodeId);
      if (selectedNodes.length === 1) add(selectedNodes[0]);
    }
    return ids.map((id) => doc.nodes[id]);
  }, [doc, hover, it, selectedNodes]);

  const draftSource = it.type === 'connect' ? doc.nodes[it.fromNodeId] : null;
  const draftLine =
    it.type === 'connect' && draftSource
      ? {
          from: portAnchor(draftSource, it.fromPort === 'auto' ? 'e' : it.fromPort).p,
          to: it.to,
        }
      : null;

  const gridSize = doc.settings.gridSize || 10;

  /* Cursor: meaningful, and only where it means something. */
  const hoveredNode = hover.nodeId ? doc.nodes[hover.nodeId] : null;
  const cursor =
    it.type === 'pan'
      ? 'grabbing'
      : it.type === 'move'
        ? 'grabbing'
        : tool === 'pan'
          ? 'grab'
          : tool === 'shape'
            ? 'copy'
            : tool === 'connect' || it.type === 'connect'
              ? 'crosshair'
              : hover.port
                ? 'crosshair'
                : hoveredNode
                  ? hoveredNode.locked
                    ? 'not-allowed'
                    : 'move'
                  : hover.edgeId
                    ? 'pointer'
                    : 'default';

  return (
    <div
      className={`canvas-shell${boardFocused ? ' is-focused' : ''}`}
      ref={containerRef}
      /*
       * The board is a real focus target, so "which surface do the letter keys
       * belong to" is answered by the browser rather than guessed at, and the
       * answer is visible. Tab reaches it like any other control.
       */
      tabIndex={0}
      role="application"
      aria-label="Drawing board"
      onFocus={() => setBoardFocused(true)}
      onBlur={(e) => {
        // Focus moving to the text overlay is still focus on the board.
        const next = e.relatedTarget as HTMLElement | null;
        if (next && containerRef.current?.contains(next)) return;
        setBoardFocused(false);
      }}
    >
      <svg
        ref={(el) => {
          svgRef.current = el;
          onReady?.(el);
        }}
        className="canvas-svg"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (interaction.current.type === 'none') publishHover(NO_HOVER);
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern
            id="grid-minor"
            width={gridSize * view.zoom}
            height={gridSize * view.zoom}
            patternUnits="userSpaceOnUse"
            x={view.panX}
            y={view.panY}
          >
            <path
              d={`M ${gridSize * view.zoom} 0 L 0 0 0 ${gridSize * view.zoom}`}
              fill="none"
              stroke="#e3e9f0"
              strokeWidth={1}
            />
          </pattern>
          <pattern
            id="grid-major"
            width={gridSize * 5 * view.zoom}
            height={gridSize * 5 * view.zoom}
            patternUnits="userSpaceOnUse"
            x={view.panX}
            y={view.panY}
          >
            <rect
              width={gridSize * 5 * view.zoom}
              height={gridSize * 5 * view.zoom}
              fill="url(#grid-minor)"
            />
            <path
              d={`M ${gridSize * 5 * view.zoom} 0 L 0 0 0 ${gridSize * 5 * view.zoom}`}
              fill="none"
              stroke="#cfd9e4"
              strokeWidth={1}
            />
          </pattern>
        </defs>

        {doc.settings.showGrid && (
          <rect data-ui="1" width="100%" height="100%" fill="url(#grid-major)" />
        )}

        <g
          data-layer="content"
          transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}
        >
          {doc.order.map((id) => {
            const node = doc.nodes[id];
            if (node) {
              return (
                <ShapeView
                  key={id}
                  node={node}
                  selected={selection.includes(id)}
                  hovered={hover.nodeId === id && !selection.includes(id)}
                  hidden={editingNodeId === id}
                />
              );
            }
            const edge = doc.edges[id];
            if (edge) {
              return (
                <ConnectorView
                  key={id}
                  diagram={doc}
                  edge={edge}
                  selected={selection.includes(id)}
                  hovered={hover.edgeId === id && !selection.includes(id)}
                />
              );
            }
            return null;
          })}

          {/*
            Source image of an import, for comparison only. Editor chrome
            (data-ui): it is stripped from every export, never saved, never
            reaches the LaTeX, and never takes a click.
          */}
          {reference && reference.mode !== 'off' && reference.docId === doc.id && (
            <image
              data-ui="1"
              data-reference={reference.mode}
              href={reference.url}
              x={reference.placement.x}
              y={reference.placement.y}
              width={reference.placement.w}
              height={reference.placement.h}
              preserveAspectRatio="none"
              opacity={reference.mode === 'overlay' ? 0.45 : 1}
              style={reference.mode === 'difference' ? { mixBlendMode: 'difference' } : undefined}
              pointerEvents="none"
            />
          )}

          <SelectionLayer
            bounds={bounds}
            zoom={view.zoom}
            showHandles={selectedNodes.length > 0 && it.type !== 'connect'}
            rotatable={selectedNodes.length > 0}
            marquee={
              it.type === 'marquee' ? normalizeRect(it.origin, it.current) : null
            }
            guides={guides}
            portHosts={portHosts}
            activePort={hover.port}
            draftLine={draftLine}
            flash={flash}
          />
        </g>
      </svg>

      {editingNode && <TextEditorOverlay node={editingNode} view={view} />}
      {doc.order.length === 0 && !editingNode && <EmptyState />}
    </div>
  );
}

export { clamp, rotatePoint, computeSnap };
