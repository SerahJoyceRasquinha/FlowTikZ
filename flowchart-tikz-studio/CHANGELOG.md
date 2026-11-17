# Changelog

## November 2026 (1.3.0): LaTeX projects

### Added
- **Open LaTeX project (.zip)** in the File menu. Imports Overleaf-style
  project zips: finds the main `.tex` file (asks when there is more than one
  candidate), follows `\input`/`\include`/`\subfile`/`\import`, and shows the
  folder tree, the LaTeX of any file and a preview of the document in place of
  the canvas.
- **Draw inside the document.** Click a spot, press **Draw here** (or `Enter`),
  draw in the frame that opens in the page, and **Insert** (`Ctrl+Enter`). The
  text below moves down. Exact or floating placement, captions with automatic
  labels, editing and removing figures later.
- **Packages added where they belong.** Only missing packages, next to the
  document's own (before `hyperref`), or in a separate preamble file;
  definitions just before `\begin{document}`. Figures are capped at the text
  width, so margins and layout never change.
- **Download .zip** (`Ctrl+S` in project mode) with the original folder layout,
  encodings and line endings; untouched files are copied byte for byte.
  **Copy LaTeX** and **.tex** for the open file.
- Clear errors when a zip has no main file, no `.tex` files, is empty, is not
  a zip or is damaged. Unsafe paths are dropped.
- Large projects: streaming reader and writer with Zip64. Tested with a 23 MB
  main file, 70,000 files and 4.5 GB archives; long documents are rendered in
  windows.
- Guided tour step and Help section for LaTeX projects. New
  [`docs/PROJECTS.md`](docs/PROJECTS.md).

### Fixed
- The guided tour's **Clear canvas** hop pointed at the wrong File-menu item
  once a new item was added; hops now use stable selectors.

## November 2026: templates, undo everywhere, standard shortcuts

### Added
- **Template library** (toolbar → **Templates**; also in the Physics and Chem
  menus and on the empty canvas). 190 ready-made, fully editable templates:
  - **Flowcharts (17):** simple process, IPO, if/else, switch, while, for and
    do-while loops, largest of two, even/odd, sum of n, factorial, binary
    search, login, try/catch, online order, waterfall life cycle, PDCA.
  - **Mathematics (72):** algebra, calculus, trigonometry, geometry,
    statistics & probability, linear algebra, series & numbers.
  - **Physics (57):** laws and equations (mechanics, electricity & magnetism,
    waves & optics, thermodynamics, modern physics) and diagrams — series,
    parallel, RC, voltage divider, LED and meter circuits; free-body, incline,
    spring–mass, pendulum, convex lens, two charges.
  - **Chemistry (44):** common, acid–base, industrial, redox, organic and
    nuclear reactions (mhchem), chemistry formulas (pH, Kc, Arrhenius, Nernst,
    Gibbs…) and molecules (chemfig).
  Live previews drawn by the canvas renderers, category tabs with counts, a
  search across every tab, keyboard navigation. Inserting is one undo step,
  lands in the middle of the view or right beside existing work (never on top
  of it), and stays selected.
- **Undo / redo everywhere.** `Ctrl/Cmd + Z`, `Ctrl/Cmd + Y` and
  `Ctrl/Cmd + Shift + Z` now work in the property panel (one step per visit to
  a field instead of one per keystroke), while typing inside a shape (typing
  first, then the canvas), and inside the formula editor (now also in LaTeX
  mode and for inserted symbols), the chemistry editor (new: formula text,
  element buttons, reaction terms, arrows, conditions), the molecule editor
  (keyboard support; a whole drag is one step) and the chart builder (new,
  with Undo/Redo buttons). Works on non-Latin keyboard layouts.
- **Everyday shortcuts:** `Ctrl/Cmd + O` opens a saved diagram,
  `Ctrl/Cmd + ]` / `[` (with Shift: to front / back) change layer order,
  `Space + drag` pans with any tool, `+` / `-`, `Shift + 0` and `Shift + 1`
  zoom the drawing while the board has focus.
- **Guided tour:** new steps for Templates, the science tools, the formula
  editor, the Physics and Chemistry menus and the Flow / Circuit / Physics
  symbol sets; the undo and zoom steps explain undo-everywhere and page zoom
  (22 steps).
- Help dialog lists shortcuts in groups (Editing, Tools, Canvas & view, Files,
  In the editors, Browser).

### Changed
- **`Ctrl/Cmd + +`, `-`, `0` zoom the web page again** (the browser's own page
  zoom), as users expect on every site; `Ctrl + 1` is left to the browser's
  tab switching. The drawing zoom moved to the keys listed above, the toolbar
  and `Ctrl + wheel`.
- `Ctrl + C`, `Ctrl + X` and `Ctrl + A` act on text you have highlighted in the
  LaTeX panel instead of on the shapes.
- The toolbar stays on one row from 1280 px to 2560 px wide: labels fold into
  icons (with tooltips and accessible names) in a fixed order as the window
  narrows.
- The typographic minus sign (−) in shape text is emitted as `$-$`.

### Tests
- 1626 tests (was 1364): new `undo.ui`, `templates` and `templates.ui` suites;
  zoom tests rewritten for page zoom; tour tests for the new steps; four new
  pdfLaTeX template fixtures. Exercised in real Chrome against the production
  build (see `docs/TESTING.md`).

