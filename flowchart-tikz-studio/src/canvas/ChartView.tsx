import { memo, useMemo } from 'react';
import type { ChartSpec, MarkKind } from '../charts/types';
import {
  CartesianLayout,
  ChartLayout,
  LegendItem,
  LLegend,
  LText,
  PieLayout,
  TEXT_DEPTH,
  TEXT_HEIGHT,
  catValueToLocal,
  dataToLocal,
  layoutChart,
} from '../charts/layout';
import { dashArraySvg } from '../latex/styles';
import { FONT_STACK } from './textLayout';

/**
 * SVG rendering of a chart layout, in the chart's local coordinates.
 *
 * Draws exactly what `layoutChart` describes - nothing is measured or
 * re-decided here - so the canvas and the PGFPlots output agree.
 */

const FONT = FONT_STACK.sans;

/** Baseline offset and text-anchor for a TikZ anchor on a fixed-height text box. */
function anchorToSvg(anchor: LText['anchor'], size: number) {
  const vertical = anchor.includes('north') ? 'north' : anchor.includes('south') ? 'south' : 'middle';
  const horizontal = anchor.includes('east') ? 'end' : anchor.includes('west') ? 'start' : 'middle';
  const dy =
    vertical === 'north'
      ? size * TEXT_HEIGHT
      : vertical === 'south'
        ? -size * TEXT_DEPTH
        : (size * (TEXT_HEIGHT - TEXT_DEPTH)) / 2;
  return { dy, textAnchor: horizontal as 'start' | 'middle' | 'end' };
}

export function SvgText({ t }: { t: LText }) {
  const { dy, textAnchor } = anchorToSvg(t.anchor, t.size);
  return (
    <text
      transform={`translate(${t.x} ${t.y})${t.rotate ? ` rotate(${-t.rotate})` : ''}`}
      x={0}
      y={dy}
      textAnchor={textAnchor}
      fill={t.color}
      style={{
        fontFamily: FONT,
        fontSize: t.size,
        fontWeight: t.bold ? 700 : 400,
        whiteSpace: 'pre',
        userSelect: 'none',
      }}
    >
      {t.text}
    </text>
  );
}

/** Plot mark, the same outlines as TikZ's `*`, `square*`, `triangle*`, `diamond*`. */
export function Mark({ kind, x, y, r, color, strokeWidth = 0.5 }: { kind: MarkKind; x: number; y: number; r: number; color: string; strokeWidth?: number }) {
  if (kind === 'none') return null;
  const common = { fill: color, stroke: color, strokeWidth };
  switch (kind) {
    case 'square':
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} {...common} />;
    case 'triangle':
      return <polygon points={`${x},${y - r} ${x + r * 0.8660254} ${y + r / 2} ${x - r * 0.8660254},${y + r / 2}`} {...common} />;
    case 'diamond':
      return <polygon points={`${x},${y - r} ${x + r * 0.75},${y} ${x},${y + r} ${x - r * 0.75},${y}`} {...common} />;
    default:
      return <circle cx={x} cy={y} r={r} {...common} />;
  }
}

function Swatch({ it }: { it: LegendItem }) {
  if (it.kind === 'box') {
    return (
      <rect
        x={it.sx}
        y={it.sy}
        width={it.sw}
        height={it.sh}
        fill={it.color}
        stroke={it.outline ?? 'none'}
        strokeWidth={it.outline ? 0.8 : 0}
      />
    );
  }
  const dash = dashArraySvg(it.dash === 'solid' ? 'solid' : it.dash, it.lineWidth);
  return (
    <g>
      {it.kind === 'line' && (
        <line
          x1={it.sx}
          y1={it.sy}
          x2={it.sx + it.sw}
          y2={it.sy}
          stroke={it.color}
          strokeWidth={it.lineWidth}
          strokeDasharray={dash.dasharray}
          strokeLinecap={dash.linecap === 'round' ? 'round' : 'butt'}
        />
      )}
      <Mark
        kind={it.mark}
        x={it.sx + it.sw / 2}
        y={it.kind === 'line' ? it.sy : it.sy + it.sh / 2}
        r={it.markSize}
        color={it.color}
      />
    </g>
  );
}

function Legend({ lg }: { lg: LLegend }) {
  return (
    <g data-chart-part="legend">
      <rect x={lg.x} y={lg.y} width={lg.w} height={lg.h} fill={lg.fill} stroke={lg.border} strokeWidth={0.8} />
      {lg.items.map((it, i) => (
        <g key={i}>
          <Swatch it={it} />
          <SvgText t={it.text} />
        </g>
      ))}
    </g>
  );
}

