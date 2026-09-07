import { useEffect, useRef, useState } from 'react';
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
  const [value, setValue] = useState(node.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const commit = useEditor((s) => s.commit);
  const setEditingNode = useEditor((s) => s.setEditingNode);

  useEffect(() => {
    setValue(node.text);
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
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
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

