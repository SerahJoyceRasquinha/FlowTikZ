import { useMemo } from 'react';
import type { ChartSpec, ChartStyle } from '../../charts/types';
import { isCartesian } from '../../charts/types';
import { CHART_PALETTES, getPalette, seriesColor } from '../../charts/palettes';
import { autoAxisTitles, autoTitle, layoutChart } from '../../charts/layout';
import { ColorField } from '../ColorField';

/**
 * Chart formatting: titles, colours, legend, labels, axes, numbers.
 * Every control writes the chart spec; the canvas and the PGFPlots code both
 * follow from it, so what is chosen here is exactly what compiles.
 */

function Section({ title, children, open = true }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="style-section" open={open}>
      <summary>{title}</summary>
      <div className="style-body">{children}</div>
    </details>
  );
}

function TitleInput({
  label,
  value,
  auto,
  onChange,
}: {
  label: string;
  value: string | null;
  auto: string;
  onChange: (v: string | null) => void;
}) {
  const hidden = value === '';
  return (
    <div className="field">
      <label>{label}</label>
      <div className="title-row">
        <input
          type="text"
          value={value ?? ''}
          placeholder={hidden ? '(hidden)' : auto || '(none)'}
          disabled={hidden}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <label className="checkline mini" title="Show or hide this text">
          <input type="checkbox" checked={!hidden} onChange={(e) => onChange(e.target.checked ? null : '')} />
          Show
        </label>
      </div>
      {value === null && !hidden && auto && <span className="field-help">Automatic from the fields. Type to replace it.</span>}
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}) {
  return (
    <label className="inline-field">
      {label}
      <input
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(e) => {
          if (e.target.value === '') return onChange(null);
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </label>
  );
}

function Sel<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="inline-field">
      {label}
      <select
        value={String(value)}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value);
          if (o) onChange(o.value);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ChartStylePanel({ spec, onChange }: { spec: ChartSpec; onChange: (next: ChartSpec) => void }) {
  const st = spec.style;
  const set = (patch: Partial<ChartStyle>) => onChange({ ...spec, style: { ...st, ...patch } });
  const layout = useMemo(() => layoutChart(spec, 560, 360), [spec]);
  const result = layout.result;
  const autoT = autoTitle(spec, result);
  const autoAxes = autoAxisTitles(spec, result);
  const cartesian = isCartesian(spec.type);

  // Names that get a colour: series on axes, slices on a pie.
  const seriesNames = useMemo(() => {
    if (layout.kind === 'cartesian') return layout.series.map((s) => s.name);
    if (layout.kind === 'pie') return layout.slices.map((s) => s.name);
    return [];
  }, [layout]);

  const hasBars = spec.type === 'column' || spec.type === 'bar' || spec.type === 'histogram';
  const hasLines = spec.type === 'line' || spec.type === 'area';
  const hasMarks = hasLines || spec.type === 'scatter';

  return (
    <div className="chart-style">
      <Section title="Titles">
        <TitleInput label="Chart title" value={st.title} auto={autoT} onChange={(v) => set({ title: v })} />
        {cartesian && (
          <>
            <TitleInput label="Horizontal axis title" value={st.xTitle} auto={autoAxes.x} onChange={(v) => set({ xTitle: v })} />
            <TitleInput label="Vertical axis title" value={st.yTitle} auto={autoAxes.y} onChange={(v) => set({ yTitle: v })} />
          </>
        )}
        <Num label="Text size" value={st.fontSize} min={6} max={40} onChange={(v) => set({ fontSize: Math.max(6, Math.min(40, v ?? 13)) })} />
      </Section>

      <Section title="Colours">
        <Sel
          label="Colour theme"
          value={st.palette}
          options={CHART_PALETTES.map((p) => ({ value: p.id, label: p.label }))}
          onChange={(v) => set({ palette: v, seriesColors: {} })}
        />
        <div className="palette-preview" aria-hidden="true">
          {getPalette(st.palette).colors.slice(0, 8).map((c) => (
            <span key={c} style={{ background: c }} />
          ))}
        </div>
        {seriesNames.slice(0, 12).map((name, i) => (
          <ColorField
            key={name}
            label={name}
            value={seriesColor(st.palette, st.seriesColors, name, i)}
            onChange={(hex) => set({ seriesColors: { ...st.seriesColors, [name]: hex } })}
          />
        ))}
        {Object.keys(st.seriesColors).length > 0 && (
          <button type="button" className="link small" onClick={() => set({ seriesColors: {} })}>
            Reset to theme colours
          </button>
        )}
        <ColorField label="Text" value={st.textColor} onChange={(hex) => set({ textColor: hex })} />
        {cartesian && <ColorField label="Axis lines" value={st.axisColor} onChange={(hex) => set({ axisColor: hex })} />}
        <label className="checkline">
          <input type="checkbox" checked={st.background !== 'none'} onChange={(e) => set({ background: e.target.checked ? '#ffffff' : 'none' })} />
          Fill the chart background
        </label>
        {st.background !== 'none' && <ColorField label="Background" value={st.background} onChange={(hex) => set({ background: hex })} />}
        <label className="checkline">
          <input type="checkbox" checked={st.outline} onChange={(e) => set({ outline: e.target.checked })} />
          {spec.type === 'pie' || spec.type === 'donut' ? 'White lines between slices' : 'Outline bars and areas'}
        </label>
      </Section>

      <Section title="Legend and labels">
        <Sel
          label="Legend"
          value={st.legend}
          options={[
            { value: 'bottom', label: 'Below the chart' },
            { value: 'right', label: cartesian ? 'Outside, right' : 'Right' },
            { value: 'top-right', label: cartesian ? 'Inside, top right (may cover data)' : 'Right, top' },
            { value: 'top-left', label: cartesian ? 'Inside, top left (may cover data)' : 'Left' },
            { value: 'none', label: 'Hidden' },
          ]}
          onChange={(v) => set({ legend: v })}
        />
        {cartesian && !spec.legend && spec.values.length < 2 && st.legend !== 'none' && (
          <span className="field-help">The legend appears when there is more than one series.</span>
        )}
        {cartesian ? (
          <label className="checkline">
            <input type="checkbox" checked={st.dataLabels} onChange={(e) => set({ dataLabels: e.target.checked })} />
            Show values on the chart (data labels)
          </label>
        ) : (
          <Sel
            label="Slice labels"
            value={st.pieLabels}
            options={[
              { value: 'percent', label: 'Percentage' },
              { value: 'value', label: 'Value' },
              { value: 'category', label: 'Category name' },
              { value: 'category-percent', label: 'Name and percentage' },
              { value: 'none', label: 'None' },
            ]}
            onChange={(v) => set({ pieLabels: v })}
          />
        )}
      </Section>

      {(hasBars || hasLines || hasMarks) && (
        <Section title={hasBars ? 'Bars' : 'Lines and points'}>
          {hasBars && spec.type !== 'histogram' && (
            <div className="field">
              <label>
                Bar width <span className="value">{Math.round(st.barWidth * 100)}%</span>
              </label>
              <input type="range" min={0.1} max={1} step={0.05} value={st.barWidth} onChange={(e) => set({ barWidth: Number(e.target.value) })} />
            </div>
          )}
          {hasLines && (
            <>
              <Num label="Line width" value={st.lineWidth} min={0.5} max={10} step={0.5} onChange={(v) => set({ lineWidth: Math.max(0.5, Math.min(10, v ?? 2)) })} />
              <Sel
                label="Line style"
                value={st.lineDash}
                options={[
                  { value: 'solid', label: 'Solid' },
                  { value: 'dashed', label: 'Dashed' },
                  { value: 'dotted', label: 'Dotted' },
                ]}
                onChange={(v) => set({ lineDash: v })}
              />
            </>
          )}
          {hasMarks && (
            <>
              <Sel
                label="Point marker"
                value={st.marks}
                options={[
                  ...(spec.type === 'scatter' ? [] : [{ value: 'none' as const, label: 'None' }]),
                  { value: 'circle', label: 'Circle' },
                  { value: 'square', label: 'Square' },
                  { value: 'triangle', label: 'Triangle' },
                  { value: 'diamond', label: 'Diamond' },
                ]}
                onChange={(v) => set({ marks: v })}
              />
              <Num label="Marker size" value={st.markSize} min={1} max={12} step={0.5} onChange={(v) => set({ markSize: Math.max(1, Math.min(12, v ?? 3.5)) })} />
            </>
          )}
          {spec.type === 'area' && (
            <div className="field">
              <label>
                Fill opacity <span className="value">{Math.round(st.areaOpacity * 100)}%</span>
              </label>
              <input type="range" min={0} max={1} step={0.05} value={st.areaOpacity} onChange={(e) => set({ areaOpacity: Number(e.target.value) })} />
            </div>
          )}
        </Section>
      )}

      {cartesian && (
        <Section title="Axes and grid" open={false}>
          <div className="grid-2">
            <Num label="Value axis min" value={st.yMin} placeholder="auto" onChange={(v) => set({ yMin: v })} />
            <Num label="Value axis max" value={st.yMax} placeholder="auto" onChange={(v) => set({ yMax: v })} />
          </div>
          <Sel
            label="Gridlines"
            value={st.grid}
            options={[
              { value: 'y', label: spec.type === 'bar' ? 'Across (horizontal)' : 'Horizontal' },
              { value: 'x', label: 'Vertical' },
              { value: 'both', label: 'Both' },
              { value: 'none', label: 'None' },
            ]}
            onChange={(v) => set({ grid: v })}
          />
          {st.grid !== 'none' && <ColorField label="Gridline colour" value={st.gridColor} onChange={(hex) => set({ gridColor: hex })} />}
          <Sel
            label="Axis frame"
            value={st.axisLines}
            options={[
              { value: 'left', label: 'Left and bottom' },
              { value: 'box', label: 'Full box' },
            ]}
            onChange={(v) => set({ axisLines: v })}
          />
          {spec.type !== 'bar' && spec.type !== 'scatter' && spec.type !== 'histogram' && (
            <Sel
              label="Category labels"
              value={st.xLabelRotate}
              options={[
                { value: 'auto', label: 'Automatic' },
                { value: 0, label: 'Horizontal' },
                { value: 45, label: 'Slanted (45°)' },
                { value: 90, label: 'Vertical' },
              ]}
              onChange={(v) => set({ xLabelRotate: v })}
            />
          )}
        </Section>
      )}

      <Section title="Number format" open={false}>
        <Sel
          label="Decimal places"
          value={st.decimals === null ? 'auto' : String(st.decimals)}
          options={[
            { value: 'auto', label: 'Automatic' },
            ...[0, 1, 2, 3, 4].map((d) => ({ value: String(d), label: String(d) })),
          ]}
          onChange={(v) => set({ decimals: v === 'auto' ? null : Number(v) })}
        />
        <label className="checkline">
          <input type="checkbox" checked={st.thousands} onChange={(e) => set({ thousands: e.target.checked })} />
          Thousands separator (50,000)
        </label>
        <label className="checkline">
          <input type="checkbox" checked={st.compact} onChange={(e) => set({ compact: e.target.checked })} />
          Short numbers (50K, 1.2M)
        </label>
        <div className="grid-2">
          <label className="inline-field">
            Prefix
            <input type="text" value={st.prefix} maxLength={12} placeholder="e.g. Rs. or $" onChange={(e) => set({ prefix: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <label className="inline-field">
            Suffix
            <input type="text" value={st.suffix} maxLength={12} placeholder="e.g. % or kg" onChange={(e) => set({ suffix: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          </label>
        </div>
      </Section>
    </div>
  );
}
