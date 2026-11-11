import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTour } from '../../state/tourStore';
import { Icon } from '../Icon';
import { TOUR_STEPS, type Side, type TourStep } from './steps';
import { Illustration } from './Illustrations';

/* ------------------------------------------------------------- geometry */

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MARGIN = 14;
const GAP = 62; // room between the target and the card for the arrow
const POP_W = 380;

function boxOf(el: Element | null): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function union(a: Box, b: Box): Box {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.left + a.width, b.left + b.width);
  const bottom = Math.max(a.top + a.height, b.top + b.height);
  return { left, top, width: right - left, height: bottom - top };
}

function measureStep(step: TourStep): Box | null {
  if (!step.target || typeof document === 'undefined') return null;
  let box = boxOf(document.querySelector(step.target));
  if (!box) return null;
  for (const sel of step.extra ?? []) {
    const b = boxOf(document.querySelector(sel));
    if (b) box = union(box, b);
  }
  return box;
}

function centerOf(selector: string): { x: number; y: number } | null {
  const b = boxOf(document.querySelector(selector));
  return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Placement {
  x: number;
  y: number;
  side: Side;
}

function place(target: Box | null, pw: number, ph: number, prefs: Side[]): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const centred = { x: (vw - pw) / 2, y: Math.max(MARGIN, (vh - ph) / 2), side: 'center' as Side };
  if (!target || prefs[0] === 'center') return centred;
  const cx = target.left + target.width / 2;
  const cy = target.top + target.height / 2;
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const fitX = (x: number) => clamp(x, MARGIN, vw - pw - MARGIN);
  const fitY = (y: number) => clamp(y, MARGIN, vh - ph - MARGIN);

  for (const side of [...prefs, 'bottom', 'right', 'left', 'top'] as Side[]) {
    switch (side) {
      case 'inside':
        return {
          x: fitX(right - pw - 28),
          y: fitY(bottom - ph - 28),
          side: 'inside',
        };
      case 'bottom':
        if (bottom + GAP + ph <= vh - MARGIN) return { x: fitX(cx - pw / 2), y: bottom + GAP, side };
        break;
      case 'top':
        if (target.top - GAP - ph >= MARGIN) return { x: fitX(cx - pw / 2), y: target.top - GAP - ph, side };
        break;
      case 'right':
        if (right + GAP + pw <= vw - MARGIN) return { x: right + GAP, y: fitY(cy - ph / 2), side };
        break;
      case 'left':
        if (target.left - GAP - pw >= MARGIN) return { x: target.left - GAP - pw, y: fitY(cy - ph / 2), side };
        break;
      default:
        break;
    }
  }
  return centred;
}

/* ---------------------------------------------------------- demo state */

interface Point {
  x: number;
  y: number;
}

interface Ghost {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  kind: 'process' | 'decision';
  caret?: boolean;
  ports?: boolean;
  hotPort?: 'left' | 'right';
}

interface DemoState {
  cursor: Point & { show: boolean; down: boolean };
  ripples: { id: number; x: number; y: number }[];
  ghosts: Ghost[];
  line: { from: Point; to: Point; drawing: boolean; done: boolean; key: number } | null;
  bubble: { x: number; y: number; text: string } | null;
  toast: string | null;
  hot: Box | null;
  hop: number;
}

const START: DemoState = {
  cursor: { x: 0, y: 0, show: false, down: false },
  ripples: [],
  ghosts: [],
  line: null,
  bubble: null,
  toast: null,
  hot: null,
  hop: -1,
};

/* ------------------------------------------------------------- the tour */

export function Tour({ onFinish }: { onFinish?: (choice: 'example' | 'draw') => void }) {
  const active = useTour((t) => t.active);
  if (!active) return null;
  return <TourInner onFinish={onFinish} />;
}

