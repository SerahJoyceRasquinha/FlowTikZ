import { useCallback, useRef, useState } from 'react';

/**
 * Undo / redo plumbing shared by the editor dialogs (formula, chemistry,
 * molecule, chart builder) and the inline text editor.
 *
 * Every editor keeps its own history while it is open, so Ctrl+Z inside a
 * dialog takes back the last change made in that dialog - never a change on
 * the canvas behind it - and the canvas history is untouched until the
 * dialog applies its result as one step.
 */

export type UndoChord = 'undo' | 'redo';

/**
 * Which history command a key chord asks for, if any.
 *
 *   Ctrl/Cmd + Z           undo
 *   Ctrl/Cmd + Shift + Z   redo
 *   Ctrl/Cmd + Y           redo
 *
 * `code` is consulted as well as `key`, so the chord still works when a
 * non-Latin keyboard layout (Russian, Greek, Hindi...) reports another letter
 * for the physical Z / Y key.
 */
export function undoChord(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): UndoChord | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = (e.key ?? '').toLowerCase();
  const latin = /^[a-z]$/.test(k);
  const isZ = k === 'z' || (!latin && e.code === 'KeyZ');
  const isY = k === 'y' || (!latin && e.code === 'KeyY');
  if (isZ) return e.shiftKey ? 'redo' : 'undo';
  if (isY && !e.shiftKey) return 'redo';
  return null;
}

/**
 * A keydown handler for a dialog: runs `undo` / `redo` for the chords above
 * and swallows the event so neither the browser's own field undo nor the
 * canvas shortcuts act on it. Returns true when it handled the key.
 *
 * Fields that keep text outside the editor's history (a search box, say) can
 * opt out with `data-native-undo`; the browser's own undo then applies there.
 */
export function handleUndoKeys(
  e: React.KeyboardEvent | KeyboardEvent,
  undo: () => void,
  redo: () => void,
): boolean {
  const chord = undoChord(e);
  if (!chord) return false;
  const target = e.target as HTMLElement | null;
  if (target?.closest?.('[data-native-undo]')) return false;
  e.preventDefault();
  e.stopPropagation();
  if (chord === 'undo') undo();
  else redo();
  return true;
}

export interface Undoable<T> {
  value: T;
  /**
   * Replace the value. With `coalesce`, successive calls sharing the same key
   * inside `coalesceMs` become one undo step (typing a word is one step, not
   * one per letter). `record: false` changes the value without a step.
   */
  set: (next: T | ((prev: T) => T), opts?: { coalesce?: string; record?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  /** Start again from `value`, forgetting all history. */
  reset: (value: T) => void;
  canUndo: boolean;
  canRedo: boolean;
}

interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/**
 * State with a private history.
 *
 * The history lives in a ref and is published to React with a plain setState,
 * so the coalescing decision is made exactly once per change - a functional
 * updater would run twice under StrictMode and merge steps it should not.
 */
export function useUndoable<T>(
  initial: T | (() => T),
  options: { limit?: number; coalesceMs?: number } = {},
): Undoable<T> {
  const limit = options.limit ?? 200;
  const coalesceMs = options.coalesceMs ?? 800;
  const [state, setState] = useState<History<T>>(() => ({
    past: [],
    present: typeof initial === 'function' ? (initial as () => T)() : initial,
    future: [],
  }));
  const ref = useRef(state);
  ref.current = state;
  const last = useRef<{ key: string; at: number } | null>(null);

  const publish = useCallback((next: History<T>) => {
    ref.current = next;
    setState(next);
  }, []);

  const set = useCallback<Undoable<T>['set']>(
    (next, opts) => {
      const h = ref.current;
      const value = typeof next === 'function' ? (next as (p: T) => T)(h.present) : next;
      if (Object.is(value, h.present)) return;
      if (opts?.record === false) {
        publish({ ...h, present: value });
        return;
      }
      const now = Date.now();
      const key = opts?.coalesce;
      const merge =
        !!key && last.current?.key === key && now - last.current.at < coalesceMs && h.past.length > 0 && h.future.length === 0;
      last.current = key ? { key, at: now } : null;
      if (merge) {
        publish({ ...h, present: value });
        return;
      }
      publish({ past: [...h.past, h.present].slice(-limit), present: value, future: [] });
    },
    [coalesceMs, limit, publish],
  );

  const undo = useCallback(() => {
    const h = ref.current;
    if (h.past.length === 0) return;
    last.current = null;
    publish({
      past: h.past.slice(0, -1),
      present: h.past[h.past.length - 1],
      future: [h.present, ...h.future].slice(0, limit),
    });
  }, [limit, publish]);

  const redo = useCallback(() => {
    const h = ref.current;
    if (h.future.length === 0) return;
    last.current = null;
    publish({ past: [...h.past, h.present].slice(-limit), present: h.future[0], future: h.future.slice(1) });
  }, [limit, publish]);

  const reset = useCallback(
    (value: T) => {
      last.current = null;
      publish({ past: [], present: value, future: [] });
    },
    [publish],
  );

  return {
    value: state.present,
    set,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
