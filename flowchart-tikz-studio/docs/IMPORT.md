# Importing diagrams

**File → Import** turns an external file into a *native, fully editable*
diagram: real shapes, real text, real connectors bound to their shapes. Nothing
is pasted in as a picture. The result is the same `Diagram` model a hand-drawn
diagram is, so the canvas, the inspector, undo/redo, save, autosave, every
export and the TikZ generator all work on it unchanged — and the LaTeX panel
updates the moment the import lands.

```
                ┌──────────────────────┐
                │ External file        │
                └──────────┬───────────┘
                           │  validate (name, size, MIME)
                ┌──────────▼───────────┐
                │ Format detection     │  by content (magic bytes / markup), not by name
                └──────────┬───────────┘
          ┌────────────────┼──────────────────┬──────────────────┐
          ▼                ▼                  ▼                  ▼
     Raster image       SVG file         draw.io XML       Excalidraw / IR JSON
          │                │                  │                  │
   decode · background  sanitise           parse cells,      validate
   analysis             parse → IR         styles, parents
   offline recogniser     │                  │                  │
   (shapes + OCR) →       │                  │                  │
   validate IR → SVG ─────┤                  │                  │
          └────────────────┴────────┬─────────┴──────────────────┘
                                    ▼
                     ┌────────────────────────────┐
                     │ Normalised diagram (IR)    │  src/import/ir/types.ts
                     └─────────────┬──────────────┘
                                   ▼  diagramMapper
                     ┌────────────────────────────┐
                     │ Existing Diagram model     │  single source of truth
                     └─────────────┬──────────────┘
                        ┌──────────┴──────────┐
                        ▼                     ▼
               Existing SVG canvas    Existing TikZ generator
```

A draw.io PNG or SVG that carries its source diagram (draw.io embeds it on
export) is imported from that source directly: no image analysis, full
fidelity.

---

## Supported formats

Everything runs locally in the browser: no internet connection, no API key,
and no file is ever uploaded.

| Format | How it is converted |
| --- | --- |
| PNG, JPEG, WEBP, BMP, GIF (first frame), AVIF | Built-in offline recogniser (shapes, lines, Tesseract OCR) → structured JSON → validated → SVG → native objects |
| SVG | Sanitised, parsed element by element, recognised as native symbols |
| SVG exported from draw.io | The embedded draw.io source, when present; otherwise as SVG |
| PNG exported from draw.io | The embedded draw.io source (`mxfile` text chunk) |
| draw.io / diagrams.net (`.drawio`, `.xml`) | Parsed from `mxCell`s; compressed and multi-page files supported |
| Excalidraw (`.excalidraw`) | Parsed from its elements, bindings and groups |
| Structured diagram JSON (the IR) | Validated, normalised, mapped |
| Flowchart Studio JSON | Imported as-is (useful with *Insert*) |

Limits: 25 MB for images, 10 MB for SVG, 20 MB for draw.io/JSON; images larger
than 20 000 px per side or 60 megapixels are refused before decoding.

---

## Using it

