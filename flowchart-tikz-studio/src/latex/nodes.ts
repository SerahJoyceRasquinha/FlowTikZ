import type { Node, Point } from '../model/types';
import { getShapeDef, nodeDecorations, nodeOutline, nodeTextBox } from '../model/shapes';
import { isClosed, Seg } from '../model/path';
import { latexId } from '../model/ids';
import { escapeComment, escapeNodeText } from './escape';
import { ColorRegistry } from './colors';
import { LibraryRegistry, shapeOptions, textOptions } from './styles';
import { UnitContext, coord, fmt, cm } from './units';

export interface EmitResult {
  lines: string[];
  warnings: string[];
}

const MAX_LINE = 92;

/**
 * Emit `\command[opt, opt, ...]<tail>`, wrapping the option list across lines
 * when it would otherwise run off the edge of the editor. Newlines inside a
 * TikZ option list are insignificant, so this is purely for legibility - and
 * legibility matters, because the whole point is code a person can then edit.
 */
export function emitStatement(
  command: string,
  options: string[],
  tail: string,
  indent = '',
): string[] {
  const oneLine = `${indent}${command}[${options.join(', ')}]${tail}`;
  if (oneLine.length <= MAX_LINE || options.length < 2) return [oneLine];

  const contIndent = `${indent}      `;
  const firstBudget = MAX_LINE - indent.length - command.length - 1;
  const contBudget = MAX_LINE - contIndent.length;

  const chunks: string[] = [];
  let current = '';
  for (const opt of options) {
    const candidate = current ? `${current}, ${opt}` : opt;
    const budget = chunks.length === 0 ? firstBudget : contBudget;
    if (candidate.length > budget && current) {
      chunks.push(current);
      current = opt;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  // Every statement must be closed exactly once. The bracket and the tail
  // belong to the final chunk, whichever chunk that turns out to be - including
  // when the options happen to collapse back into a single chunk.
  const lines = chunks.map((chunk, i) => {
    const head = i === 0 ? `${indent}${command}[` : contIndent;
    const close = i === chunks.length - 1 ? ']' : ',';
    return `${head}${chunk}${close}`;
  });

  // The tail (node name, coordinate, body) attaches to the closing bracket
  // unless doing so would overrun, in which case it continues on its own line.
  const last = lines.length - 1;
  if (tail) {
    if (lines[last].length + tail.length <= MAX_LINE) {
      lines[last] += tail;
    } else {
      lines.push(`${contIndent}${tail.trimStart()}`);
    }
  }
  return lines;
}

/**
 * Render a world-space path as TikZ.
 *
 * Long paths are broken across lines at segment boundaries. Whitespace is
 * insignificant inside a TikZ path, so a continuation line may begin with the
 * `--` or `.. controls ..` operator. The decision to break is made *before* a
 * piece is appended, which is what keeps every line inside the budget.
 */
export function segsToTikz(segs: Seg[], ctx: UnitContext, indent = '  '): string[] {
  const out: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) out.push(indent + current.trim());
    current = '';
  };

  const append = (piece: string) => {
    if (current && indent.length + current.length + piece.length > MAX_LINE) {
      flush();
      current = piece.trimStart();
    } else {
      current += piece;
    }
  };

  for (const s of segs) {
    switch (s.c) {
      case 'M':
        flush();
        current = coord(s.p, ctx);
        break;
      case 'L':
        append(` -- ${coord(s.p, ctx)}`);
        break;
      case 'C':
        append(
          ` .. controls ${coord(s.c1, ctx)} and ${coord(s.c2, ctx)} .. ${coord(s.p, ctx)}`,
        );
        break;
      case 'Z':
        append(' -- cycle');
        break;
    }
  }
  flush();
  return out;
}

function toWorld(segs: Seg[], n: Node): Seg[] {
  const t = (p: Point) => ({ x: n.x + p.x, y: n.y + p.y });
  return segs.map((s) => {
    if (s.c === 'M') return { c: 'M', p: t(s.p) } as Seg;
    if (s.c === 'L') return { c: 'L', p: t(s.p) } as Seg;
    if (s.c === 'C') return { c: 'C', c1: t(s.c1), c2: t(s.c2), p: t(s.p) } as Seg;
    return s;
  });
}

