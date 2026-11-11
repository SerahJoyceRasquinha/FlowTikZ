import { useEffect, useRef, useState } from 'react';

/**
 * Quick, readable tooltips for every element with a `title`.
 *
 * The browser's own tooltip appears after a long delay in small grey text.
 * This one appears quickly, in large dark text, below the control. While it is
 * showing, the element's `title` is parked in `data-tip` so the native tooltip
 * does not pop up as well; it is put back as soon as the pointer leaves.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; above: boolean } | null>(null);
  const current = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const restore = () => {
      const el = current.current;
      if (el && el.dataset.tip !== undefined) {
        el.setAttribute('title', el.dataset.tip);
        delete el.dataset.tip;
      }
      current.current = null;
      window.clearTimeout(timer.current);
      setTip(null);
    };

    const onOver = (e: MouseEvent) => {
      const t = e.target as Element | null;
      const el = (t?.closest?.('[title]') as HTMLElement | null) ?? null;
      if (el === current.current) return;
      restore();
      if (!el || el.closest('.canvas-svg') || el.closest('.tour-root')) return;
      const text = el.getAttribute('title');
      if (!text) return;
      current.current = el;
      el.dataset.tip = text;
      el.removeAttribute('title');
      timer.current = window.setTimeout(() => {
        if (current.current !== el) return;
        const r = el.getBoundingClientRect();
        const above = r.bottom + 60 > window.innerHeight;
        setTip({ text, x: r.left + r.width / 2, y: above ? r.top - 8 : r.bottom + 8, above });
      }, 280);
    };

    const onOut = (e: MouseEvent) => {
      const el = current.current;
      if (!el) return;
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return;
      restore();
    };

    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('mousedown', restore, true);
    window.addEventListener('blur', restore);
    return () => {
      restore();
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('mousedown', restore, true);
      window.removeEventListener('blur', restore);
    };
  }, []);

  if (!tip) return null;
  const left = Math.max(150, Math.min(window.innerWidth - 150, tip.x));
  return (
    <div
      className={`app-tooltip${tip.above ? ' above' : ''}`}
      role="tooltip"
      style={{ left, top: tip.y }}
    >
      {tip.text}
    </div>
  );
}
