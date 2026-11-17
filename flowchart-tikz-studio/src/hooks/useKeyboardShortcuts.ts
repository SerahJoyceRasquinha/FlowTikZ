import { openScienceEditor } from '../science/editing';
import { undoChord } from './undo';
import { useProject } from '../state/projectStore';
import { useEffect, useRef } from 'react';
import { useEditor } from '../state/store';
import { useTour } from '../state/tourStore';
import { serialize } from '../persistence/schema';
import { downloadText, slugify } from '../export/file';

export interface ShortcutRow {
  keys: string;
  description: string;
  /** Section in the Help dialog. */
  group: 'Editing' | 'Canvas & view' | 'Tools' | 'Files' | 'In the editors' | 'Browser';
}

export const SHORTCUTS: ShortcutRow[] = [
  { group: 'Editing', keys: 'Ctrl/Cmd + Z', description: 'Undo — on the canvas, in the property panel, while typing in a shape, and inside every editor (formula, chemistry, molecule, chart)' },
  { group: 'Editing', keys: 'Ctrl/Cmd + Y', description: 'Redo' },
  { group: 'Editing', keys: 'Ctrl/Cmd + Shift + Z', description: 'Redo (alternative)' },
  { group: 'Editing', keys: 'Ctrl/Cmd + C', description: 'Copy selection' },
  { group: 'Editing', keys: 'Ctrl/Cmd + X', description: 'Cut selection' },
  { group: 'Editing', keys: 'Ctrl/Cmd + V', description: 'Paste' },
  { group: 'Editing', keys: 'Ctrl/Cmd + D', description: 'Duplicate' },
  { group: 'Editing', keys: 'Ctrl/Cmd + A', description: 'Select all' },
  { group: 'Editing', keys: 'Ctrl/Cmd + G', description: 'Group' },
  { group: 'Editing', keys: 'Ctrl/Cmd + Shift + G', description: 'Ungroup' },
  { group: 'Editing', keys: 'Ctrl/Cmd + ]', description: 'Bring forward (add Shift: bring to front)' },
  { group: 'Editing', keys: 'Ctrl/Cmd + [', description: 'Send backward (add Shift: send to back)' },
  { group: 'Editing', keys: 'Delete / Backspace', description: 'Delete selection' },
  { group: 'Editing', keys: 'Arrow keys', description: 'Nudge by one grid step' },
  { group: 'Editing', keys: 'Shift + Arrow keys', description: 'Nudge by ten units' },
  { group: 'Editing', keys: 'Enter / F2', description: 'Edit the selected object (text, chart settings, formula or molecule)' },
  { group: 'Editing', keys: 'R / Shift + R', description: 'Turn a circuit or physics part by 90 degrees' },
  { group: 'Editing', keys: 'Escape', description: 'Cancel the current operation, close a dialog' },
  { group: 'Tools', keys: 'V', description: 'Select tool' },
  { group: 'Tools', keys: 'H', description: 'Pan tool' },
  { group: 'Tools', keys: 'C', description: 'Connect tool' },
  { group: 'Canvas & view', keys: 'Space + drag', description: 'Pan the canvas with any tool (also Alt + drag, or the middle mouse button)' },
  { group: 'Canvas & view', keys: '+ / -', description: 'Zoom the drawing in / out (canvas focused)' },
  { group: 'Canvas & view', keys: 'Shift + 0', description: 'Drawing zoom back to 100%' },
  { group: 'Canvas & view', keys: 'Shift + 1', description: 'Fit the diagram to the canvas' },
  { group: 'Canvas & view', keys: 'Ctrl/Cmd + mouse wheel', description: 'Zoom the drawing at the pointer (pinch on a trackpad)' },
  { group: 'Canvas & view', keys: 'Mouse wheel / Shift + wheel', description: 'Scroll the canvas up-down / left-right' },
  { group: 'Files', keys: 'Ctrl/Cmd + S', description: 'Save diagram JSON' },
  { group: 'Files', keys: 'Ctrl/Cmd + O', description: 'Open a saved diagram' },
  { group: 'Files', keys: '?', description: 'Show this list' },
  { group: 'In the editors', keys: 'Ctrl/Cmd + Enter', description: 'Insert / apply (formula and chemistry editors, text in a shape)' },
  { group: 'In the editors', keys: '^  /  _', description: 'Superscript / subscript box (formula editor)' },
  { group: 'In the editors', keys: 'Tab', description: 'Move between fields; focus stays inside the open dialog' },
  { group: 'Browser', keys: 'Ctrl/Cmd + +', description: 'Zoom the whole page (browser zoom; the app leaves it alone)' },
  { group: 'Browser', keys: 'Ctrl/Cmd + -', description: 'Zoom the whole page out' },
  { group: 'Browser', keys: 'Ctrl/Cmd + 0', description: 'Reset the page zoom' },
];

