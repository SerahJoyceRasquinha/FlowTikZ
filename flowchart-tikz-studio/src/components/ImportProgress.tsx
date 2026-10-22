import { useEffect, useState } from 'react';
import { useImport, ReferenceMode } from '../state/importStore';
import { cancelImport, dismissImport } from '../import/controller';
import { STAGE_LABELS, IMPORT_ERROR_MESSAGES } from '../import/types';
import { attentionCount } from '../import/report';
import { downloadText, slugify } from '../export/file';

/**
 * Import progress, docked over the corner of the canvas.
 *
 * It is not a modal: the editor stays usable while an import runs in the
 * background. Progress is shown as the real stages of the pipeline - there
 * is no invented percentage - with the elapsed time.
 */

const REFERENCE_MODES: { value: ReferenceMode; label: string }[] = [
  { value: 'off', label: 'Reconstructed' },
  { value: 'original', label: 'Original' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'difference', label: 'Difference' },
];

function useElapsed(running: boolean, startedAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
}

export function ImportProgress() {
  const session = useImport((s) => s.session);
  const reference = useImport((s) => s.reference);
  const setReferenceMode = useImport((s) => s.setReferenceMode);
  const setReportOpen = useImport((s) => s.setReportOpen);
  const [showDetail, setShowDetail] = useState(false);
  const running = session?.status === 'running';
  const elapsed = useElapsed(running, session?.startedAt);

  useEffect(() => setShowDetail(false), [session?.id]);
  if (!session) return null;

  const { status } = session;
  const title =
    status === 'running'
      ? 'Importing'
      : status === 'done'
        ? 'Import complete'
        : status === 'cancelled'
          ? 'Import cancelled'
          : 'Import failed';
  const report = session.report;
  const attention = report ? attentionCount(report) : 0;

  return (
    <section
      className={`import-panel is-${status}`}
      role="status"
      aria-live="polite"
      aria-label="Import progress"
    >
      <header className="import-panel-head">
        <div>
          <span className="eyebrow">{title}</span>
          <h3 title={session.fileName}>{session.fileName}</h3>
          {session.formatLabel && <p className="import-format">{session.formatLabel}</p>}
        </div>
        {running ? (
          <button className="btn tiny" onClick={cancelImport}>
            Cancel
          </button>
        ) : (
          <button className="btn tiny ghost" onClick={dismissImport} aria-label="Dismiss import panel">
            Close
          </button>
        )}
      </header>

      {running && (
        <>
          <ol className="import-stages">
            {session.stages.map((st) => {
              const done = session.done.includes(st);
              const current = session.current === st;
              return (
                <li key={st} className={done ? 'done' : current ? 'current' : 'todo'} aria-current={current ? 'step' : undefined}>
                  <span className="mark" aria-hidden="true">
                    {done ? '✓' : current ? '' : '·'}
                  </span>
                  {STAGE_LABELS[st]}
                </li>
              );
            })}
          </ol>
          <div className="import-indeterminate" aria-hidden="true">
            <span />
          </div>
          <p className="import-note">
            {session.note ??
              (session.current === 'analyze' ? `Recognising offline… ${elapsed} s` : `${elapsed} s elapsed`)}
            {session.inWorker ? ' · running in the background' : ''}
          </p>
        </>
      )}

      {status === 'done' && report && (
        <div className="import-summary">
          <p>
            {report.counts.shapes} shape{report.counts.shapes === 1 ? '' : 's'}, {report.counts.texts} text
            {report.counts.texts === 1 ? '' : 's'}, {report.counts.connectors} connector
            {report.counts.connectors === 1 ? '' : 's'}
            {report.counts.groups ? `, ${report.counts.groups} group${report.counts.groups === 1 ? '' : 's'}` : ''} — all
            editable. LaTeX updated.
          </p>
          <p className={attention ? 'import-attention' : 'import-ok'}>
            {attention ? `${attention} item${attention === 1 ? '' : 's'} to review` : 'Nothing needed approximating.'}
          </p>
          <div className="button-row">
            <button className="btn tiny" onClick={() => setReportOpen(true)}>
              View report
            </button>
            {session.svg && (
              <button
                className="btn tiny"
                onClick={() => downloadText(session.svg!, `${slugify(session.fileName.replace(/\.[^.]+$/, ''))}-reconstructed.svg`, 'image/svg+xml')}
                title="The intermediate SVG reconstruction the diagram was built from"
              >
                Reconstruction SVG
              </button>
            )}
          </div>
          {reference && (
            <div className="import-compare">
              <span className="eyebrow">Compare with source image</span>
              <div className="segmented" role="group" aria-label="Reference image">
                {REFERENCE_MODES.map((m) => (
                  <button
                    key={m.value}
                    className={reference.mode === m.value ? 'on' : ''}
                    onClick={() => setReferenceMode(m.value)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {status === 'error' && session.error && (
        <div className="import-error" role="alert">
          <p>{session.error.message || IMPORT_ERROR_MESSAGES[session.error.code]}</p>
          <p className="import-note">Your diagram was not changed.</p>
          {session.error.detail && (
            <>
              <button className="link" onClick={() => setShowDetail((v) => !v)}>
                {showDetail ? 'Hide details' : 'Details'}
              </button>
              {showDetail && <p className="import-detail">{session.error.detail}</p>}
            </>
          )}
        </div>
      )}

      {status === 'cancelled' && <p className="import-note">The diagram was not changed.</p>}
    </section>
  );
}
