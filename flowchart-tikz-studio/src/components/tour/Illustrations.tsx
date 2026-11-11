import type { Illustration as Kind } from './steps';

/** Small looping animations shown inside the tour card. Pure SVG + CSS. */
export function Illustration({ kind }: { kind: Kind }) {
  switch (kind) {
    case 'welcome':
      return (
        <div className="illus illus-welcome" aria-hidden="true">
          <svg viewBox="0 0 340 96">
            <g className="w-flow">
              <rect className="w-a" x="10" y="12" width="70" height="28" rx="14" />
              <path className="w-l1" d="M45 40v14" />
              <polygon className="w-b" points="45,56 80,72 45,88 10,72" />
            </g>
            <path className="w-arrow" d="M104 50h44" />
            <path className="w-arrow-head" d="M140 42l10 8-10 8" />
            <rect className="w-code" x="168" y="10" width="164" height="78" rx="8" />
            <text className="w-t1" x="180" y="32">\begin{'{'}tikzpicture{'}'}</text>
            <text className="w-t2" x="190" y="52">\node[process] …</text>
            <text className="w-t3" x="180" y="72">\end{'{'}tikzpicture{'}'}</text>
          </svg>
        </div>
      );
    case 'chart':
      return (
        <div className="illus illus-chart" aria-hidden="true">
          <div className="mini-table">
            <span>Region</span>
            <span>Sales</span>
            <span>North</span>
            <span>42</span>
            <span>South</span>
            <span>68</span>
            <span>East</span>
            <span>55</span>
          </div>
          <span className="mini-arrow">→</span>
          <div className="mini-bars">
            <i style={{ height: '48%' }} />
            <i style={{ height: '82%' }} />
            <i style={{ height: '64%' }} />
          </div>
        </div>
      );
    case 'code':
      return (
        <div className="illus illus-code" aria-hidden="true">
          <div className="cl c1">
            <span className="k">\node</span>[process] (n1) {'{'}Start{'}'};
          </div>
          <div className="cl c2 traced">
            <span className="k">\node</span>[decision] (n2) {'{'}Valid?{'}'};
          </div>
          <div className="cl c3">
            <span className="k">\draw</span>[-&gt;] (n1) -- (n2);
          </div>
        </div>
      );
    case 'inspector':
      return (
        <div className="illus illus-inspector" aria-hidden="true">
          <div className="insp-shape">Process</div>
          <div className="insp-swatches">
            <i style={{ background: '#e0e7ff' }} />
            <i style={{ background: '#dcfce7' }} />
            <i style={{ background: '#fef3c7' }} />
            <i style={{ background: '#fee2e2' }} />
          </div>
        </div>
      );
    case 'status':
      return (
        <div className="illus illus-status" aria-hidden="true">
          <span className="st-pill">
            <i className="st-dot" />
            <span className="st-unsaved">Unsaved changes</span>
            <span className="st-saved">All changes saved</span>
          </span>
        </div>
      );
    case 'finish':
      return (
        <div className="illus illus-finish" aria-hidden="true">
          <svg viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="32" />
            <path d="M25 41l10 10 20-22" />
          </svg>
        </div>
      );
    default:
      return null;
  }
}