## November 2026: mathematics, physics and chemistry

### Added
- **Formula editor**: nested visual construction, live preview, LaTeX mode,
  undo/redo, 55 structures and 230 searchable symbols with recent and frequent lists.
- **Circuits**: 39 components emitted through CircuiTikZ, drag and drop, wires
  bound to terminals, junctions, rotation and flipping, labels, values, voltage
  and current annotations.
- **Physics parts**: forces, springs, pulleys, inclines, fields, waves, optics.
- **Chemistry**: mhchem formula editor, reaction builder with balance check,
  molecule editor generating chemfig.
- Required LaTeX packages are detected and listed, with no duplicates.

### Changed
- Palette has Flow / Circuit / Physics tabs; Flow remains the default.
- Older save files load and generate unchanged.

## November 2026: friendly redesign and guided tour

### Added
- **Guided tour (demo)** under **Help**, in the top bar, on the empty canvas
  and in the Help dialog. 16 animated steps: a spotlight on each part of the
  screen, a bouncing arrow, a pretend pointer that clicks through the controls,
  and on-canvas demonstrations of placing a symbol, typing in a shape and
  connecting shapes. Next / Back / Exit, arrow keys and Esc. Offered once to
  first-time visitors. The diagram is never changed by the tour.
- **Selection bar** floating over the canvas while something is selected:
  Align (with even spacing), Arrange, Duplicate, Group/Ungroup, Lock, Delete.
- Quick, large tooltips on every button; colour-coded toast messages.

### Changed
- **Bright theme**: light panels, dark crisp text, larger fonts, clear hover
  states (tinted fill, outline and glow) on every button.
- **Colour coding**: green for Save / Copy LaTeX / Insert chart / success,
  red for Delete / Clear canvas / errors, amber for unsaved changes.
- **Decluttered toolbar**: about 15 controls instead of 37, on one row. File
  actions moved into a **File** menu, grid/snap into **View**, image/PDF into
  **Export**, and selection actions into the selection bar that appears only
  when needed. Every menu entry says what it does.
- Status bar shows "All changes saved" / "Unsaved changes" in words.

## October 2026: charts from data, fixes and usability pass

### Fixed
- **Zoom shortcuts.** `Ctrl/Cmd` + `+` / `-` / `0` / `1` now work everywhere:
  on the main keyboard and the numpad, with or without Shift, on layouts where
  `+` is not on the `=` key, and while a text field or the property panel has
  focus (previously the browser zoomed the whole page instead). Keyboard and
  toolbar zoom keep the middle of the board still instead of drifting toward
  the top-left corner.
- **Colour fields** no longer show a stale hex value after picking a swatch,
  using the colour picker, or selecting another shape.
- **Zoom and Fit** measure the board live, so they stay correct after the
  palette folds or the property panel changes width.

### Removed
- **Letter shortcuts for shapes** (`R`, `D`, `⇧M`, ...) and their palette
  badges. Shapes are placed from the palette only, so typing on the board can
  no longer arm a shape by accident. The tool keys `V`, `H`, `C` remain.

### Added: charts from Excel / CSV (Power BI-style)
- **Chart from data** in the toolbar and on the empty canvas: load `.xlsx`
  (any sheet), `.csv`/`.tsv`, paste cells from a spreadsheet, or use sample data;
  check column types in a preview table.
- Eight chart types: column, bar, line, area, scatter, pie, donut, histogram.
- Field wells **Axis**, **Values**, **Legend**, **Filters** with drag and drop,
  drop-downs and double-click; aggregations sum, average, count, distinct
  count, minimum, maximum, median; count of records; several value fields;
  filters by value or range; sort; top N; date grouping by month, quarter,
  year; stacking; histogram bins.
- Formatting: seven colour themes plus a colour per series or slice, titles
  (automatic from the field names, editable, hideable), legend position, data
  labels, pie labels, bar width, line width/style, markers, area opacity,
  axis range, gridlines, frame, label angle, decimals, thousands separator,
  short numbers, prefix/suffix, background.
- **PGFPlots output** with the data, field names and exact colours written
  into the code (no external data file), drawn from the same layout as the
  canvas so plot area, ranges, ticks, bars, colours and labels match.

### Usability
- The app is now titled **FlowTikZ**; the code panel is "LaTeX output"; the
  main action is a highlighted **Copy LaTeX** button; the code-panel buttons
  wrap instead of overlapping on narrow screens.
- The **Symbols** palette can fold away (« / ») to widen the canvas.
- A new chart is fully visible when inserted; **Load example**, **Open** and
  **Restore** fit the diagram to the screen; **Load example** asks before
  replacing unsaved work.
- Tooltips on every toolbar button; clearer labels (**Import diagram**,
  **Help**); the zoom level is shown in the toolbar and resets on click.
- The property panel's heading shows the shape's text rather than its id; the
  status bar counts shapes, charts and connectors separately with correct
  plurals; the "Ready to compile" line lists the packages the code needs.
- The help dialog starts with a three-step quick start for flowcharts and
  charts.

### Verification
- 497 automated tests (80 new for charts, plus new zoom tests); 9 pdflatex
  fixtures including every chart type and a chart pasted into an article;
  canvas-against-PDF overlay checks; a 400-chart random stress test.
