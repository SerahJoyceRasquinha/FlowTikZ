import { memo, useEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import { useEditor } from '../state/store';
import { generateLatex, GeneratedBlock } from '../latex/generator';
import { tokenizeDocument, findMatches } from '../latex/highlight';
import { copyToClipboard, downloadText, slugify } from '../export/file';
import { summarizeIssues } from '../latex/validate';

const LINE_HEIGHT = 19;

function CodeLines({
  code,
  highlighted,
  matchLines,
  activeMatch,
  onLineClick,
}: {
  code: string;
  highlighted: Set<number>;
  matchLines: number[];
  activeMatch: number | null;
  onLineClick: (line: number) => void;
}) {
  const lines = useMemo(() => tokenizeDocument(code), [code]);
  const matchSet = useMemo(() => new Set(matchLines), [matchLines]);

  return (
    <div className="code-body">
      <div className="gutter" aria-hidden="true">
        {lines.map((_, i) => (
          <div
            key={i}
            className={`gutter-line${highlighted.has(i + 1) ? ' traced' : ''}`}
          >
            {i + 1}
          </div>
        ))}
      </div>
      <pre className="code-text">
        {lines.map((tokens, i) => {
          const n = i + 1;
          const classes = [
            'code-line',
            highlighted.has(n) ? 'traced' : '',
            matchSet.has(n) ? 'match' : '',
            activeMatch === n ? 'match-active' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={i} className={classes} onClick={() => onLineClick(n)}>
              {tokens.map((t, j) => (
                <span key={j} className={`tk-${t.kind}`}>
                  {t.value}
                </span>
              ))}
              {tokens.length === 0 ? ' ' : null}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

const MemoCodeLines = memo(CodeLines);

export function CodePanel() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const outputMode = useEditor((s) => s.outputMode);
  const showComments = useEditor((s) => s.showComments);
  const setOutputMode = useEditor((s) => s.setOutputMode);
  const setShowComments = useEditor((s) => s.setShowComments);
  const setSelection = useEditor((s) => s.setSelection);
  const setStatus = useEditor((s) => s.setStatus);

  // Deferring keeps dragging at 60fps: the canvas updates immediately and the
  // code catches up on the next idle frame instead of blocking the gesture.
  const deferredDoc = useDeferredValue(doc);
  const stale = deferredDoc !== doc;

  const result = useMemo(
    () => generateLatex(deferredDoc, { mode: outputMode, comments: showComments }),
    [deferredDoc, outputMode, showComments],
  );

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(
    () => findMatches(result.code, query),
    [result.code, query],
  );

  const tracedLines = useMemo(() => {
    const set = new Set<number>();
    const selected = new Set(selection);
    for (const b of result.blocks as GeneratedBlock[]) {
      if (selected.has(b.objectId)) {
        for (let l = b.startLine; l <= b.endLine; l++) set.add(l);
      }
    }
    return set;
  }, [result.blocks, selection]);

  // Scroll the traced block into view when the canvas selection changes.
  useEffect(() => {
    if (tracedLines.size === 0 || !scrollRef.current) return;
    const first = Math.min(...tracedLines);
    const el = scrollRef.current;
    if (typeof el.scrollTo !== 'function') return;
    const target = (first - 3) * LINE_HEIGHT;
    if (target < el.scrollTop || target > el.scrollTop + el.clientHeight - 60) {
      el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  }, [tracedLines]);

  useEffect(() => {
    if (!matches.length || !scrollRef.current) return;
    if (typeof scrollRef.current.scrollTo !== 'function') return;
    const line = matches[matchIndex % matches.length];
    scrollRef.current.scrollTo({
      top: Math.max(0, (line - 5) * LINE_HEIGHT),
      behavior: 'smooth',
    });
  }, [matchIndex, matches]);

  const onLineClick = (line: number) => {
    const block = result.blocks.find(
      (b) => line >= b.startLine && line <= b.endLine,
    );
    if (block) setSelection([block.objectId]);
  };

  const counts = summarizeIssues(result.issues);
  const filename = slugify(doc.name);

  return (
    <section className="code-panel" aria-label="Generated LaTeX">
      <header className="panel-head">
        <div className="panel-title">
          <span className="eyebrow">TikZ output</span>
          <h2>{outputMode === 'standalone' ? 'Standalone document' : 'Picture snippet'}</h2>
        </div>
        <div className="segmented" role="group" aria-label="Output mode">
          <button
            className={outputMode === 'standalone' ? 'on' : ''}
            onClick={() => setOutputMode('standalone')}
          >
            Standalone
          </button>
          <button
            className={outputMode === 'snippet' ? 'on' : ''}
            onClick={() => setOutputMode('snippet')}
          >
            Snippet
          </button>
        </div>
      </header>

      <div className="code-actions">
        <button
          className="btn"
          onClick={async () => {
            const ok = await copyToClipboard(result.code);
            setStatus(ok ? 'LaTeX copied to the clipboard.' : 'Copy failed. Select the code and copy manually.');
          }}
        >
          Copy
        </button>
        <button
          className="btn"
          onClick={() => {
            downloadText(
              result.code,
              `${filename}.tex`,
              'application/x-tex',
            );
            setStatus(`Saved ${filename}.tex`);
          }}
        >
          Download .tex
        </button>
        <button
          className={`btn${searchOpen ? ' on' : ''}`}
          onClick={() => setSearchOpen((v) => !v)}
        >
          Search
        </button>
        <label className="checkline">
          <input
            type="checkbox"
            checked={showComments}
            onChange={(e) => setShowComments(e.target.checked)}
          />
          Comments
        </label>
        <span className="spacer" />
        <span className="meta">
          {result.lineCount} lines · {result.colorCount} colours
          {stale ? ' · updating' : ''}
        </span>
      </div>

      {searchOpen && (
        <div className="search-row">
          <input
            autoFocus
            value={query}
            placeholder="Find in generated code"
            onChange={(e) => {
              setQuery(e.target.value);
              setMatchIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setMatchIndex((i) => i + 1);
              if (e.key === 'Escape') setSearchOpen(false);
              e.stopPropagation();
            }}
          />
          <span className="meta">
            {matches.length
              ? `${(matchIndex % matches.length) + 1} of ${matches.length}`
              : query
                ? 'no matches'
                : ''}
          </span>
        </div>
      )}

      <div className="code-scroll" ref={scrollRef}>
        <MemoCodeLines
          code={result.code}
          highlighted={tracedLines}
          matchLines={matches}
          activeMatch={matches.length ? matches[matchIndex % matches.length] : null}
          onLineClick={onLineClick}
        />
      </div>

      <footer className={`issues${counts.errors ? ' has-error' : ''}`}>
        {result.issues.length === 0 ? (
          <span className="ok">
            Ready to compile — {result.libraries.length
              ? `libraries: ${result.libraries.join(', ')}`
              : 'no extra TikZ libraries needed'}
          </span>
        ) : (
          <details open={counts.errors > 0}>
            <summary>
              {counts.errors > 0 && <b className="sev-error">{counts.errors} errors</b>}
              {counts.warnings > 0 && <b className="sev-warn">{counts.warnings} warnings</b>}
              {counts.infos > 0 && <b className="sev-info">{counts.infos} notes</b>}
            </summary>
            <ul>
              {result.issues.slice(0, 40).map((issue, i) => (
                <li key={i} className={`sev-${issue.severity}`}>
                  {issue.objectId && (
                    <button
                      className="link"
                      onClick={() => setSelection([issue.objectId!])}
                    >
                      {issue.objectId}
                    </button>
                  )}
                  {issue.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </footer>
    </section>
  );
}
