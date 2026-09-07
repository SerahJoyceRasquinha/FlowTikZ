import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  left: ReactNode;
  right: ReactNode;
  initial?: number;
  min?: number;
  max?: number;
  storageKey?: string;
}

/** Two panels with a draggable divider; the split persists between sessions. */
export function SplitPane({
  left,
  right,
  initial = 460,
  min = 280,
  max = 900,
  storageKey = 'flowchart-tikz-studio:split',
}: Props) {
  const [width, setWidth] = useState(() => {
    if (typeof localStorage === 'undefined') return initial;
    const saved = Number(localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved >= min ? saved : initial;
  });
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return;
      const rect = containerRef.current?.getBoundingClientRect();
      const next = Math.min(max, Math.max(min, e.clientX - (rect?.left ?? 0)));
      setWidth(next);
    },
    [max, min],
  );

  useEffect(() => {
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      try {
        localStorage.setItem(storageKey, String(width));
      } catch {
        /* storage may be disabled */
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
    };
  }, [onMove, storageKey, width]);

  return (
    <div className="split" ref={containerRef}>
      <div className="split-left" style={{ width }}>
        {left}
      </div>
      <div
        className="split-divider"
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={() => {
          dragging.current = true;
          document.body.style.cursor = 'col-resize';
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setWidth((w) => Math.max(min, w - 20));
          if (e.key === 'ArrowRight') setWidth((w) => Math.min(max, w + 20));
        }}
      />
      <div className="split-right">{right}</div>
    </div>
  );
}
