import { useMemo, useState } from 'react';
import type { Aggregation, ChartFilter, ChartSpec, ColumnType, DataColumn, ValueField } from '../../charts/types';
import { AGGREGATIONS, canStack, wellsFor } from '../../charts/types';
import { distinctValues, numericRange } from '../../charts/aggregate';

/**
 * Field wells - the Power BI "Visualizations" pane / Tableau shelves.
 *
 * Columns are dragged from the field list into Axis, Values, Legend and
 * Filters. Every well also has a drop-down, so the whole thing works without
 * a mouse (and without drag and drop) too.
 */

const DRAG_TYPE = 'application/x-flowtikz-field';

export function TypeBadge({ type }: { type: ColumnType }) {
  const label = type === 'number' ? '123' : type === 'date' ? 'Date' : 'Abc';
  const title = type === 'number' ? 'Number (measure)' : type === 'date' ? 'Date' : 'Text (category)';
  return (
    <span className={`type-badge t-${type}`} title={title} aria-label={title}>
      {label}
    </span>
  );
}

function FieldChip({ col, onPick }: { col: DataColumn; onPick?: () => void }) {
  return (
    <div
      className="field-chip"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, col.name);
        e.dataTransfer.setData('text/plain', col.name);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={`Drag "${col.name}" into a box below, or double-click to add it`}
      onDoubleClick={onPick}
    >
      <TypeBadge type={col.type} />
      <span className="chip-name">{col.name}</span>
      <span className="chip-grip" aria-hidden="true">⋮⋮</span>
    </div>
  );
}

function readDrop(e: React.DragEvent): string | null {
  const v = e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData('text/plain');
  return v || null;
}

function Well({
  label,
  hint,
  children,
  onDropField,
  accepts,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  onDropField: (name: string) => void;
  accepts: (name: string) => boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`well${over ? ' over' : ''}`}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes(DRAG_TYPE) || [...e.dataTransfer.types].includes('text/plain')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const name = readDrop(e);
        if (name && accepts(name)) onDropField(name);
      }}
    >
      <div className="well-head">
        <span className="well-label">{label}</span>
        {hint && <span className="well-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function FieldSelect({
  columns,
  value,
  onChange,
  placeholder,
  filter,
  allowNone = true,
  ariaLabel,
}: {
  columns: DataColumn[];
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder: string;
  filter?: (c: DataColumn) => boolean;
  allowNone?: boolean;
  ariaLabel: string;
}) {
  const list = filter ? columns.filter(filter) : columns;
  return (
    <select
      className="well-select"
      aria-label={ariaLabel}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {(allowNone || !value) && <option value="">{placeholder}</option>}
      {list.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name} ({c.type === 'number' ? 'number' : c.type})
        </option>
      ))}
    </select>
  );
}

function FilterEditor({
  spec,
  filter,
  onChange,
  onRemove,
}: {
  spec: ChartSpec;
  filter: ChartFilter;
  onChange: (f: ChartFilter) => void;
  onRemove: () => void;
}) {
  const col = spec.data.columns.find((c) => c.name === filter.field);
  const [query, setQuery] = useState('');
  const values = useMemo(() => (col && col.type !== 'number' ? distinctValues(spec.data, col.name) : []), [spec.data, col]);
  const range = useMemo(() => (col?.type === 'number' ? numericRange(spec.data, col.name) : null), [spec.data, col]);
  if (!col) return null;
  const included = filter.include ?? values;
  const shown = values.filter((v) => v.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 200);
  const set = (next: string[]) => onChange({ ...filter, include: next.length === values.length ? undefined : next });

  return (
    <div className="filter-card">
      <div className="filter-head">
        <TypeBadge type={col.type} />
        <b>{col.name}</b>
        <span className="filter-summary">
          {col.type === 'number'
            ? filter.min != null || filter.max != null
              ? 'range'
              : 'all'
            : filter.include
              ? `${filter.include.length} of ${values.length}`
              : 'all'}
        </span>
        <button type="button" className="icon-btn" onClick={onRemove} aria-label={`Remove filter on ${col.name}`} title="Remove filter">
          ×
        </button>
      </div>
      {col.type === 'number' ? (
        <div className="filter-range">
          <label>
            Min
            <input
              type="number"
              value={filter.min ?? ''}
              placeholder={range ? String(range.min) : ''}
              onChange={(e) => onChange({ ...filter, min: e.target.value === '' ? null : Number(e.target.value) })}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
          <label>
            Max
            <input
              type="number"
              value={filter.max ?? ''}
              placeholder={range ? String(range.max) : ''}
              onChange={(e) => onChange({ ...filter, max: e.target.value === '' ? null : Number(e.target.value) })}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
        </div>
      ) : (
        <>
          <div className="filter-tools">
            {values.length > 8 && (
              <input
                className="filter-search"
                placeholder="Search values"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            )}
            <button type="button" className="link" onClick={() => set(values)}>
              All
            </button>
            <button type="button" className="link" onClick={() => set([])}>
              None
            </button>
          </div>
          <div className="filter-values">
            {shown.map((v) => (
              <label key={v} className="checkline">
                <input
                  type="checkbox"
                  checked={included.includes(v)}
                  onChange={(e) => set(e.target.checked ? [...included, v] : included.filter((x) => x !== v))}
                />
                <span>{v}</span>
              </label>
            ))}
            {values.length > shown.length && !query && <p className="note">Showing 200 of {values.length}; search to find others.</p>}
          </div>
        </>
      )}
    </div>
  );
}

