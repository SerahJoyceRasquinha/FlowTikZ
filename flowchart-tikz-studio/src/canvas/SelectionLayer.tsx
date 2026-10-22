import { memo } from 'react';
import type { Node, Point, PortId, Rect } from '../model/types';
import type { SnapGuide } from '../model/diagram';
import { nodePorts } from '../model/shapes';
import { portAnchor } from '../model/routing';

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type HandleId = (typeof HANDLES)[number];

export function handlePositions(r: Rect): Record<HandleId, Point> {
  return {
    nw: { x: r.x, y: r.y },
    n: { x: r.x + r.w / 2, y: r.y },
    ne: { x: r.x + r.w, y: r.y },
    e: { x: r.x + r.w, y: r.y + r.h / 2 },
    se: { x: r.x + r.w, y: r.y + r.h },
    s: { x: r.x + r.w / 2, y: r.y + r.h },
    sw: { x: r.x, y: r.y + r.h },
    w: { x: r.x, y: r.y + r.h / 2 },
  };
}

const CURSORS: Record<HandleId, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

/**
 * Resize handles and connection points are two different instruments, and the
 * geometry says so before the colour does.
 *
 *   resize      square, on the selection boundary, teal
 *   connect     round, floating clear of the outline, blue, crosshair cursor
 *
 * `PORT_GAP` is the distance, in screen pixels, that a connection point sits
 * outside the shape along its outward normal. It has to clear the resize
 * handle that shares the same edge - a handle is `HANDLE_SIZE` across, so the
 * nearest they can come is `PORT_GAP - HANDLE_SIZE / 2`, which at these values
 * is a clear 8.5 px at every zoom level.
 */
export const PORT_GAP = 12;
export const HANDLE_SIZE = 7;
/**
 * How far above the selection the rotate handle floats, in screen pixels.
 * It has to clear the north connection point as well as the north resize
 * handle, so it sits beyond `PORT_GAP` rather than between the two.
 */
export const ROTATE_OFFSET = 40;
/** Visible radius of a connection point, in screen pixels. */
export const PORT_RADIUS = 4.2;
/** Grab radius of a connection point, in screen pixels. Comfortably larger. */
export const PORT_HIT_RADIUS = 11;

/** Cardinal ports are always offered; diagonals need room to be distinct. */
const DIAGONAL_PORTS: PortId[] = ['ne', 'se', 'sw', 'nw'];
const MIN_SIZE_FOR_DIAGONALS = 58;

/** Ports worth showing for a node at the current zoom. */
export function visiblePortIds(n: Node, zoom: number): PortId[] {
  const ids = nodePorts(n).map((p) => p.id);
  const onScreen = Math.min(n.w, n.h) * zoom;
  if (onScreen >= MIN_SIZE_FOR_DIAGONALS) return ids;
  return ids.filter((id) => !DIAGONAL_PORTS.includes(id));
}

/**
 * Where a connection point is *drawn*, as opposed to where a connector
 * *attaches*. The attach point is `portAnchor`, on the outline, and is shared
 * with the router and the TikZ emitter; nudging the handle outward is purely
 * so the user has something to aim at that is not already a resize handle.
 */
export function portHandlePoint(n: Node, port: PortId, zoom: number): Point {
  const a = portAnchor(n, port);
  const gap = PORT_GAP / Math.max(zoom, 0.01);
  return { x: a.p.x + a.dir.x * gap, y: a.p.y + a.dir.y * gap };
}

export interface PortTarget {
  nodeId: string;
  port: PortId;
}

interface Props {
  bounds: Rect | null;
  zoom: number;
  showHandles: boolean;
  rotatable: boolean;
  marquee: Rect | null;
  guides: SnapGuide[];
  /** Nodes whose connection points are on offer right now. */
  portHosts: Node[];
  /** The connection point the pointer is currently locked on to. */
  activePort?: PortTarget | null;
  draftLine?: { from: Point; to: Point } | null;
  /** Anchor of a connection that was just made, shown briefly. */
  flash?: Point | null;
}

function ConnectionPoint({
  host,
  port,
  s,
  active,
}: {
  host: Node;
  port: PortId;
  s: number;
  active: boolean;
}) {
  const p = portHandlePoint(host, port, 1 / s);
  const r = PORT_RADIUS * s;
  return (
    <g>
      {active && (
        <circle
          cx={p.x}
          cy={p.y}
          r={PORT_HIT_RADIUS * s}
          fill="url(#port-glow)"
          pointerEvents="none"
        />
      )}
      {/* Generous, invisible grab area. Kept separate from the visible dot so
          the dot can stay small without becoming fiddly to hit. */}
      <circle
        data-port={port}
        data-port-node={host.id}
        cx={p.x}
        cy={p.y}
        r={PORT_HIT_RADIUS * s}
        fill="transparent"
        pointerEvents="all"
        style={{ cursor: 'crosshair' }}
      />
      <circle
        cx={p.x}
        cy={p.y}
        r={(active ? r * 1.5 : r) + 1.1 * s}
        fill="var(--paper)"
        pointerEvents="none"
      />
      <circle
        cx={p.x}
        cy={p.y}
        r={active ? r * 1.5 : r}
        fill={active ? 'var(--port-hot)' : 'var(--port)'}
        stroke={active ? 'var(--port-hot)' : 'var(--port)'}
        strokeWidth={1.1 * s}
        pointerEvents="none"
      />
      {active && (
        <circle
          cx={p.x}
          cy={p.y}
          r={r * 2.6}
          fill="none"
          stroke="var(--port-hot)"
          strokeWidth={1.3 * s}
          strokeOpacity={0.85}
          pointerEvents="none"
        />
      )}
    </g>
  );
}

