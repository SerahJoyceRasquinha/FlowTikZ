import type { Node } from '../model/types';
import { useEditor } from '../state/store';
import { isCircuitKind } from './physics/circuits';
import type { NaturalSize } from './types';

/** MIME type carrying a shape kind from the palette to the canvas. */
export const SHAPE_DRAG_TYPE = 'application/x-flowtikz-shape';

/** Default font size of newly typeset content, in diagram units. */
export const DEFAULT_FORMULA_FONT = 20;

/** Box size for content of `natural` ems at a font size. */
export function sizeForFont(natural: NaturalSize, font: number): { w: number; h: number } {
  return { w: Math.max(4, natural.w * font), h: Math.max(4, natural.h * font) };
}

/**
 * Open the editor that belongs to a node. Returns false for ordinary shapes,
 * so the caller can fall back to in-place text editing.
 */
export function openScienceEditor(node: Node | undefined): boolean {
  if (!node) return false;
  const s = useEditor.getState();
  switch (node.science?.type) {
    case 'math':
      s.openScienceDialog({ kind: 'math', nodeId: node.id });
      return true;
    case 'chem':
      s.openScienceDialog({ kind: 'chem', nodeId: node.id, tab: node.science.reaction ? 'reaction' : 'formula' });
      return true;
    case 'molecule':
      s.openScienceDialog({ kind: 'molecule', nodeId: node.id });
      return true;
    default:
      break;
  }
  if (isCircuitKind(node.kind)) {
    s.setSelection([node.id]);
    // The inspector is mounted for the selection on the next frame.
    setTimeout(() => {
      (document.querySelector('[data-field="circuit-label"]') as HTMLInputElement | null)?.focus();
    }, 0);
    return true;
  }
  return false;
}

/** The centre of the visible part of the board, in diagram units. */
export function viewCentre(): { x: number; y: number } {
  const s = useEditor.getState();
  const el = typeof document !== 'undefined' ? document.querySelector('.canvas-svg') : null;
  const rect = el?.getBoundingClientRect();
  const width = rect && rect.width > 0 ? rect.width : 800;
  const height = rect && rect.height > 0 ? rect.height : 600;
  let x = (width / 2 - s.view.panX) / s.view.zoom;
  let y = (height / 2 - s.view.panY) / s.view.zoom;
  // Step clear of anything already sitting there, so successive inserts do not stack.
  const taken = Object.values(s.doc.nodes).map((n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 }));
  while (taken.some((c) => Math.abs(c.x - x) < 24 && Math.abs(c.y - y) < 24)) {
    x += 40;
    y += 40;
  }
  return { x, y };
}