/** Tool letters. The only single-letter shortcuts in the application. */
const TOOL_KEYS: Record<string, 'select' | 'pan' | 'connect'> = {
  v: 'select',
  h: 'pan',
  c: 'connect',
};

export const ZOOM_STEP = 1.2;

export type ZoomIntent = 'in' | 'out' | 'reset' | 'fit';

/**
 * Ctrl/Cmd + "+", "-", "0" (and Ctrl + 1...) belong to the browser: they zoom
 * the whole page, which is what people expect from every website, and they
 * matter for readability. The app never takes them.
 */
export function isBrowserZoomChord(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  const k = e.key;
  const c = e.code ?? '';
  return (
    k === '+' || k === '=' || k === '-' || k === '_' || k === '0' || k === 'Add' || k === 'Subtract' ||
    c === 'Equal' || c === 'Minus' || c === 'Digit0' || c === 'NumpadAdd' || c === 'NumpadSubtract' || c === 'Numpad0'
  );
}

/**
 * Zoom keys for the drawing itself, used only while the board has focus:
 * "+" / "=" and "-" (main keyboard or numpad), Shift + 0 for 100% and
 * Shift + 1 to fit - the convention of Figma, Excalidraw and draw.io.
 * Any Ctrl, Cmd or Alt chord is left to the browser.
 */
export function zoomIntent(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'> & { shiftKey?: boolean },
): ZoomIntent | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const key = e.key;
  const code = e.code ?? '';
  if (e.shiftKey && (code === 'Digit0' || key === ')')) return 'reset';
  if (e.shiftKey && (code === 'Digit1' || key === '!')) return 'fit';
  if (key === '+' || key === '=' || key === 'Add' || code === 'NumpadAdd') return 'in';
  if (key === '-' || key === 'Subtract' || code === 'NumpadSubtract') return 'out';
  return null;
}

/** Apply a zoom intent, keeping the middle of the drawing board still. */
export function applyZoom(intent: ZoomIntent, fallbackSize: { width: number; height: number }) {
  const s = useEditor.getState();
  // Measure the board now: panels that fold or widen change its size without
  // a window resize, so a cached size would zoom about the wrong point.
  const el = typeof document !== 'undefined' ? document.querySelector('.canvas-shell') : null;
  const r = el?.getBoundingClientRect();
  const canvasSize = r && r.width > 0 && r.height > 0 ? { width: r.width, height: r.height } : fallbackSize;
  const centre = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
  switch (intent) {
    case 'in':
      s.zoomBy(ZOOM_STEP, centre);
      break;
    case 'out':
      s.zoomBy(1 / ZOOM_STEP, centre);
      break;
    case 'reset':
      s.zoomBy(1 / s.view.zoom, centre);
      break;
    case 'fit':
      s.fitToView(canvasSize);
      break;
  }
}

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    // Check boxes, radios, colour wells and range sliders take no text.
    return !['checkbox', 'radio', 'button', 'color', 'range', 'file', 'submit'].includes(type);
  }
  return (
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable === true
  );
}

