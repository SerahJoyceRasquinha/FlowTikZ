import type { TourMenu } from '../../state/tourStore';

export type Side = 'top' | 'bottom' | 'left' | 'right' | 'inside' | 'center';

export interface Hop {
  /** Element the pointer visits. */
  selector: string;
  label: string;
  desc: string;
  /** Visual tone of the chip in the list. */
  tone?: 'danger' | 'success';
}

export type Demo = 'place' | 'edit' | 'connect' | 'copy' | 'save';
export type Illustration = 'welcome' | 'chart' | 'code' | 'inspector' | 'finish' | 'status';

export interface TourStep {
  id: string;
  /** CSS selector of the part of the screen this step explains. */
  target?: string;
  /** Extra elements folded into the highlight (an open menu, for example). */
  extra?: string[];
  side?: Side[];
  title: string;
  body: React.ReactNode;
  hops?: Hop[];
  demo?: Demo;
  illus?: Illustration;
  menu?: TourMenu;
  previewSelection?: boolean;
  pad?: number;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    side: ['center'],
    illus: 'welcome',
    title: 'Welcome to FlowTikZ!',
    body: (
      <>
        <p>
          Draw a flowchart or a chart on the <b>right</b>, and FlowTikZ writes the matching{' '}
          <b>LaTeX code</b> for you on the <b>left</b>, ready to paste into Overleaf.
        </p>
        <p>
          This short tour points at each part of the screen and shows what it does. Use{' '}
          <b>Next</b> and <b>Back</b> (or the <kbd>←</kbd> <kbd>→</kbd> keys). Press <b>Exit</b>{' '}
          whenever you like.
        </p>
      </>
    ),
  },
  {
    id: 'palette',
    target: '[data-tour="palette"]',
    side: ['right'],
    demo: 'place',
    title: 'Step 1 · Pick a symbol',
    body: (
      <>
        <p>
          This is your box of <b>flowchart symbols</b>. Click one, then click anywhere on the white
          canvas to place it — watch the pointer.
        </p>
        <p className="tip">
          Shortcut: <b>double-click</b> a symbol to drop it straight into the middle. Use the search box
          to find one by name.
        </p>
      </>
    ),
  },
  {
    id: 'canvas',
    target: '.canvas-shell',
    side: ['left', 'inside'],
    demo: 'edit',
    title: 'Step 2 · Type inside a shape',
    body: (
      <>
        <p>
          The white area is your <b>canvas</b>. <b>Double-click</b> a shape to type in it. Drag a shape
          to move it; drag its square corner handles to resize.
        </p>
        <p className="tip">
          Zoom with <b>Ctrl + mouse wheel</b>. Hold <b>Alt</b> and drag to move around.
        </p>
      </>
    ),
  },
  {
    id: 'connect',
    target: '.canvas-shell',
    side: ['left', 'inside'],
    demo: 'connect',
    title: 'Step 3 · Join shapes with arrows',
    body: (
      <>
        <p>
          Hover a shape and small <b className="c-blue">blue dots</b> appear on its sides. Drag from a dot
          onto another shape. When the target dot turns <b className="c-red">red</b>, let go — the arrow
          is drawn.
        </p>
        <p className="tip">Arrows stay attached when you move the shapes later.</p>
      </>
    ),
  },
  {
    id: 'tools',
    target: '[data-tour="tools"]',
    side: ['bottom'],
    title: 'Your tools',
    body: <p>Only one tool is active at a time. The highlighted one is the tool you are using now.</p>,
    hops: [
      { selector: '[data-tour="tools"] .btn:nth-child(1)', label: 'Select (V)', desc: 'Click to pick shapes, drag to move them.' },
      { selector: '[data-tour="tools"] .btn:nth-child(2)', label: 'Pan (H)', desc: 'Drag to slide the whole canvas around.' },
      { selector: '[data-tour="tools"] .btn:nth-child(3)', label: 'Connect (C)', desc: 'Drag between two shapes to draw an arrow.' },
      { selector: '[data-tour="tools"] .btn:nth-child(4)', label: 'Text', desc: 'Add a free text label anywhere.' },
    ],
  },
  {
    id: 'chart',
    target: '[data-tour="chart"]',
    side: ['bottom'],
    illus: 'chart',
    title: 'Charts from your data',
    body: (
      <p>
        Have numbers in <b>Excel</b> or a <b>CSV</b> file? Click <b>Chart from data</b>, load the file,
        pick a chart type (bar, line, pie…) and press <b>Insert chart</b>. The chart turns into LaTeX
        (PGFPlots) too.
      </p>
    ),
  },
  {
    id: 'history',
    target: '[data-tour="history"]',
    side: ['bottom'],
    title: 'Made a mistake? Undo it',
    body: <p>Nothing you do is permanent. Step backwards and forwards through your changes.</p>,
    hops: [
      { selector: '[data-tour="history"] .btn:nth-child(1)', label: 'Undo', desc: 'Take back the last change (Ctrl+Z).' },
      { selector: '[data-tour="history"] .btn:nth-child(2)', label: 'Redo', desc: 'Bring it back again (Ctrl+Y).' },
    ],
  },
  {
    id: 'view',
    target: '[data-tour="view"]',
    extra: ['[data-tour="view-menu"] .menu'],
    menu: 'view',
    side: ['bottom'],
    title: 'Zoom and view',
    body: <p>Get closer, step back, or fit everything on screen.</p>,
    hops: [
      { selector: '[data-tour="view"] [aria-label="Zoom out"]', label: '−  Zoom out', desc: 'See more of the diagram.' },
      { selector: '[data-tour="view"] .zoom-readout', label: '100%', desc: 'Shows the zoom. Click it to reset.' },
      { selector: '[data-tour="view"] [aria-label="Zoom in"]', label: '+  Zoom in', desc: 'Look closer.' },
      { selector: '[data-tour="view"] > .btn:nth-child(4)', label: 'Fit', desc: 'Show the whole diagram at once.' },
      { selector: '[data-tour="view-menu"] .menu button:nth-of-type(1)', label: 'View → Grid / Snap', desc: 'Guide lines, and neat lining-up while dragging.' },
    ],
  },
  {
    id: 'selection',
    target: '[data-tour="selection"]',
    previewSelection: true,
    side: ['bottom'],
    title: 'Actions appear when you need them',
    body: (
      <p>
        When you select shapes, this bar <b>pops up</b> above the canvas with everything you can do to
        them. Nothing selected? It stays hidden, so the screen stays tidy.
      </p>
    ),
    hops: [
      { selector: '[data-tour="selection"] .menu-wrap:nth-of-type(1) .btn', label: 'Align', desc: 'Line shapes up, or space them evenly.' },
      { selector: '[data-tour="selection"] .menu-wrap:nth-of-type(2) .btn', label: 'Arrange', desc: 'Bring to front or send to back.' },
      { selector: '[data-tour="selection"] > .btn:nth-of-type(1)', label: 'Duplicate', desc: 'Make a copy (Ctrl+D).' },
      { selector: '[data-tour="selection"] > .btn:nth-of-type(2)', label: 'Group', desc: 'Make several shapes move together.' },
      { selector: '[data-tour="selection"] > .btn:nth-of-type(3)', label: 'Lock', desc: 'Stop a shape from moving by accident.' },
      { selector: '[data-tour="delete"]', label: 'Delete', desc: 'Remove it (red = removes things). Undo brings it back.', tone: 'danger' },
    ],
  },
  {
    id: 'inspector',
    target: '[data-tour="inspector"]',
    side: ['left'],
    illus: 'inspector',
    title: 'Properties: make it look right',
    body: (
      <>
        <p>
          Select a shape or arrow and this panel shows its <b>text, colours, border, size</b> and
          arrow style. Change anything here and the canvas and the code update together.
        </p>
        <p className="tip">With nothing selected it shows the page settings (background, scale).</p>
      </>
    ),
  },
  {
    id: 'code',
    target: '[data-tour="code"]',
    side: ['right'],
    illus: 'code',
    title: 'Your LaTeX, written live',
    body: (
      <>
        <p>
          Every change you make is turned into LaTeX code here <b>instantly</b>. Select a shape and its
          lines light up; click a line to select its shape.
        </p>
        <p className="tip">
          <b>Standalone</b> = a full document for a new Overleaf project. <b>Snippet</b> = just the
          picture, for a document you already have.
        </p>
      </>
    ),
  },
  {
    id: 'copy',
    target: '[data-tour="copy"]',
    side: ['bottom', 'right'],
    demo: 'copy',
    title: 'Copy it into Overleaf',
    body: (
      <p>
        Press the green <b className="c-green">Copy LaTeX</b> button, then paste into Overleaf and
        compile. Or use <b>Download .tex</b> to save it as a file.
      </p>
    ),
  },
  {
    id: 'file',
    target: '[data-tour="file"]',
    extra: ['[data-tour="file"] .menu'],
    menu: 'file',
    side: ['left', 'bottom'],
    title: 'The File menu',
    body: <p>Everything to start, open or bring in a diagram lives here.</p>,
    hops: [
      { selector: '[data-tour="file"] .menu button:nth-of-type(1)', label: 'New', desc: 'Start with an empty canvas.' },
      { selector: '[data-tour="file"] .menu button:nth-of-type(2)', label: 'Open', desc: 'Re-open a diagram you saved earlier.' },
      { selector: '[data-tour="file"] .menu button:nth-of-type(3)', label: 'Import diagram', desc: 'Turn a picture, SVG or draw.io file into editable shapes.' },
      { selector: '[data-tour="file"] .menu button:nth-of-type(4)', label: 'Clear canvas', desc: 'Remove everything (red = careful). Undo still works.', tone: 'danger' },
    ],
  },
  {
    id: 'save',
    target: '[data-tour="save"]',
    side: ['bottom', 'left'],
    demo: 'save',
    title: 'Save your work',
    body: (
      <p>
        <b className="c-green">Green</b> means safe. <b>Save</b> downloads your diagram as a{' '}
        <b>.json</b> file that you can open again later with <b>File → Open</b>. Shortcut:{' '}
        <kbd>Ctrl</kbd>+<kbd>S</kbd>.
      </p>
    ),
  },
  {
    id: 'export',
    target: '[data-tour="export"]',
    extra: ['[data-tour="export"] .menu'],
    menu: 'export',
    side: ['left', 'bottom'],
    title: 'Export a picture',
    body: <p>Need the drawing for slides or a report? Download it as an image or PDF.</p>,
    hops: [
      { selector: '[data-tour="export"] .menu button:nth-of-type(1)', label: 'SVG', desc: 'Stays sharp at any size.' },
      { selector: '[data-tour="export"] .menu button:nth-of-type(2)', label: 'PNG', desc: 'A normal picture file.' },
      { selector: '[data-tour="export"] .menu button:nth-of-type(3)', label: 'PDF', desc: 'Through your browser’s print window.' },
    ],
  },
  {
    id: 'status',
    target: '[data-tour="status"]',
    side: ['top'],
    illus: 'status',
    title: 'Status bar: always know where you stand',
    body: (
      <>
        <p>
          The dot tells you if your work is saved: <b className="c-amber">amber</b> = unsaved changes,{' '}
          <b className="c-green">green</b> = all saved. It also counts your shapes and arrows.
        </p>
        <p className="tip">
          Messages pop up in the corner: <b className="c-green">green</b> for success,{' '}
          <b className="c-red">red</b> if something went wrong.
        </p>
      </>
    ),
  },
  {
    id: 'help',
    target: '[data-tour="help"]',
    extra: ['[data-tour="help"] .menu'],
    menu: 'help',
    side: ['left', 'bottom'],
    title: 'Help is always one click away',
    body: <p>Come back to this tour any time, or look up a keyboard shortcut.</p>,
    hops: [
      { selector: '[data-tour="help"] .menu button:nth-of-type(1)', label: 'Guided tour (demo)', desc: 'Replay this walkthrough.' },
      { selector: '[data-tour="help"] .menu button:nth-of-type(2)', label: 'Help & shortcuts', desc: 'Quick start and every key. Press ? anytime.' },
    ],
  },
  {
    id: 'finish',
    side: ['center'],
    illus: 'finish',
    title: 'You’re all set!',
    body: (
      <>
        <p>That’s everything. The quickest way to learn is to try it:</p>
        <ol className="finish-list">
          <li>Click a symbol, then click the canvas.</li>
          <li>Double-click it and type.</li>
          <li>Drag a blue dot to another shape.</li>
          <li>
            Press <b className="c-green">Copy LaTeX</b> and paste into Overleaf.
          </li>
        </ol>
      </>
    ),
  },
];
