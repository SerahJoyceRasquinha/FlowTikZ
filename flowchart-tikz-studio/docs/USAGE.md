# User guide

## The layout

| Region | Purpose |
| --- | --- |
| Top bar | Document identity, **Take the tour** and **Load example** |
| Toolbar | Tools (Select, Pan, Connect, Text), Chart from data, Undo/Redo, zoom, **View** menu (grid, snap), **File** menu (New, Open, Import diagram, Clear canvas), **Save**, **Export** menu, **Help** menu (Guided tour, Help & shortcuts) |
| Selection bar | Floats above the canvas only while something is selected: Align, Arrange, Duplicate, Group/Ungroup, Lock, Delete |
| Left panel | Generated LaTeX, with mode toggle, copy, download, search and issues |
| Palette | 29 flowchart symbols, filterable, grouped by category; fold it away with « |
| Canvas | The diagram, on white paper |
| Inspector | Properties of whatever is selected |
| Status bar | Saved / unsaved state, counts, diagram size, scale and zoom. Messages appear as a toast: green for success, red for problems |

## Guided tour

**Help → Guided tour (demo)** (also **Take the tour** in the top bar, the link on
the empty canvas, and the button in the Help dialog) starts an animated,
step-by-step walkthrough. It dims the screen, lights up one part at a time,
points at it with an arrow, and plays a short demonstration with a pretend
pointer: placing a symbol, typing in a shape, connecting two shapes, copying
the LaTeX, and so on. Pretend shapes are drawn over the canvas only; your
diagram is never changed.

Move with **Next** / **Back** or the `←` `→` keys; leave with **Exit tour**, the
× button, or `Esc`. First-time visitors are offered the tour once.

## Colour coding

- **Indigo** — the active tool or option, and main actions.
- **Green** — safe and successful actions: Save, Copy LaTeX, Insert chart, success messages, "All changes saved".
- **Red** — actions that remove things: Delete, Clear canvas; and error messages.
- **Amber** — "Unsaved changes" and search matches.

Drag the divider between the code and the editor to rebalance them; the split is
remembered between sessions.

## Creating shapes

1. Click a symbol in the palette; it stays armed and highlighted.
2. Click the canvas. The shape lands centred on the click, snapped to the grid.
3. Double-clicking a palette symbol drops it in the middle of the view instead.

Double-clicking empty canvas creates a process box and opens it for typing —
the fastest way to build a chain of steps.

`Esc` disarms the palette and returns to the select tool.

### Keyboard and shapes

Shapes have no letter keys: they are placed from the palette only, so typing
while the board has focus never arms a shape. The tool letters `V`, `H` and
`C` (select, pan, connect) still work while the drawing board has focus.

Everything with a modifier (`Ctrl/Cmd + Z`, `Ctrl/Cmd + S`, …) and the editing
keys (`Delete`, `Enter`, `F2`, the arrows, `Esc`, `?`) work from anywhere in
the application, as they always have.

## Charts from data

Press **Chart from data** in the toolbar (or on the empty canvas). Load an
Excel `.xlsx`, a `.csv`/`.tsv` file, paste cells copied from a spreadsheet, or
use the sample sales data; check each column's type; then choose a chart type
and drag fields into **Axis**, **Values**, **Legend** and **Filters** while the
preview updates. **Insert chart** places it on the canvas. Select a chart to
edit everything in the panel on the right; double-click it (or press `Enter`)
to jump to its settings. The full guide is [`CHARTS.md`](CHARTS.md).

## Text

Double-click a shape, or select it and press `Enter` or `F2`. Type directly on
the canvas.

- `Enter` inserts a line break.
- `Ctrl/Cmd + Enter` commits.
- `Esc` cancels and restores the previous text.
- Clicking away commits.

Longer text wraps inside the shape rather than spilling out, and the compiled
LaTeX wraps at the same width. Alignment is nine-way: pick horizontal (left,
centre, right) and vertical (top, middle, bottom) in the inspector.

Special characters are safe. Type `50% of #3 & rising`, `a > b`, `C:\path`,
`x ≤ 100°`, `Δt`, `Café` — all of it is escaped or mapped to the correct LaTeX
command automatically. Characters outside the Latin-1/Latin-Extended-A range
(CJK, emoji) are passed through with a note that they need XeLaTeX or LuaLaTeX.

## Connecting shapes

Hover a shape and four to eight **round blue points** appear just outside its
outline — the ports. Drag from one onto another shape, or onto one of its own
points, to create a connector. Drop on empty canvas to leave the endpoint
floating at that point.