const ANCHOR: Record<string, string> = {
  'left-top': 'north west',
  'center-top': 'north',
  'right-top': 'north east',
  'left-middle': 'west',
  'center-middle': 'center',
  'right-middle': 'east',
  'left-bottom': 'south west',
  'center-bottom': 'south',
  'right-bottom': 'south east',
};

function textAnchorPoint(n: Node): { p: Point; anchor: string } {
  const tb = nodeTextBox(n);
  const ts = n.textStyle;
  const x =
    ts.align === 'left'
      ? n.x + tb.x
      : ts.align === 'right'
        ? n.x + tb.x + tb.w
        : n.x + tb.x + tb.w / 2;
  const y =
    ts.valign === 'top'
      ? n.y + tb.y
      : ts.valign === 'bottom'
        ? n.y + tb.y + tb.h
        : n.y + tb.y + tb.h / 2;
  return { p: { x, y }, anchor: ANCHOR[`${ts.align}-${ts.valign}`] ?? 'center' };
}

/**
 * The text box is always pinned with `text width`.
 *
 * Without it a TikZ node grows to fit its body, so a long label would silently
 * make the compiled shape wider than the `minimum width` we asked for - and
 * the figure would no longer match the canvas. Pinning the width makes long
 * text wrap inside the shape instead, exactly as the canvas renders it.
 */
function textWidthOption(n: Node, ctx: UnitContext): string[] {
  const tb = nodeTextBox(n);
  const ts = n.textStyle;
  const width = ts.wrapWidth > 0 ? ts.wrapWidth : tb.w;
  return [`text width=${fmt(cm(Math.max(1, width), ctx))}cm`];
}

function emitTextNode(
  n: Node,
  ctx: UnitContext,
  colors: ColorRegistry,
  indent: string,
): string[] {
  const escaped = escapeNodeText(n.text, {
    bold: n.textStyle.bold,
    italic: n.textStyle.italic,
    underline: n.textStyle.underline,
  });
  if (escaped.isEmpty) return [];
  const { p, anchor } = textAnchorPoint(n);
  const opts = [
    'fclabel',
    `anchor=${anchor}`,
    ...textOptions(n.textStyle, colors, ctx),
    ...textWidthOption(n, ctx),
  ];
  return emitStatement('\\node', opts, ` at ${coord(p, ctx)} {${escaped.body}};`, indent);
}

/**
 * Emit one node.
 *
 * Two strategies:
 *  - `\node[shape=...]` when TikZ owns a shape whose bounding box we can pin
 *    exactly (rectangle, diamond, circle, ellipse, rounded rectangle);
 *  - an explicit `\draw` path derived from the very same outline function the
 *    canvas renders, for every other symbol.
 * Both produce identical geometry; the first is simply more idiomatic to read
 * and easier to reference from hand-written TikZ afterwards.
 */
