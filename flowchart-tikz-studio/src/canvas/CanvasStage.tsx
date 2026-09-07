import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Node, Point, PortId, Rect } from '../model/types';
import { useEditor } from '../state/store';
import {
  computeSnap,
  nodeBounds,
  selectionBounds,
  snapPoint,
} from '../model/diagram';
import { clamp, normalizeRect, rectIntersects, rotatePoint } from '../model/geometry';
import { ShapeView } from './ShapeView';
import { ConnectorView } from './ConnectorView';
import { SelectionLayer, HandleId } from './SelectionLayer';
import { TextEditorOverlay } from './TextEditorOverlay';
import { portAnchor } from '../model/routing';
import { EmptyState } from '../components/EmptyState';

type Interaction =
  | { type: 'none' }
  | { type: 'move'; last: Point; moved: boolean }
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

export interface CanvasHandle {
  svg: SVGSVGElement | null;
}

interface Props {
  onReady?: (el: SVGSVGElement | null) => void;
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
  const store = useEditor;

  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [hoverPort, setHoverPort] = useState<{ nodeId: string; port: PortId } | null>(null);

  useEffect(() => {
    onReady?.(svgRef.current);
  }, [onReady]);

  /* --------------------------------------------------------- coordinates */
  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = svgRef.current?.getBoundingClientRect();
      const v = store.getState().view;
      const x = clientX - (rect?.left ?? 0);
      const y = clientY - (rect?.top ?? 0);
      return { x: (x - v.panX) / v.zoom, y: (y - v.panY) / v.zoom };
    },
    [store],
  );

  /* ------------------------------------------------------------- helpers */
  const findObjectId = (target: EventTarget | null): string | null => {
    let el = target as Element | null;
    while (el && el !== svgRef.current) {
      const id = el.getAttribute?.('data-object-id');
      if (id) return id;
      el = el.parentElement;
    }
    return null;
  };

  const findAttr = (target: EventTarget | null, attr: string): string | null => {
    let el = target as Element | null;
    while (el && el !== svgRef.current) {
      const v = el.getAttribute?.(attr);
      if (v) return v;
      el = el.parentElement;
    }
    return null;
  };

  /** Nearest port on any node within grabbing distance of a point. */
  const portAt = (p: Point, excludeNodeId?: string) => {
    const threshold = 18 / view.zoom;
    let best: { nodeId: string; port: PortId; dist: number } | null = null;
    for (const id of doc.order) {
      const n = doc.nodes[id];
      if (!n || n.id === excludeNodeId) continue;
      const b = nodeBounds(n);
      if (
        p.x < b.x - threshold ||
        p.x > b.x + b.w + threshold ||
        p.y < b.y - threshold ||
        p.y > b.y + b.h + threshold
      ) {
        continue;
      }
      for (const port of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'] as PortId[]) {
        const a = portAnchor(n, port);
        const dist = Math.hypot(a.p.x - p.x, a.p.y - p.y);
        if (dist < threshold && (!best || dist < best.dist)) {
          best = { nodeId: n.id, port, dist };
        }
      }
    }
    return best;
  };

  const nodeAt = (p: Point): Node | null => {
    for (let i = doc.order.length - 1; i >= 0; i--) {
      const n = doc.nodes[doc.order[i]];
      if (!n) continue;
      const b = nodeBounds(n);
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return n;
    }
    return null;
  };

  /* --------------------------------------------------------- pointerdown */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && tool === 'pan') || e.altKey) {
      interaction.current = {
        type: 'pan',
        startClient: { x: e.clientX, y: e.clientY },
        startPan: { x: view.panX, y: view.panY },
      };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    const world = toWorld(e.clientX, e.clientY);
    const s = store.getState();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);

    // 1. Placing an armed shape
    if (tool === 'shape' && pendingShape) {
      s.addNode(pendingShape, world);
      s.setTool('select');
      return;
    }

    // 2. Starting a connection from a port
    const portNode = findAttr(e.target, 'data-port-node');
    const portId = findAttr(e.target, 'data-port') as PortId | null;
    if (portNode && portId) {
      s.beginInteraction();
      interaction.current = {
        type: 'connect',
        fromNodeId: portNode,
        fromPort: portId,
        to: world,
      };
      rerender();
      return;
    }

    // 3. Resize / rotate handles
    const handle = findAttr(e.target, 'data-handle');
    if (handle && selection.length) {
      const box = selectionBounds(doc, selection);
      if (box) {
        s.beginInteraction();
        if (handle === 'rotate') {
          const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
          interaction.current = {
            type: 'rotate',
            centre,
            startAngle: Math.atan2(world.y - centre.y, world.x - centre.x),
            startRotations: Object.fromEntries(
              selection
                .filter((id) => doc.nodes[id])
                .map((id) => [id, doc.nodes[id].rotation]),
            ),
          };
        } else {
          interaction.current = {
            type: 'resize',
            handle: handle as HandleId,
            startBox: box,
            startNodes: Object.fromEntries(
              selection
                .filter((id) => doc.nodes[id])
                .map((id) => [
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

    // 4. Hitting an object
    const objectId = findObjectId(e.target);
    if (objectId) {
      const alreadySelected = selection.includes(objectId);
      if (e.shiftKey) {
        s.toggleSelection(objectId);
      } else if (!alreadySelected) {
        s.setSelection([objectId]);
      }
      if (tool === 'connect' && doc.nodes[objectId]) {
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
      interaction.current = { type: 'move', last: world, moved: false };
      rerender();
      return;
    }

    // 5. Empty canvas: marquee select
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
  const onPointerMove = (e: React.PointerEvent) => {
    const world = toWorld(e.clientX, e.clientY);
    const s = store.getState();
    const it = interaction.current;

    if (it.type === 'none') {
      const node = nodeAt(world);
      setHoverNodeId(node?.id ?? null);
      const near = portAt(world);
      setHoverPort(near ? { nodeId: near.nodeId, port: near.port } : null);
      return;
    }

    switch (it.type) {
      case 'pan': {
        s.setView({
          panX: it.startPan.x + (e.clientX - it.startClient.x),
          panY: it.startPan.y + (e.clientY - it.startClient.y),
        });
        break;
      }
      case 'move': {
        const dx = world.x - it.last.x;
        const dy = world.y - it.last.y;
        if (dx === 0 && dy === 0) break;
        s.moveSelection(dx, dy, !e.altKey);
        interaction.current = { ...it, last: world, moved: true };
        break;
      }
      case 'resize': {
        applyResize(it, world, e.shiftKey);
        break;
      }
      case 'rotate': {
        const angle = Math.atan2(world.y - it.centre.y, world.x - it.centre.x);
        let deltaDeg = ((angle - it.startAngle) * 180) / Math.PI;
        if (e.shiftKey) deltaDeg = Math.round(deltaDeg / 15) * 15;
        s.update((d) => {
          for (const [id, start] of Object.entries(it.startRotations)) {
            const n = d.nodes[id];
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
        setHoverPort(near ? { nodeId: near.nodeId, port: near.port } : null);
        interaction.current = { ...it, to: world };
        rerender();
        break;
      }
    }
  };

  const applyResize = (
    it: Extract<Interaction, { type: 'resize' }>,
    world: Point,
    keepAspect: boolean,
  ) => {
    const s = store.getState();
    const box = it.startBox;
    const grid = doc.settings.gridSize;
    const snapped = snapPoint(world, grid, doc.settings.snapToGrid);

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

    w = Math.max(MIN_SIZE, w);
    h = Math.max(MIN_SIZE, h);

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

    s.update((d) => {
      for (const [id, start] of Object.entries(it.startNodes)) {
        const n = d.nodes[id];
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
    const s = store.getState();
    const it = interaction.current;
    const world = toWorld(e.clientX, e.clientY);

    if (it.type === 'marquee') {
      const box = normalizeRect(it.origin, it.current);
      if (box.w > 2 || box.h > 2) {
        const hits = doc.order.filter((id) => {
          const n = doc.nodes[id];
          if (n) return rectIntersects(nodeBounds(n), box);
          return false;
        });
        s.setSelection(it.additive ? [...selection, ...hits] : hits);
      }
    }

    if (it.type === 'connect') {
      const near = portAt(world, it.fromNodeId);
      const overNode = nodeAt(world);
      const targetNodeId = near?.nodeId ?? (overNode && overNode.id !== it.fromNodeId ? overNode.id : null);
      if (targetNodeId) {
        s.addEdge({
          source: { nodeId: it.fromNodeId, port: it.fromPort },
          target: { nodeId: targetNodeId, port: near?.port ?? 'auto' },
        });
      } else {
        s.addEdge({
          source: { nodeId: it.fromNodeId, port: it.fromPort },
          target: { point: snapPoint(world, doc.settings.gridSize, doc.settings.snapToGrid) },
        });
      }
      s.setTool('select');
    }

    if (it.type !== 'none' && it.type !== 'marquee' && it.type !== 'pan') {
      s.endInteraction();
    }
    s.setGuides([]);
    interaction.current = { type: 'none' };
    setHoverPort(null);
    rerender();
  };

  /* --------------------------------------------------------------- wheel */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const s = store.getState();
      const rect = svgRef.current?.getBoundingClientRect();
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
  }, [store]);

  /* ---------------------------------------------------------- double tap */
  const onDoubleClick = (e: React.MouseEvent) => {
    const world = toWorld(e.clientX, e.clientY);
    const s = store.getState();
    const objectId = findObjectId(e.target);
    if (objectId && doc.nodes[objectId]) {
      s.setEditingNode(objectId);
      return;
    }
    if (objectId && doc.edges[objectId]) {
      s.setEditingEdge(objectId);
      return;
    }
    s.addNode('process', world);
    s.setEditingNode(s.selection[0] ?? null);
  };

  /* --------------------------------------------------------------- render */
  const it = interaction.current;
  const bounds = selectionBounds(doc, selection);
  const editingNode = editingNodeId ? doc.nodes[editingNodeId] : null;
  const selectedNodes = selection.filter((id) => doc.nodes[id]);

  const portHost = useMemo(() => {
    if (it.type === 'connect') return doc.nodes[it.fromNodeId] ?? null;
    if (hoverPort) return doc.nodes[hoverPort.nodeId] ?? null;
    if (hoverNodeId) return doc.nodes[hoverNodeId] ?? null;
    if (selectedNodes.length === 1) return doc.nodes[selectedNodes[0]] ?? null;
    return null;
  }, [doc, hoverNodeId, hoverPort, it, selectedNodes]);

  const draftLine =
    it.type === 'connect'
      ? {
          from: portAnchor(doc.nodes[it.fromNodeId], it.fromPort === 'auto' ? 'e' : it.fromPort).p,
          to: it.to,
        }
      : null;

  const gridSize = doc.settings.gridSize || 10;
  const cursor =
    tool === 'pan'
      ? 'grab'
      : tool === 'shape'
        ? 'copy'
        : tool === 'connect'
          ? 'crosshair'
          : 'default';

  return (
    <div className="canvas-shell" ref={containerRef}>
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
                />
              );
            }
            return null;
          })}

          <SelectionLayer
            bounds={bounds}
            zoom={view.zoom}
            showHandles={selectedNodes.length > 0 && it.type !== 'connect'}
            rotatable={selectedNodes.length > 0}
            marquee={
              it.type === 'marquee' ? normalizeRect(it.origin, it.current) : null
            }
            guides={guides}
            portHost={portHost}
            activePort={hoverPort?.port ?? null}
            draftLine={draftLine}
          />
        </g>
      </svg>

      {editingNode && <TextEditorOverlay node={editingNode} view={view} />}
      {doc.order.length === 0 && !editingNode && <EmptyState />}
    </div>
  );
}

export { clamp, rotatePoint, computeSnap };
