import { memo } from 'react';
import type { Node } from '../model/types';
import { getShapeDef, nodeDecorations, nodeOutline } from '../model/shapes';
import { isClosed, segsToSvgPath } from '../model/path';
import { dashArraySvg } from '../latex/styles';
import { layoutNodeText, fontCss } from './textLayout';

interface Props {
  node: Node;
  selected: boolean;
  hidden?: boolean;
}

function gradientId(n: Node) {
  return `grad-${n.id}`;
}

function Gradient({ node }: { node: Node }) {
  const { shading, fill, shadingColor } = node.style;
  if (shading === 'none') return null;
  const id = gradientId(node);
  if (shading === 'radial') {
    return (
      <radialGradient id={id} cx="50%" cy="50%" r="65%">
        <stop offset="0%" stopColor={fill} />
        <stop offset="100%" stopColor={shadingColor} />
      </radialGradient>
    );
  }
  const horizontal = shading === 'axis-horizontal';
  return (
    <linearGradient
      id={id}
      x1="0%"
      y1="0%"
      x2={horizontal ? '100%' : '0%'}
      y2={horizontal ? '0%' : '100%'}
    >
      <stop offset="0%" stopColor={fill} />
      <stop offset="100%" stopColor={shadingColor} />
    </linearGradient>
  );
}

export const ShapeView = memo(function ShapeView({ node, selected, hidden }: Props) {
  // A shape with corrupt styling is skipped rather than allowed to throw; the
  // generator reports it as an error in the issues list.
  if (!node || !node.style || !node.textStyle) return null;
  const def = getShapeDef(node.kind);
  const outline = nodeOutline(node);
  const decorations = nodeDecorations(node);
  const closed = isClosed(outline);
  const textOnly = def.noOutline && closed;

  const s = node.style;
  const dash = dashArraySvg(s.strokeStyle, s.strokeWidth);
  const strokeVisible = s.strokeStyle !== 'none' && s.strokeWidth > 0;
  const fillValue =
    s.shading !== 'none' ? `url(#${gradientId(node)})` : textOnly ? 'none' : s.fill;

  const layout = layoutNodeText(node);
  const font = fontCss(node);
  const d = segsToSvgPath(outline);

  const strokeProps = {
    stroke: strokeVisible ? s.stroke : 'none',
    strokeWidth: strokeVisible ? s.strokeWidth : 0,
    strokeOpacity: s.strokeOpacity,
    strokeDasharray: dash.dasharray,
    strokeLinecap: (dash.linecap === 'round' ? 'round' : 'butt') as 'round' | 'butt',
    strokeLinejoin: 'round' as const,
  };

  return (
    <g
      transform={`translate(${node.x} ${node.y}) rotate(${node.rotation} ${node.w / 2} ${
        node.h / 2
      })`}
      opacity={hidden ? 0 : s.opacity}
      data-object-id={node.id}
      data-kind={node.kind}
    >
      {s.shading !== 'none' && (
        <defs>
          <Gradient node={node} />
        </defs>
      )}

      {s.shadow && !textOnly && (
        <path d={d} transform="translate(3 3)" fill="#000000" opacity={0.22} />
      )}

      {!textOnly && (
        <path
          d={d}
          fill={closed ? fillValue : 'none'}
          fillOpacity={s.shading !== 'none' ? 1 : s.fillOpacity}
          {...strokeProps}
        />
      )}

      {decorations.map((dec, i) => (
        <path
          key={i}
          d={segsToSvgPath(dec)}
          fill="none"
          {...strokeProps}
        />
      ))}

      {layout && (
        <text
          x={layout.x}
          y={layout.firstBaseline}
          textAnchor={layout.textAnchor}
          fill={node.textStyle.color}
          style={{
            fontFamily: font.fontFamily,
            fontSize: font.fontSize,
            fontWeight: font.fontWeight,
            fontStyle: font.fontStyle,
            textDecoration: font.textDecoration,
            whiteSpace: 'pre',
            userSelect: 'none',
          }}
        >
          {layout.lines.map((line, i) => (
            <tspan
              key={i}
              x={layout.x}
              y={layout.firstBaseline + i * layout.lineHeight}
            >
              {line === '' ? ' ' : line}
            </tspan>
          ))}
        </text>
      )}

      {selected && node.locked && (
        <rect
          data-ui="1"
          x={-2}
          y={-2}
          width={node.w + 4}
          height={node.h + 4}
          fill="none"
          stroke="var(--signal)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}
    </g>
  );
});
