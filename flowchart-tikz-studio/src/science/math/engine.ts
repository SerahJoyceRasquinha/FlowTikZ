import { useEffect, useSyncExternalStore } from 'react';
import { normalizeChemSource, validateTex } from './validate';
import type { NaturalSize } from '../types';

/**
 * Typesetting front end: a lazy loader and a bounded cache.
 *
 * The engine arrives as its own chunk. Until it has, `renderTex` returns null
 * and views draw a quiet placeholder, so the canvas is never blocked by it.
 * The same engine runs in the browser and under the test runner.
 */

export interface TexRender {
  ok: boolean;
  error?: string;
  /** Inner SVG markup (paths), in the coordinates of `viewBox`. */
  markup: string;
  viewBox: [number, number, number, number];
  /** Natural size in ems. */
  natural: NaturalSize;
}

type Core = typeof import('./mathjaxCore');

let core: Core | null = null;
let pending: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();

export function loadEngine(): Promise<void> {
  if (core) return Promise.resolve();
  if (!pending) {
    pending = import('./mathjaxCore').then((m) => {
      core = m;
      version++;
      listeners.forEach((l) => l());
    });
  }
  return pending;
}

export function isEngineReady(): boolean {
  return core !== null;
}

const CACHE_LIMIT = 1500;
const cache = new Map<string, TexRender>();

function failed(error: string): TexRender {
  return { ok: false, error, markup: '', viewBox: [0, 0, 1000, 1000], natural: { w: 1, h: 1 } };
}

/** Typeset, or null when the engine has not arrived yet. */
export function renderTex(tex: string, display = true): TexRender | null {
  if (!core) return null;
  const key = `${display ? 'D' : 'I'}${tex}`;
  const hit = cache.get(key);
  if (hit) {
    // Refresh recency: Map iteration order is insertion order.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const invalid = validateTex(tex);
  let out: TexRender;
  if (invalid) {
    out = failed(invalid);
  } else {
    try {
      const raw = core.typeset(tex, display);
      out = {
        ok: true,
        markup: raw.inner,
        viewBox: raw.viewBox,
        natural: { w: raw.viewBox[2] / 1000, h: raw.viewBox[3] / 1000 },
      };
    } catch (err) {
      const message = (err as { message?: string })?.message ?? String(err);
      out = failed(message);
    }
  }
  cache.set(key, out);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return out;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Re-renders the caller when the engine arrives, and starts loading it. */
export function useEngineVersion(): number {
  const v = useSyncExternalStore(subscribe, () => version, () => version);
  useEffect(() => {
    void loadEngine();
  }, []);
  return v;
}

/** The TeX a chemistry source is typeset from. */
export function chemTex(source: string): string {
  return `\\ce{${normalizeChemSource(source)}}`;
}
