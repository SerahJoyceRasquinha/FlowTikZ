import { describe, expect, it } from 'vitest';
import { SHORTCUTS, isBrowserZoomChord, zoomIntent } from '../hooks/useKeyboardShortcuts';
import { undoChord } from '../hooks/undo';

const ev = (key: string, code: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods }) as KeyboardEvent;

/**
 * Ctrl/Cmd + "+", "-", "0" are the browser's page zoom. Users expect them to
 * enlarge the whole page on every site, so the app must recognise them in
 * every spelling only in order to leave them alone.
 */
describe('browser zoom chords are recognised (and left to the browser)', () => {
  it('in every spelling of zoom in', () => {
    for (const [k, c] of [['=', 'Equal'], ['+', 'Equal'], ['+', 'NumpadAdd'], ['Add', 'NumpadAdd'], ['+', 'BracketRight'], ['Unidentified', 'Equal']]) {
      expect(isBrowserZoomChord(ev(k, c, { ctrlKey: true }))).toBe(true);
      expect(isBrowserZoomChord(ev(k, c, { metaKey: true }))).toBe(true);
    }
  });
  it('for zoom out and reset', () => {
    for (const [k, c] of [['-', 'Minus'], ['_', 'Minus'], ['-', 'NumpadSubtract'], ['0', 'Digit0'], ['0', 'Numpad0']]) {
      expect(isBrowserZoomChord(ev(k, c, { ctrlKey: true }))).toBe(true);
    }
  });
  it('but not plain keys, Alt chords or other Ctrl shortcuts', () => {
    expect(isBrowserZoomChord(ev('=', 'Equal'))).toBe(false);
    expect(isBrowserZoomChord(ev('=', 'Equal', { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isBrowserZoomChord(ev('z', 'KeyZ', { ctrlKey: true }))).toBe(false);
    expect(isBrowserZoomChord(ev('1', 'Digit1', { ctrlKey: true }))).toBe(false);
  });
});

describe('drawing zoom keys (board focused, no modifier)', () => {
  it('+ / = and - zoom the drawing, on the main keyboard and the numpad', () => {
    expect(zoomIntent(ev('+', 'Equal', { shiftKey: true }))).toBe('in');
    expect(zoomIntent(ev('=', 'Equal'))).toBe('in');
    expect(zoomIntent(ev('+', 'NumpadAdd'))).toBe('in');
    expect(zoomIntent(ev('-', 'Minus'))).toBe('out');
    expect(zoomIntent(ev('-', 'NumpadSubtract'))).toBe('out');
  });
  it('Shift + 0 resets to 100% and Shift + 1 fits, whatever the layout prints', () => {
    expect(zoomIntent(ev(')', 'Digit0', { shiftKey: true }))).toBe('reset');
    expect(zoomIntent(ev('=', 'Digit0', { shiftKey: true }))).toBe('reset'); // German layout
    expect(zoomIntent(ev('!', 'Digit1', { shiftKey: true }))).toBe('fit');
    expect(zoomIntent(ev('0', 'Digit0'))).toBeNull();
    expect(zoomIntent(ev('1', 'Digit1'))).toBeNull();
  });
  it('never with Ctrl, Cmd or Alt held', () => {
    expect(zoomIntent(ev('=', 'Equal', { ctrlKey: true }))).toBeNull();
    expect(zoomIntent(ev('-', 'Minus', { metaKey: true }))).toBeNull();
    expect(zoomIntent(ev('=', 'Equal', { altKey: true }))).toBeNull();
  });
});

describe('undo / redo chords', () => {
  it('Ctrl/Cmd + Z undoes; Ctrl + Y and Ctrl + Shift + Z redo', () => {
    expect(undoChord(ev('z', 'KeyZ', { ctrlKey: true }))).toBe('undo');
    expect(undoChord(ev('z', 'KeyZ', { metaKey: true }))).toBe('undo');
    expect(undoChord(ev('Z', 'KeyZ', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(undoChord(ev('y', 'KeyY', { ctrlKey: true }))).toBe('redo');
    expect(undoChord(ev('Y', 'KeyY', { ctrlKey: true, shiftKey: true }))).toBeNull();
  });
  it('works on non-Latin layouts by the physical key', () => {
    expect(undoChord(ev('я', 'KeyZ', { ctrlKey: true }))).toBe('undo'); // Russian
    expect(undoChord(ev('ζ', 'KeyZ', { ctrlKey: true }))).toBe('undo'); // Greek
    expect(undoChord(ev('н', 'KeyY', { ctrlKey: true }))).toBe('redo');
  });
  it('respects the printed letter on Latin layouts (AZERTY / QWERTZ)', () => {
    // QWERTZ: the key printed Z sits where QWERTY has Y.
    expect(undoChord(ev('z', 'KeyY', { ctrlKey: true }))).toBe('undo');
    expect(undoChord(ev('y', 'KeyZ', { ctrlKey: true }))).toBe('redo');
    // AZERTY: W is printed where QWERTY has Z, so code KeyZ alone is not undo.
    expect(undoChord(ev('w', 'KeyZ', { ctrlKey: true }))).toBeNull();
  });
  it('ignores plain letters and AltGr chords', () => {
    expect(undoChord(ev('z', 'KeyZ'))).toBeNull();
    expect(undoChord(ev('z', 'KeyZ', { ctrlKey: true, altKey: true }))).toBeNull();
  });
});

describe('shortcut reference', () => {
  it('lists no shape letters: shapes are placed from the palette only', () => {
    const singleLetters = SHORTCUTS.filter((s) => /^[A-Z]$/.test(s.keys)).map((s) => s.keys);
    expect(singleLetters.sort()).toEqual(['C', 'H', 'V']);
    expect(SHORTCUTS.some((s) => /A\s*[–-]\s*Z/.test(s.keys))).toBe(false);
  });

  it('documents undo, redo, the browser zoom and the drawing zoom separately', () => {
    const text = SHORTCUTS.map((s) => `${s.group}|${s.keys}`).join('\n');
    expect(text).toContain('Editing|Ctrl/Cmd + Z');
    expect(text).toContain('Editing|Ctrl/Cmd + Y');
    expect(text).toContain('Browser|Ctrl/Cmd + +');
    expect(text).toContain('Browser|Ctrl/Cmd + -');
    expect(text).toContain('Browser|Ctrl/Cmd + 0');
    expect(text).toContain('Canvas & view|+ / -');
    expect(text).toContain('Files|Ctrl/Cmd + O');
  });

  it('has no duplicate key rows', () => {
    const keys = SHORTCUTS.map((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
