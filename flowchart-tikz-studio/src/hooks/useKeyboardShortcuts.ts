import { useEffect } from 'react';
import { useEditor } from '../state/store';
import { serialize } from '../persistence/schema';
import { downloadText, slugify } from '../export/file';

export const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: 'V', description: 'Select tool' },
  { keys: 'H', description: 'Pan tool (or hold Alt while dragging)' },
  { keys: 'C', description: 'Connect tool' },
  { keys: 'T', description: 'Text label' },
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

/** Global shortcuts. Ignored while typing into a field. */
export function useKeyboardShortcuts(opts: {
  onShowHelp: () => void;
  canvasSize: { width: number; height: number };
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

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
            s.fitToView(opts.canvasSize);
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
          opts.onShowHelp();
          return;
        default:
          break;
      }

      switch (key.toLowerCase()) {
        case 'v':
          s.setTool('select');
          break;
        case 'h':
          s.setTool('pan');
          break;
        case 'c':
          s.setTool('connect');
          break;
        case 't':
          s.armShape('text');
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [opts]);
}
