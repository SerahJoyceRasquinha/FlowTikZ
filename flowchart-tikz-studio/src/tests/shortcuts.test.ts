import { describe, expect, it } from 'vitest';
import { SHORTCUTS, zoomIntent } from '../hooks/useKeyboardShortcuts';

/**
 * Zoom chords are matched on both `key` and `code`: keyboards disagree about
 * which one carries "+", and checking only one is what made Ctrl + "+" look
 * dead for some users.
 */
const ev = (key: string, code: string, mods: Partial<KeyboardEvent> = { ctrlKey: true }) =>
  ({ key, code, ctrlKey: false, metaKey: false, altKey: false, ...mods }) as KeyboardEvent;

describe('zoom chord recognition', () => {
  it('reads zoom in from every spelling', () => {
    expect(zoomIntent(ev('=', 'Equal'))).toBe('in');
    expect(zoomIntent(ev('+', 'Equal'))).toBe('in');
    expect(zoomIntent(ev('+', 'NumpadAdd'))).toBe('in');
    expect(zoomIntent(ev('Add', 'NumpadAdd'))).toBe('in');
    expect(zoomIntent(ev('+', 'BracketRight'))).toBe('in'); // German layout
    expect(zoomIntent(ev('=', 'Equal', { metaKey: true }))).toBe('in');
  });

  it('reads zoom out, reset and fit', () => {
    expect(zoomIntent(ev('-', 'Minus'))).toBe('out');
    expect(zoomIntent(ev('_', 'Minus'))).toBe('out');
    expect(zoomIntent(ev('-', 'NumpadSubtract'))).toBe('out');
    expect(zoomIntent(ev('0', 'Digit0'))).toBe('reset');
    expect(zoomIntent(ev('0', 'Numpad0'))).toBe('reset');
    expect(zoomIntent(ev('1', 'Digit1'))).toBe('fit');
  });

  it('ignores the same keys without Ctrl/Cmd, or with Alt', () => {
    expect(zoomIntent(ev('=', 'Equal', {}))).toBeNull();
    expect(zoomIntent(ev('-', 'Minus', {}))).toBeNull();
    expect(zoomIntent(ev('=', 'Equal', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(zoomIntent(ev('z', 'KeyZ'))).toBeNull();
  });
});

describe('shortcut reference', () => {
  it('lists no shape letters: shapes are placed from the palette only', () => {
    const singleLetters = SHORTCUTS.filter((s) => /^[A-Z]$/.test(s.keys)).map((s) => s.keys);
    expect(singleLetters.sort()).toEqual(['C', 'H', 'V']);
    expect(SHORTCUTS.some((s) => /A\s*[–-]\s*Z/.test(s.keys))).toBe(false);
  });

  it('documents the zoom chords', () => {
    const text = SHORTCUTS.map((s) => s.keys).join(' ');
    expect(text).toContain('Ctrl/Cmd + +');
    expect(text).toContain('Ctrl/Cmd + -');
    expect(text).toContain('Ctrl/Cmd + 0');
  });
});
