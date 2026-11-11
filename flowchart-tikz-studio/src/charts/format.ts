import type { ChartStyle } from './types';

/**
 * Number formatting for ticks, data labels and pie labels.
 *
 * Both the canvas and the LaTeX output print the strings produced here, so a
 * label reads "50,000" in both places, never "50000" in one and "5·10^4"
 * in the other.
 */

/** Decimal places needed to show `step` exactly (0 .. 6). */
export function decimalsForStep(step: number): number {
  for (let d = 0; d <= 6; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6 * Math.max(1, Math.abs(scaled))) return d;
  }
  return 6;
}

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export interface NumberFormat {
  decimals: number | null;
  thousands: boolean;
  compact: boolean;
  prefix: string;
  suffix: string;
}

export function formatOf(style: Pick<ChartStyle, 'decimals' | 'thousands' | 'compact' | 'prefix' | 'suffix'>): NumberFormat {
  return {
    decimals: style.decimals,
    thousands: style.thousands,
    compact: style.compact,
    prefix: style.prefix,
    suffix: style.suffix,
  };
}

/**
 * Format a number.
 * `fallbackDecimals` applies when the format says "automatic": ticks pass the
 * precision of their step, data labels pass 2 and trailing zeros are dropped.
 */
export function formatNumber(v: number, f: NumberFormat, fallbackDecimals = 2, trimZeros = true): string {
  if (!Number.isFinite(v)) return '';
  let value = v;
  let unit = '';
  if (f.compact) {
    const a = Math.abs(v);
    if (a >= 1e9) {
      value = v / 1e9;
      unit = 'B';
    } else if (a >= 1e6) {
      value = v / 1e6;
      unit = 'M';
    } else if (a >= 1e3) {
      value = v / 1e3;
      unit = 'K';
    }
  }
  const auto = f.decimals === null;
  let d = auto ? fallbackDecimals : Math.max(0, Math.min(6, f.decimals!));
  if (auto && unit) d = Math.max(d, 1);
  let s = Math.abs(value).toFixed(d);
  if (auto && trimZeros && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  let [ip, fp] = s.split('.');
  if (f.thousands) ip = groupThousands(ip);
  s = fp !== undefined ? `${ip}.${fp}` : ip;
  const negative = value < 0 && Number(s.replace(/,/g, '')) !== 0;
  return `${negative ? '-' : ''}${f.prefix}${s}${unit}${f.suffix}`;
}