function Cartesian({ l }: { l: CartesianLayout }) {
  const { plot } = l;
  const bottom = plot.y + plot.h;
  const right = plot.x + plot.w;
  const xPos = (v: number) => dataToLocal(l, v, l.yRange.min).x;
  const yPos = (v: number) => dataToLocal(l, l.xRange.min, v).y;
  const gridW = Math.max(0.5, l.axisWidth * 0.8);

  return (
    <g>
      {/* grid */}
      {l.grid.y &&
        l.yTicks.map((t, i) => (
          <line key={`gy${i}`} x1={plot.x} x2={right} y1={yPos(t.v)} y2={yPos(t.v)} stroke={l.grid.color} strokeWidth={gridW} />
        ))}
      {l.grid.x &&
        l.xTicks.map((t, i) => (
          <line key={`gx${i}`} x1={xPos(t.v)} x2={xPos(t.v)} y1={plot.y} y2={bottom} stroke={l.grid.color} strokeWidth={gridW} />
        ))}

      {/* axis lines */}
      {l.axisLines === 'box' ? (
        <rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} fill="none" stroke={l.axisColor} strokeWidth={l.axisWidth} />
      ) : (
        <path d={`M ${plot.x} ${plot.y} L ${plot.x} ${bottom} L ${right} ${bottom}`} fill="none" stroke={l.axisColor} strokeWidth={l.axisWidth} />
      )}

      {/* ticks */}
      {l.xTicks.map((t, i) => (
        <line key={`tx${i}`} x1={xPos(t.v)} x2={xPos(t.v)} y1={bottom} y2={bottom + l.tickLen} stroke={l.axisColor} strokeWidth={l.axisWidth} />
      ))}
      {l.yTicks.map((t, i) => (
        <line key={`ty${i}`} x1={plot.x} x2={plot.x - l.tickLen} y1={yPos(t.v)} y2={yPos(t.v)} stroke={l.axisColor} strokeWidth={l.axisWidth} />
      ))}

      {/* series */}
      {l.series.map((s, si) => {
        if (s.kind === 'bar') {
          return (
            <g key={si} data-series={s.name}>
              {s.points.map((p, pi) => {
                const half = s.barWidth / 2;
                const a = catValueToLocal(l, p.x - half, p.y0);
                const b = catValueToLocal(l, p.x + half, p.y);
                const x = Math.min(a.x, b.x);
                const y = Math.min(a.y, b.y);
                return (
                  <rect
                    key={pi}
                    x={x}
                    y={y}
                    width={Math.abs(b.x - a.x)}
                    height={Math.abs(b.y - a.y)}
                    fill={s.color}
                    stroke={s.outline ?? 'none'}
                    strokeWidth={s.outline ? s.outlineWidth : 0}
                  />
                );
              })}
            </g>
          );
        }
        const pts = s.points.map((p) => dataToLocal(l, p.x, p.y));
        const dash = dashArraySvg(s.dash === 'solid' ? 'solid' : s.dash, s.lineWidth);
        const linePath = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
        return (
          <g key={si} data-series={s.name}>
            {s.kind === 'area' && pts.length > 0 && (
              <path
                d={`${linePath} ${[...s.points]
                  .reverse()
                  .map((p) => {
                    const q = dataToLocal(l, p.x, Math.max(p.y0, l.yRange.min));
                    return `L ${q.x} ${q.y}`;
                  })
                  .join(' ')} Z`}
                fill={s.color}
                fillOpacity={s.fillOpacity}
                stroke="none"
              />
            )}
            {(s.kind === 'line' || s.kind === 'area') && pts.length > 1 && (
              <path
                d={linePath}
                fill="none"
                stroke={s.color}
                strokeWidth={s.lineWidth}
                strokeLinejoin="round"
                strokeDasharray={dash.dasharray}
                strokeLinecap={dash.linecap === 'round' ? 'round' : 'butt'}
              />
            )}
            {s.mark !== 'none' &&
              pts.map((p, i) => <Mark key={i} kind={s.mark} x={p.x} y={p.y} r={s.markSize} color={s.color} />)}
          </g>
        );
      })}

      {/* tick labels */}
      {l.xTicks.map((t, i) => (
        <SvgText
          key={`lx${i}`}
          t={{
            text: t.label,
            x: xPos(t.v),
            y: bottom + l.tickLabelGap,
            anchor: l.xTickAnchor,
            size: l.fontSize,
            bold: false,
            rotate: l.xTickRotate,
            color: l.textColor,
            role: 'data-label',
          }}
        />
      ))}
      {l.yTicks.map((t, i) => (
        <SvgText
          key={`ly${i}`}
          t={{
            text: t.label,
            x: plot.x - l.tickLabelGap,
            y: yPos(t.v),
            anchor: l.yTickAnchor,
            size: l.fontSize,
            bold: false,
            rotate: 0,
            color: l.textColor,
            role: 'data-label',
          }}
        />
      ))}

      {l.series.flatMap((s, si) => s.labels.map((t, i) => <SvgText key={`dl${si}-${i}`} t={t} />))}
      {l.texts.map((t, i) => (
        <SvgText key={`t${i}`} t={t} />
      ))}
      {l.legend && <Legend lg={l.legend} />}
    </g>
  );
}

