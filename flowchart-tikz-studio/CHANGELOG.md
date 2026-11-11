# Changelog

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