1. Click **Import** in the File group (next to **Open**, which still opens this
   app's own `.json` saves).
2. Pick a file. If the canvas already has content you choose:
   - **Replace current diagram** — one undoable step; `Ctrl+Z` restores your
     diagram;
   - **Insert into current diagram** — added to the right of your work,
     selected, also one undoable step;
   - **Open as new document** — a fresh document (history starts over; the
     dialog warns if this would discard unsaved changes).
3. A progress panel shows the real pipeline stages. Nothing is modal: keep
   working while it runs. **Cancel** stops the import and leaves the diagram
   untouched.
4. When it lands, the view fits the imported diagram, the LaTeX updates, and
   the panel summarises what was converted. **View report** lists everything
   that needed attention; each entry links to its object.

For image imports the panel also offers **Compare with source image**:
*Original*, *Overlay* and *Difference* place the source picture exactly over
the reconstruction. It is editor chrome only — never exported, saved or
turned into LaTeX — and it disappears when the document is replaced.
**Reconstruction SVG** downloads the intermediate SVG the diagram was built
from.

---

## How a picture is read

Pictures (PNG, JPG, …) are converted by the built-in offline recogniser — no
internet, no API key, nothing uploaded, typically 1–3 s.

**The offline recogniser** (`src/import/local/`) is classical computer vision
plus OCR, running inside the import worker:

1. **Regions** — the page is found by connectivity from the image border; the
   rest is split into regions of uniform colour.
2. **Shapes** — a region is a shape body when, with its text holes filled, it
   is large, thick and compact. Filled shapes are found directly; outlined
   shapes through their enclosed interior (so white boxes on white paper
   work). An outline of a different colour is measured as the stroke. The
   silhouette is matched against templates of the flowchart symbols
   (rectangle, rounded rectangle, terminator, ellipse/circle, diamond,
   parallelogram, trapezoid, hexagon, triangles, document, manual input,
   off-page, delay; a split lid + body is a cylinder). Anything else keeps its
   exact outline as a polygon.
3. **Text** — the remaining marks are grouped into lines and blocks by layout,
   and each block is read by **Tesseract** (WebAssembly, English model) from a
   clean, enlarged, dark-on-white rendering of just its own pixels. Size,
   colour and bold are measured from the glyphs.
4. **Connectors** — every other mark is thinned to a one-pixel skeleton.
   Filled heads (thick tapered blobs), open heads (two barbs meeting at a
   point) and heads standing apart from their line are recognised; dashed and
   dotted lines are chained back together; ends are attached to the nearest
   shape; the arrow tip decides the direction; nearby text becomes the label.

Its output is IR JSON, validated and mapped by the same code as every other
format. It is made for clean digital diagrams (exports, screenshots, slides);
hand drawings, photos, heavy decoration and overlapping elements are harder,
and the report flags anything uncertain.

The OCR files (worker, WebAssembly core, English model — about 7 MB) are served
by this app itself under `/ocr/` (`scripts/vite-ocr-assets.mjs` streams them
from `node_modules` in development and copies them into `dist/ocr/` on build),
so offline recognition needs no CDN. Browsers cache the language model after
the first use.

---

## How image reconstruction works

1. **Decode and measure** — the image is decoded off the main thread
   (`createImageBitmap` + `OffscreenCanvas`) at up to 1600 px for analysis.
2. **Background removal by connectivity** — the page colour is estimated from
   the image border (robust to paper tint, scans, screenshots, coloured and
   transparent backgrounds), then flood-filled *from the edge of the image*.
   Only pixels connected to the edge are background. A white box on white
   paper has a border all round it, so its white interior is **not** connected
   to the edge and is kept. There is no "remove every white pixel" step
   anywhere.
3. **Offline recognition** — shapes, text (OCR) and connectors are found as
   described above and written as JSON in the IR schema: shape types from a
   fixed flowchart vocabulary, boxes, text with per-item confidence, styles,
   connectors with `source`/`target` object ids and full bend points, labels.
4. **Validation** — the result is checked like any outside input. Every field is type-checked and
   range-checked: `NaN`, `Infinity` and coordinates far outside the image are
   dropped, colours are parsed (invalid → default + report), unknown enums are
   coerced and reported, text is stripped of control characters, counts are
   capped. One bad object never sinks the rest.
5. **Back to source pixels** — coordinates are mapped back through any
   downscaling.
6. **Normalisation** — duplicates removed; a rectangle covering the page is
   dropped; loose text inside a shape becomes its label; loose text beside a
   line becomes that connector's label, keeping its offset.
7. **Background check** — every shape reported with the background colour is
   checked against the connectivity mask: enclosed → kept as a white fill;
   connected to the page → its fill is made transparent (e.g. inside a dashed
   outline) or, with no outline and no text, it is removed as a phantom.
8. **SVG** — the IR is written as a deterministic SVG annotated with
   `data-fc-*` attributes, then read back through the sanitiser and the SVG
   importer. The round trip is lossless (tested) and the SVG is downloadable.
9. **Mapping** — as for every format, below.

Text is never "corrected": OCR output is kept exactly as read, and
recognition below 80 % confidence is listed under *Text to check* in the
report, linked to the shape.

---

## How any IR becomes native objects

`src/import/conversion/diagramMapper.ts`, shared by all formats:

- **Shapes.** Semantic types map to registry kinds (diamond → Decision,
  cylinder → Database, parallelogram → Input/Output …). An explicit outline
  (SVG polygon or path) is compared geometrically — symmetric Hausdorff
  distance, including inner strokes such as a cylinder's lid or a predefined
  process's bars — against every native symbol laid out in the same box. A
  match becomes that symbol; otherwise the exact outline is kept as the
  `freeform` kind (below). A rectangle whose radius reaches half its height is
  a terminator.
- **Text.** Content verbatim (the existing emitter escapes it for LaTeX), font
  size, weight, slant, underline, colour, horizontal and vertical alignment;
  families are classified sans/serif/mono. Free text boxes are widened to their
  longest line so the canvas does not wrap what the source did not.
- **Connectors.** Ends bind to the objects the source names; where it names
  none (plain SVG, a recognised picture), an end that touches a shape is attached
  to it. Ports: an explicit port, a draw.io exit/entry fraction or the contact
  point all resolve to the nearest named port; draw.io's floating terminals
  stay floating (`auto`). Routes: if the native router, left to itself, draws
  what the source drew, the connector is left to the router (so it stays live
  when shapes move); otherwise the bend points become waypoints with the first
  and last legs kept straight. Curves become the model's curved routing with
  the bend recovered from the curve's control points.
- **Styles.** Fill (none → zero opacity), stroke (none → no line), width, dash
  (custom patterns → nearest of dashed/dotted/dash-dot), opacity, corner
  radius, shadow, gradients (nearest axis direction).
- **Groups.** Mapped to native groups (one level deep; nested groups flatten
  into their outermost group). **z-order** is preserved exactly.
- **Provenance.** Every imported object records its source format and id,
  recognition confidence, and every source property the editor cannot show —
  verbatim — in `meta.import.preserved`. The inspector shows it under
  *Imported*; it is saved with the diagram and never affects rendering or
  LaTeX.

### The `freeform` shape

An outline that matches no symbol is not flattened or approximated: it becomes
a node of kind `freeform` whose outline is stored on the node, normalised to
its box. It is an ordinary registry entry, so it renders, hit-tests, resizes,
rotates, takes connection points, styles and — through the existing explicit
`\draw` path emitter — compiles to the exact same curve in TikZ. It is not in
the palette because it has no fixed outline to offer.

---

## draw.io specifics

Read directly from the XML: `mxCell` geometry (including children positioned
inside groups and containers), labels (plain or HTML, with placeholders
resolved from `UserObject` attributes), `fillColor`, `strokeColor`,
`strokeWidth`, `dashed`/`dashPattern`, `rounded`/`arcSize`, `shadow`,
`opacity`/`fillOpacity`/`strokeOpacity`, `gradientColor`/`gradientDirection`,
`fontColor`, `fontSize`, `fontFamily`, `fontStyle` bits, `align`,
`verticalAlign`, `rotation`, `locked`, shapes (built-in and
`mxgraph.flowchart.*`), `triangle` directions, swimlanes (frame + header rule),
edges with `source`/`target`, `exitX`/`exitY`/`entryX`/`entryY`, waypoints,
`sourcePoint`/`targetPoint`, `edgeStyle` (orthogonal/elbow → elbow),
`curved`, `rounded`, `startArrow`/`endArrow` with fill, marker sizes, edge
labels (the edge's own value and child label cells with their position),
groups and containers, layers (merged in order; hidden layers reported),
multiple pages (the first is imported; the others are listed) and compressed
pages. Style keys that affect only draw.io's editor are ignored; **every other
unconsumed key is kept verbatim as metadata**.

---

## Security

- Imported markup is **never inserted into the page**. SVG and XML are parsed
  by a small DOM-free parser into plain objects that the importers read as
  data. Nothing in an imported file can execute.
- The XML parser rejects entity declarations (no "billion laughs", no XXE),
  bounds nesting depth and element count, and uses null-prototype attribute
  maps (no prototype pollution).
- The SVG sanitiser removes scripts, event-handler attributes, `javascript:`
  URLs, embedded documents and animation, and every external reference
  (`href`, `url(...)`); only `#id` references and inline raster `data:` images
  survive. `<foreignObject>` HTML is reduced to plain text. Counts of what was
  removed appear in the report.
- Recognised and JSON input is validated field by field (see above); label
  text is plain data and is escaped by the existing LaTeX escaper like any
  typed text.
- Pictures are never uploaded: recognition and OCR run in the browser, and
  the OCR files are served by the app itself.
- Compressed content (draw.io pages, PNG text chunks) is inflated with a size
  cap, so a compression bomb is stopped rather than allowed to fill memory.
- Errors shown to users are sentences, never stack traces; the optional
  *Details* line carries a short diagnostic.

---

## Background processing

The whole pipeline runs in a dedicated **Web Worker**
(`src/import/worker/import.worker.ts`): decoding, background analysis,
offline recognition and OCR, SVG generation and parsing, and mapping. The
editor stays fully interactive while it runs. If a Worker cannot start, the same pipeline is
loaded lazily and runs on the main thread, still asynchronous and yielding
between stages. Cancellation stops recognition and discards the result; a
cancelled import commits nothing.

Ids are allocated inside the worker with a local counter and re-allocated from
the editor's own counter when the diagram is committed, so imported ids never
collide with existing ones.

---

## The conversion report

| Category | Meaning |
| --- | --- |
| Unsupported elements | Could not be imported (the rest still was) |
| Text to check | Recognised with low confidence — verify the wording |
| Connectors not attached | An end could not be bound to a shape |
| Partially converted | Imported, but part could not be represented (e.g. an embedded image kept as a frame) |
| Approximated properties | Drawn with the nearest native equivalent |
| Style differences | Renders differently from the source |
| Preserved as metadata | Source properties kept verbatim on the object |
| Notes | Background handling, pages, layers … |
| Converted | What became native objects |

---

## Module map

```
src/import/
├── types.ts                 ImportResult, ImportError (+ user messages), progress stages
├── detector.ts              content-based format detection, embedded draw.io extraction
├── validation.ts            size / extension / MIME / pixel-count limits
├── binary.ts                magic bytes, header dimensions, base64, inflate, PNG text chunks
├── report.ts                report builder and categories
├── pipeline.ts              runImport: the stages, per format, with cancellation
├── client.ts                startImport: Web Worker, or lazy main-thread fallback
├── controller.ts            UI glue: mode choice, progress, commit via applyImport
├── xml/parser.ts            DOM-free, entity-safe XML parser
├── ir/types.ts              the normalised diagram representation (IR)
├── ir/validate.ts           untrusted IR → valid IR (recogniser output, JSON files)
├── ir/normalize.ts          dedupe, text attachment, background checks, coordinate mapping
├── ir/shapes.ts             IR ↔ registry kinds, geometric outline matching
├── svg/sanitize.ts          active-content and external-reference removal
├── svg/parser.ts            SVG → IR (CSS, transforms, <use>, markers, gradients, arrowheads …)
├── svg/generator.ts         IR → annotated, deterministic SVG
├── svg/annotated.ts         annotated SVG → IR (lossless reader)
├── svg/pathData.ts          full SVG path grammar incl. arcs → cubic segments
├── svg/transform.ts         affine matrices
├── svg/css.ts               <style> rules: selectors, specificity, cascade
├── drawio/parser.ts         mxfile / mxGraphModel → IR
├── drawio/style.ts          style strings, shape and arrow vocabularies
├── excalidraw/parser.ts     Excalidraw → IR
├── raster/background.ts     connectivity-based background analysis
├── raster/decode.ts         image decoding behind an interface
├── local/recognize.ts       the offline recogniser: picture → IR JSON
├── local/shapes.ts          colour regions, shape bodies, strokes, symbol templates
├── local/text.ts            glyph grouping and OCR of each text block
├── local/lines.ts           skeletons, arrow heads, dashed-line chaining
├── local/morph.ts           components, hole filling, distance transform, thinning
├── local/ocr.ts             the Tesseract text reader, served locally
├── local/image.ts           pixel helpers (colour, PGM encoding, resizing)
├── conversion/diagramMapper.ts   IR → Diagram (the single convergence point)
├── conversion/connectorMapper.ts binding, ports, route simplification
├── conversion/styleMapper.ts     fills, strokes, dashes, gradients, arrowheads
├── conversion/textMapper.ts      fonts, alignment, confidence
├── conversion/ids.ts             id allocation and re-numbering
├── conversion/color.ts           full CSS colour parsing
└── worker/                       the Worker entry, its message loop and protocol

server/
└── serve.mjs                production server for dist/, no dependencies
```

Model additions (all optional and backward compatible — existing save files
load byte-identically): `Node.path` for the `freeform` kind, `Node.meta` /
`Edge.meta` for provenance, and `settings.background: 'none'` for a transparent
export (also selectable in the canvas inspector).
