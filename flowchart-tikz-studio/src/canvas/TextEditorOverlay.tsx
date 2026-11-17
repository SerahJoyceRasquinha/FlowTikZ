import { useEffect, useRef } from 'react';
import { undoChord, useUndoable } from '../hooks/undo';
import type { Node } from '../model/types';
import { useEditor } from '../state/store';
import { FONT_STACK } from './textLayout';

interface Props {
  node: Node;
  view: { zoom: number; panX: number; panY: number };
}

/**
 * Editing happens in a real textarea positioned over the shape rather than in
 * a modal: the user keeps sight of the diagram and the generated LaTeX updates
 * as they type.
 */
export function TextEditorOverlay({ node, view }: Props) {
  /*
   * The text keeps its own history while it is being typed, so Ctrl+Z takes
   * back words in this box first; once there is nothing left to take back,
   * Ctrl+Z leaves the box and undoes the previous change on the canvas.
   */
  const text = useUndoable<string>(node.text);
  const value = text.value;
  const ref = useRef<HTMLTextAreaElement>(null);
  const commit = useEditor((s) => s.commit);
  const setEditingNode = useEditor((s) => s.setEditingNode);

  useEffect(() => {
    text.reset(node.text);
    const t = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const finish = (save: boolean) => {
    if (save && value !== node.text) {
      commit((d) => {
        const n = d.nodes[node.id];
        if (n) n.text = value;
      });
    }
    setEditingNode(null);
  };

  const left = node.x * view.zoom + view.panX;
  const top = node.y * view.zoom + view.panY;

  return (
    <textarea
      ref={ref}
      className="text-overlay"
      value={value}
      onChange={(e) => text.set(e.target.value, { coalesce: 'typing' })}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        const chord = undoChord(e);
        if (chord) {
          e.preventDefault();
          if (chord === 'undo') {
            if (text.canUndo) text.undo();
            else {
              finish(true);
              useEditor.getState().undo();
            }
          } else if (text.canRedo) {
            text.redo();
          } else {
            finish(true);
            useEditor.getState().redo();
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          finish(true);
        }
      }}
      style={{
        left,
        top,
        width: node.w * view.zoom,
        height: node.h * view.zoom,
        fontFamily: FONT_STACK[node.textStyle.fontFamily],
        fontSize: node.textStyle.fontSize * view.zoom,
        lineHeight: node.textStyle.lineHeight,
        fontWeight: node.textStyle.bold ? 700 : 400,
        fontStyle: node.textStyle.italic ? 'italic' : 'normal',
        color: node.textStyle.color,
        textAlign: node.textStyle.align,
      }}
      spellCheck={false}
    />
  );
}

