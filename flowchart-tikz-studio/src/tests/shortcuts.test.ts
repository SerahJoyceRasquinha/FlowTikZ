import { describe, expect, it } from 'vitest';
import {
  RESERVED_TOOL_KEYS,
  SHAPE_SHORTCUTS,
  shapeForKey,
  shapeShortcutRows,
  shortcutAria,
  shortcutForShape,
  shortcutLabel,
  shortcutSpoken,
} from '../model/shortcuts';
import { SHAPE_LIST } from '../model/shapes';

/**
 * The palette badge, the accessible label, the help table and the key handler
 * all read one map. These tests are what make that claim enforceable: they
 * fail the moment a symbol is added without a binding, two symbols claim the
 * same chord, or a chord collides with a tool key.
 */

describe('shape shortcut table', () => {
  it('binds every shape in the registry, and nothing that is not one', () => {
    const kinds = new Set(SHAPE_LIST.map((d) => d.id));
    for (const def of SHAPE_LIST) {
      expect(
        shortcutForShape(def.id),
        `shape "${def.id}" has no keyboard binding`,
      ).toBeTruthy();
    }
    for (const s of SHAPE_SHORTCUTS) {
      expect(kinds.has(s.kind), `binding for unknown shape "${s.kind}"`).toBe(true);
    }
    expect(SHAPE_SHORTCUTS).toHaveLength(SHAPE_LIST.length);
  });

  it('gives every shape a distinct chord', () => {
    const seen = new Map<string, string>();
    for (const s of SHAPE_SHORTCUTS) {
      const chord = `${s.shift ? 'shift+' : ''}${s.letter}`;
      expect(
        seen.has(chord),
        `${s.kind} and ${seen.get(chord)} both claim ${chord}`,
      ).toBe(false);
      seen.set(chord, s.kind);
    }
  });

  it('never claims a letter the tools already own', () => {
    for (const s of SHAPE_SHORTCUTS) {
      if (s.shift) continue; // Shift+V does not collide with V.
      expect(
        RESERVED_TOOL_KEYS[s.letter.toLowerCase()],
        `${s.kind} claims the reserved tool key ${s.letter}`,
      ).toBeUndefined();
    }
  });

  it('uses only single letters A-Z', () => {
    for (const s of SHAPE_SHORTCUTS) {
      expect(s.letter).toMatch(/^[A-Z]$/);
    }
  });
});

describe('resolving a keystroke', () => {
  it('accepts upper and lower case as the same key', () => {
    expect(shapeForKey('r', false)?.kind).toBe('rectangle');
    // Caps Lock: the key is "R" but shift is not held.
    expect(shapeForKey('R', false)?.kind).toBe('rectangle');
  });

  it('keeps the shift tier separate from the plain tier', () => {
    expect(shapeForKey('m', false)?.kind).toBe('manual-input');
    expect(shapeForKey('M', true)?.kind).toBe('manual-operation');
    expect(shapeForKey('m', true)?.kind).toBe('manual-operation');
  });

  it('resolves one shape per bound chord, round trip', () => {
    for (const s of SHAPE_SHORTCUTS) {
      expect(shapeForKey(s.letter, s.shift)?.kind).toBe(s.kind);
      expect(shapeForKey(s.letter.toLowerCase(), s.shift)?.kind).toBe(s.kind);
    }
  });

  it('ignores keys that are not letters', () => {
    for (const key of ['Enter', 'Escape', 'ArrowUp', '1', '?', '-', ' ', 'F2']) {
      expect(shapeForKey(key, false)).toBeUndefined();
      expect(shapeForKey(key, true)).toBeUndefined();
    }
  });

  it('leaves the tool letters unclaimed', () => {
    for (const letter of Object.keys(RESERVED_TOOL_KEYS)) {
      expect(shapeForKey(letter, false)).toBeUndefined();
    }
  });
});

describe('how a binding is displayed', () => {
  it('renders a plain letter bare and a shift chord with the shift glyph', () => {
    const rect = shortcutForShape('rectangle')!;
    const manualOp = shortcutForShape('manual-operation')!;
    expect(shortcutLabel(rect)).toBe('R');
    expect(shortcutLabel(manualOp)).toBe('⇧M');
    expect(shortcutSpoken(rect)).toBe('R');
    expect(shortcutSpoken(manualOp)).toBe('Shift + M');
    expect(shortcutAria(rect)).toBe('R');
    expect(shortcutAria(manualOp)).toBe('Shift+M');
  });

  it('lists every registry shape for the help dialog, in palette order', () => {
    const rows = shapeShortcutRows();
    expect(rows.map((r) => r.kind)).toEqual(SHAPE_LIST.map((d) => d.id));
    expect(rows.every((r) => r.shortcut)).toBe(true);
    // The label shown is the registry's, so the two can never disagree.
    expect(rows[0].label).toBe(SHAPE_LIST[0].label);
  });
});
