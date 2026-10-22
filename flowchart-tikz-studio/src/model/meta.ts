import type { ImportMeta, MetaValue, NormalizedSeg, ObjectMeta, Point } from './types';

/**
 * Defensive readers for the optional, import-related parts of the model.
 *
 * Save files and import results are untrusted input. These functions accept
 * anything and return either a well-formed value or `undefined`, so a
 * hand-edited file can never smuggle a non-finite coordinate into the
 * renderer or an unbounded blob into autosave.
 */

const MAX_PATH_SEGS = 4000;
const MAX_PRESERVED_KEYS = 80;
const MAX_META_STRING = 4000;
const MAX_NOTES = 20;
/** Normalised coordinates may overshoot the box a little (curve controls). */
const PATH_LIMIT = 50;

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function readPoint(raw: unknown): Point | null {
  if (!raw || typeof raw !== 'object') return null;
  const { x, y } = raw as { x?: unknown; y?: unknown };
  if (!finite(x) || !finite(y)) return null;
  if (Math.abs(x) > PATH_LIMIT || Math.abs(y) > PATH_LIMIT) return null;
  return { x, y };
}

/** A normalised outline, or undefined if the input is not a usable one. */
export function coercePath(raw: unknown): NormalizedSeg[] | undefined {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_PATH_SEGS) return undefined;
  const out: NormalizedSeg[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') return undefined;
    const c = (s as { c?: unknown }).c;
    if (c === 'Z') {
      out.push({ c: 'Z' });
    } else if (c === 'M' || c === 'L') {
      const p = readPoint((s as { p?: unknown }).p);
      if (!p) return undefined;
      out.push({ c, p });
    } else if (c === 'C') {
      const seg = s as { c1?: unknown; c2?: unknown; p?: unknown };
      const c1 = readPoint(seg.c1);
      const c2 = readPoint(seg.c2);
      const p = readPoint(seg.p);
      if (!c1 || !c2 || !p) return undefined;
      out.push({ c: 'C', c1, c2, p });
    } else {
      return undefined;
    }
  }
  if (out[0].c !== 'M') return undefined;
  return out;
}

function readScalar(v: unknown): MetaValue | undefined {
  if (typeof v === 'boolean') return v;
  if (finite(v)) return v;
  if (typeof v === 'string') return v.slice(0, MAX_META_STRING);
  return undefined;
}

function readImportMeta(raw: unknown): ImportMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.format !== 'string') return undefined;
  const out: ImportMeta = { format: r.format.slice(0, 40) };
  if (typeof r.sourceId === 'string') out.sourceId = r.sourceId.slice(0, 200);
  if (finite(r.confidence)) out.confidence = Math.min(1, Math.max(0, r.confidence));
  if (r.preserved && typeof r.preserved === 'object') {
    const preserved: Record<string, MetaValue> = {};
    let count = 0;
    for (const [k, v] of Object.entries(r.preserved as Record<string, unknown>)) {
      if (count >= MAX_PRESERVED_KEYS) break;
      const value = readScalar(v);
      if (value === undefined) continue;
      preserved[k.slice(0, 80)] = value;
      count++;
    }
    if (count) out.preserved = preserved;
  }
  if (Array.isArray(r.notes)) {
    const notes = r.notes
      .filter((n): n is string => typeof n === 'string')
      .slice(0, MAX_NOTES)
      .map((n) => n.slice(0, 400));
    if (notes.length) out.notes = notes;
  }
  return out;
}

/** Object metadata, or undefined when absent or unreadable. */
export function coerceMeta(raw: unknown): ObjectMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const imp = readImportMeta((raw as { import?: unknown }).import);
  return imp ? { import: imp } : undefined;
}

/**
 * True for the "transparent" export background. An empty value keeps its old
 * meaning (white paper), so documents saved before this option existed export
 * exactly as they always did.
 */
export function isTransparentBackground(bg: string | undefined): boolean {
  return bg === 'none' || bg === 'transparent';
}
