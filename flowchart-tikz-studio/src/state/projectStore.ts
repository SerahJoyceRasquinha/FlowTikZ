import { create } from 'zustand';
import { useEditor } from './store';
import { emptyDiagram } from '../model/defaults';
import type { Diagram } from '../model/types';
import type { LatexProject, LoadProgress } from '../project/project';
import type { Block, ProjectDocument } from '../project/document';
import type { Placement, Target } from '../project/figure';
import { downloadBlob } from '../export/file';

/* The project code is loaded the first time a project is opened. */
type Lib = typeof import('../project/lib');
let lib: Lib | null = null;
async function loadLib(): Promise<Lib> {
  if (!lib) lib = await import('../project/lib');
  return lib;
}
/** Only called once a project exists, by which time the code is loaded. */
const L = (): Lib => {
  if (!lib) throw new Error('Project code is not loaded yet.');
  return lib;
};

/**
 * State of the LaTeX-project mode: the imported project, its parsed
 * document, where the user wants to draw, the drawing in progress, and the
 * history of document edits (so Ctrl+Z works on the document too).
 */

export interface Caret extends Target {
  blockKey: string;
}

export interface Frame {
  mode: 'new' | 'edit';
  target: Caret;
  /** For 'edit': the figure being changed. */
  blockKey?: string;
  figureId: string;
  caption: string;
  label: string;
  placement: Placement;
  height: number;
}

type Snapshot = Record<string, string>;

export interface ImportState {
  name: string;
  progress: LoadProgress | null;
  error: { message: string; details: string[] } | null;
}

interface ProjectState {
  project: LatexProject | null;
  doc: ProjectDocument | null;
  /** Bumped on every document change. */
  version: number;
  importing: ImportState | null;
  /** A project waiting for the user to confirm its main file. */
  pending: LatexProject | null;
  leftTab: 'files' | 'source' | 'figure';
  activeFile: string | null;
  caret: Caret | null;
  frame: Frame | null;
  past: Snapshot[];
  future: Snapshot[];
  zoom: number;
  exporting: boolean;
  /** Document version at the last download, to tell whether there is anything new. */
  savedVersion: number;
  /** The flowchart (and code view) that were there before the project opened. */
  stash: { doc: Diagram; past: Diagram[]; future: Diagram[]; outputMode: 'standalone' | 'snippet' } | null;
  /** Files changed and not yet downloaded. */
  dirtyCount: () => number;

  importZip: (file: File | Blob, name?: string) => Promise<void>;
  dismissImport: () => void;
  confirmMain: (path: string) => void;
  setMain: (path: string) => void;
  close: () => void;
  setLeftTab: (t: ProjectState['leftTab']) => void;
  setActiveFile: (p: string | null) => void;
  setZoom: (z: number) => void;
  setCaret: (c: Caret | null) => void;
  openFrame: (target: Caret) => void;
  /** In project mode, make sure a drawing is open (at the caret, or at the end) before a tool inserts into it. */
  ensureFrame: () => boolean;
  editFigure: (block: Block) => Promise<void>;
  updateFrame: (patch: Partial<Frame>) => void;
  cancelFrame: () => void;
  commitFrame: () => Promise<boolean>;
  removeFigure: (block: Block) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  download: () => Promise<void>;
  mainText: () => string;
}

const HISTORY = 100;

function reparse(project: LatexProject): ProjectDocument {
  return L().parseDocument(project.mainPath, L().access(project));
}

function enterProjectMode(get: () => ProjectState, set: (p: Partial<ProjectState>) => void, project: LatexProject) {
  const ed = useEditor.getState();
  const stash = get().stash ?? { doc: ed.doc, past: ed.past, future: ed.future, outputMode: ed.outputMode };
  ed.loadDocument(emptyDiagram('Figure'), { markSaved: true });
  // A figure goes into an existing document: show its code as a snippet.
  ed.setOutputMode('snippet');
  set({
    project,
    doc: reparse(project),
    version: get().version + 1,
    pending: null,
    importing: null,
    savedVersion: get().version + 1,
    leftTab: 'files',
    activeFile: project.mainPath,
    caret: null,
    frame: null,
    past: [],
    future: [],
    stash,
  });
  ed.setStatus(`Opened ${project.name}. Click anywhere in the document to add a drawing there.`);
}

function nextFigureId(doc: ProjectDocument | null): string {
  const used = new Set(doc?.blocks.filter((b) => b.figureId).map((b) => b.figureId!) ?? []);
  let n = used.size + 1;
  while (used.has(`fig${n}`)) n++;
  return `fig${n}`;
}

