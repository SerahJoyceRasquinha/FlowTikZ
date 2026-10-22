import { create } from 'zustand';
import type { Rect } from '../model/types';
import type { ImportMode, ImportStage, SerializedImportError } from '../import/types';
import type { ImportReport } from '../import/report';
import { useEditor } from './store';

/**
 * Transient state of the import feature: the current import session, the
 * pending mode choice, the report dialog and the reference image.
 *
 * Deliberately separate from the diagram store: none of this is part of the
 * document, so none of it is saved, undone, autosaved or turned into LaTeX.
 */

export type ImportStatus = 'running' | 'done' | 'error' | 'cancelled';

export interface ImportSession {
  id: number;
  fileName: string;
  fileSize: number;
  mode: ImportMode;
  status: ImportStatus;
  formatLabel?: string;
  /** Stages this import will go through, in order. */
  stages: ImportStage[];
  done: ImportStage[];
  current: ImportStage | null;
  /** Transient detail inside the current stage ("Reading text"). */
  note?: string;
  startedAt: number;
  finishedAt?: number;
  error?: SerializedImportError;
  report?: ImportReport;
  inWorker?: boolean;
  /** The deterministic SVG reconstruction (image imports). */
  svg?: string;
}

export type ReferenceMode = 'off' | 'original' | 'overlay' | 'difference';

export interface ReferenceImage {
  url: string;
  /** Where the source image sits, in diagram units. */
  placement: Rect;
  mode: ReferenceMode;
  /** Id of the document it belongs to; cleared when that document goes away. */
  docId: string;
}

interface ImportStoreState {
  /** A file waiting for the user to choose replace / insert / new. */
  pending: File | null;
  session: ImportSession | null;
  reportOpen: boolean;
  reference: ReferenceImage | null;
  setPending: (f: File | null) => void;
  setSession: (s: ImportSession | null) => void;
  patchSession: (id: number, patch: Partial<ImportSession>) => void;
  setReportOpen: (v: boolean) => void;
  setReference: (r: ReferenceImage | null) => void;
  setReferenceMode: (m: ReferenceMode) => void;
}

function revoke(r: ReferenceImage | null) {
  if (r && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    try {
      URL.revokeObjectURL(r.url);
    } catch {
      /* already revoked */
    }
  }
}

export const useImport = create<ImportStoreState>((set, get) => ({
  pending: null,
  session: null,
  reportOpen: false,
  reference: null,
  setPending: (f) => set({ pending: f }),
  setSession: (s) => set({ session: s }),
  patchSession: (id, patch) => {
    const s = get().session;
    if (!s || s.id !== id) return;
    set({ session: { ...s, ...patch } });
  },
  setReportOpen: (v) => set({ reportOpen: v }),
  setReference: (r) => {
    const prev = get().reference;
    if (prev && prev.url !== r?.url) revoke(prev);
    set({ reference: r });
  },
  setReferenceMode: (m) => {
    const r = get().reference;
    if (r) set({ reference: { ...r, mode: m } });
  },
}));

/* A reference image belongs to one document: drop it when that document is replaced. */
useEditor.subscribe((state, prev) => {
  if (state.doc.id !== prev.doc.id) {
    const ref = useImport.getState().reference;
    if (ref && ref.docId !== state.doc.id) useImport.getState().setReference(null);
  }
});
