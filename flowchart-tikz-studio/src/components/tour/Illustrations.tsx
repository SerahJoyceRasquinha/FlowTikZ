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
    case 'templates':
      return (
        <div className="illus illus-templates" aria-hidden="true">
          <div className="tp-card tp-1">
            <svg viewBox="0 0 60 40">
              <rect x="20" y="2" width="20" height="8" rx="4" />
              <path d="M30 10v5" />
              <polygon points="30,15 40,21 30,27 20,21" />
              <path d="M30 27v5" />
              <rect x="20" y="32" width="20" height="6" rx="3" />
            </svg>
            <span>Flowchart</span>
          </div>
          <div className="tp-card tp-2">
            <b className="tp-tex">x = −b ± √…<br />───────<br />2a</b>
            <span>Formula</span>
          </div>
          <div className="tp-card tp-3">
            <svg viewBox="0 0 60 40">
              <path d="M6 30V8h14l3-4 4 8 4-8 4 8 3-4h16v22H6" />
              <path d="M2 18h8M6 14v8" />
            </svg>
            <span>Circuit</span>
          </div>
          <div className="tp-card tp-4">
            <svg viewBox="0 0 60 40">
              <polygon points="30,4 46,13 46,31 30,40 14,31 14,13" />
              <path d="M30 9l11 6.5M41 29l-11 6.5M19 15.5v13" />
            </svg>
            <span>Molecule</span>
          </div>
        </div>
      );
    case 'science':
      return (
        <div className="illus illus-science" aria-hidden="true">
          <span className="sc-chip sc-math">Σ  ∫  √x  ½</span>
          <span className="sc-chip sc-phys">⚡ R  C  L  F⃗</span>
          <span className="sc-chip sc-chem">H₂O  ⇌  ⌬</span>
        </div>
      );
    case 'formula':
      return (
        <div className="illus illus-formula" aria-hidden="true">
          <span className="fx-pre">x =</span>
          <span className="fx-frac">
            <span className="fx-box fx-b1">−b ± √<i>b²−4ac</i></span>
            <span className="fx-bar" />
            <span className="fx-box fx-b2">2a</span>
          </span>
          <span className="fx-keys">
            <kbd>^</kbd>
            <kbd>_</kbd>
            <kbd>Ctrl</kbd>+<kbd>Z</kbd>
          </span>
        </div>
      );
    case 'undo':
      return (
        <div className="illus illus-undo" aria-hidden="true">
          <span className="ud-key">
            <kbd>Ctrl</kbd>+<kbd>Z</kbd>
            <small>undo</small>
          </span>
          <span className="ud-shapes">
            <i className="ud-a" />
            <i className="ud-b" />
          </span>
          <span className="ud-key">
            <kbd>Ctrl</kbd>+<kbd>Y</kbd>
            <small>redo</small>
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