export const SelectionLayer = memo(function SelectionLayer({
  bounds,
  zoom,
  showHandles,
  rotatable,
  marquee,
  guides,
  portHosts,
  activePort,
  draftLine,
  flash,
}: Props) {
  const s = 1 / Math.max(zoom, 0.01); // keep chrome a constant size on screen
  const handleSize = HANDLE_SIZE * s;

  return (
    <g data-ui="1" pointerEvents="none">
      <defs>
        {/* The "you are about to connect here" halo. */}
        <radialGradient id="port-glow">
          <stop offset="0%" stopColor="var(--port-hot)" stopOpacity="0.55" />
          <stop offset="60%" stopColor="var(--port-hot)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--port-hot)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {guides.map((g, i) =>
        g.axis === 'x' ? (
          <line
            key={i}
            x1={g.value}
            y1={g.from - 20 * s}
            x2={g.value}
            y2={g.to + 20 * s}
            stroke="var(--signal)"
            strokeWidth={s}
            strokeDasharray={`${4 * s} ${3 * s}`}
          />
        ) : (
          <line
            key={i}
            x1={g.from - 20 * s}
            y1={g.value}
            x2={g.to + 20 * s}
            y2={g.value}
            stroke="var(--signal)"
            strokeWidth={s}
            strokeDasharray={`${4 * s} ${3 * s}`}
          />
        ),
      )}

      {marquee && (
        <rect
          x={marquee.x}
          y={marquee.y}
          width={marquee.w}
          height={marquee.h}
          fill="var(--accent)"
          fillOpacity={0.08}
          stroke="var(--accent)"
          strokeWidth={s}
          strokeDasharray={`${4 * s} ${3 * s}`}
        />
      )}

      {bounds && (
        <rect
          x={bounds.x}
          y={bounds.y}
          width={bounds.w}
          height={bounds.h}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.2 * s}
        />
      )}

      {bounds && showHandles && (
        <>
          {HANDLES.map((h) => {
            const p = handlePositions(bounds)[h];
            return (
              <rect
                key={h}
                data-handle={h}
                x={p.x - handleSize / 2}
                y={p.y - handleSize / 2}
                width={handleSize}
                height={handleSize}
                fill="var(--paper)"
                stroke="var(--accent)"
                strokeWidth={1.2 * s}
                pointerEvents="all"
                style={{ cursor: CURSORS[h] }}
              />
            );
          })}
          {rotatable && (
            <>
              <line
                x1={bounds.x + bounds.w / 2}
                y1={bounds.y}
                x2={bounds.x + bounds.w / 2}
                y2={bounds.y - ROTATE_OFFSET * s}
                stroke="var(--accent)"
                strokeWidth={1.2 * s}
                strokeOpacity={0.55}
              />
              <circle
                data-handle="rotate"
                cx={bounds.x + bounds.w / 2}
                cy={bounds.y - ROTATE_OFFSET * s}
                r={5 * s}
                fill="var(--paper)"
                stroke="var(--accent)"
                strokeWidth={1.2 * s}
                pointerEvents="all"
                style={{ cursor: 'grab' }}
              />
            </>
          )}
        </>
      )}

      {portHosts.map((host) => (
        <g key={host.id} data-port-host={host.id}>
          {visiblePortIds(host, zoom).map((port) => (
            <ConnectionPoint
              key={port}
              host={host}
              port={port}
              s={s}
              active={
                !!activePort &&
                activePort.nodeId === host.id &&
                activePort.port === port
              }
            />
          ))}
        </g>
      ))}

      {draftLine && (
        <g>
          <line
            x1={draftLine.from.x}
            y1={draftLine.from.y}
            x2={draftLine.to.x}
            y2={draftLine.to.y}
            stroke="var(--port)"
            strokeWidth={1.6 * s}
            strokeDasharray={`${5 * s} ${4 * s}`}
          />
          <circle cx={draftLine.from.x} cy={draftLine.from.y} r={3 * s} fill="var(--port)" />
          {!activePort && (
            <circle cx={draftLine.to.x} cy={draftLine.to.y} r={3.5 * s} fill="var(--port)" />
          )}
        </g>
      )}

      {flash && (
        <g pointerEvents="none">
          <circle cx={flash.x} cy={flash.y} r={9 * s} fill="url(#port-glow)" />
          <circle
            cx={flash.x}
            cy={flash.y}
            r={4.2 * s}
            fill="var(--port-hot)"
            stroke="var(--paper)"
            strokeWidth={1.4 * s}
          />
        </g>
      )}
    </g>
  );
});
