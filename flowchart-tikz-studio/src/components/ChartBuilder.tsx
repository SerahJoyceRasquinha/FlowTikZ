import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../state/store';
import type { ChartSpec, ChartType, ColumnType, DataTable } from '../charts/types';
import { chartTypeLabel } from '../charts/types';
import {
  DATA_ACCEPT,
  DataImportError,
  Workbook,
  parseCsvText,
  readDataFile,
  retypeColumn,
  sampleSalesTable,
} from '../charts/parse';
import { adaptSpecToType, DEFAULT_CHART_SIZE, suggestSpec } from '../charts/defaults';
import { layoutChart } from '../charts/layout';
import { ChartLayoutView } from '../canvas/ChartView';
import { ChartTypePicker } from './chart/ChartTypePicker';
import { ChartFields, TypeBadge } from './chart/ChartFields';

/**
 * "Chart from data": import a table, choose a chart and its fields, insert.
 *
 * Two steps, like Power BI's Get Data -> Visualizations: first the data
 * (file, paste or sample) with a typed preview, then the chart with a live
 * preview. Everything after insertion is edited in the property panel.
 */

function cellText(v: string | number | null): string {
  if (v === null) return '';
  return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 6 }) : v;
}

/** Keep the field choices that still exist in a replacement table. */
function carryOver(prev: ChartSpec, table: DataTable): ChartSpec {
  const names = new Set(table.columns.map((c) => c.name));
  const fresh = suggestSpec(table, prev.type);
  const keep: ChartSpec = {
    ...prev,
    data: table,
    x: prev.x && names.has(prev.x) ? prev.x : fresh.x,
    values: prev.values.filter((v) => v.field === null || names.has(v.field)),
    legend: prev.legend && names.has(prev.legend) ? prev.legend : null,
    filters: prev.filters.filter((f) => names.has(f.field)),
  };
  if (keep.values.length === 0) keep.values = fresh.values;
  return adaptSpecToType(keep, prev.type);
}

