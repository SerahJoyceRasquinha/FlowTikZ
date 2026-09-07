import type { Node, Point, Rect } from '../model/types';
import type { SnapGuide } from '../model/diagram';
import { nodePorts } from '../model/shapes';
import { rotatePoint } from '../model/geometry';

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

interface Props {
  bounds: Rect | null;
  zoom: number;
  showHandles: boolean;
  rotatable: boolean;
  marquee: Rect | null;
  guides: SnapGuide[];
  portHost: Node | null;
  activePort?: string | null;
  draftLine?: { from: Point; to: Point } | null;
}

export function SelectionLayer({
  bounds,
  zoom,
  showHandles,
  rotatable,
  marquee,
  guides,
  portHost,
  activePort,
  draftLine,
}: Props) {
  const s = 1 / zoom; // keep chrome a constant size on screen
  const handleSize = 7 * s;

  return (
    <g data-ui="1" pointerEvents="none">
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
                y2={bounds.y - 26 * s}
                stroke="var(--accent)"
                strokeWidth={1.2 * s}
              />
              <circle
                data-handle="rotate"
                cx={bounds.x + bounds.w / 2}
                cy={bounds.y - 26 * s}
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

      {portHost && (
        <g>
          {nodePorts(portHost).map((port) => {
            const centre = {
              x: portHost.x + portHost.w / 2,
              y: portHost.y + portHost.h / 2,
            };
            const p = rotatePoint(
              { x: portHost.x + port.p.x, y: portHost.y + port.p.y },
              centre,
              portHost.rotation,
            );
            const active = activePort === port.id;
            return (
              <circle
                key={port.id}
                data-port={port.id}
                data-port-node={portHost.id}
                cx={p.x}
                cy={p.y}
                r={(active ? 6.5 : 4.5) * s}
                fill={active ? 'var(--accent)' : 'var(--paper)'}
                stroke="var(--accent)"
                strokeWidth={1.4 * s}
                pointerEvents="all"
                style={{ cursor: 'crosshair' }}
              />
            );
          })}
        </g>
      )}

      {draftLine && (
        <g>
          <line
            x1={draftLine.from.x}
            y1={draftLine.from.y}
            x2={draftLine.to.x}
            y2={draftLine.to.y}
            stroke="var(--accent)"
            strokeWidth={1.6 * s}
            strokeDasharray={`${5 * s} ${4 * s}`}
          />
          <circle cx={draftLine.to.x} cy={draftLine.to.y} r={3.5 * s} fill="var(--accent)" />
        </g>
      )}
    </g>
  );
}