function TourInner({ onFinish }: { onFinish?: (choice: 'example' | 'draw') => void }) {
  const stepIndex = useTour((t) => t.step);
  const goto = useTour((t) => t.goto);
  const exit = useTour((t) => t.exit);
  const setStage = useTour((t) => t.setStage);
  const step = TOUR_STEPS[stepIndex] ?? TOUR_STEPS[0];
  const total = TOUR_STEPS.length;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === total - 1;

  const [target, setTarget] = useState<Box | null>(null);
  const [popSize, setPopSize] = useState({ w: POP_W, h: 260 });
  const popRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [demo, setDemo] = useState<DemoState>(() => ({
    ...START,
    cursor: { x: window.innerWidth / 2, y: window.innerHeight / 2, show: false, down: false },
  }));

  const next = useCallback(() => {
    if (isLast) exit();
    else goto(stepIndex + 1);
  }, [isLast, exit, goto, stepIndex]);
  const back = useCallback(() => {
    if (!isFirst) goto(stepIndex - 1);
  }, [isFirst, goto, stepIndex]);

  /* Open menus / preview bars the step talks about. */
  useEffect(() => {
    setStage({ menu: step.menu ?? null, previewSelection: !!step.previewSelection });
  }, [step, setStage]);

  /* Track the target: layout can move (menus open, window resizes). */
  useLayoutEffect(() => {
    const measure = () => {
      const b = measureStep(step);
      setTarget((cur) =>
        cur && b &&
        Math.abs(cur.left - b.left) < 0.5 &&
        Math.abs(cur.top - b.top) < 0.5 &&
        Math.abs(cur.width - b.width) < 0.5 &&
        Math.abs(cur.height - b.height) < 0.5
          ? cur
          : b,
      );
      const p = popRef.current;
      if (p) {
        const w = p.offsetWidth;
        const h = p.offsetHeight;
        setPopSize((cur) => (Math.abs(cur.w - w) < 1 && Math.abs(cur.h - h) < 1 ? cur : { w, h }));
      }
    };
    measure();
    const id = window.setInterval(measure, 200);
    window.addEventListener('resize', measure);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [step]);

  /* Keyboard: arrows to move, Escape to leave. The app's own shortcuts are paused. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === 'PageDown') {
        e.preventDefault();
        e.stopPropagation();
        next();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        e.stopPropagation();
        back();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        exit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, back, exit]);

  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, [stepIndex]);

  /* ------------------------------------------------ the animated demos */
  useEffect(() => {
    const timers: number[] = [];
    let rippleId = 0;
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(window.setTimeout(resolve, ms));
      });
    const patch = (p: Partial<DemoState> | ((d: DemoState) => Partial<DemoState>)) =>
      setDemo((d) => ({ ...d, ...(typeof p === 'function' ? p(d) : p) }));

    const moveTo = async (pt: Point, ms = 750) => {
      patch((d) => ({ cursor: { ...d.cursor, x: pt.x, y: pt.y, show: true } }));
      await wait(ms);
    };
    const ripple = (pt: Point) => {
      const id = ++rippleId;
      patch((d) => ({ ripples: [...d.ripples, { id, x: pt.x, y: pt.y }] }));
      timers.push(
        window.setTimeout(() => patch((d) => ({ ripples: d.ripples.filter((r) => r.id !== id) })), 800),
      );
    };
    const click = async (pt: Point) => {
      patch((d) => ({ cursor: { ...d.cursor, down: true } }));
      ripple(pt);
      await wait(170);
      patch((d) => ({ cursor: { ...d.cursor, down: false } }));
      await wait(180);
    };

    // Reset everything from the previous step, but keep the pointer where it was:
    // it glides on to the next thing, which is what makes it feel like a demo.
    patch({ ghosts: [], line: null, bubble: null, toast: null, hot: null, hop: -1, ripples: [] });

    const canvasBox = () => boxOf(document.querySelector('.canvas-shell'));
    /**
     * A spot on the canvas for a pretend shape of size w x h that the tour card
     * does not cover. Tries the upper-left, upper-right, lower-left, lower-right
     * and centre in turn.
     */
    const freeSpot = (w: number, h: number): Point | null => {
      const c = canvasBox();
      if (!c) return null;
      const card = popRef.current?.getBoundingClientRect();
      const fx = [0.32, 0.68, 0.32, 0.68, 0.5];
      const fy = [0.3, 0.3, 0.72, 0.72, 0.5];
      for (let i = 0; i < fx.length; i++) {
        const x = c.left + c.width * fx[i];
        const y = c.top + c.height * fy[i];
        const l = x - w / 2 - 24;
        const r = x + w / 2 + 24;
        const tp = y - h / 2 - 24;
        const b = y + h / 2 + 24;
        const inside = l >= c.left && r <= c.left + c.width && tp >= c.top && b <= c.top + c.height;
        const hitsCard = card && !(r < card.left || l > card.right || b < card.top || tp > card.bottom);
        if (inside && !hitsCard) return { x, y };
      }
      return { x: c.left + c.width / 2, y: c.top + c.height * 0.3 };
    };

    const scripts: Record<string, () => Promise<void>> = {
      async hops() {
        const hops = step.hops ?? [];
        await wait(450);
        for (;;) {
          for (let i = 0; i < hops.length; i++) {
            const pt = centerOf(hops[i].selector);
            patch({ hop: i, hot: boxOf(document.querySelector(hops[i].selector)) });
            if (pt) {
              await moveTo(pt, 700);
              ripple(pt);
            }
            await wait(1500);
          }
          patch({ hop: -1, hot: null });
          await wait(900);
        }
      },

      async place() {
        await wait(400);
        for (;;) {
          patch({ ghosts: [], hot: null });
          const btnSel = '.shape-btn[aria-label="Process"], .palette .shape-btn, .rail-btn';
          const btn = document.querySelector(btnSel);
          const bp = btn ? centerOf(btnSel) : null;
          const drop = freeSpot(150, 60);
          if (!bp || !drop) return;
          await moveTo(bp, 800);
          patch({ hot: boxOf(btn) });
          await click(bp);
          await wait(250);
          await moveTo(drop, 1000);
          await click(drop);
          patch({
            hot: null,
            ghosts: [{ id: 'a', x: drop.x - 75, y: drop.y - 30, w: 150, h: 60, label: 'Process', kind: 'process' }],
          });
          await wait(2200);
        }
      },

      async edit() {
        await wait(300);
        const text = 'Is it valid?';
        for (;;) {
          const spot = freeSpot(240, 120);
          if (!spot) return;
          const g: Ghost = {
            id: 'e',
            x: spot.x - 90,
            y: spot.y - 45,
            w: 180,
            h: 90,
            label: '',
            kind: 'decision',
          };
          patch({ ghosts: [g] });
          const mid = { x: g.x + g.w / 2, y: g.y + g.h / 2 };
          await moveTo(mid, 900);
          await click(mid);
          await click(mid);
          patch({ ghosts: [{ ...g, caret: true }] });
          for (let i = 1; i <= text.length; i++) {
            await wait(95);
            patch({ ghosts: [{ ...g, caret: true, label: text.slice(0, i) }] });
          }
          await wait(700);
          patch({ ghosts: [{ ...g, label: text }] });
          // drag it a little to show moving
          const to = { x: mid.x + 60, y: mid.y + 26 };
          patch((d) => ({ cursor: { ...d.cursor, down: true } }));
          await wait(150);
          patch((d) => ({
            cursor: { ...d.cursor, x: to.x, y: to.y },
            ghosts: [{ ...g, label: text, x: g.x + 60, y: g.y + 26 }],
          }));
          await wait(800);
          patch((d) => ({ cursor: { ...d.cursor, down: false } }));
          await wait(1600);
        }
      },

      async connect() {
        await wait(300);
        for (;;) {
          const spot = freeSpot(460, 90);
          if (!spot) return;
          const cy = spot.y;
          const cx = spot.x + 80;
          const a: Ghost = { id: 'a', x: cx - 230, y: cy - 30, w: 140, h: 60, label: 'Start', kind: 'process' };
          const b: Ghost = { id: 'b', x: cx + 70, y: cy - 30, w: 140, h: 60, label: 'Check input', kind: 'process' };
          patch({ ghosts: [a, b], line: null });
          await moveTo({ x: a.x + a.w / 2, y: a.y + a.h / 2 }, 900);
          patch({ ghosts: [{ ...a, ports: true }, b] });
          await wait(500);
          const from = { x: a.x + a.w + 12, y: a.y + a.h / 2 };
          await moveTo(from, 500);
          patch((d) => ({ cursor: { ...d.cursor, down: true } }));
          ripple(from);
          await wait(250);
          const to = { x: b.x - 12, y: b.y + b.h / 2 };
          const key = Date.now();
          patch((d) => ({
            cursor: { ...d.cursor, x: to.x, y: to.y },
            line: { from, to, drawing: true, done: false, key },
            ghosts: [{ ...a, ports: true }, { ...b, ports: true }],
          }));
          await wait(1000);
          patch({ ghosts: [{ ...a, ports: true }, { ...b, ports: true, hotPort: 'left' }] });
          await wait(600);
          patch((d) => ({
            cursor: { ...d.cursor, down: false },
            line: { from, to: { x: b.x, y: to.y }, drawing: false, done: true, key },
            ghosts: [a, b],
          }));
          ripple(to);
          await wait(2300);
        }
      },

      async copy() {
        await wait(400);
        for (;;) {
          const sel = '[data-tour="copy"]';
          const p = centerOf(sel);
          const b = boxOf(document.querySelector(sel));
          if (!p || !b) return;
          patch({ bubble: null });
          await moveTo(p, 900);
          await click(p);
          patch({ bubble: { x: b.left + b.width / 2, y: b.top - 10, text: 'Copied! Now paste into Overleaf' } });
          await wait(2200);
          patch({ bubble: null });
          await wait(600);
        }
      },

      async save() {
        await wait(400);
        for (;;) {
          const sel = '[data-tour="save"]';
          const p = centerOf(sel);
          if (!p) return;
          patch({ toast: null });
          await moveTo(p, 900);
          await click(p);
          patch({ toast: 'Diagram saved as JSON.' });
          await wait(2400);
          patch({ toast: null });
          await wait(600);
        }
      },
    };

    const which = step.demo ?? (step.hops?.length ? 'hops' : null);
    if (which) {
      void scripts[which]();
    } else {
      patch((d) => ({ cursor: { ...d.cursor, show: false } }));
    }
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [step]);

  /* ---------------------------------------------------------- layout */
  const pad = step.pad ?? 8;
  const hole = target
    ? { left: target.left - pad, top: target.top - pad, width: target.width + pad * 2, height: target.height + pad * 2 }
    : null;
  const pos = place(hole, popSize.w, popSize.h, step.side ?? ['bottom']);
  const arrow = hole && pos.side !== 'center' && pos.side !== 'inside' ? arrowFor(hole, pos, popSize) : null;
  const progress = ((stepIndex + 1) / total) * 100;

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* Blocks the app while the tour runs; clicking it nudges the card. */}
      <div className="tour-blocker" onClick={() => nextRef.current?.focus()} />

      <div
        className={`tour-spot${hole ? '' : ' is-empty'}`}
        style={
          hole
            ? { left: hole.left, top: hole.top, width: hole.width, height: hole.height }
            : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 }
        }
      />

      {/* Fades the real drawing so the demonstration stands out. */}
      {hole && (step.demo === 'place' || step.demo === 'edit' || step.demo === 'connect') && (() => {
        const c = boxOf(document.querySelector('.canvas-shell'));
        return c ? (
          <div className="tour-veil" style={{ left: c.left, top: c.top, width: c.width, height: c.height }}>
            <span>Demo</span>
          </div>
        ) : null;
      })()}

      {/* Highlight ring that follows the item being demonstrated. */}
      {demo.hot && (
        <div
          className="tour-hot"
          style={{ left: demo.hot.left - 4, top: demo.hot.top - 4, width: demo.hot.width + 8, height: demo.hot.height + 8 }}
        />
      )}

      {/* Pretend shapes and arrows, drawn on top of the real canvas. */}
      {demo.ghosts.map((g) => (
        <div
          key={g.id}
          className={`tour-ghost ${g.kind}`}
          style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
        >
          {g.kind === 'decision' && (
            <svg className="ghost-diamond" viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true">
              <polygon points="50,1 99,25 50,49 1,25" />
            </svg>
          )}
          <span className="ghost-label">
            {g.label}
            {g.caret && <span className="ghost-caret" />}
          </span>
          {g.ports && (
            <>
              <i className="ghost-port p-top" />
              <i className="ghost-port p-bottom" />
              <i className={`ghost-port p-left${g.hotPort === 'left' ? ' hot' : ''}`} />
              <i className="ghost-port p-right" />
            </>
          )}
        </div>
      ))}
      {demo.line && (
        <svg className="tour-lines" aria-hidden="true">
          <defs>
            <marker id="tour-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0L10 5L0 10z" fill="#1f2937" />
            </marker>
          </defs>
          <path
            key={demo.line.key + (demo.line.done ? 'd' : 'p')}
            className={demo.line.done ? 'line-done' : 'line-draw'}
            d={`M${demo.line.from.x} ${demo.line.from.y} L${demo.line.to.x} ${demo.line.to.y}`}
            pathLength={1}
            markerEnd={demo.line.done ? 'url(#tour-arrowhead)' : undefined}
          />
        </svg>
      )}
      {demo.bubble && (
        <div className="tour-bubble" style={{ left: demo.bubble.x, top: demo.bubble.y }}>
          <Icon name="check" size={15} stroke={3} />
          {demo.bubble.text}
        </div>
      )}
      {demo.toast && (
        <div className="toast toast-success tour-toast">
          <span className="toast-icon">
            <Icon name="check" size={15} stroke={3} />
          </span>
          {demo.toast}
        </div>
      )}

      {demo.ripples.map((r) => (
        <span key={r.id} className="tour-ripple" style={{ left: r.x, top: r.y }} />
      ))}

      <div
        className={`tour-cursor${demo.cursor.show ? ' show' : ''}${demo.cursor.down ? ' down' : ''}`}
        style={{ transform: `translate(${demo.cursor.x}px, ${demo.cursor.y}px)` }}
        aria-hidden="true"
      >
        <svg width="26" height="30" viewBox="0 0 26 30">
          <path d="M3 2l19 11-8.2 1.9L10.5 27z" fill="#ffffff" stroke="#0b1324" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </div>

      {arrow && (
        <div
          className="tour-arrow"
          style={{ left: arrow.x, top: arrow.y, transform: `rotate(${arrow.rot}deg)` }}
          aria-hidden="true"
        >
          <svg width="46" height="46" viewBox="0 0 46 46">
            <path d="M23 42V8" />
            <path d="M10 20L23 6l13 14" />
          </svg>
        </div>
      )}

      <div
        ref={popRef}
        className={`tour-pop side-${pos.side}`}
        style={{ left: pos.x, top: pos.y, width: POP_W }}
        key={step.id}
      >
        <div className="tour-pop-head">
          <span className="tour-chip">
            {isFirst ? 'Guided tour' : isLast ? 'Finished' : `Step ${stepIndex} of ${total - 2}`}
          </span>
          <button className="tour-x" onClick={exit} title="Exit the tour (Esc)" aria-label="Exit the tour">
            <Icon name="x" size={16} stroke={2.4} />
          </button>
        </div>
        <h2 id="tour-title">{step.title}</h2>
        {step.illus && <Illustration kind={step.illus} />}
        <div className="tour-body">{step.body}</div>

        {step.hops && (
          <ul className="tour-hops">
            {step.hops.map((h, i) => (
              <li key={h.label} className={`${i === demo.hop ? 'on' : ''}${h.tone ? ` tone-${h.tone}` : ''}`}>
                <b>{h.label}</b>
                <span>{h.desc}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="tour-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>

        <div className="tour-foot">
          {!isLast && (
            <button className="btn ghost tour-exit" onClick={exit}>
              Exit tour
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={back} disabled={isFirst} data-action="tour-back">
            <Icon name="chevronLeft" size={16} />
            Back
          </button>
          {isLast ? (
            <>
              {onFinish && (
                <button
                  className="btn"
                  onClick={() => {
                    exit();
                    onFinish('example');
                  }}
                >
                  Open an example
                </button>
              )}
              <button
                ref={nextRef}
                className="btn success"
                onClick={() => {
                  exit();
                  onFinish?.('draw');
                }}
                data-action="tour-finish"
              >
                <Icon name="check" size={16} stroke={2.6} />
                Start drawing
              </button>
            </>
          ) : (
            <button ref={nextRef} className="btn primary" onClick={next} data-action="tour-next">
              {isFirst ? 'Start the tour' : 'Next'}
              <Icon name="chevronRight" size={16} />
            </button>
          )}
        </div>
        <div className="tour-keys">
          <kbd>←</kbd> <kbd>→</kbd> to move · <kbd>Esc</kbd> to exit
        </div>
      </div>
    </div>
  );
}

/** Where the bouncing arrow sits: in the gap between the card and the target, pointing at the target. */
function arrowFor(hole: Box, pos: Placement, pop: { w: number; h: number }) {
  const S = 46;
  const holeCx = hole.left + hole.width / 2;
  const holeCy = hole.top + hole.height / 2;
  switch (pos.side) {
    case 'bottom': {
      const x = clamp(holeCx, pos.x + 30, pos.x + pop.w - 30);
      return { x: x - S / 2, y: hole.top + hole.height + 6, rot: 0 };
    }
    case 'top': {
      const x = clamp(holeCx, pos.x + 30, pos.x + pop.w - 30);
      return { x: x - S / 2, y: hole.top - 6 - S, rot: 180 };
    }
    case 'right': {
      const y = clamp(holeCy, pos.y + 30, pos.y + pop.h - 30);
      return { x: hole.left + hole.width + 8, y: y - S / 2, rot: -90 };
    }
    case 'left': {
      const y = clamp(holeCy, pos.y + 30, pos.y + pop.h - 30);
      return { x: hole.left - 8 - S, y: y - S / 2, rot: 90 };
    }
    default:
      return null;
  }
}
