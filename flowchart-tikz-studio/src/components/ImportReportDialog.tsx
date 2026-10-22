import { useImport } from '../state/importStore';
import { useEditor } from '../state/store';
import { CATEGORY_LABELS, groupReport } from '../import/report';

/**
 * The conversion report: what was converted exactly, what was approximated,
 * what was kept as metadata, what could not be imported. Entries that concern
 * one object link to it - clicking selects it on the canvas (and so
 * highlights its LaTeX), exactly like the issue list under the code panel.
 */
export function ImportReportDialog() {
  const open = useImport((s) => s.reportOpen);
  const session = useImport((s) => s.session);
  const setOpen = useImport((s) => s.setReportOpen);
  const setSelection = useEditor((s) => s.setSelection);
  const doc = useEditor((s) => s.doc);
  const report = session?.report;
  if (!open || !report) return null;

  const groups = groupReport(report);
  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div
        className="modal import-report"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-report-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      >
        <header>
          <span className="eyebrow">Conversion report · {report.format}</span>
          <h2 id="import-report-title">{report.fileName}</h2>
          <button className="btn ghost" onClick={() => setOpen(false)}>
            Close
          </button>
        </header>
        <p className="import-dialog-lede">
          {report.counts.shapes} shapes, {report.counts.texts} text labels, {report.counts.connectors} connectors,{' '}
          {report.counts.groups} groups
          {report.durationMs !== undefined ? ` · ${(report.durationMs / 1000).toFixed(1)} s` : ''}. Source properties the
          editor cannot show exactly are kept on each object as metadata and are saved with the diagram.
        </p>
        {groups.map((g) => (
          <section key={g.category} className={`report-group cat-${g.category}`}>
            <h3>
              {CATEGORY_LABELS[g.category]} <span className="count">{g.entries.length}</span>
            </h3>
            <ul>
              {g.entries.map((e, i) => (
                <li key={i}>
                  {e.objectId && (doc.nodes[e.objectId] || doc.edges[e.objectId]) && (
                    <button
                      className="link"
                      onClick={() => {
                        setSelection([e.objectId!]);
                        setOpen(false);
                      }}
                    >
                      {e.objectId}
                    </button>
                  )}
                  {e.message}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