export const useProject = create<ProjectState>((set, get) => ({
  project: null,
  doc: null,
  version: 0,
  importing: null,
  pending: null,
  leftTab: 'files',
  activeFile: null,
  caret: null,
  frame: null,
  past: [],
  future: [],
  zoom: 1,
  exporting: false,
  savedVersion: 0,
  stash: null,

  importZip: async (file, name) => {
    const fileName = name ?? (file as File).name ?? 'project.zip';
    if (get().project && get().dirtyCount() && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm('Open another project? Changes to the current one that you have not downloaded will be lost.')) return;
    }
    set({ importing: { name: fileName, progress: null, error: null } });
    try {
      const { loadProject } = await loadLib();
      const project = await loadProject(file, fileName, (progress) => {
        const cur = get().importing;
        if (cur) set({ importing: { ...cur, progress } });
      });
      if (project.detection.ambiguous) {
        set({ pending: project, importing: null });
        return;
      }
      enterProjectMode(get, set, project);
      if (project.warnings.length) useEditor.getState().setStatus(`Opened ${project.name} with ${project.warnings.length} note${project.warnings.length > 1 ? 's' : ''}: ${project.warnings[0]}`);
    } catch (err) {
      const details = (err as { details?: string[] })?.details ?? [];
      const message = err instanceof Error ? err.message : 'The project could not be opened.';
      set({ importing: { name: fileName, progress: null, error: { message, details } } });
    }
  },

  dismissImport: () => set({ importing: null, pending: null }),

  confirmMain: (path) => {
    const p = get().pending;
    if (!p || !(path in p.files)) return;
    p.mainPath = path;
    enterProjectMode(get, set, p);
  },

  setMain: (path) => {
    const p = get().project;
    if (!p || !p.detection.candidates.some((c) => c.path === path)) return;
    p.mainPath = path;
    set({ doc: reparse(p), version: get().version + 1, caret: null, frame: null, activeFile: path });
    useEditor.getState().setStatus(`${path} is now the main file.`);
  },

  close: () => {
    const { project, stash } = get();
    if (project && get().dirtyCount() && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm('Close the project? Changes you have not downloaded will be lost.')) return;
    }
    const ed = useEditor.getState();
    if (stash) {
      ed.loadDocument(stash.doc, { markSaved: !ed.dirty });
      useEditor.setState({ past: stash.past, future: stash.future });
      ed.setOutputMode(stash.outputMode);
    }
    set({ project: null, doc: null, caret: null, frame: null, past: [], future: [], stash: null, pending: null, activeFile: null });
  },

  setLeftTab: (t) => set({ leftTab: t }),
  setActiveFile: (p) => set({ activeFile: p, leftTab: p ? 'source' : get().leftTab }),
  setZoom: (z) => set({ zoom: Math.max(0.4, Math.min(2.5, Math.round(z * 100) / 100)) }),
  setCaret: (c) => set({ caret: c }),

  openFrame: (target) => {
    if (get().frame) return;
    const ed = useEditor.getState();
    ed.loadDocument(emptyDiagram('Figure'), { markSaved: true });
    set({
      caret: null,
      leftTab: 'figure',
      frame: { mode: 'new', target, figureId: nextFigureId(get().doc), caption: '', label: '', placement: 'here', height: 420 },
    });
  },

  ensureFrame: () => {
    const s = get();
    if (!s.project || !s.doc) return false;
    if (s.frame) return true;
    s.openFrame(s.caret ?? endTarget(s.doc));
    useEditor.getState().setStatus(s.caret ? 'Drawing opened at the spot you picked.' : 'Drawing opened at the end of the document. Click in the text first to put it somewhere else.');
    return true;
  },

  editFigure: async (block) => {
    if (get().frame || block.kind !== 'flowtikz') return;
    const diagram = await L().decodeDiagram(block.text);
    const ed = useEditor.getState();
    if (!diagram) {
      ed.setStatus('This figure\'s drawing data is missing or damaged, so it cannot be edited visually.');
      return;
    }
    ed.loadDocument(diagram, { markSaved: true });
    const caption = /\\caption(?:of\{figure\})?\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(block.text)?.[1] ?? '';
    const label = /\\label\{([^}]*)\}/.exec(block.text)?.[1] ?? '';
    const placement: Placement = /\\begin\{figure\*?\}/.test(block.text) ? 'float' : 'here';
    set({
      caret: null,
      leftTab: 'figure',
      frame: {
        mode: 'edit',
        target: { file: block.file, offset: block.start, after: false, indent: block.indent, blockKey: block.key },
        blockKey: block.key,
        figureId: block.figureId!,
        caption: unescapeCaption(caption),
        label,
        placement,
        height: 420,
      },
    });
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        const r = document.querySelector('.canvas-shell')?.getBoundingClientRect();
        if (r && r.width > 0) useEditor.getState().fitToView({ width: r.width, height: r.height });
      });
    }
  },

  updateFrame: (patch) => {
    const f = get().frame;
    if (f) set({ frame: { ...f, ...patch } });
  },

  cancelFrame: () => {
    useEditor.getState().loadDocument(emptyDiagram('Figure'), { markSaved: true });
    set({ frame: null, leftTab: 'files' });
  },

  commitFrame: async () => {
    const { frame, project, doc } = get();
    const ed = useEditor.getState();
    if (!frame || !project || !doc) return false;
    const diagram = ed.doc;
    if (diagram.order.length === 0) {
      ed.setStatus('The drawing is empty. Add a shape (or a template) first, or press Cancel.');
      return false;
    }
    const { documentStyle, slugLabel, planInsert, planReplace, access } = L();
    const style = documentStyle(doc.bodyFiles.map((p) => project.files[p]?.text ?? ''));
    let label = frame.label.trim();
    if (frame.caption.trim() && !label) {
      const taken = new Set(doc.blocks.flatMap((b) => b.labels));
      const base = style.labelPrefix + slugLabel(frame.caption, `flowtikz-${frame.figureId}`);
      label = base;
      for (let n = 2; taken.has(label); n++) label = `${base}-${n}`;
    }
    const opts = { id: frame.figureId, caption: frame.caption, label, placement: frame.placement };
    try {
      const files = access(project);
      const edits =
        frame.mode === 'edit' && frame.blockKey
          ? await planReplace(doc, files, diagram, doc.blocks.find((b) => b.key === frame.blockKey)!, opts)
          : await planInsert(doc, files, diagram, frame.target, opts);
      applyEdits(get, set, edits);
      ed.loadDocument(emptyDiagram('Figure'), { markSaved: true });
      set({ frame: null, leftTab: 'source', activeFile: frame.target.file });
      ed.setStatus(frame.mode === 'edit' ? 'Figure updated in the document.' : `Drawing added to ${frame.target.file}. The text after it moved down; Ctrl+Z takes it out again.`);
      return true;
    } catch (err) {
      ed.setStatus(err instanceof Error ? err.message : 'The drawing could not be added.');
      return false;
    }
  },

  removeFigure: (block) => {
    const { project, doc } = get();
    if (!project || !doc) return;
    applyEdits(get, set, L().planRemove(doc, L().access(project), block));
    useEditor.getState().setStatus('Figure removed from the document. Ctrl+Z brings it back.');
  },

  undo: () => {
    const { past, project } = get();
    if (!project || !past.length) return;
    const snap = past[past.length - 1];
    const redo: Snapshot = {};
    for (const p of Object.keys(snap)) {
      redo[p] = project.files[p].text ?? '';
      project.files[p].text = snap[p];
    }
    set({ past: past.slice(0, -1), future: [redo, ...get().future].slice(0, HISTORY), doc: reparse(project), version: get().version + 1, caret: null });
    useEditor.getState().setStatus('Undid the last change to the document.');
  },

  redo: () => {
    const { future, project } = get();
    if (!project || !future.length) return;
    const snap = future[0];
    const undo: Snapshot = {};
    for (const p of Object.keys(snap)) {
      undo[p] = project.files[p].text ?? '';
      project.files[p].text = snap[p];
    }
    set({ future: future.slice(1), past: [...get().past, undo].slice(-HISTORY), doc: reparse(project), version: get().version + 1, caret: null });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  download: async () => {
    const { project } = get();
    if (!project || get().exporting) return;
    set({ exporting: true });
    try {
      const blob = await L().exportProject(project);
      downloadBlob(blob, `${project.name}-flowtikz.zip`);
      set({ savedVersion: get().version });
      useEditor.getState().setStatus(`Saved ${project.name}-flowtikz.zip with ${get().dirtyCount()} changed file(s). Upload it to Overleaf as a new project.`);
    } catch (err) {
      useEditor.getState().setStatus(err instanceof Error ? `Export failed: ${err.message}` : 'Export failed.');
    } finally {
      set({ exporting: false });
    }
  },

  dirtyCount: () => {
    const p = get().project;
    return p && lib ? lib.modifiedPaths(p).length : 0;
  },

  mainText: () => {
    const p = get().project;
    return p ? p.files[p.mainPath]?.text ?? '' : '';
  },
}));