As you approach a valid target the point you would land on turns red and picks
up a halo, so the attachment is obvious before you let go. The shape you are
aiming at offers its own points while you drag.

Ports sit outside the outline on purpose: the **square teal handles** on the
boundary resize the shape, and the two must never be mistaken for one another.
Small shapes show their four cardinal points only, so they stay uncrowded.

The **Connect** tool (`C`) does the same thing by dragging anywhere on a shape.

Connectors stay attached. Move, resize or rotate either shape and the route
recomputes from the ports. Delete a shape and its connectors survive as floating
paths at their last position, so nothing silently disappears.

### Routing styles

| Style | Shape | TikZ |
| --- | --- | --- |
| Straight | Direct line | `--` |
| Elbow | Axis-aligned dog-leg from the port directions | chained `--` |
| Elbow, rounded | Same with filleted corners | cubic corners |
| Curved | Arc through a displaced midpoint; set **Curvature** | `.. controls .. and ..` |
| Bezier | Leaves and enters along the port normals | `.. controls .. and ..` |
| Zig-zag | Alternating triangular wave | chained `--` |
| Polyline | Straight through your waypoints | chained `--` |

### Arrowheads and labels

Either end can carry none, stealth, LaTeX, triangle, open triangle, bar, circle
or diamond, at an adjustable size. For decision branches, type a label or use
the **Yes / No / True / False** quick buttons. Position slides the label along
the path (0–1), offset pushes it perpendicular, and the plate paints an opaque
backing so it stays legible where it crosses a line.

## Styling

Select an object; the inspector adapts to it.

Shapes offer fill, gradient (top-to-bottom, left-to-right or radial), border
colour, width and style (solid, dashed, dotted, dash-dot, none), corner radius
where the shape supports it, drop shadow, separate fill/border/overall opacity,
and full typography. Connectors offer routing, curvature, colour, width, dash,
opacity, arrowheads and label options.

Select several shapes to batch-edit: any change applies to all of them.

Colours come from the 20-swatch palette, a hex field, or your operating
system's colour picker. Every distinct colour becomes exactly one
`\definecolor` in the output no matter how many objects use it.

## Arranging

- **Snapping** — shapes snap to the grid and to other shapes' edges and centres.
  Amber guides show what you snapped to. Hold `Alt` while dragging to disable.
- **Align** (selection bar) — left edges, centres, right edges, top edges,
  middles, bottom edges. Needs two or more shapes.
- **Distribute** (in the Align menu) — even spacing left to right or top to
  bottom. Needs three or more.
- **Arrange** (selection bar) — Bring to front, Bring forward, Send backward,
  Send to back.
- **Group** — `Ctrl/Cmd + G`. Selecting one member selects the group.
- **Lock** — locked shapes ignore moves, resizes and alignment.

Resize from any of the eight handles; hold `Shift` to keep the aspect ratio.
Rotate with the handle above the selection; hold `Shift` for 15° steps.
Multi-selections resize and rotate as a block.

## Navigating

| Action | How |
| --- | --- |
| Pan | Middle-drag, hold `Alt` and drag, the **Pan** tool, or two-finger scroll |
| Zoom in | `Ctrl/Cmd` + `+` (also `Ctrl` + `=` and numpad `+`), or the toolbar **+** |
| Zoom out | `Ctrl/Cmd` + `-` (also numpad `-`), or the toolbar **−** |
| Zoom at the pointer | `Ctrl/Cmd` + scroll wheel |
| Reset zoom | `Ctrl/Cmd + 0`, or click the zoom percentage in the toolbar |
| Fit diagram | `Ctrl/Cmd + 1`, or **Fit** |

Zooming with the wheel keeps the point under the cursor fixed; the keyboard and
toolbar keep the middle of the board fixed. The zoom chords are taken by the
app even while a text field has focus, so the browser never zooms the whole
interface by mistake.

The **Symbols** palette can be folded away with **«** (and back with **»**) to
give the canvas more room, which helps when working on charts.

## Using the generated code

### Standalone

Compiles on its own. Create a new Overleaf project, replace `main.tex` with the
copied code, and press **Recompile**. You get a tightly cropped PDF of just the
figure — ideal for `\includegraphics` in a larger document, or for a
presentation.

### Snippet

For dropping into a document you already have. The header lists the packages and
libraries as comments; copy those into your preamble once:

```latex
\usepackage{tikz}
\usepackage{xcolor}
\usetikzlibrary{arrows.meta,shapes.geometric,shapes.misc}
```

