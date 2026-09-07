import type { ShapeStyle, StrokeStyle, TextStyle } from '../model/types';
import { ColorRegistry } from './colors';
import { UnitContext, fmt, toPt } from './units';
import { round } from '../model/geometry';

/**
 * Translation of model styling into TikZ options.
 *
 * Every option this file can emit declares the library it needs, so the
 * preamble is assembled from what the diagram actually uses rather than from a
 * fixed "kitchen sink" list.
 */

export class LibraryRegistry {
  private set = new Set<string>();

  use(...names: string[]): void {
    for (const n of names) this.set.add(n);
  }

  list(): string[] {
    return [...this.set].sort();
  }

  render(): string[] {
    const libs = this.list();
    return libs.length ? [`\\usetikzlibrary{${libs.join(',')}}`] : [];
  }
}

/* --------------------------------------------------------- dash patterns */

export function dashOption(
  style: StrokeStyle,
  strokeWidth: number,
  ctx: UnitContext,
): string[] {
  const w = Math.max(strokeWidth, 0.4);
  switch (style) {
    case 'dashed':
      return [`dash pattern=on ${fmt(toPt(w * 3, ctx))}pt off ${fmt(toPt(w * 3, ctx))}pt`];
    case 'dotted':
      return [
        'line cap=round',
        `dash pattern=on 0pt off ${fmt(toPt(w * 2.6, ctx))}pt`,
      ];
    case 'dashdotted':
      return [
        'line cap=round',
        `dash pattern=on ${fmt(toPt(w * 3.5, ctx))}pt off ${fmt(
          toPt(w * 2, ctx),
        )}pt on 0pt off ${fmt(toPt(w * 2, ctx))}pt`,
      ];
    default:
      return [];
  }
}

/** SVG equivalent of the same pattern, so the canvas matches the PDF. */
export function dashArraySvg(
  style: StrokeStyle,
  strokeWidth: number,
): { dasharray?: string; linecap?: string } {
  const w = Math.max(strokeWidth, 0.4);
  switch (style) {
    case 'dashed':
      return { dasharray: `${round(w * 3, 2)} ${round(w * 3, 2)}` };
    case 'dotted':
      return { dasharray: `0.01 ${round(w * 2.6, 2)}`, linecap: 'round' };
    case 'dashdotted':
      return {
        dasharray: `${round(w * 3.5, 2)} ${round(w * 2, 2)} 0.01 ${round(w * 2, 2)}`,
        linecap: 'round',
      };
    default:
      return {};
  }
}

/* ------------------------------------------------------------- opacities */

function opacityOption(name: string, value: number): string[] {
  const v = round(Math.min(1, Math.max(0, value)), 3);
  return v >= 1 ? [] : [`${name}=${fmt(v)}`];
}

/* ------------------------------------------------------------ shape fill */

export interface StyleBuildResult {
  options: string[];
  warnings: string[];
}

export function shapeOptions(
  style: ShapeStyle,
  colors: ColorRegistry,
  libs: LibraryRegistry,
  ctx: UnitContext,
): StyleBuildResult {
  const options: string[] = [];
  const warnings: string[] = [];

  const hasStroke = style.strokeStyle !== 'none' && style.strokeWidth > 0;
  if (hasStroke) {
    options.push(`draw=${colors.use(style.stroke)}`);
    options.push(`line width=${fmt(toPt(style.strokeWidth, ctx))}pt`);
    options.push(...dashOption(style.strokeStyle, style.strokeWidth, ctx));
    options.push(...opacityOption('draw opacity', style.strokeOpacity));
  } else {
    options.push('draw=none');
  }

  const fillName = colors.use(style.fill);
  if (style.shading === 'none') {
    options.push(`fill=${fillName}`);
  } else {
    const to = colors.use(style.shadingColor);
    switch (style.shading) {
      case 'axis-vertical':
        options.push(`top color=${fillName}`, `bottom color=${to}`);
        break;
      case 'axis-horizontal':
        options.push(`left color=${fillName}`, `right color=${to}`);
        break;
      case 'radial':
        options.push(`inner color=${fillName}`, `outer color=${to}`);
        break;
    }
    if (style.fillOpacity < 1) {
      warnings.push(
        'TikZ shadings ignore fill opacity; the gradient is emitted at full opacity.',
      );
    }
  }

  if (style.shading === 'none') {
    options.push(...opacityOption('fill opacity', style.fillOpacity));
  }
  options.push(...opacityOption('opacity', style.opacity));

  if (style.shadow) {
    libs.use('shadows');
    options.push(
      `drop shadow={shadow xshift=${fmt(toPt(3, ctx))}pt, shadow yshift=${fmt(
        -toPt(3, ctx),
      )}pt, opacity=0.25, fill=black}`,
    );
  }

  return { options, warnings };
}

/* ------------------------------------------------------------------ font */

const FAMILY_CMD: Record<TextStyle['fontFamily'], string> = {
  sans: '\\sffamily',
  serif: '\\rmfamily',
  mono: '\\ttfamily',
};

/**
 * Font size is converted proportionally rather than snapped to a LaTeX size
 * command, so the compiled text occupies the same fraction of the shape as it
 * does on the canvas.
 */
export function fontOption(text: TextStyle, ctx: UnitContext): string {
  const size = Math.max(1, toPt(text.fontSize, ctx));
  const leading = round(size * Math.max(1, text.lineHeight), 2);
  return `font=\\fontsize{${fmt(round(size, 2))}pt}{${fmt(leading)}pt}\\selectfont${
    FAMILY_CMD[text.fontFamily] ?? '\\sffamily'
  }`;
}

export function textOptions(
  text: TextStyle,
  colors: ColorRegistry,
  ctx: UnitContext,
): string[] {
  const options = [fontOption(text, ctx), `text=${colors.use(text.color)}`];
  options.push(`align=${text.align}`);
  return options;
}

/* ------------------------------------------------------------- base defs */

/**
 * Reusable styles emitted once in the preamble. Node and edge emitters then
 * only spell the options that differ from these, which keeps the body
 * readable.
 */
export function baseStyleDefinitions(): string[] {
  return [
    '\\tikzset{',
    '  fcnode/.style={',
    '    draw, inner sep=0pt, outer sep=0pt, align=center,',
    '    line join=round, line cap=butt',
    '  },',
    '  fcpath/.style={line join=round, line cap=butt},',
    '  fcedge/.style={line join=round, line cap=butt},',
    '  fclabel/.style={inner sep=1.4pt, outer sep=0pt, align=center},',
    '}',
  ];
}