function applyEdits(get: () => ProjectState, set: (p: Partial<ProjectState>) => void, edits: Map<string, string>) {
  const project = get().project!;
  const before: Snapshot = {};
  for (const [p, t] of edits) {
    if (!project.files[p]) continue;
    before[p] = project.files[p].text ?? '';
    project.files[p].text = t;
  }
  if (!Object.keys(before).length) return;
  set({ past: [...get().past, before].slice(-HISTORY), future: [], doc: reparse(project), version: get().version + 1, caret: null });
}

/** After the last visible block (or at the top of an empty body). */
export function endTarget(doc: ProjectDocument): Caret {
  const vis = doc.blocks.filter((b) => !b.hidden);
  const last = vis[vis.length - 1];
  if (last) return { file: last.file, offset: last.end, after: true, indent: last.indent, blockKey: last.key };
  return { file: doc.mainPath, offset: Math.max(0, doc.outline.bodyStart), after: true, indent: '', blockKey: '__empty__' };
}

function unescapeCaption(s: string): string {
  return s
    .replace(/\\textbackslash\{\}/g, '\\')
    .replace(/\\textasciitilde\{\}/g, '~')
    .replace(/\\textasciicircum\{\}/g, '^')
    .replace(/\\([#$%&_{}])/g, '$1');
}
