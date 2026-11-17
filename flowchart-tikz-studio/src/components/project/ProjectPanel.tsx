import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useProject } from '../../state/projectStore';
import { useEditor } from '../../state/store';
import { tokenizeLine } from '../../latex/highlight';
import { copyToClipboard, downloadText } from '../../export/file';
import { modifiedPaths, type LatexProject } from '../../project/project';
import { CodePanel } from '../CodePanel';
import { Icon } from '../Icon';

/**
 * Left side in project mode: the project's files, the LaTeX of any file
 * (with FlowTikZ's additions highlighted), and while drawing, the figure's
 * own generated code.
 */

const LINE = 19;

interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  children: TreeNode[];
  size: number;
}

export function buildTree(paths: string[], sizes: Record<string, number>): TreeNode {
  const root: TreeNode = { name: '', path: '', dir: true, children: [], size: 0 };
  for (const p of paths) {
    const parts = p.split('/');
    let cur = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');
      let child = cur.children.find((c) => c.name === part && c.dir === !isFile);
      if (!child) {
        child = { name: part, path, dir: !isFile, children: [], size: 0 };
        cur.children.push(child);
      }
      child.size += sizes[p] ?? 0;
      cur = child;
    });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true })));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

const ICON: Record<string, string> = { tex: 'file', bib: 'book', style: 'file', image: 'image', pdf: 'file', data: 'file', other: 'file' };

