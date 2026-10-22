import { useEffect, useRef } from 'react';
import { useEditor } from '../state/store';
import { serialize } from '../persistence/schema';
import { downloadText, slugify } from '../export/file';
import { shapeForKey } from '../model/shortcuts';

export const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: 'V', description: 'Select tool' },
  { keys: 'H', description: 'Pan tool (or hold Alt while dragging)' },
  { keys: 'C', description: 'Connect tool' },
  { keys: 'A – Z', description: 'Arm a shape — see the symbol list below' },
  { keys: 'Ctrl/Cmd + Z', description: 'Undo' },
  { keys: 'Ctrl/Cmd + Y', description: 'Redo' },
  { keys: 'Ctrl/Cmd + Shift + Z', description: 'Redo' },
  { keys: 'Ctrl/Cmd + C', description: 'Copy selection' },
  { keys: 'Ctrl/Cmd + X', description: 'Cut selection' },
  { keys: 'Ctrl/Cmd + V', description: 'Paste' },
  { keys: 'Ctrl/Cmd + D', description: 'Duplicate' },
  { keys: 'Ctrl/Cmd + A', description: 'Select all' },
  { keys: 'Ctrl/Cmd + S', description: 'Save diagram JSON' },
  { keys: 'Ctrl/Cmd + G', description: 'Group' },
  { keys: 'Ctrl/Cmd + Shift + G', description: 'Ungroup' },
  { keys: 'Delete / Backspace', description: 'Delete selection' },
  { keys: 'Arrow keys', description: 'Nudge by one grid step' },
  { keys: 'Shift + Arrow keys', description: 'Nudge by ten units' },
  { keys: 'Enter / F2', description: 'Edit text of the selected shape' },
  { keys: 'Ctrl/Cmd + = / -', description: 'Zoom in / out' },
  { keys: 'Ctrl/Cmd + 0', description: 'Reset zoom to 100%' },
  { keys: 'Ctrl/Cmd + 1', description: 'Fit diagram to the canvas' },
  { keys: 'Escape', description: 'Cancel the current operation' },
  { keys: '?', description: 'Show this list' },
];

/** Tool letters. Single source of truth for the reserved set in `shortcuts.ts`. */
const TOOL_KEYS: Record<string, 'select' | 'pan' | 'connect'> = {
  v: 'select',
  h: 'pan',
  c: 'connect',
};

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable === true
  );
}

/**
 * Whether a bare letter should act on the drawing board.
 *
 * Letters are the one class of shortcut that belongs to a *place*: `R` means
 * "rectangle" over the canvas and means nothing at all while the caret is in
 * the LaTeX search box or on a palette button. The board therefore has to own
 * focus - with one deliberate exception. When nothing is focused at all (the
 * page has just loaded, or a dialog has closed and handed focus back to the
 * body) the board is the only thing a letter could sensibly mean, so it still
 * works. Everything else - any input, any button, any other panel - declines.
 */
export function canvasKeysAllowed(
  doc: Document = typeof document === 'undefined'
    ? (undefined as unknown as Document)
    : document,
): boolean {
  if (!doc) return false;
  const active = doc.activeElement as HTMLElement | null;
  if (!active || active === doc.body || active === doc.documentElement) return true;
  if (isTypingTarget(active)) return false;
  const board = doc.querySelector('.canvas-shell');
  return !!board && board.contains(active);
}

/** Global shortcuts. Ignored while typing into a field. */
export function useKeyboardShortcuts(opts: {
  onShowHelp: () => void;
  canvasSize: { width: number; height: number };
}) {
  /*
   * The options object is a fresh literal on every render of the caller, so
   * depending on it directly tore the window listener down and added it back
   * on every keystroke, selection change and pointer move. The handler is
   * registered once and reads the current options through a ref instead.
   */
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (isTypingTarget(target)) return;
      // While a modal dialog (import choice, import report) is open, the
      // canvas underneath must not react to Delete, arrows or letters.
      if (typeof document !== 'undefined' && document.querySelector('.modal[aria-modal="true"].import-dialog, .modal[aria-modal="true"].import-report')) return;

      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;

      if (mod) {
        switch (key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) s.redo();
            else s.undo();
            return;
          case 'y':
            e.preventDefault();
            s.redo();
            return;
          case 'c':
            s.copySelection();
            return;
          case 'x':
            e.preventDefault();
            s.cutSelection();
            return;
          case 'v':
            e.preventDefault();
            s.paste();
            return;
          case 'd':
            e.preventDefault();
            s.duplicateSelection();
            return;
          case 'a':
            e.preventDefault();
            s.selectAll();
            return;
          case 's':
            e.preventDefault();
            downloadText(
              serialize(s.doc),
              `${slugify(s.doc.name)}.json`,
              'application/json',
            );
            s.markSaved();
            s.setStatus('Diagram saved as JSON.');
            return;
          case 'g':
            e.preventDefault();
            if (e.shiftKey) s.ungroup();
            else s.group();
            return;
          case '0':
            e.preventDefault();
            s.resetZoom();
            return;
          case '1':
            e.preventDefault();
            s.fitToView(optsRef.current.canvasSize);
            return;
          case '=':
          case '+':
            e.preventDefault();
            s.zoomBy(1.2);
            return;
          case '-':
            e.preventDefault();
            s.zoomBy(1 / 1.2);
            return;
          default:
            return;
        }
      }

      switch (key) {
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          s.deleteSelection();
          return;
        case 'Escape':
          s.armShape(null);
          s.setTool('select');
          s.setDraft(null);
          s.setEditingNode(null);
          s.clearSelection();
          return;
        case 'Enter':
        case 'F2': {
          const id = s.selection.find((i) => s.doc.nodes[i]);
          if (id) {
            e.preventDefault();
            s.setEditingNode(id);
          }
          return;
        }
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (s.selection.length === 0) return;
          e.preventDefault();
          const step = e.shiftKey ? 10 : s.doc.settings.gridSize || 1;
          const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
          const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
          s.beginInteraction();
          s.moveSelection(dx, dy, false);
          s.endInteraction();
          return;
        }
        case '?':
          optsRef.current.onShowHelp();
          return;
        default:
          break;
      }

      /* ---------------------------------------- canvas letters, scoped */
      // Held-down keys repeat; arming the same tool twenty times a second is
      // pointless at best, so only the first event of a press counts.
      if (e.repeat) return;
      // Alt+letter belongs to the browser and the window manager.
      if (e.altKey) return;
      if (!canvasKeysAllowed()) return;

      const tool = TOOL_KEYS[key.toLowerCase()];
      if (tool) {
        e.preventDefault();
        s.setTool(tool);
        return;
      }

      const shape = shapeForKey(key, e.shiftKey);
      if (shape) {
        e.preventDefault();
        // Exactly what clicking the palette button does, toggle included.
        s.armShape(s.pendingShape === shape.kind ? null : shape.kind);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
