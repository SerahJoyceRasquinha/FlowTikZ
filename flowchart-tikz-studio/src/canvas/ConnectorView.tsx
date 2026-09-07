import { memo } from 'react';
import type { ArrowHead, Diagram, Edge, Point } from '../model/types';
import { routeEdge, edgeLabelPoint, Route } from '../model/routing';
import { segsToSvgPath } from '../model/path';
import { dashArraySvg } from '../latex/styles';
import { FONT_STACK } from './textLayout';

/**
 * Arrowheads are drawn as explicit geometry rather than SVG markers so their
 * shape and size track the TikZ `arrows.meta` tips they will compile into.
 */
function arrowGeometry(
  kind: ArrowHead,
  tip: Point,
  dir: Point,
  size: number,
): { d: string; filled: boolean; circle?: { r: number } } | null {
  if (kind === 'none') return null;
  const ux = dir.x;
  const uy = dir.y;
  const px = -uy;
  const py = ux;
  const back = (dist: number, side: number): Point => ({
    x: tip.x - ux * dist + px * side,
    y: tip.y - uy * dist + py * side,
  });
  const w = size * 0.375;

  switch (kind) {
    case 'stealth': {
      const a = back(size, w);
      const b = back(size * 0.62, 0);
      const c = back(size, -w);
      return {
        d: `M ${tip.x} ${tip.y} L ${a.x} ${a.y} L ${b.x} ${b.y} L ${c.x} ${c.y} Z`,
        filled: true,
      };
    }
    case 'latex': {
      const a = back(size, w * 0.9);
      const b = back(size * 0.85, 0);
      const c = back(size, -w * 0.9);
      return {
        d: `M ${tip.x} ${tip.y} Q ${a.x} ${a.y} ${a.x} ${a.y} L ${b.x} ${b.y} L ${c.x} ${c.y} Z`,
        filled: true,
      };
    }
    case 'triangle':
    case 'open-triangle': {
      const a = back(size, w);
      const c = back(size, -w);
      return {
        d: `M ${tip.x} ${tip.y} L ${a.x} ${a.y} L ${c.x} ${c.y} Z`,
        filled: kind === 'triangle',
      };
    }
    case 'bar': {
      const a = back(0, w);
      const b = back(0, -w);
      return { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, filled: false };
    }
    case 'diamond': {
      const a = back(size / 2, w);
      const b = back(size, 0);
      const c = back(size / 2, -w);
      return {
        d: `M ${tip.x} ${tip.y} L ${a.x} ${a.y} L ${b.x} ${b.y} L ${c.x} ${c.y} Z`,
        filled: true,
      };
    }
    case 'circle': {
      const centre = back(w, 0);
      return {
        d: `M ${centre.x} ${centre.y}`,
        filled: true,
        circle: { r: w },
      };
    }
    default:
      return null;
  }
}

function Arrow({
  kind,
  tip,
  dir,
  size,
  color,
  strokeWidth,
  opacity,
}: {
  kind: ArrowHead;
  tip: Point;
  dir: Point;
  size: number;
  color: string;
  strokeWidth: number;
  opacity: number;
}) {
  const geo = arrowGeometry(kind, tip, dir, size);
  if (!geo) return null;
  if (geo.circle) {
    const m = /M ([-\d.]+) ([-\d.]+)/.exec(geo.d);
    const cx = m ? Number(m[1]) : tip.x;
    const cy = m ? Number(m[2]) : tip.y;
    return <circle cx={cx} cy={cy} r={geo.circle.r} fill={color} opacity={opacity} />;
  }
  return (
    <path
      d={geo.d}
      fill={geo.filled ? color : 'none'}
      stroke={color}
      strokeWidth={geo.filled ? 0 : strokeWidth}
      strokeLinejoin="round"
      opacity={opacity}
    />
  );
}

interface Props {
  diagram: Diagram;
  edge: Edge;
  selected: boolean;
}

export const ConnectorView = memo(function ConnectorView({
  diagram,
  edge,
  selected,
}: Props) {
  if (!edge || !edge.waypoints) return null;
  const route: Route | null = routeEdge(diagram, edge);
  if (!route) return null;

  const dash = dashArraySvg(edge.strokeStyle, edge.strokeWidth);
  const visible = edge.strokeStyle !== 'none' && edge.strokeWidth > 0;
  const d = segsToSvgPath(route.segs);

  const label = edge.label;
  const labelPoint =
    label && label.text.trim()
      ? edgeLabelPoint(route, label.pos, label.offset)
      : null;

  return (
    <g data-object-id={edge.id} opacity={edge.opacity}>
      {/* Invisible fat stroke: makes thin connectors comfortable to click. */}
      <path
        data-hit="1"
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(12, edge.strokeWidth * 4)}
      />
      {visible && (
        <path
          d={d}
          fill="none"
          stroke={edge.stroke}
          strokeOpacity={edge.strokeOpacity}
          strokeWidth={edge.strokeWidth}
          strokeDasharray={dash.dasharray}
          strokeLinecap={(dash.linecap as 'round' | undefined) ?? 'butt'}
          strokeLinejoin="round"
        />
      )}
      {visible && (
        <>
          <Arrow
            kind={edge.arrowStart}
            tip={route.start}
            dir={route.startDir}
            size={edge.arrowSize}
            color={edge.stroke}
            strokeWidth={edge.strokeWidth}
            opacity={edge.strokeOpacity}
          />
          <Arrow
            kind={edge.arrowEnd}
            tip={route.end}
            dir={route.endDir}
            size={edge.arrowSize}
            color={edge.stroke}
            strokeWidth={edge.strokeWidth}
            opacity={edge.strokeOpacity}
          />
        </>
      )}

      {label && labelPoint && (
        <g>
          {label.background && (
            <rect
              x={labelPoint.x - (label.text.length * label.fontSize * 0.29 + 4)}
              y={labelPoint.y - label.fontSize * 0.72 - 2}
              width={label.text.length * label.fontSize * 0.58 + 8}
              height={label.fontSize * 1.44 + 4}
              fill="#ffffff"
              rx={2}
            />
          )}
          <text
            x={labelPoint.x}
            y={labelPoint.y + label.fontSize * 0.35}
            textAnchor="middle"
            fill={label.color}
            style={{
              fontFamily: FONT_STACK.sans,
              fontSize: label.fontSize,
              userSelect: 'none',
            }}
          >
            {label.text}
          </text>
        </g>
      )}

      {selected && (
        <path
          data-ui="1"
          d={d}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={Math.max(edge.strokeWidth + 3, 4)}
          strokeOpacity={0.25}
          strokeLinecap="round"
        />
      )}
    </g>
  );
});