function slicePath(l: PieLayout, start: number, end: number): string {
  const p = (r: number, deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${l.cx + r * Math.sin(a)} ${l.cy - r * Math.cos(a)}`;
  };
  const sweep = end - start;
  if (sweep >= 359.999) {
    const ring = (r: number) => `M ${l.cx - r} ${l.cy} A ${r} ${r} 0 1 1 ${l.cx + r} ${l.cy} A ${r} ${r} 0 1 1 ${l.cx - r} ${l.cy} Z`;
    return l.inner > 0 ? `${ring(l.r)} ${ring(l.inner)}` : ring(l.r);
  }
  const large = sweep > 180 ? 1 : 0;
  if (l.inner > 0) {
    return `M ${p(l.r, start)} A ${l.r} ${l.r} 0 ${large} 1 ${p(l.r, end)} L ${p(l.inner, end)} A ${l.inner} ${l.inner} 0 ${large} 0 ${p(l.inner, start)} Z`;
  }
  return `M ${l.cx} ${l.cy} L ${p(l.r, start)} A ${l.r} ${l.r} 0 ${large} 1 ${p(l.r, end)} Z`;
}

function Pie({ l }: { l: PieLayout }) {
  return (
    <g>
      {l.slices.map((s, i) => (
        <path
          key={i}
          d={slicePath(l, s.start, s.end)}
          fill={s.color}
          fillRule="evenodd"
          stroke={l.outline ?? 'none'}
          strokeWidth={l.outline ? l.outlineWidth : 0}
          data-slice={s.name}
        />
      ))}
      {l.slices.map((s, i) => (s.label ? <SvgText key={`l${i}`} t={s.label} /> : null))}
      {l.texts.map((t, i) => (
        <SvgText key={`t${i}`} t={t} />
      ))}
      {l.legend && <Legend lg={l.legend} />}
    </g>
  );
}

/** Draw a computed layout. */
export function ChartLayoutView({ layout, showEmptyFrame = true }: { layout: ChartLayout; showEmptyFrame?: boolean }) {
  return (
    <g data-chart-kind={layout.kind}>
      {layout.kind !== 'empty' && layout.background && (
        <rect x={0} y={0} width={layout.w} height={layout.h} fill={layout.background} />
      )}
      {layout.kind === 'cartesian' && <Cartesian l={layout} />}
      {layout.kind === 'pie' && <Pie l={layout} />}
      {layout.kind === 'empty' && showEmptyFrame && (
        <g data-ui="1">
          <rect
            x={0.5}
            y={0.5}
            width={Math.max(0, layout.w - 1)}
            height={Math.max(0, layout.h - 1)}
            fill="#f7f9fb"
            stroke="#9aa7b5"
            strokeDasharray="6 4"
          />
          <text
            x={layout.w / 2}
            y={layout.h / 2}
            textAnchor="middle"
            fill="#5a6776"
            style={{ fontFamily: FONT, fontSize: 14, userSelect: 'none' }}
          >
            {layout.message}
          </text>
        </g>
      )}
    </g>
  );
}

/** A chart spec at a given size, laid out and drawn. */
export const ChartView = memo(function ChartView({ spec, w, h }: { spec: ChartSpec; w: number; h: number }) {
  const layout = useMemo(() => layoutChart(spec, w, h), [spec, w, h]);
  return <ChartLayoutView layout={layout} />;
});