function FileTree({ project, version }: { project: LatexProject; version: number }) {
  const setActive = useProject((s) => s.setActiveFile);
  const setMain = useProject((s) => s.setMain);
  const active = useProject((s) => s.activeFile);
  const tree = useMemo(
    () => buildTree(project.order, Object.fromEntries(project.order.map((p) => [p, project.files[p].size]))),
    [project],
  );
  const edited = useMemo(() => new Set(modifiedPaths(project)), [project, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const mainDirs = useMemo(() => {
    const s = new Set<string>();
    const parts = project.mainPath.split('/');
    for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join('/'));
    return s;
  }, [project.mainPath]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const candidates = new Set(project.detection.candidates.map((c) => c.path));
  const [shown, setShown] = useState(400);

  let rendered = 0;
  const rows: JSX.Element[] = [];
  const walk = (n: TreeNode, depth: number) => {
    for (const c of n.children) {
      if (rendered >= shown) return;
      rendered++;
      const isOpen = open[c.path] ?? (depth === 0 || mainDirs.has(c.path) || project.order.length < 60);
      if (c.dir) {
        rows.push(
          <button key={c.path} className="ft-row ft-dir" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setOpen((o) => ({ ...o, [c.path]: !isOpen }))} aria-expanded={isOpen}>
            <span className="ft-caret">{isOpen ? '▾' : '▸'}</span>
            <Icon name="folder" size={14} />
            <span className="ft-name">{c.name}</span>
            <span className="ft-size">{formatSize(c.size)}</span>
          </button>,
        );
        if (isOpen) walk(c, depth + 1);
      } else {
        const f = project.files[c.path];
        const isText = f.text !== undefined;
        rows.push(
          <div key={c.path} className={`ft-row ft-file${active === c.path ? ' on' : ''}`} style={{ paddingLeft: 22 + depth * 14 }}>
            <button className="ft-open" onClick={() => isText && setActive(c.path)} disabled={!isText} title={isText ? `Show ${c.path}` : f.error ? `${c.path} ${f.error}` : c.path}>
              <Icon name={ICON[f.kind]} size={14} />
              <span className="ft-name">{c.name}</span>
            </button>
            {c.path === project.mainPath && <span className="ft-badge main">main</span>}
            {edited.has(c.path) && <span className="ft-badge edited">edited</span>}
            {c.path !== project.mainPath && candidates.has(c.path) && (
              <button className="ft-badge ft-set-main" onClick={() => setMain(c.path)} title="Use this file as the main document">
                set as main
              </button>
            )}
            <span className="ft-size">{formatSize(f.size)}</span>
          </div>,
        );
      }
    }
  };
  walk(tree, 0);

  return (
    <div className="ft" role="tree" aria-label="Project files">
      {rows}
      {rendered >= shown && (
        <button className="btn tiny ft-more" onClick={() => setShown((s) => s + 2000)}>
          Show more files…
        </button>
      )}
      {project.warnings.length > 0 && (
        <details className="ft-warnings">
          <summary>{project.warnings.length} note{project.warnings.length > 1 ? 's' : ''} about this project</summary>
          <ul>
            {project.warnings.slice(0, 50).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** A long file, drawn only where it is visible. */
const SourceView = memo(function SourceView({ text, path }: { text: string; path: string; version: number }) {
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const marks = useMemo(() => {
    const set = new Set<number>();
    let inside = false;
    lines.forEach((l, i) => {
      if (/FlowTikZ (figure .*\(begin\)|: packages|: colours)/.test(l)) inside = true;
      if (inside) set.add(i);
      if (/FlowTikZ (figure .*\(end\)|: end of)/.test(l)) inside = false;
    });
    return set;
  }, [lines]);
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setHeight(el.clientHeight || 600);
    // Jump to the first FlowTikZ figure, which is what the user just added.
    const first = [...marks].find((i) => /FlowTikZ figure .*\(begin\)/.test(lines[i]));
    if (first !== undefined && typeof el.scrollTo === 'function') el.scrollTo({ top: Math.max(0, (first - 4) * LINE) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, text]);
  const from = Math.max(0, Math.floor(top / LINE) - 20);
  const to = Math.min(lines.length, Math.ceil((top + height) / LINE) + 20);
  const gutter = String(lines.length).length;
  return (
    <div className="pj-source code-scroll" ref={ref} onScroll={(e) => setTop((e.target as HTMLElement).scrollTop)} tabIndex={0} aria-label={`Source of ${path}`}>
      <div style={{ height: lines.length * LINE, position: 'relative' }}>
        <div style={{ position: 'absolute', top: from * LINE, left: 0, right: 0 }}>
          {lines.slice(from, to).map((l, i) => {
            const n = from + i;
            return (
              <div key={n} className={`pj-line${marks.has(n) ? ' added' : ''}`} style={{ height: LINE }}>
                <span className="pj-gutter" style={{ width: `${gutter + 1}ch` }}>
                  {n + 1}
                </span>
                <span className="pj-code">
                  {l.length > 2000 ? (
                    <span className="tk-text">{l.slice(0, 2000)}…</span>
                  ) : (
                    tokenizeLine(l).map((t, j) => (
                      <span key={j} className={`tk-${t.kind}`}>
                        {t.value}
                      </span>
                    ))
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export function ProjectPanel() {
  const project = useProject((s) => s.project);
  const version = useProject((s) => s.version);
  const tab = useProject((s) => s.leftTab);
  const setTab = useProject((s) => s.setLeftTab);
  const active = useProject((s) => s.activeFile);
  const setActive = useProject((s) => s.setActiveFile);
  const frame = useProject((s) => s.frame);
  const download = useProject((s) => s.download);
  const exporting = useProject((s) => s.exporting);
  const close = useProject((s) => s.close);
  const setStatus = useEditor((s) => s.setStatus);
  if (!project) return null;
  const file = active ? project.files[active] : project.files[project.mainPath];
  const shownPath = file?.path ?? project.mainPath;
  const texFiles = project.order.filter((p) => project.files[p].text !== undefined);
  const edited = modifiedPaths(project);

  return (
    <section className="code-panel pj-panel" aria-label="LaTeX project" data-tour="code">
      <header className="panel-head">
        <div className="panel-title">
          <span className="eyebrow">LaTeX project</span>
          <h2 title={project.name}>{project.name}</h2>
          <span className="pj-main">
            Main file: <code>{project.mainPath}</code>
            {edited.length > 0 && <span className="ft-badge edited">{edited.length} edited</span>}
          </span>
        </div>
        <button className="btn tiny ghost" onClick={close} title="Close the project and go back to the plain drawing board" data-action="close-project">
          <Icon name="x" size={14} /> Close
        </button>
      </header>

      <div className="code-actions">
        <button className="btn success" onClick={() => void download()} disabled={exporting} data-action="download-project" title="Download the whole project, with your drawings, as a .zip (Ctrl+S)">
          <Icon name="download" size={16} />
          {exporting ? 'Preparing…' : 'Download .zip'}
        </button>
        <button
          className="btn"
          data-action="copy-project-tex"
          title={`Copy the LaTeX of ${shownPath}`}
          onClick={async () => {
            const ok = await copyToClipboard(file?.text ?? '');
            setStatus(ok ? `Copied ${shownPath}.` : 'Copy failed. Select the code and copy it manually.');
          }}
        >
          <Icon name="copy" size={16} />
          Copy LaTeX
        </button>
        <button
          className="btn"
          title={`Download ${shownPath} on its own`}
          onClick={() => {
            downloadText(file?.text ?? '', shownPath.split('/').pop() ?? 'main.tex', 'application/x-tex');
            setStatus(`Saved ${shownPath.split('/').pop()}.`);
          }}
        >
          .tex
        </button>
      </div>

      <div className="segmented pj-tabs" role="tablist" aria-label="Project views">
        <button role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')} data-pj-tab="files">
          Files
        </button>
        <button role="tab" aria-selected={tab === 'source'} className={tab === 'source' ? 'on' : ''} onClick={() => setTab('source')} data-pj-tab="source">
          LaTeX
        </button>
        <button role="tab" aria-selected={tab === 'figure'} className={tab === 'figure' ? 'on' : ''} onClick={() => setTab('figure')} disabled={!frame} data-pj-tab="figure" title={frame ? 'The code of the drawing you are making' : 'Open a drawing in the document first'}>
          Drawing code
        </button>
      </div>

      {tab === 'files' && <FileTree project={project} version={version} />}
      {tab === 'source' && (
        <>
          <div className="pj-file-pick">
            <select value={shownPath} onChange={(e) => setActive(e.target.value)} aria-label="File to show" onKeyDown={(e) => e.stopPropagation()}>
              {texFiles.map((p) => (
                <option key={p} value={p}>
                  {p}
                  {p === project.mainPath ? ' (main)' : ''}
                  {edited.includes(p) ? ' • edited' : ''}
                </option>
              ))}
            </select>
          </div>
          <SourceView text={file?.text ?? ''} path={shownPath} version={version} />
        </>
      )}
      {tab === 'figure' && frame && (
        <div className="pj-figure-code">
          <CodePanel />
        </div>
      )}
    </section>
  );
}
