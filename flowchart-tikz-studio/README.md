# Flowchart → TikZ Studio

A visual flowchart editor that writes its own LaTeX. You draw on the canvas on
the right; compile-ready TikZ appears on the left and stays in step with every
edit. Paste it into Overleaf and the compiled figure matches what you drew.

Built for people producing figures for papers, theses, project reports and
technical documentation — where a screenshot of a drawing tool is not good
enough and hand-written TikZ is slow.

```
User edits canvas  →  diagram model  →  SVG renderer   (what you see)
                             └────────→  TikZ emitter  (what you compile)
```

The diagram model is the single source of truth. Both the canvas and the LaTeX
are projections of it, which is why they cannot drift apart.

---

## Quick start

Requires Node.js 18 or newer.

```bash
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Typecheck, then build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the full test suite (178 tests) |
| `npm run test:watch` | Tests in watch mode |
| `npm run typecheck` | TypeScript, no emit |
| `npm run latex:fixtures` | Generate `.tex` fixtures into `latex-verify/` |
| `bash scripts/verify-latex.sh` | Compile those fixtures with `pdflatex` |

Deploying the production build is a matter of serving `dist/` as static files —
there is no backend.

---

## The 60-second tour

1. Click a symbol in the left palette, then click the canvas to place it.
2. Double-click a shape to type into it. `Esc` cancels, `Ctrl+Enter` commits.
3. Hover a shape and drag from one of its edge dots to another shape to connect
   them. Move either shape — the connector follows.
4. Select anything and edit it in the inspector on the right.
5. Watch the panel on the left. Select a shape and **its own generated lines
   light up**; click any generated line to select the object that produced it.
6. Press **Copy**, paste into Overleaf, recompile.

Press `?` in the app for the full shortcut list.

---

## What it does

**Canvas.** Create, select, move, resize, rotate, duplicate, delete, copy/paste,
multi-select, marquee-select, group, lock, reorder (front/forward/back/bottom),
align (6 ways), distribute (2 axes), undo/redo, zoom, pan, fit-to-view, grid
with snapping, and object-to-object snapping with live guides.

**Symbols.** 29 shapes across Flow, Data, Documents, Extended, Basic and
Annotation categories — terminator, process, decision, input/output, predefined
process, preparation, manual input, manual operation, delay, display, connector,
off-page connector, merge, extract, or, summing junction, document, multiple
documents, database, stored data, internal storage, direct access storage, card,
loop limit, rectangle, ellipse, text label, note and annotation bracket.

**Connectors.** Seven routing styles (straight, elbow, rounded elbow, curved,
Bezier, zig-zag, polyline), eight arrowhead types at either or both ends,
labels with adjustable position/offset/plate, and per-connector colour, width,
dash pattern and opacity. Connectors bind to named ports and re-route
automatically when shapes move, resize or rotate.

**Styling.** Fill, border colour, border width, five border styles, corner
radius, three gradient modes, drop shadow, separate fill/border/overall
opacity, text colour, size, family, bold/italic/underline, nine-way text
alignment and wrap width. Custom colours via palette, hex field or the native
picker.

**Output.** Standalone document or picture snippet, both with automatically
generated colour definitions, style definitions and exactly the TikZ libraries
the diagram needs. Syntax highlighting, line numbers, search, copy, download,
issue list with clickable object references.

**Files.** Save/open diagram JSON, export SVG, PNG and PDF, and automatic
recovery of the last session after an accidental refresh.

---

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/USAGE.md`](docs/USAGE.md) | Full user guide, including the Overleaf workflow |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Module map, data model, and why each decision was made |
| [`docs/LATEX_MAPPING.md`](docs/LATEX_MAPPING.md) | Every visual feature and the TikZ it becomes |
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | Where canvas and TikZ cannot match exactly, and what happens instead |
| [`docs/VERIFICATION.md`](docs/VERIFICATION.md) | How the output is proven to compile |
| [`docs/TESTING.md`](docs/TESTING.md) | Test layout and what each suite covers |

---

## Technology, and why

| Choice | Reason |
| --- | --- |
| React 18 + TypeScript + Vite | Fast dev loop, and a typed model is essential when the model *is* the product |
| Zustand | The store holds one plain diagram object; snapshot-based undo is a few lines rather than a framework |
| **Custom SVG canvas engine** | See below |
| Custom LaTeX highlighter | The panel is read-only by design; a full editor component would add ~700 kB for line numbers and colour |
| No other runtime dependencies | Three packages total, so the app stays auditable and the bundle is 81 kB gzipped |

**On not using a diagram library.** Konva, JointJS, tldraw and React Flow were
all considered. Each owns its own geometry and serialisation model, so exact
canvas-to-TikZ parity would mean reverse-engineering that model on every frame —
and the hard requirement here is that the compiled PDF matches the canvas to
within a fraction of a point. Owning the geometry means one outline function per
shape feeds *both* the SVG renderer and the TikZ path emitter, so the two
cannot disagree by construction. What that cost is roughly 900 lines of
interaction code (pointer state machine, handles, snapping, marquee) that a
library would have supplied.

---

## Verified, not assumed

`npm test` runs 178 tests, including a DOM smoke test that mounts the real
application and fails if React logs a single warning.

Beyond that, `scripts/verify-latex.sh` compiles seven generated fixtures with
`pdflatex` — the worked example, every symbol, every styling combination, every
routing and arrowhead, an empty diagram, an extreme scale, and a dimensional
control. All seven compile clean. The dimensional control checks the compiled
page size against the size the model asked for:

```
PASS  07-geometry-control  (1 page, 130.233x73.54 pt)
      geometry OK: expected 130.72x73.82 pt, got 130.233x73.54 pt
```

A 200 × 100 unit rectangle at 50 units/cm prints at 4 cm × 2 cm, to within
0.5 pt (0.17 mm) — the residual is TikZ's handling of stroke width in the
bounding box. See [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

---

## Licence

Provided as-is for academic and personal use.
