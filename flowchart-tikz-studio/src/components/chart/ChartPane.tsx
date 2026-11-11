import { useEffect, useRef } from 'react';
import { useEditor } from '../../state/store';
import type { Node } from '../../model/types';
import type { ChartSpec } from '../../charts/types';
import { chartTypeLabel } from '../../charts/types';
import { adaptSpecToType } from '../../charts/defaults';
import { ChartTypePicker } from './ChartTypePicker';
import { ChartFields } from './ChartFields';
import { ChartStylePanel } from './ChartStylePanel';

/** Property panel for a selected chart: type, fields, filters and formatting. */
export function ChartPane({ node }: { node: Node }) {
  const updateChart = useEditor((s) => s.updateChart);
  const commit = useEditor((s) => s.commit);
  const openBuilder = useEditor((s) => s.openChartBuilder);
  const focus = useEditor((s) => s.chartFocus);
  const ref = useRef<HTMLDivElement>(null);
  const spec = node.chart!;

  const apply = (next: ChartSpec) => updateChart(node.id, (c) => Object.assign(c, next));

  // Enter / double-click on the chart brings its settings into view.
  useEffect(() => {
    if (focus?.id !== node.id) return;
    ref.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    ref.current?.querySelector<HTMLElement>('.chart-type.on')?.focus();
  }, [focus, node.id]);

  const geometry = (patch: Partial<Node>) =>
    commit((d) => {
      const n = d.nodes[node.id];
      if (n) Object.assign(n, patch);
    });

  return (
    <div className="chart-pane" ref={ref}>
      <div className="inspector-head">
        <span className="eyebrow">{chartTypeLabel(spec.type)} chart</span>
        <h3 title={spec.data.name}>{spec.data.name}</h3>
        <p className="note">
          {spec.data.rows.length.toLocaleString('en-US')} rows · {spec.data.columns.length} fields. Drag fields into the boxes, or pick
          them from the lists.
        </p>
        <div className="button-row">
          <button className="btn tiny" onClick={() => openBuilder({ mode: 'edit', nodeId: node.id })} title="Open the larger editor with a preview, or load different data">
            Open chart editor…
          </button>
        </div>
      </div>

      <section>
        <h4>Chart type</h4>
        <ChartTypePicker compact value={spec.type} onChange={(t) => apply(adaptSpecToType(spec, t))} />
      </section>

      <section>
        <h4>Data fields</h4>
        <ChartFields spec={spec} onChange={apply} />
      </section>

      <section>
        <h4>Format</h4>
        <ChartStylePanel spec={spec} onChange={apply} />
      </section>

      <section>
        <h4>Size and position</h4>
        <div className="grid-2">
          {(['x', 'y', 'w', 'h'] as const).map((k) => (
            <label className="inline-field" key={k}>
              {k === 'x' ? 'X' : k === 'y' ? 'Y' : k === 'w' ? 'Width' : 'Height'}
              <input
                type="number"
                value={Math.round(node[k])}
                min={k === 'w' || k === 'h' ? 120 : undefined}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v)) return;
                  geometry({ [k]: k === 'w' || k === 'h' ? Math.max(120, v) : v } as Partial<Node>);
                }}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </label>
          ))}
        </div>
        <p className="note">
          Or drag the corner handles on the canvas. At the current scale this chart prints{' '}
          {((node.w / useEditor.getState().doc.settings.unitsPerCm) || 0).toFixed(1)} cm wide.
        </p>
      </section>
    </div>
  );
}
