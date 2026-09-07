import type { Diagram } from '../model/types';
import { deserialize, serialize } from './schema';

/**
 * Crash/refresh recovery.
 *
 * The current document is mirrored to localStorage on a short debounce so an
 * accidental reload does not lose work. Only diagram geometry and styling is
 * stored - there are no credentials or user data in the payload.
 */

const KEY = 'flowchart-tikz-studio:autosave';
const DEBOUNCE_MS = 700;

let timer: ReturnType<typeof setTimeout> | null = null;

export function scheduleAutosave(d: Diagram) {
  if (typeof localStorage === 'undefined') return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, serialize(d));
    } catch {
      // Quota exceeded or storage disabled: autosave is best-effort.
    }
  }, DEBOUNCE_MS);
}

export function readAutosave(): { diagram: Diagram; savedAt?: string } | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const { diagram } = deserialize(raw);
    const savedAt = JSON.parse(raw)?.savedAt;
    if (diagram.order.length === 0) return null;
    return { diagram, savedAt };
  } catch {
    return null;
  }
}

export function clearAutosave() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEY);
}