export function emitNode(
  n: Node,
  ctx: UnitContext,
  colors: ColorRegistry,
  libs: LibraryRegistry,
): EmitResult {
  const def = getShapeDef(n.kind);
  const lines: string[] = [];
  const warnings: string[] = [];
  const id = latexId(n.id);
  const centre: Point = { x: n.x + n.w / 2, y: n.y + n.h / 2 };
  const angle = -n.rotation; // canvas y grows down; TikZ y grows up

  const label = n.text.trim().split('\n')[0].slice(0, 40);
  lines.push(
    `% ${n.id} - ${def.label}${label ? ` "${escapeComment(label)}"` : ''}`,
  );

  const escaped = escapeNodeText(n.text, {
    bold: n.textStyle.bold,
    italic: n.textStyle.italic,
    underline: n.textStyle.underline,
  });
  if (escaped.risky.length) {
    warnings.push(
      `${n.id}: characters ${escaped.risky.join(' ')} may need a Unicode-aware engine (XeLaTeX/LuaLaTeX) or extra packages.`,
    );
  }

  const style = shapeOptions(n.style, colors, libs, ctx);
  warnings.push(...style.warnings.map((w) => `${n.id}: ${w}`));

  /* -------------------------------------------------- text-only symbols */
  if (def.noOutline && isClosed(def.outline(n.w, n.h, n))) {
    const opts = [
      'fclabel',
      'anchor=center',
      ...textOptions(n.textStyle, colors, ctx),
      ...textWidthOption(n, ctx),
    ];
    if (angle) opts.push(`rotate=${fmt(angle)}`);
    lines.push(
      ...emitStatement(
        '\\node',
        opts,
        ` (${id}) at ${coord(centre, ctx)} {${escaped.body}};`,
      ),
    );
    return { lines, warnings };
  }

  /* ------------------------------------------------- built-in TikZ nodes */
  const mapping = def.tikzNode;
  const decorations = nodeDecorations(n);
  const canUseNode =
    mapping &&
    decorations.length === 0 &&
    !(mapping.shape === 'circle' && Math.abs(n.w - n.h) > 0.5);

  if (canUseNode && mapping) {
    if (mapping.libraries) libs.use(...mapping.libraries);
    if (mapping.shape === 'diamond' || mapping.shape === 'ellipse') {
      libs.use('shapes.geometric');
    }
    if (mapping.shape === 'rounded rectangle') libs.use('shapes.misc');

    const opts = ['fcnode', `shape=${mapping.shape}`];
    if (mapping.shape === 'circle') {
      opts.push(`minimum size=${fmt(cm(n.w, ctx))}cm`);
    } else {
      opts.push(
        `minimum width=${fmt(cm(n.w, ctx))}cm`,
        `minimum height=${fmt(cm(n.h, ctx))}cm`,
      );
    }
    if (mapping.options) opts.push(...mapping.options(n));
    if (def.roundable && n.style.cornerRadius > 0) {
      opts.push(`rounded corners=${fmt(cm(n.style.cornerRadius, ctx))}cm`);
    }
    opts.push(...style.options);
    opts.push(...textOptions(n.textStyle, colors, ctx));
    opts.push(...textWidthOption(n, ctx));
    if (angle) opts.push(`rotate=${fmt(angle)}`);

    // Vertical alignment other than "middle" needs a separate label node.
    const needsSeparateText =
      n.textStyle.valign !== 'middle' && !escaped.isEmpty;

    lines.push(
      ...emitStatement(
        '\\node',
        opts,
        ` (${id}) at ${coord(centre, ctx)} {${needsSeparateText ? '' : escaped.body}};`,
      ),
    );
    if (needsSeparateText) {
      if (angle) {
        lines.push(`\\begin{scope}[rotate around={${fmt(angle)}:${coord(centre, ctx)}}]`);
        lines.push(...emitTextNode(n, ctx, colors, '  '));
        lines.push('\\end{scope}');
      } else {
        lines.push(...emitTextNode(n, ctx, colors, ''));
      }
    }
    return { lines, warnings };
  }

  /* ------------------------------------------------------ explicit paths */
  const indent = angle ? '  ' : '';
  if (angle) {
    lines.push(`\\begin{scope}[rotate around={${fmt(angle)}:${coord(centre, ctx)}}]`);
  }

  const outline = toWorld(nodeOutline(n), n);
  const closed = isClosed(outline);
  const drawOpts = closed
    ? ['fcpath', ...style.options]
    : // Open outlines (annotation brackets) are stroked, never filled.
      ['fcpath', ...style.options.filter((o) => !/^(fill|top color|bottom color|left color|right color|inner color|outer color)/.test(o))];

  lines.push(...emitStatement('\\draw', drawOpts, '', indent));
  lines.push(...segsToTikz(outline, ctx, `${indent}  `).map((l, i, arr) =>
    i === arr.length - 1 ? `${l};` : l,
  ));

  // Decorations are stroked with the same pen but never filled or shaded.
  const strokeOnly = style.options.filter((o) =>
    /^(draw|line width|dash pattern|line cap|draw opacity|opacity)/.test(o),
  );
  for (const dec of decorations) {
    const world = toWorld(dec, n);
    lines.push(...emitStatement('\\draw', ['fcpath', ...strokeOnly], '', indent));
    lines.push(
      ...segsToTikz(world, ctx, `${indent}  `).map((l, i, arr) =>
        i === arr.length - 1 ? `${l};` : l,
      ),
    );
  }

  // A zero-size coordinate carries the object id so the shape can still be
  // referenced from hand-written TikZ appended after the generated block.
  lines.push(`${indent}\\coordinate (${id}) at ${coord(centre, ctx)};`);
  lines.push(...emitTextNode(n, ctx, colors, indent));

  if (angle) lines.push('\\end{scope}');
  return { lines, warnings };
}
