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
export type Illustration = 'welcome' | 'chart' | 'code' | 'inspector' | 'finish' | 'status' | 'templates' | 'science' | 'formula' | 'undo';

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
          Draw a flowchart, a chart, an equation, a circuit or a molecule on the <b>right</b>, and FlowTikZ
          writes the matching <b>LaTeX code</b> for you on the <b>left</b>, ready to paste into Overleaf.
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
          Zoom the drawing with <b>Ctrl + mouse wheel</b> (or the <kbd>+</kbd> <kbd>−</kbd> keys). Hold{' '}
          <b>Space</b> or <b>Alt</b> and drag to move around.
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
    id: 'templates',
    target: '[data-tour="templates"]',
    side: ['bottom'],
    illus: 'templates',
    title: 'Templates: start in seconds',
    body: (
      <>
        <p>
          Don’t want to start from a blank page? <b>Templates</b> has ready-made pieces you can drop in with one
          click: <b>flowcharts</b> (if/else, loops, login, binary search…), <b>maths formulas</b> (quadratic
          formula, derivatives, statistics, matrices…), <b>physics</b> laws, circuits and force diagrams, and{' '}
          <b>chemistry</b> reactions, molecules and formulas.
        </p>
        <p className="tip">
          Type in the search box to find one fast. Everything you insert stays fully editable, and{' '}
          <kbd>Ctrl</kbd>+<kbd>Z</kbd> removes it again.
        </p>
      </>
    ),
  },
  {
    id: 'science',
    target: '[data-tour="science"]',
    side: ['bottom'],
    illus: 'science',
    title: 'Maths, physics and chemistry',
    body: (
      <p>
        These three buttons open the science tools. Each one makes a real object on the canvas with real LaTeX
        behind it, and you can <b>double-click</b> it later to change it.
      </p>
    ),
    hops: [
      { selector: '[data-action="math"]', label: 'Math', desc: 'The formula editor: fractions, roots, sums, matrices and 230+ symbols.' },
      { selector: '[data-action="physics"]', label: 'Physics', desc: 'Circuit parts, physics diagram parts, physics symbols and templates.' },
      { selector: '[data-action="chemistry"]', label: 'Chem', desc: 'Chemical formulas, reactions with a balance check, and molecules.' },
    ],
  },
  {
    id: 'formula',
    side: ['center'],
    illus: 'formula',
    title: 'The formula editor (Math)',
    body: (
      <>
        <p>
          Build an equation from <b>boxes</b>: pick a structure (fraction, square root, power, integral, sum,
          limit, matrix, cases…) and type into its empty boxes. The preview at the top shows the finished
          formula as you go.
        </p>
        <ul className="tour-list">
          <li>Type <kbd>^</kbd> for a superscript and <kbd>_</kbd> for a subscript.</li>
          <li>The <b>symbol library</b> has Greek letters, operators, arrows, sets and physics constants — search it by name, e.g. “integral” or “ohm”.</li>
          <li><b>LaTeX</b> mode lets experts type the code directly; <b>Colour part</b> colours a piece of it.</li>
          <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> undo and redo inside the editor; <kbd>Ctrl</kbd>+<kbd>Enter</kbd> inserts.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'physics-menu',
    target: '[data-tour="physics-menu"]',
    extra: ['[data-tour="physics-menu"] .menu'],
    menu: 'physics',
    side: ['bottom', 'right'],
    title: 'The Physics menu',
    body: <p>Everything for physics diagrams and equations.</p>,
    hops: [
      { selector: '[data-action="physics-circuit"]', label: 'Circuit components', desc: 'Shows resistors, batteries, diodes, transistors… in the left panel. Drag them in and wire their terminals.' },
      { selector: '[data-action="physics-parts"]', label: 'Physics diagram parts', desc: 'Forces, blocks, springs, pulleys, lenses, charges and fields.' },
      { selector: '[data-action="physics-symbols"]', label: 'Physics symbols and equations', desc: 'The formula editor with the physics library: F, E, λ, ħ, units and constants.' },
      { selector: '[data-action="physics-templates"]', label: 'Physics templates', desc: "Ready-made laws (Newton, Ohm, Maxwell…), circuits and force diagrams." },
    ],
  },
  {
    id: 'chem-menu',
    target: '[data-tour="chem-menu"]',
    extra: ['[data-tour="chem-menu"] .menu'],
    menu: 'chemistry',
    side: ['bottom', 'right'],
    title: 'The Chemistry menu',
    body: <p>Formulas, reactions and molecule drawings, all producing real LaTeX (mhchem and chemfig).</p>,
    hops: [
      { selector: '[data-action="chem-formula"]', label: 'Chemical formula', desc: 'Type H2SO4 or Fe^3+ — numbers become subscripts automatically. Element buttons included.' },
      { selector: '[data-action="chem-reaction"]', label: 'Reaction', desc: 'Reactants, products, arrows, catalysts and conditions, with a “balanced?” check.' },
      { selector: '[data-action="chem-molecule"]', label: 'Molecule structure', desc: 'Draw atoms and bonds, or start from water, benzene, ethanol and more.' },
      { selector: '[data-action="chem-templates"]', label: 'Chemistry templates', desc: 'Photosynthesis, Haber process, neutralisation, pH and more, ready to insert.' },
    ],
  },
  {
    id: 'symbol-sets',
    target: '.palette-domains',
    side: ['right'],
    title: 'Three sets of symbols',
    body: (
      <>
        <p>
          The left panel switches between <b>Flow</b> (flowchart symbols), <b>Circuit</b> (electrical
          components) and <b>Physics</b> (diagram parts). Drag a part onto the canvas, or click it and then
          click the canvas.
        </p>
        <p className="tip">
          Circuit parts have round <b>terminals</b>: drag from one terminal to another to draw a wire. Press{' '}
          <kbd>R</kbd> to turn a selected part by 90°.
        </p>
      </>
    ),
  },
  {
    id: 'history',
    target: '[data-tour="history"]',
    side: ['bottom'],
    title: 'Made a mistake? Undo it',
    illus: 'undo',
    body: (
      <>
        <p>Nothing you do is permanent. Step backwards and forwards through your changes.</p>
        <p className="tip">
          <kbd>Ctrl</kbd>+<kbd>Z</kbd> and <kbd>Ctrl</kbd>+<kbd>Y</kbd> work <b>everywhere</b>: on the canvas,
          in the property panel, while typing in a shape, and inside the formula, chemistry, molecule and chart
          editors.
        </p>
      </>
    ),
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
    body: (
      <>
        <p>Get closer to the drawing, step back, or fit everything on screen.</p>
        <p className="tip">
          These buttons zoom only the <b>drawing</b>. <kbd>Ctrl</kbd>+<kbd>+</kbd> and <kbd>Ctrl</kbd>+<kbd>−</kbd>{' '}
          still zoom the <b>whole page</b>, like on any website — handy if the text looks too small.
        </p>
      </>
    ),
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
      { selector: '[data-tour="file"] .menu [data-action="open-project"]', label: 'Open LaTeX project (.zip)', desc: 'Bring in a whole Overleaf project and draw straight into it.' },
      { selector: '[data-tour="file"] .menu [data-action="clear"]', label: 'Clear canvas', desc: 'Remove everything (red = careful). Undo still works.', tone: 'danger' },
    ],
  },
  {
    id: 'project',
    target: '[data-tour="file"]',
    side: ['left', 'bottom'],
    title: 'Draw inside your LaTeX project',
    body: (
      <>
        <p>
          Have a paper or report on Overleaf? Download it there as a zip (<b>Menu → Download → Source</b>) and choose{' '}
          <b>File → Open LaTeX project (.zip)</b>. FlowTikZ finds the main <b>.tex</b> file, shows the document where the
          canvas was, and lists the files and the LaTeX code on the left.
        </p>
        <ol className="finish-list">
          <li>Click the place in the document where the drawing should go, then press <b>Draw here</b>.</li>
          <li>Draw with all the usual tools and add a caption.</li>
          <li>
            Press <b className="c-green">Insert</b>: the text below moves down, and the packages the drawing needs are added
            to the preamble for you. Margins and layout stay as they were.
          </li>
          <li>
            <b className="c-green">Download .zip</b> gives back the whole project with your changes, ready to upload to
            Overleaf.
          </li>
        </ol>
      </>
    ),
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
      { selector: '[data-tour="help"] .menu button:nth-of-type(2)', label: 'Help & shortcuts', desc: 'Quick start and every key, grouped by task. Press ? anytime.' },
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
          <li>
            Click a symbol, then click the canvas — or press <b>Templates</b> and pick a ready-made one.
          </li>
          <li>Double-click it and type.</li>
          <li>Drag a blue dot to another shape.</li>
          <li>
            Press <b className="c-green">Copy LaTeX</b> and paste into Overleaf.
          </li>
          <li>
            Or open your whole LaTeX project with <b>File → Open LaTeX project</b> and draw right inside it.
          </li>
        </ol>
      </>
    ),
  },
];
