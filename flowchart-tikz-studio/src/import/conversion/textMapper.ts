import type { FontFamily, MetaValue, TextStyle } from '../../model/types';
import { DEFAULT_TEXT_STYLE } from '../../model/defaults';
import type { IRText } from '../ir/types';
import type { ReportBuilder } from '../report';
import { round2 } from './styleMapper';

/**
 * Text translation.
 *
 * Content is carried verbatim - line breaks included - and is *not* escaped
 * here: the model stores raw text and the existing LaTeX emitter escapes it on
 * the way out, exactly as it does for text typed by hand. Doing it here as
 * well would double-escape.
 */

/** Confidence below which recognised text is flagged for review. */
export const LOW_TEXT_CONFIDENCE = 0.8;

const GENERIC_SANS = /^(sans-serif|helvetica|arial|verdana|tahoma|segoe ui|roboto|open sans|inter|liberation sans|dejavu sans|system-ui|-apple-system|calibri|noto sans|lato|source sans pro|trebuchet ms)$/i;

export function classifyFont(family: string): { family: FontFamily; exact: boolean } {
  const first = family
    .split(',')[0]
    .trim()
    .replace(/^['"]|['"]$/g, '');
  const f = family.toLowerCase();
  if (/mono|courier|consol|menlo|monaco|code|fixed|typewriter/.test(f)) {
    return { family: 'mono', exact: /^(monospace|courier new|courier)$/i.test(first) };
  }
  if (/sans/.test(f) || GENERIC_SANS.test(first)) return { family: 'sans', exact: true };
  if (/serif|times|georgia|garamond|cambria|palatino|book|roman|baskerville|didot/.test(f)) {
    return { family: 'serif', exact: /^(serif|times new roman|times|georgia)$/i.test(first) };
  }
  return { family: 'sans', exact: !first };
}

export interface MappedText {
  text: string;
  textStyle: TextStyle;
  preserved: Record<string, MetaValue>;
  confidence?: number;
}

export function mapText(
  t: IRText | undefined,
  scale: number,
  report: ReportBuilder,
  ref: string,
): MappedText {
  const preserved: Record<string, MetaValue> = {};
  if (!t) return { text: '', textStyle: { ...DEFAULT_TEXT_STYLE }, preserved };
  const font = classifyFont(t.fontFamily || 'sans-serif');
  if (!font.exact) {
    preserved.fontFamily = t.fontFamily;
    report.tally('style-difference', `Font "${t.fontFamily.split(',')[0].trim().replace(/['"]/g, '')}" shown with the closest ${font.family} family`);
  }
  const textStyle: TextStyle = {
    ...DEFAULT_TEXT_STYLE,
    color: t.color,
    fontSize: round2(Math.max(1, t.fontSize * scale)),
    fontFamily: font.family,
    bold: t.bold,
    italic: t.italic,
    underline: t.underline,
    align: t.align,
    valign: t.valign,
  };
  if (t.confidence !== undefined && t.confidence < LOW_TEXT_CONFIDENCE) {
    const excerpt = t.content.replace(/\s+/g, ' ').slice(0, 60);
    report.add(
      'low-confidence-text',
      `Recognised "${excerpt}" with ${Math.round(t.confidence * 100)}% confidence - check the wording.`,
      ref,
    );
  }
  return { text: t.content, textStyle, preserved, confidence: t.confidence };
}

const AVG_CHAR = { sans: 0.52, serif: 0.5, mono: 0.6 } as const;

/**
 * Width a free text label needs so the canvas's line-wrapping (which uses the
 * same average-character estimate as `canvas/textLayout.ts`) does not break
 * lines the source kept whole.
 */
export function minTextWidth(text: string, style: TextStyle): number {
  const longest = text.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
  return Math.ceil(longest * style.fontSize * (AVG_CHAR[style.fontFamily] ?? 0.52) + 2);
}

export function minTextHeight(text: string, style: TextStyle): number {
  const lines = Math.max(1, text.split('\n').length);
  return Math.ceil(lines * style.fontSize * Math.max(1, style.lineHeight) + 2);
}
