import { SHAPE_LIST } from './shapes';

/**
 * Keyboard letters for the shape registry.
 *
 * This file is the single source of truth. The palette badge, the accessible
 * label, the help dialog and the key handler all read the same table, so the
 * letter a user sees and the letter that works cannot drift apart. There is a
 * test that fails if a shape is missing a binding, if two shapes claim the
 * same chord, or if a chord collides with a reserved tool key.
 *
 * Two tiers, because there are 29 symbols and only 26 letters - and three of
 * those are already spoken for by the tools:
 *
 *   tier 1   `R`          plain letter
 *   tier 2   `Shift + R`  for the rarer member of a related pair
 *
 * Shift pairs are always mnemonically tied to their plain partner (manual
 * input / manual operation, document / multiple documents, ...) so the second
 * tier is guessable rather than arbitrary.
 */

/** Single letters owned by the tools; no shape may claim one. */
export const RESERVED_TOOL_KEYS: Record<string, string> = {
  v: 'Select tool',
  h: 'Pan tool',
  c: 'Connect tool',
};

export interface ShapeShortcut {
  /** Shape registry key. */
  kind: string;
  /** Upper-case letter, e.g. "R". */
  letter: string;
  /** True when the binding is Shift + letter. */
  shift: boolean;
}

/**
 * kind -> binding. Order follows the palette so the table reads like the UI.
 */
const BINDINGS: [kind: string, chord: string][] = [
  /* Flow */
  ['terminator', 'S'],
  ['process', 'P'],
  ['decision', 'D'],
  ['io', 'I'],
  ['predefined', 'F'],
  ['preparation', 'X'],
  ['manual-input', 'M'],
  ['manual-operation', 'Shift+M'],
  ['delay', 'Y'],
  ['display', 'L'],
  ['connector', 'O'],
  ['offpage', 'Shift+O'],
  ['merge', 'U'],
  ['extract', 'Shift+U'],
  ['or', 'Q'],
  ['summing-junction', 'Shift+Q'],
  /* Documents */
  ['document', 'W'],
  ['multi-document', 'Shift+W'],
  /* Data */
  ['database', 'B'],
  ['stored-data', 'A'],
  ['internal-storage', 'Z'],
  ['direct-access-storage', 'Shift+Z'],
  ['card', 'K'],
  /* Extended */
  ['loop-limit', 'J'],
  /* Basic */
  ['rectangle', 'R'],
  ['ellipse', 'E'],
  /* Annotation */
  ['text', 'T'],
  ['note', 'N'],
  ['annotation', 'G'],
];

function parse(kind: string, chord: string): ShapeShortcut {
  const shift = chord.startsWith('Shift+');
  const letter = (shift ? chord.slice('Shift+'.length) : chord).toUpperCase();
  return { kind, letter, shift };
}

export const SHAPE_SHORTCUTS: ShapeShortcut[] = BINDINGS.map(([k, c]) =>
  parse(k, c),
);

const BY_KIND = new Map<string, ShapeShortcut>(
  SHAPE_SHORTCUTS.map((s) => [s.kind, s]),
);

/** Lookup key for a keyboard event: "shift+r" or "r". */
function chordKey(letter: string, shift: boolean): string {
  return `${shift ? 'shift+' : ''}${letter.toLowerCase()}`;
}

const BY_CHORD = new Map<string, ShapeShortcut>(
  SHAPE_SHORTCUTS.map((s) => [chordKey(s.letter, s.shift), s]),
);

/** The binding for a shape, or undefined if it has none. */
export function shortcutForShape(kind: string): ShapeShortcut | undefined {
  return BY_KIND.get(kind);
}

/**
 * The shape a keystroke selects, or undefined.
 * Case-insensitive by construction: only the letter and the shift flag are
 * consulted, so `r` and `R` (shift held) resolve the same way.
 */
export function shapeForKey(
  key: string,
  shiftKey: boolean,
): ShapeShortcut | undefined {
  if (key.length !== 1) return undefined;
  const letter = key.toLowerCase();
  if (letter < 'a' || letter > 'z') return undefined;
  return BY_CHORD.get(chordKey(letter, shiftKey));
}

/** Display form for badges and the help dialog: "R" or "⇧R". */
export function shortcutLabel(s: ShapeShortcut): string {
  return s.shift ? `⇧${s.letter}` : s.letter;
}

/** Spoken form for aria-label / title: "R" or "Shift + R". */
export function shortcutSpoken(s: ShapeShortcut): string {
  return s.shift ? `Shift + ${s.letter}` : s.letter;
}

/** Value for the `aria-keyshortcuts` attribute. */
export function shortcutAria(s: ShapeShortcut): string {
  return s.shift ? `Shift+${s.letter}` : s.letter;
}

/** Every shape, paired with its binding, in palette order. Used by the help dialog. */
export function shapeShortcutRows(): {
  kind: string;
  label: string;
  category: string;
  shortcut: ShapeShortcut | undefined;
}[] {
  return SHAPE_LIST.map((def) => ({
    kind: def.id,
    label: def.label,
    category: def.category,
    shortcut: shortcutForShape(def.id),
  }));
}
