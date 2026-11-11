/**
 * Colour themes for charts.
 *
 * Every colour is a plain hex value, so the canvas and the generated
 * `\definecolor{..}{HTML}{..}` lines use literally the same numbers.
 */

export interface ChartPalette {
  id: string;
  label: string;
  colors: string[];
}

export const CHART_PALETTES: ChartPalette[] = [
  {
    id: 'classic',
    label: 'Classic (Tableau-like)',
    colors: ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'],
  },
  {
    id: 'office',
    label: 'Office (Power BI-like)',
    colors: ['#118dff', '#12239e', '#e66c37', '#6b007b', '#e044a7', '#744ec2', '#d9b300', '#d64550', '#197278', '#1aab40'],
  },
  {
    id: 'teal',
    label: 'Teal and amber',
    colors: ['#0f9b8e', '#e8a33d', '#2f6feb', '#c65b3c', '#5a4bd6', '#6b8f3a', '#7c8a9b', '#c0392b', '#3a4654', '#d4a017'],
  },
  {
    id: 'pastel',
    label: 'Pastel',
    colors: ['#8dd3c7', '#fdb462', '#bebada', '#fb8072', '#80b1d3', '#b3de69', '#fccde5', '#ffffb3', '#bc80bd', '#ccebc5'],
  },
  {
    id: 'blues',
    label: 'Shades of blue',
    colors: ['#08306b', '#08519c', '#2171b5', '#4292c6', '#6baed6', '#9ecae1', '#c6dbef', '#3f5f8a', '#1c3d6b', '#5d84b5'],
  },
  {
    id: 'viridis',
    label: 'Viridis (colour-blind safe)',
    colors: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725', '#355f8d', '#1f988b', '#a5db36', '#482475'],
  },
  {
    id: 'grey',
    label: 'Greyscale (print)',
    colors: ['#252525', '#636363', '#969696', '#bdbdbd', '#d9d9d9', '#404040', '#7f7f7f', '#a6a6a6', '#cccccc', '#525252'],
  },
];

export function getPalette(id: string): ChartPalette {
  return CHART_PALETTES.find((p) => p.id === id) ?? CHART_PALETTES[0];
}

/** Colour of the i-th series, honouring a per-series override. */
export function seriesColor(
  paletteId: string,
  overrides: Record<string, string>,
  name: string,
  index: number,
): string {
  const o = overrides[name];
  if (o && /^#[0-9a-fA-F]{6}$/.test(o)) return o.toLowerCase();
  const p = getPalette(paletteId).colors;
  return p[((index % p.length) + p.length) % p.length];
}

/** Relative luminance, for choosing black or white text on a fill. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 1;
  const ch = (s: string) => {
    const c = parseInt(s, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(m[1]) + 0.7152 * ch(m[2]) + 0.0722 * ch(m[3]);
}

export function contrastText(fill: string): string {
  return luminance(fill) > 0.4 ? '#1a1a1a' : '#ffffff';
}

/** A darker shade of a colour, used for bar outlines. */
export function darken(hex: string, amount = 0.35): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#333333';
  const f = (s: string) =>
    Math.max(0, Math.min(255, Math.round(parseInt(s, 16) * (1 - amount))))
      .toString(16)
      .padStart(2, '0');
  return `#${f(m[1])}${f(m[2])}${f(m[3])}`;
}