/**
 * Whether a bare letter (the tool keys V, H, C) should act on the drawing board.
 *
 * The board has to own focus - with one deliberate exception. When nothing
 * is focused at all (the page has just loaded, or a dialog has closed and
 * handed focus back to the body) the board is the only thing a letter could
 * sensibly mean, so it still works. Everything else declines.
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

/** Fields whose value is the diagram itself (the property panel). */
export function isDocBound(el: Element | null): boolean {
  return !!el?.closest?.('[data-doc-bound]');
}

/** Text-like fields that get a merged undo step per visit. */
function isEditField(el: Element | null): boolean {
  if (!el) return false;
  if (isTypingTarget(el)) return true;
  return el.tagName === 'INPUT' && ['range', 'color'].includes((el as HTMLInputElement).type);
}

/** A text selection the user made in the page (in the LaTeX panel, say). */
function hasPageTextSelection(): boolean {
  if (typeof window === 'undefined' || !window.getSelection) return false;
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
}

function modalOpen(): boolean {
  return (
    typeof document !== 'undefined' &&
    !!document.querySelector('.modal[aria-modal="true"]')
  );
}

/** Global shortcuts. Ignored while typing into a field (zoom excepted). */
export function useKeyboardShortcuts(opts: {
  onShowHelp: () => void;
  canvasSize: { width: number; height: number };
}) {
  /*
   * The options object is a fresh literal on every render of the caller, so
   * the handler is registered once and reads the current options through a
   * ref instead of being torn down and re-added on every render.
   */
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // The guided tour owns the keyboard while it runs.
      if (useTour.getState().active) return;

      // Page zoom (Ctrl + "+", "-", "0") is the browser's. Never touch it.
      if (isBrowserZoomChord(e)) return;

      const target = e.target as HTMLElement | null;
      const s = useEditor.getState();

      /*
       * Undo / redo. Dialogs keep their own history and handle the chord
       * themselves; the inline text box does too. A field in the property
       * panel shows the diagram, so there the canvas history is the right
       * one. Any other text box (a search field) keeps the browser's undo.
       */
      const chord = undoChord(e);
      if (chord) {
        if (modalOpen()) return;
        if (target?.closest?.('.text-overlay')) return;
        if (isTypingTarget(target) && !isDocBound(target) && target?.tagName !== 'SELECT') return;
        e.preventDefault();
        // In a LaTeX project with no drawing open, undo works on the document.
        const pj = useProject.getState();
        if (pj.project && !pj.frame) {
          if (chord === 'undo') pj.undo();
          else pj.redo();
          return;
        }
        if (chord === 'undo') s.undo();
        else s.redo();
        return;
      }

      if (isTypingTarget(target)) return;
      // While a modal dialog is open, the canvas underneath must not react
      // to Delete, arrows or letters.
      if (modalOpen()) return;

      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;

      if (mod) {
        if (e.altKey) return;
        // Clipboard and select-all act on text the user highlighted, if any.
        const inCode = !!target?.closest?.('[data-tour="code"]');
        switch (key.toLowerCase()) {
          case 'c':
            if (inCode || hasPageTextSelection()) return;
            s.copySelection();
            return;
          case 'x':
            if (inCode || hasPageTextSelection()) return;
            e.preventDefault();
            s.cutSelection();
            return;
          case 'v':
            if (inCode) return;
            e.preventDefault();
            s.paste();
            return;
          case 'd':
            e.preventDefault();
            s.duplicateSelection();
            return;
          case 'a':
            if (inCode) return;
            e.preventDefault();
            s.selectAll();
            return;
          case 's':
            e.preventDefault();
            if (useProject.getState().project) {
              void useProject.getState().download();
              return;
            }
            downloadText(
              serialize(s.doc),
              `${slugify(s.doc.name)}.json`,
              'application/json',
            );
            s.markSaved();
            s.setStatus('Diagram saved as JSON.');
            return;
          case 'o': {
            const input = document.querySelector<HTMLInputElement>('input[data-input="open"]');
            if (!input) return;
            e.preventDefault();
            input.click();
            return;
          }
          case 'g':
            e.preventDefault();
            if (e.shiftKey) s.ungroup();
            else s.group();
            return;
          default:
            break;
        }
        // Layer order: Ctrl+] forward, Ctrl+[ backward; with Shift, all the way.
        if (e.code === 'BracketRight' || key === ']' || key === '}') {
          if (s.selection.length === 0) return;
          e.preventDefault();
          s.reorderSelection(e.shiftKey ? 'front' : 'forward');
          return;
        }
        if (e.code === 'BracketLeft' || key === '[' || key === '{') {
          if (s.selection.length === 0) return;
          e.preventDefault();
          s.reorderSelection(e.shiftKey ? 'back' : 'backward');
          return;
        }
        return;
      }

      // Space held over the board: drag to pan, with any tool.
      if (key === ' ' || e.code === 'Space') {
        if (e.altKey || !canvasKeysAllowed()) return;
        e.preventDefault();
        s.setSpacePan(true);
        return;
      }

      // Drawing zoom on its own keys, only while the board has focus.
      const zoom = zoomIntent(e);
      if (zoom && canvasKeysAllowed()) {
        e.preventDefault();
        applyZoom(zoom, optsRef.current.canvasSize);
        return;
      }

      switch (key) {
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          s.deleteSelection();
          return;
        case 'r':
        case 'R': {
          // Only on electrical and physics parts: the one place quarter turns are routine.
          if (e.altKey || !canvasKeysAllowed()) return;
          const rotatable = s.selection.filter((i) => /^(circuit|physics)\./.test(s.doc.nodes[i]?.kind ?? ''));
          if (rotatable.length === 0) return;
          e.preventDefault();
          s.rotateSelectionBy(e.shiftKey ? -90 : 90);
          return;
        }
        case 'Escape':
          if (useProject.getState().caret) useProject.getState().setCaret(null);
          s.armShape(null);
          s.setTool('select');
          s.setDraft(null);
          s.setEditingNode(null);
          s.clearSelection();
          return;
        case 'Enter':
        case 'F2': {
          const pj = useProject.getState();
          if (key === 'Enter' && pj.project && pj.caret && !pj.frame) {
            e.preventDefault();
            pj.openFrame(pj.caret);
            return;
          }
          const id = s.selection.find((i) => s.doc.nodes[i]);
          if (id) {
            e.preventDefault();
            if (s.doc.nodes[id].chart) {
              // Charts have no free text; Enter opens their settings instead.
              s.requestChartFocus(id);
            } else if (!openScienceEditor(s.doc.nodes[id])) {
              s.setEditingNode(id);
            }
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

      /* ------------------------------------------- tool letters, scoped */
      if (e.repeat) return;
      if (e.altKey) return;
      if (!canvasKeysAllowed()) return;

      const tool = TOOL_KEYS[key.toLowerCase()];
      if (tool) {
        e.preventDefault();
        s.setTool(tool);
      }
      // Shapes deliberately have no letter keys: they are placed from the
      // palette only, which keeps typing on the board from ever arming one.
    };

    const keyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.code === 'Space') useEditor.getState().setSpacePan(false);
    };
    const blur = () => useEditor.getState().setSpacePan(false);

    /*
     * Merged undo steps for the property panel: each visit to one of its
     * fields is a session, and all edits made in it become one step.
     */
    let session = 0;
    const focusIn = (e: FocusEvent) => {
      const t = e.target as Element | null;
      useEditor.getState().setFieldSession(isDocBound(t) && isEditField(t) ? ++session : null);
    };
    const focusOut = () => useEditor.getState().setFieldSession(null);

    window.addEventListener('keyup', keyUp, true);
    window.addEventListener('blur', blur);
    document.addEventListener('focusin', focusIn);
    document.addEventListener('focusout', focusOut);
    window.addEventListener('keydown', handler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('keyup', keyUp, true);
      window.removeEventListener('blur', blur);
      document.removeEventListener('focusin', focusIn);
      document.removeEventListener('focusout', focusOut);
    };
  }, []);
}
