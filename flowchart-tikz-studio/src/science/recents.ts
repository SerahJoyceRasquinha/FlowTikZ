import type { SymbolDef } from './math/symbols';

/** Recently and frequently used symbols, per library, kept in localStorage. */

interface Entry extends SymbolDef {
  count: number;
  last: number;
}

const KEY = (library: string) => `flowtikz:symbols:${library}`;
const LIMIT = 60;
let tick = 0;

function read(library: string): Entry[] {
  try {
    const raw = localStorage.getItem(KEY(library));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((e) => typeof e?.tex === 'string') : [];
  } catch {
    return [];
  }
}

export function recordUse(library: string, sym: SymbolDef): void {
  const list = read(library);
  const found = list.find((e) => e.tex === sym.tex);
  const last = Date.now() * 1000 + (tick++ % 1000);
  if (found) {
    found.count += 1;
    found.last = last;
  } else {
    list.push({ ...sym, count: 1, last });
  }
  list.sort((a, b) => b.last - a.last);
  try {
    localStorage.setItem(KEY(library), JSON.stringify(list.slice(0, LIMIT)));
  } catch {
    /* storage may be disabled */
  }
}

export const recentSymbols = (library: string, n = 16): SymbolDef[] => read(library).sort((a, b) => b.last - a.last).slice(0, n);

export const frequentSymbols = (library: string, n = 16): SymbolDef[] =>
  read(library).filter((e) => e.count > 1).sort((a, b) => b.count - a.count || b.last - a.last).slice(0, n);
