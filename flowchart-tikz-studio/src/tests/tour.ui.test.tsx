// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from '../App';
import { useEditor } from '../state/store';
import { useTour, TOUR_SEEN_KEY } from '../state/tourStore';
import { emptyDiagram } from '../model/defaults';
import { resetIdCounters } from '../model/ids';
import { TOUR_STEPS } from '../components/tour/steps';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
const consoleErrors: unknown[][] = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  consoleErrors.length = 0;
  vi.spyOn(console, 'error').mockImplementation((...args) => consoleErrors.push(args));
  vi.spyOn(console, 'warn').mockImplementation((...args) => consoleErrors.push(args));
  localStorage.clear();
  resetIdCounters();
  useTour.setState({ active: false, step: 0, menu: null, previewSelection: false });
  useEditor.setState({
    doc: emptyDiagram(),
    selection: [],
    past: [],
    future: [],
    snapshot: null,
    clipboard: null,
    dirty: false,
    view: { zoom: 1, panX: 60, panY: 60 },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const render = () => act(() => root.render(<App />));
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const click = (el: HTMLElement | null) => act(() => el!.click());
const key = (k: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });

describe('guided tour', () => {
  it('is offered once to first-time visitors', () => {
    render();
    expect($('.tour-prompt')).toBeTruthy();
    click([...document.querySelectorAll<HTMLElement>('.tour-prompt button')].find((b) => b.textContent === 'Not now')!);
    expect($('.tour-prompt')).toBeNull();
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe('1');
  });

  it('starts from the Help menu and steps back and forth', () => {
    render();
    click($('[data-action="help"]'));
    click($('[data-action="start-tour"]'));
    expect($('.tour-root')).toBeTruthy();
    expect($('#tour-title')!.textContent).toBe(TOUR_STEPS[0].title);
    expect(($('[data-action="tour-back"]') as HTMLButtonElement).disabled).toBe(true);

    click($('[data-action="tour-next"]'));
    click($('[data-action="tour-next"]'));
    expect($('#tour-title')!.textContent).toBe(TOUR_STEPS[2].title);
    click($('[data-action="tour-back"]'));
    expect($('#tour-title')!.textContent).toBe(TOUR_STEPS[1].title);

    key('ArrowRight');
    expect(useTour.getState().step).toBe(2);
    key('ArrowLeft');
    expect(useTour.getState().step).toBe(1);
    expect(consoleErrors).toEqual([]);
  });

  it('pauses the app shortcuts and exits with Escape', () => {
    render();
    act(() => useTour.getState().start(0));
    key('c'); // would switch to the Connect tool
    expect(useEditor.getState().tool).toBe('select');
    key('Escape');
    expect($('.tour-root')).toBeNull();
    expect(useTour.getState().active).toBe(false);
  });

  it('opens the menus it talks about and previews the selection bar, then tidies up', () => {
    render();
    act(() => useTour.getState().start(0));
    const fileStep = TOUR_STEPS.findIndex((s) => s.id === 'file');
    const selStep = TOUR_STEPS.findIndex((s) => s.id === 'selection');
    act(() => useTour.getState().goto(fileStep));
    expect($('[data-tour="file"] .menu')).toBeTruthy();
    act(() => useTour.getState().goto(selStep));
    expect($('[data-tour="selection"]')).toBeTruthy();
    expect($('[data-tour="file"] .menu')).toBeNull();
    click($('.tour-exit'));
    expect($('[data-tour="selection"]')).toBeNull();
    expect(document.querySelectorAll('.menu').length).toBe(0);
  });

  it('never changes the diagram', () => {
    render();
    const before = useEditor.getState().doc;
    act(() => useTour.getState().start(0));
    for (let i = 0; i < TOUR_STEPS.length; i++) key('ArrowRight');
    expect(useTour.getState().active).toBe(false);
    expect(useEditor.getState().doc).toBe(before);
  });

  it('every step that names a target can find it on screen', () => {
    render();
    act(() => useTour.getState().start(0));
    for (let i = 0; i < TOUR_STEPS.length; i++) {
      act(() => useTour.getState().goto(i));
      const s = TOUR_STEPS[i];
      if (s.target) expect(document.querySelector(s.target), s.id).toBeTruthy();
      for (const h of s.hops ?? []) expect(document.querySelector(h.selector), `${s.id}: ${h.label}`).toBeTruthy();
    }
  });
});
