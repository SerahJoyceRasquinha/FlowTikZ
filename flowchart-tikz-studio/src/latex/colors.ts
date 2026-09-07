/**
 * Colour registry.
 *
 * Every colour used anywhere in the diagram is funnelled through one registry
 * so that a colour shared by twenty shapes produces exactly one
 * `\definecolor` line. Names are derived from the hex value, which makes the
 * output stable: reordering shapes never reshuffles colour names.
 */

export interface ColorDefinition {
  name: string;
  hex: string; // uppercase RRGGBB, no '#'
  /** True for colours already provided by xcolor - no definition emitted. */
  builtin: boolean;
}

/** xcolor's base names we can use verbatim, avoiding pointless definitions. */
const BUILTIN: Record<string, string> = {
  '000000': 'black',
  FFFFFF: 'white',
  FF0000: 'red',
  '00FF00': 'green',
  '0000FF': 'blue',
  '00FFFF': 'cyan',
  FF00FF: 'magenta',
  FFFF00: 'yellow',
};

export function normalizeHex(input: string): string | null {
  if (!input) return null;
  let s = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    s = s
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return s.toUpperCase();
}

export class ColorRegistry {
  private map = new Map<string, ColorDefinition>();

  /**
   * Register a colour and return the LaTeX name to use.
   * Unparseable input falls back to black and is reported by the caller.
   */
  use(input: string): string {
    const hex = normalizeHex(input);
    if (!hex) return 'black';
    const existing = this.map.get(hex);
    if (existing) return existing.name;
    const builtin = BUILTIN[hex];
    const def: ColorDefinition = {
      name: builtin ?? `fc${hex}`,
      hex,
      builtin: !!builtin,
    };
    this.map.set(hex, def);
    return def.name;
  }

  /** Definitions that need emitting, sorted for deterministic output. */
  definitions(): ColorDefinition[] {
    return [...this.map.values()]
      .filter((d) => !d.builtin)
      .sort((a, b) => a.hex.localeCompare(b.hex));
  }

  render(): string[] {
    return this.definitions().map(
      (d) => `\\definecolor{${d.name}}{HTML}{${d.hex}}`,
    );
  }

  get size(): number {
    return this.map.size;
  }
}

/** Human-readable palette offered by the colour picker. */
export const PALETTE: { name: string; hex: string }[] = [
  { name: 'White', hex: '#ffffff' },
  { name: 'Paper', hex: '#f7f9fb' },
  { name: 'Mist', hex: '#e6edf4' },
  { name: 'Steel', hex: '#c3d0de' },
  { name: 'Slate', hex: '#7c8a9b' },
  { name: 'Graphite', hex: '#3a4654' },
  { name: 'Ink', hex: '#12161c' },
  { name: 'Black', hex: '#000000' },
  { name: 'Teal', hex: '#0f9b8e' },
  { name: 'Mint', hex: '#d4f0ea' },
  { name: 'Blue', hex: '#2f6feb' },
  { name: 'Sky', hex: '#dbe8ff' },
  { name: 'Indigo', hex: '#5a4bd6' },
  { name: 'Violet', hex: '#e6e0ff' },
  { name: 'Amber', hex: '#e8a33d' },
  { name: 'Sand', hex: '#fdeecd' },
  { name: 'Rust', hex: '#c65b3c' },
  { name: 'Blush', hex: '#fadfd8' },
  { name: 'Crimson', hex: '#c0392b' },
  { name: 'Olive', hex: '#6b8f3a' },
];