export function ChartBuilder() {
  const builder = useEditor((s) => s.chartBuilder);
  const open = useEditor((s) => s.openChartBuilder);
  const doc = useEditor((s) => s.doc);
  const editingNode = builder?.mode === 'edit' ? doc.nodes[builder.nodeId] : null;

  const [step, setStep] = useState<'data' | 'build'>('data');
  const [table, setTable] = useState<DataTable | null>(null);
  const [spec, setSpec] = useState<ChartSpec | null>(null);
  const [workbook, setWorkbook] = useState<{ wb: Workbook; sheet: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset whenever the dialog opens.
  useEffect(() => {
    if (!builder) return;
    setError(null);
    setWarnings([]);
    setPasteOpen(false);
    setPasteText('');
    setWorkbook(null);
    if (builder.mode === 'edit' && editingNode?.chart) {
      setTable(editingNode.chart.data);
      setSpec(editingNode.chart);
      setStep('build');
    } else {
      setTable(null);
      setSpec(null);
      setStep('data');
    }
    setTimeout(() => dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builder]);

  const preview = useMemo(() => (spec ? layoutChart(spec, DEFAULT_CHART_SIZE.w, DEFAULT_CHART_SIZE.h) : null), [spec]);

  if (!builder) return null;
  const close = () => open(null);

  const accept = (t: DataTable, w: string[]) => {
    setTable(t);
    setWarnings(w);
    setError(null);
    setSpec((prev) => (prev ? carryOver(prev, t) : suggestSpec(t)));
  };

  const loadFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const src = await readDataFile(file.name, bytes);
      if (src.kind === 'workbook') {
        const first = src.workbook.sheets[0].name;
        setWorkbook({ wb: src.workbook, sheet: first });
        const parsed = await src.workbook.readSheet(first);
        accept(parsed.table, parsed.warnings);
      } else {
        setWorkbook(null);
        accept(src.parsed.table, src.parsed.warnings);
      }
    } catch (err) {
      setError(err instanceof DataImportError ? err.message : `That file could not be read${err instanceof Error ? `: ${err.message}` : '.'}`);
    } finally {
      setBusy(false);
    }
  };

  const switchSheet = async (name: string) => {
    if (!workbook) return;
    setBusy(true);
    try {
      const parsed = await workbook.wb.readSheet(name);
      setWorkbook({ ...workbook, sheet: name });
      accept(parsed.table, parsed.warnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That sheet could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const usePaste = () => {
    try {
      const parsed = parseCsvText(pasteText, 'Pasted data', 'paste');
      setWorkbook(null);
      accept(parsed.table, parsed.warnings);
      setPasteOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The pasted text could not be read as a table.');
    }
  };

  const setColumnType = (column: string, type: ColumnType) => {
    if (!table) return;
    const t = retypeColumn(table, column, type);
    setTable(t);
    setSpec((prev) => (prev ? adaptSpecToType({ ...prev, data: t }, prev.type) : suggestSpec(t)));
  };

  const insert = () => {
    if (!spec) return;
    const s = useEditor.getState();
    if (builder.mode === 'edit' && editingNode) {
      s.updateChart(editingNode.id, (c) => Object.assign(c, spec));
      s.setSelection([editingNode.id]);
      s.setStatus('Chart updated.');
    } else {
      const el = document.querySelector('.canvas-svg') as SVGSVGElement | null;
      const rect = el?.getBoundingClientRect();
      const v = s.view;
      const cx = ((rect?.width || 900) / 2 - v.panX) / v.zoom;
      const cy = ((rect?.height || 640) / 2 - v.panY) / v.zoom;
      const id = s.insertChart(spec, { x: cx, y: cy });
      // Selecting the chart widens the property panel, which narrows the board;
      // measure after that layout change, then bring the whole chart into view.
      const reveal = () => {
        const board = document.querySelector('.canvas-shell')?.getBoundingClientRect();
        if (board) useEditor.getState().revealNode(id, { width: board.width, height: board.height });
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(reveal));
      else reveal();
      s.setStatus('Chart inserted. Fine-tune colours, labels and fields in the panel on the right.');
    }
    close();
  };

  const rowsShown = table ? table.rows.slice(0, 8) : [];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={dialogRef}
        className="modal chart-builder"
        role="dialog"
        aria-modal="true"
        aria-label="Chart from data"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}
      >
        <header>
          <span className="eyebrow">{builder.mode === 'edit' ? 'Edit chart' : 'New chart'}</span>
          <h2>Chart from data</h2>
          <ol className="steps" aria-label="Steps">
            <li className={step === 'data' ? 'current' : 'done'}>
              <button type="button" className="step-btn" onClick={() => setStep('data')}>
                1. Data
              </button>
            </li>
            <li className={step === 'build' ? 'current' : ''}>
              <button type="button" className="step-btn" disabled={!table} onClick={() => table && setStep('build')}>
                2. Build the chart
              </button>
            </li>
          </ol>
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
        </header>

        {step === 'data' && (
          <div className="cb-data">
            <div
              className={`drop-zone${dragOver ? ' over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void loadFile(f);
              }}
            >
              <div className="drop-icon" aria-hidden="true">
                ⇪
              </div>
              <p className="drop-title">{busy ? 'Reading…' : 'Drop an Excel or CSV file here'}</p>
              <p className="note">.xlsx, .csv, .tsv or .txt — the first row should hold the column names</p>
              <div className="button-row center">
                <button className="btn primary" data-autofocus onClick={() => fileRef.current?.click()} disabled={busy}>
                  Browse for a file…
                </button>
                <button className="btn" onClick={() => setPasteOpen((v) => !v)}>
                  Paste from Excel
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setWorkbook(null);
                    accept(sampleSalesTable(), []);
                  }}
                >
                  Use sample sales data
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept={DATA_ACCEPT}
                style={{ display: 'none' }}
                aria-label="Data file"
                data-input="chart-data"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadFile(f);
                  e.target.value = '';
                }}
              />
            </div>

            {pasteOpen && (
              <div className="paste-box">
                <label htmlFor="cb-paste">Copy cells in Excel or Google Sheets (including the header row) and paste them here:</label>
                <textarea
                  id="cb-paste"
                  rows={6}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder={'Product\tRegion\tSales\nLaptop\tNorth\t50000'}
                />
                <div className="button-row">
                  <button className="btn primary" disabled={!pasteText.trim()} onClick={usePaste}>
                    Use pasted data
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p className="cb-error" role="alert">
                {error}
              </p>
            )}

            {table && (
              <div className="cb-preview-table">
                <div className="cb-table-head">
                  <div>
                    <b>{table.name}</b>
                    <span className="note">
                      {' '}
                      · {table.rows.length.toLocaleString('en-US')} rows · {table.columns.length} columns
                    </span>
                  </div>
                  {workbook && workbook.wb.sheets.length > 1 && (
                    <label className="inline-field">
                      Sheet
                      <select value={workbook.sheet} onChange={(e) => void switchSheet(e.target.value)} onKeyDown={(e) => e.stopPropagation()}>
                        {workbook.wb.sheets.map((s) => (
                          <option key={s.name} value={s.name}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {warnings.length > 0 && (
                  <ul className="cb-warnings">
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
                <p className="note">Check each column's type. Numbers can be summed and averaged; text and dates become categories.</p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {table.columns.map((c) => (
                          <th key={c.name}>
                            <div className="th-name">
                              <TypeBadge type={c.type} /> {c.name}
                            </div>
                            <select
                              aria-label={`Type of ${c.name}`}
                              value={c.type}
                              onChange={(e) => setColumnType(c.name, e.target.value as ColumnType)}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <option value="number">Number</option>
                              <option value="text">Text</option>
                              <option value="date">Date</option>
                            </select>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rowsShown.map((r, ri) => (
                        <tr key={ri}>
                          {r.map((v, ci) => (
                            <td key={ci} className={table.columns[ci].type === 'number' ? 'num' : ''}>
                              {cellText(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {table.rows.length > rowsShown.length && <p className="note">First {rowsShown.length} rows shown.</p>}
              </div>
            )}
          </div>
        )}

        {step === 'build' && spec && preview && (
          <div className="cb-build">
            <div className="cb-left">
              <h4>Chart type</h4>
              <ChartTypePicker value={spec.type} onChange={(t: ChartType) => setSpec(adaptSpecToType(spec, t))} />
              <ChartFields spec={spec} onChange={setSpec} />
            </div>
            <div className="cb-right">
              <div className="cb-preview-head">
                <h4>Preview</h4>
                <span className="note">
                  {chartTypeLabel(spec.type)} · {preview.result.rowCount.toLocaleString('en-US')} rows used
                </span>
              </div>
              <div className="cb-preview">
                <svg viewBox={`0 0 ${DEFAULT_CHART_SIZE.w} ${DEFAULT_CHART_SIZE.h}`} role="img" aria-label="Chart preview">
                  <rect width={DEFAULT_CHART_SIZE.w} height={DEFAULT_CHART_SIZE.h} fill="#ffffff" />
                  <ChartLayoutView layout={preview} />
                </svg>
              </div>
              {preview.warnings.length > 0 && (
                <ul className="cb-warnings">
                  {preview.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              <p className="note">
                The LaTeX will contain this chart's data, field names, colours and labels, so the spreadsheet is not needed in
                Overleaf. Colours, titles, legend and number format can be changed after inserting, in the panel on the right.
              </p>
            </div>
          </div>
        )}

        <footer className="cb-footer">
          {step === 'data' ? (
            <>
              <span className="note">{table ? 'Data loaded. Next, choose the chart and fields.' : 'Load some data to continue.'}</span>
              <button className="btn primary" disabled={!table} onClick={() => setStep('build')}>
                Next: build the chart →
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setStep('data')}>
                ← Change data
              </button>
              <button className="btn success" disabled={!spec || preview?.kind === 'empty'} onClick={insert} data-action="insert-chart">
                {builder.mode === 'edit' ? 'Apply changes' : 'Insert chart'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
