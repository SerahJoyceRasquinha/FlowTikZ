import type { ArrowHead, Diagram, Edge } from '../model/types';
import { routeEdge, edgeLabelPoint } from '../model/routing';
import { latexId } from '../model/ids';
import { escapeComment, escapeNodeText } from './escape';
import { ColorRegistry } from './colors';
import { LibraryRegistry, dashOption } from './styles';
import { UnitContext, coord, fmt, toPt } from './units';
import { segsToTikz, emitStatement } from './nodes';
import type { EmitResult } from './nodes';
import { round } from '../model/geometry';

/**
 * Arrow tips, expressed with the `arrows.meta` library so that the tip scales
 * with the diagram instead of with the ambient line width.
 */
function arrowTip(kind: ArrowHead, sizePt: number): string | null {
  const l = fmt(round(sizePt, 2));
  const w = fmt(round(sizePt * 0.75, 2));
  switch (kind) {
    case 'none':
      return null;
    case 'stealth':
      return `Stealth[length=${l}pt, width=${w}pt]`;
    case 'latex':
      return `Latex[length=${l}pt, width=${w}pt]`;
    case 'triangle':
      return `Triangle[length=${l}pt, width=${w}pt]`;
    case 'open-triangle':
      return `Triangle[open, length=${l}pt, width=${w}pt]`;
    case 'bar':
      return `Bar[width=${w}pt]`;
    case 'circle':
      return `Circle[length=${w}pt]`;
    case 'diamond':
      return `Diamond[length=${l}pt, width=${w}pt]`;
    default:
      return null;
  }
}

export function arrowSpec(
  edge: Edge,
  ctx: UnitContext,
  libs: LibraryRegistry,
): string | null {
  const sizePt = toPt(edge.arrowSize, ctx);
  const start = arrowTip(edge.arrowStart, sizePt);
  const end = arrowTip(edge.arrowEnd, sizePt);
  if (!start && !end) return null;
  libs.use('arrows.meta');
  return `${start ? `{${start}}` : ''}-${end ? `{${end}}` : ''}`;
}

export function emitEdge(
  d: Diagram,
  edge: Edge,
  ctx: UnitContext,
  colors: ColorRegistry,
  libs: LibraryRegistry,
): EmitResult {
  const lines: string[] = [];
  const warnings: string[] = [];
  const route = routeEdge(d, edge);

  const from = edge.source.nodeId ?? 'point';
  const to = edge.target.nodeId ?? 'point';
  lines.push(`% ${edge.id} - ${from} -> ${to} (${edge.routing})`);

  if (!route) {
    warnings.push(
      `${edge.id}: endpoints could not be resolved; the connector was skipped.`,
    );
    lines.push(`% ${edge.id}: skipped - unresolved endpoint`);
    return { lines, warnings };
  }
  if (route.totalLength < 0.5) {
    warnings.push(
      `${edge.id}: zero-length connector; nothing was emitted for it.`,
    );
    lines.push(`% ${edge.id}: skipped - zero length`);
    return { lines, warnings };
  }

  const opts: string[] = ['fcedge'];
  const spec = arrowSpec(edge, ctx, libs);
  if (spec) opts.push(spec);
  if (edge.strokeStyle === 'none' || edge.strokeWidth <= 0) {
    warnings.push(`${edge.id}: stroke is disabled, so the path is invisible.`);
  }
  opts.push(`draw=${colors.use(edge.stroke)}`);
  opts.push(`line width=${fmt(toPt(Math.max(edge.strokeWidth, 0.1), ctx))}pt`);
  opts.push(...dashOption(edge.strokeStyle, edge.strokeWidth, ctx));
  if (edge.strokeOpacity < 1) {
    opts.push(`draw opacity=${fmt(round(edge.strokeOpacity, 3))}`);
  }
  if (edge.opacity < 1) opts.push(`opacity=${fmt(round(edge.opacity, 3))}`);

  lines.push(...emitStatement('\\draw', opts, ''));
  const body = segsToTikz(route.segs, ctx, '  ');
  body[body.length - 1] += ';';
  lines.push(...body);

  if (edge.label && edge.label.text.trim()) {
    const escaped = escapeNodeText(edge.label.text);
    if (escaped.risky.length) {
      warnings.push(
        `${edge.id}: label characters ${escaped.risky.join(' ')} may need XeLaTeX/LuaLaTeX.`,
      );
    }
    const p = edgeLabelPoint(route, edge.label.pos, edge.label.offset);
    const labelOpts = [
      'fclabel',
      'anchor=center',
      `font=\\fontsize{${fmt(round(Math.max(1, toPt(edge.label.fontSize, ctx)), 2))}pt}{${fmt(
        round(Math.max(1.2, toPt(edge.label.fontSize, ctx) * 1.2), 2),
      )}pt}\\selectfont\\sffamily`,
      `text=${colors.use(edge.label.color)}`,
    ];
    if (edge.label.background) {
      labelOpts.push('fill=white', 'inner sep=1.6pt');
    }
    lines.push(
      ...emitStatement(
        '\\node',
        labelOpts,
        ` (${latexId(edge.id)}label) at ${coord(p, ctx)} {${escaped.body}};`,
      ),
    );
  }

  const comment = escapeComment('');
  void comment;
  return { lines, warnings };
}
