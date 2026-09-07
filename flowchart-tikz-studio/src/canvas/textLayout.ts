import type { Node } from '../model/types';
import { nodeTextBox } from '../model/shapes';

/**
 * Canvas text layout.
 *
 * Mirrors the rules the TikZ emitter uses: the same anchor corner, the same
 * alignment, the same line order. Line *breaking* for wrapped text is
 * necessarily approximate here (the browser and TeX use different algorithms),
 * which is why wrapping raises an informational notice at generation time.
 */

const AVG_CHAR_RATIO: Record<Node['textStyle']['fontFamily'], number> = {
  sans: 0.52,
  serif: 0.5,
  mono: 0.6,
};

export const FONT_STACK: Record<Node['textStyle']['fontFamily'], string> = {
  sans: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace",
};

export interface TextLayout {
  lines: string[];
  /** Anchor x in local shape coordinates. */
  x: number;
  /** Baseline y of the first line, local coordinates. */
  firstBaseline: number;
  lineHeight: number;
  textAnchor: 'start' | 'middle' | 'end';
}

function wrapLine(line: string, maxWidth: number, charWidth: number): string[] {
  if (maxWidth <= 0 || charWidth <= 0) return [line];
  const maxChars = Math.max(1, Math.floor(maxWidth / charWidth));
  if (line.length <= maxChars) return [line];
  const words = line.split(/\s+/);
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out.length ? out : [line];
}

export function layoutNodeText(n: Node): TextLayout | null {
  if (!n.text || !n.text.trim()) return null;
  const ts = n.textStyle;
  const box = nodeTextBox(n);
  const charWidth = ts.fontSize * (AVG_CHAR_RATIO[ts.fontFamily] ?? 0.52);
  // Matches the LaTeX emitter, which always pins `text width` to this value.
  const wrapWidth = ts.wrapWidth > 0 ? ts.wrapWidth : box.w;

  const lines: string[] = [];
  for (const raw of n.text.split(/\r?\n/)) {
    lines.push(...(wrapWidth > 0 ? wrapLine(raw, wrapWidth, charWidth) : [raw]));
  }

  const lineHeight = ts.fontSize * Math.max(1, ts.lineHeight);
  const blockHeight = lines.length * lineHeight;

  const x =
    ts.align === 'left' ? box.x : ts.align === 'right' ? box.x + box.w : box.x + box.w / 2;

  const top =
    ts.valign === 'top'
      ? box.y
      : ts.valign === 'bottom'
        ? box.y + box.h - blockHeight
        : box.y + (box.h - blockHeight) / 2;

  return {
    lines,
    x,
    // 0.78 approximates the cap-height offset from the top of the line box.
    firstBaseline: top + ts.fontSize * 0.78 + (lineHeight - ts.fontSize) / 2,
    lineHeight,
    textAnchor: ts.align === 'left' ? 'start' : ts.align === 'right' ? 'end' : 'middle',
  };
}

export function fontCss(n: Node) {
  const ts = n.textStyle;
  return {
    fontFamily: FONT_STACK[ts.fontFamily] ?? FONT_STACK.sans,
    fontSize: ts.fontSize,
    fontWeight: ts.bold ? 700 : 400,
    fontStyle: ts.italic ? 'italic' : 'normal',
    textDecoration: ts.underline ? 'underline' : 'none',
  } as const;
}
