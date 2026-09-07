/**
 * Stable, human-readable identifiers.
 *
 * Ids are the contract between the canvas, the history stack, the saved JSON
 * and the generated LaTeX. They are allocated once, on creation, and never
 * regenerated on state updates - a node created as `n3` stays `n3` for the
 * lifetime of the document so that the emitted TikZ stays diff-stable.
 */

let counters: Record<string, number> = {};

export function resetIdCounters(seed: Record<string, number> = {}) {
  counters = { ...seed };
}

export function nextId(prefix: 'n' | 'e' | 'g' | 'd'): string {
  counters[prefix] = (counters[prefix] ?? 0) + 1;
  return `${prefix}${counters[prefix]}`;
}

/** Re-seed counters after loading a document so new ids never collide. */
export function adoptIds(ids: string[]) {
  for (const id of ids) {
    const m = /^([negd])(\d+)$/.exec(id);
    if (!m) continue;
    const prefix = m[1];
    const num = Number(m[2]);
    if (!Number.isFinite(num)) continue;
    counters[prefix] = Math.max(counters[prefix] ?? 0, num);
  }
}

/** A LaTeX-safe identifier derived from an object id. */
export function latexId(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, '');
}