Then paste the rest where the figure belongs, usually inside a float:

```latex
\begin{figure}[htbp]
  \centering
  % ---- paste the snippet here ----
  \caption{Manuscript review workflow.}
  \label{fig:review}
\end{figure}
```

The colour and style definitions in the snippet are valid inside the document
body, so they can stay next to the picture. If you insert several diagrams,
move the shared `\tikzset` block to your preamble and delete the duplicates.

### Scaling the figure

The **Units per centimetre** setting (inspector, with nothing selected)
controls the printed size. At 50, a 150-unit shape prints 3 cm wide. Halve the
number to double the figure. To fit a diagram to a text width instead, wrap it:

```latex
\resizebox{\textwidth}{!}{% ... tikzpicture ... }
```

### Tracing code back to shapes

Select a shape and its generated lines are highlighted, with the gutter marked
in teal, and the panel scrolls to them. Click any generated line to select the
object that produced it. Object ids (`n3`, `e7`) appear in the comments, in the
node names, and in the issues list — the same id everywhere.

### The issues list

The footer under the code reports:

- **Errors** — something cannot be emitted correctly (invalid size, missing
  shape). Fix these before compiling.
- **Warnings** — emitted, but not exactly as drawn (unreadable colour, a
  character needing another engine).
- **Notes** — a known approximation, such as text wrapping.

Click an id to select that object on the canvas.

## Saving, opening and exporting

**Save** (`Ctrl/Cmd + S`) writes a `.json` file containing the whole diagram —
shapes, positions, sizes, text, styles, colours, connectors, connection
relationships, grouping, layer order and canvas settings. **Open** restores it,
fully editable, and regenerates the LaTeX. The generated LaTeX is never the save
format; a projection cannot round-trip.

Export offers SVG (vector, exactly what is on screen with the editor chrome
stripped), PNG (2× for slides and previews), PDF (opens a correctly-sized print
window — choose *Save as PDF*), and the diagram JSON.

The current diagram is mirrored to browser storage as you work. After an
accidental refresh, a bar offers to restore it. The app also warns before you
navigate away, clear the canvas or start a new diagram with unsaved changes.

## Importing an existing diagram

**Import** (File group, next to **Open**) converts an external file into an
editable diagram: PNG, JPG, WEBP, BMP, GIF and AVIF images, SVG, draw.io /
diagrams.net files (including the source embedded in draw.io's SVG and PNG
exports), Excalidraw drawings and structured diagram JSON.

- On an empty canvas the import starts at once. Otherwise choose **Replace**
  (undo with `Ctrl+Z`), **Insert** (placed beside your work and selected) or
  **Open as new document**.
- The progress panel in the bottom-right shows each stage; keep working, or
  press **Cancel** — a cancelled import changes nothing.
- When it completes the view fits the imported diagram and the LaTeX updates.
  **View report** lists anything approximated, unsupported or recognised with
  low confidence; click an entry's id to select that object.
- For images, **Compare with source image** overlays the original picture
  (*Original*, *Overlay*, *Difference*) for checking. The overlay is never
  exported or saved.
- Imported objects are ordinary objects. Select one to see where it came from
  under **Imported** in the inspector, including source properties kept as
  metadata.

Pictures are converted by the built-in offline recogniser with OCR, entirely
in the browser — no API key, no internet connection, nothing uploaded (see
[`IMPORT.md`](IMPORT.md)). It works best on clean digital diagrams; check the
conversion report for text recognised with low confidence.

Imported diagrams export on a transparent background. Change that under
**Export background** in the inspector with nothing selected.

## Keyboard shortcuts

Press `?` for the in-app list. The essentials:

| Keys | Action |
| --- | --- |
| `V` `H` `C` | Select, Pan, Connect |
| `Ctrl/Cmd + Z` / `+ Y` | Undo / redo |
| `Ctrl/Cmd + C` `X` `V` `D` | Copy, cut, paste, duplicate |
| `Ctrl/Cmd + A` | Select all |
| `Ctrl/Cmd + S` | Save JSON |
| `Ctrl/Cmd + G` / `+ Shift + G` | Group / ungroup |
| `Delete` | Delete selection |
| Arrows / `Shift` + arrows | Nudge one grid step / ten units |
| `Enter` or `F2` | Edit text (on a chart: open its settings) |
| `Ctrl/Cmd + +` / `-` | Zoom in / out |
| `Ctrl/Cmd + 0` / `+ 1` | Reset zoom / fit |
| `Esc` | Cancel |
