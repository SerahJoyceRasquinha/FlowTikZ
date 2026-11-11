import { create } from 'zustand';

/** Toolbar menus the guided tour can open to show what is inside them. */
export type TourMenu = 'file' | 'export' | 'view' | 'help' | 'align' | 'arrange' | null;

interface TourState {
  active: boolean;
  step: number;
  /** A toolbar menu the current step wants open. */
  menu: TourMenu;
  /** Show the selection toolbar even when nothing is selected (preview only). */
  previewSelection: boolean;
  start: (step?: number) => void;
  exit: () => void;
  goto: (step: number) => void;
  setStage: (stage: { menu?: TourMenu; previewSelection?: boolean }) => void;
}

export const TOUR_SEEN_KEY = 'flowtikz:tour-seen';

export const useTour = create<TourState>((set) => ({
  active: false,
  step: 0,
  menu: null,
  previewSelection: false,
  start: (step = 0) => set({ active: true, step, menu: null, previewSelection: false }),
  exit: () => {
    try {
      localStorage.setItem(TOUR_SEEN_KEY, '1');
    } catch {
      /* storage may be disabled */
    }
    set({ active: false, step: 0, menu: null, previewSelection: false });
  },
  goto: (step) => set({ step }),
  setStage: (stage) =>
    set({ menu: stage.menu ?? null, previewSelection: stage.previewSelection ?? false }),
}));
