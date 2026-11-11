import type { ChartType } from '../../charts/types';
import { CHART_TYPES } from '../../charts/types';

/** Small, literal pictures of each chart type, so the choice is visual. */
export function ChartTypeIcon({ type, size = 30 }: { type: ChartType; size?: number }) {
  const c = 'currentColor';
  const body = (() => {
    switch (type) {
      case 'column':
        return (
          <>
            <rect x="5" y="14" width="5" height="12" fill={c} />
            <rect x="12.5" y="7" width="5" height="19" fill={c} opacity="0.75" />
            <rect x="20" y="17" width="5" height="9" fill={c} opacity="0.5" />
          </>
        );
      case 'bar':
        return (
          <>
            <rect x="4" y="5" width="20" height="5" fill={c} />
            <rect x="4" y="12.5" width="13" height="5" fill={c} opacity="0.75" />
            <rect x="4" y="20" width="8" height="5" fill={c} opacity="0.5" />
          </>
        );
      case 'line':
        return <polyline points="4,22 11,13 17,17 26,6" fill="none" stroke={c} strokeWidth="2.2" strokeLinejoin="round" />;
      case 'area':
        return (
          <>
            <polygon points="4,26 4,20 11,12 17,16 26,7 26,26" fill={c} opacity="0.35" />
            <polyline points="4,20 11,12 17,16 26,7" fill="none" stroke={c} strokeWidth="2" />
          </>
        );
      case 'scatter':
        return (
          <>
            {[
              [7, 21],
              [10, 16],
              [14, 18],
              [17, 11],
              [21, 13],
              [24, 7],
            ].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="2.1" fill={c} />
            ))}
          </>
        );
      case 'pie':
        return (
          <>
            <circle cx="15" cy="15" r="10" fill={c} opacity="0.4" />
            <path d="M15 15 L15 5 A10 10 0 0 1 24.5 18.1 Z" fill={c} />
          </>
        );
      case 'donut':
        return (
          <>
            <circle cx="15" cy="15" r="8" fill="none" stroke={c} strokeWidth="5" opacity="0.4" />
            <path d="M15 4.5 A10.5 10.5 0 0 1 25 18.3" fill="none" stroke={c} strokeWidth="5" />
          </>
        );
      case 'histogram':
        return (
          <>
            <rect x="4" y="18" width="5.5" height="8" fill={c} opacity="0.6" />
            <rect x="9.5" y="9" width="5.5" height="17" fill={c} />
            <rect x="15" y="12" width="5.5" height="14" fill={c} opacity="0.8" />
            <rect x="20.5" y="20" width="5.5" height="6" fill={c} opacity="0.6" />
          </>
        );
    }
  })();
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
      <line x1="3" y1="27" x2="27" y2="27" stroke={c} strokeOpacity="0.35" strokeWidth="1" />
      {body}
    </svg>
  );
}

export function ChartTypePicker({
  value,
  onChange,
  compact = false,
}: {
  value: ChartType;
  onChange: (t: ChartType) => void;
  compact?: boolean;
}) {
  return (
    <div className={`chart-types${compact ? ' compact' : ''}`} role="radiogroup" aria-label="Chart type">
      {CHART_TYPES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={value === t.id}
          className={`chart-type${value === t.id ? ' on' : ''}`}
          title={`${t.label}: ${t.hint}`}
          onClick={() => onChange(t.id)}
        >
          <ChartTypeIcon type={t.id} size={compact ? 24 : 30} />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