export function ChartFields({
  spec,
  onChange,
  showFieldList = true,
}: {
  spec: ChartSpec;
  onChange: (next: ChartSpec) => void;
  showFieldList?: boolean;
}) {
  const cols = spec.data.columns;
  const colType = (name: string | null) => cols.find((c) => c.name === name)?.type;
  const wells = wellsFor(spec.type);
  const set = (patch: Partial<ChartSpec>) => onChange({ ...spec, ...patch });

  const axisAccepts = (name: string) => (wells.axisNumeric ? colType(name) === 'number' : true);
  const valueAccepts = (name: string) => (spec.type === 'scatter' ? colType(name) === 'number' : true);
  const newValue = (name: string): ValueField => ({ field: name, agg: colType(name) === 'number' ? 'sum' : 'count' });

  const addValue = (name: string) => {
    if (spec.type === 'scatter' || !wells.multiValue) {
      set({ values: [newValue(name)] });
      return;
    }
    if (spec.values.some((v) => v.field === name)) return;
    // Replace an empty "count of records" placeholder rather than stacking up next to it.
    const kept = spec.values.filter((v) => v.field !== null);
    set({ values: [...kept, newValue(name)].slice(0, 12) });
  };
  const addFilter = (name: string) => {
    if (spec.filters.some((f) => f.field === name)) return;
    set({ filters: [...spec.filters, { field: name }] });
  };

  /** Double-click on a field: put it where Power BI would when its box is ticked. */
  const autoPlace = (name: string) => {
    const t = colType(name);
    if (spec.type === 'histogram') return set({ x: t === 'number' ? name : spec.x });
    if (spec.type === 'scatter') {
      if (t !== 'number') return set({ legend: name });
      return spec.x && spec.x !== name ? addValue(name) : set({ x: name });
    }
    if (t === 'number') return addValue(name);
    if (!spec.x || colType(spec.x) === 'number') return set({ x: name });
    if (wells.legend && spec.x !== name) return set({ legend: name });
    set({ x: name });
  };

  const xIsDate = colType(spec.x) === 'date';
  const seriesCount = spec.legend ? 2 : spec.values.length;

  return (
    <div className="chart-fields">
      {showFieldList && (
        <div className="field-list" aria-label="Fields in the data">
          <div className="well-head">
            <span className="well-label">Fields</span>
            <span className="well-hint">drag into a box, or double-click</span>
          </div>
          {cols.map((c) => (
            <FieldChip key={c.name} col={c} onPick={() => autoPlace(c.name)} />
          ))}
        </div>
      )}

      <div className="wells">
        <Well
          label={wells.axis}
          hint={spec.type === 'histogram' ? 'counts rows per bin' : undefined}
          accepts={axisAccepts}
          onDropField={(name) => set({ x: name })}
        >
          <FieldSelect
            ariaLabel={wells.axis}
            columns={cols}
            value={spec.x}
            placeholder="Choose a field…"
            filter={wells.axisNumeric ? (c) => c.type === 'number' : undefined}
            onChange={(v) => set({ x: v })}
          />
          {xIsDate && spec.type !== 'scatter' && spec.type !== 'histogram' && (
            <label className="inline-field">
              Group dates by
              <select
                value={spec.dateGroup}
                onChange={(e) => set({ dateGroup: e.target.value as ChartSpec['dateGroup'] })}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <option value="none">Day (as is)</option>
                <option value="month">Month</option>
                <option value="quarter">Quarter</option>
                <option value="year">Year</option>
              </select>
            </label>
          )}
        </Well>

        {wells.values && (
          <Well label={wells.values} accepts={valueAccepts} onDropField={addValue}>
            {spec.values.map((v, i) => (
              <div className="value-row" key={`${v.field ?? 'count'}-${i}`}>
                <span className="value-name" title={v.field ?? 'Number of rows in each group'}>
                  {v.field ? (
                    <>
                      <TypeBadge type={colType(v.field) ?? 'text'} /> {v.field}
                    </>
                  ) : (
                    'Count of records'
                  )}
                </span>
                {spec.type !== 'scatter' && v.field && (
                  <select
                    aria-label={`How to combine ${v.field}`}
                    title="How rows in the same group are combined"
                    value={v.agg}
                    onChange={(e) => {
                      const values = spec.values.map((x, k) => (k === i ? { ...x, agg: e.target.value as Aggregation } : x));
                      set({ values });
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {AGGREGATIONS.filter((a) => colType(v.field) === 'number' || a.id === 'count' || a.id === 'distinct').map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                )}
                {(spec.values.length > 1 || spec.type === 'scatter' || v.field !== null) && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${v.field ?? 'count'}`}
                    title="Remove"
                    onClick={() => {
                      const rest = spec.values.filter((_, k) => k !== i);
                      set({ values: rest.length || spec.type === 'scatter' ? rest : [{ field: null, agg: 'count' }] });
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {(wells.multiValue || spec.values.length === 0 || spec.type === 'scatter') && (
              <FieldSelect
                ariaLabel={`Add to ${wells.values}`}
                columns={cols}
                value={null}
                placeholder={spec.values.length && wells.multiValue ? '+ Add another value…' : '+ Add a value…'}
                filter={(c) => (spec.type === 'scatter' ? c.type === 'number' : !spec.values.some((v) => v.field === c.name))}
                onChange={(v) => v && addValue(v)}
              />
            )}
            {spec.type !== 'scatter' && !spec.values.some((v) => v.field === null) && wells.multiValue && (
              <button type="button" className="link small" onClick={() => set({ values: [...spec.values, { field: null, agg: 'count' }] })}>
                + Count of records
              </button>
            )}
          </Well>
        )}

        {wells.legend && (
          <Well label={wells.legend} accepts={(n) => colType(n) !== 'number' || spec.type !== 'scatter'} onDropField={(name) => set({ legend: name })}>
            <FieldSelect
              ariaLabel={wells.legend}
              columns={cols}
              value={spec.legend}
              placeholder="None"
              filter={(c) => c.name !== spec.x && (spec.type !== 'scatter' || c.type !== 'number')}
              onChange={(v) => set({ legend: v })}
            />
          </Well>
        )}

        <Well label="Filters" hint="keep only some rows" accepts={() => true} onDropField={addFilter}>
          {spec.filters.map((f, i) => (
            <FilterEditor
              key={f.field}
              spec={spec}
              filter={f}
              onChange={(nf) => set({ filters: spec.filters.map((x, k) => (k === i ? nf : x)) })}
              onRemove={() => set({ filters: spec.filters.filter((_, k) => k !== i) })}
            />
          ))}
          <FieldSelect
            ariaLabel="Add a filter"
            columns={cols}
            value={null}
            placeholder="+ Filter on a field…"
            filter={(c) => !spec.filters.some((f) => f.field === c.name)}
            onChange={(v) => v && addFilter(v)}
          />
        </Well>

        {spec.type !== 'scatter' && spec.type !== 'histogram' && (
          <div className="well well-plain">
            <div className="grid-2">
              <label className="inline-field">
                Sort
                <select value={spec.sort} onChange={(e) => set({ sort: e.target.value as ChartSpec['sort'] })} onKeyDown={(e) => e.stopPropagation()}>
                  <option value="data">{xIsDate ? 'By date' : 'As in the data'}</option>
                  <option value="val-desc">Largest first</option>
                  <option value="val-asc">Smallest first</option>
                  <option value="cat-asc">A → Z</option>
                  <option value="cat-desc">Z → A</option>
                </select>
              </label>
              <label className="inline-field">
                Show top
                <input
                  type="number"
                  min={0}
                  value={spec.topN || ''}
                  placeholder="all"
                  onChange={(e) => set({ topN: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </label>
            </div>
            {canStack(spec.type) && seriesCount > 1 && (
              <label className="checkline">
                <input type="checkbox" checked={spec.stacked} onChange={(e) => set({ stacked: e.target.checked })} />
                Stack the series
              </label>
            )}
          </div>
        )}
        {spec.type === 'histogram' && (
          <div className="well well-plain">
            <label className="inline-field">
              Number of bins
              <input
                type="number"
                min={0}
                max={100}
                value={spec.bins || ''}
                placeholder="auto"
                onChange={(e) => set({ bins: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
