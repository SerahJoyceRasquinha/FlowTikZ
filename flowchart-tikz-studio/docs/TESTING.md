# Testing

```bash
npm test          # 417 tests
npm run test:watch
npm run typecheck
```

TypeScript runs in `strict` mode with `noUnusedLocals` and
`noUnusedParameters`; `npm run build` typechecks before it bundles.

## Suites

| File | Tests | Covers |
| --- | --- | --- |
| `escape.test.ts` | 15 | All seven TeX specials, command-form escapes, symbol and accent mapping, per-line formatting, CRLF, blank lines, and that a pasted `\newcommand` cannot survive as a command |
| `colors.test.ts` | 12 | Hex normalisation (long, short, no hash, invalid), deduplication, xcolor built-ins, order independence, and every unit conversion including the y flip and number formatting |
| `geometry.test.ts` | 24 | Rotation, rotated bounds, rectangle normalisation, quadratic→cubic exactness; every shape's outline is non-empty, stays inside its box, produces no `NaN` at 1×1 px, and exposes at least four ports; port anchoring under rotation, connectors following moved shapes, auto-port selection, all 7 routing styles, label placement, and routing determinism |
| `diagram.test.ts` | 25 | Bounds (including connector geometry and the empty case), all four z-order commands, all six alignments, distribution, locked-shape immunity, deletion converting attached connectors to floating endpoints, group dissolution, and snapping to grid, to objects, and not at all |
| `generator.test.ts` | 61 | Document structure in both modes; every shape emitting lint-clean; both emission strategies; scale, rotation, text, escaping, all fill/border/opacity/shading/shadow/radius/typography options; all routings, arrowheads and label options; colour deduplication; traceability; byte-stability across regeneration and diff-stability when one shape moves; and robustness against 200 objects, overlapping shapes, long text, invalid dimensions, unreadable colours, unknown shapes and a corrupt object |
| `persistence.test.ts` | 29 | Save/load round trip, identical LaTeX after a round trip, envelope format, rejection of non-diagrams, defaults for sparse files, dropping connectors to missing shapes, version warnings, partial recovery; then the store: creation, undo/redo of every edit kind, drag coalescing, no-op interactions, redo invalidation, copy/paste with rewired connectors, cut, group/ungroup, lock, select-all, clear, id stability, zoom-about-a-point, fit, and id collision-avoidance after loading |
| `shortcuts.test.ts` | 11 | That every registry shape has a binding and no binding names a shape that is not in the registry, that no two shapes share a chord, that no shape claims a tool letter, case-insensitive resolution, the Shift tier, rejection of non-letter keys, and that the label, spoken and ARIA forms all agree |
| `hittest.test.ts` | 21 | Outline flattening and even-odd containment, the interior of every registry shape, diamond and triangle geometry against their bounding boxes, text labels and open brackets falling back to their box, rotation, the forgiveness margin not reaching the next shape, degenerate and NaN geometry, paint-order priority between overlapping shapes, and shape-over-connector priority including the margin case |
| `interaction.test.tsx` | 67 | Drives the assembled application with real pointer and keyboard events: every shortcut chord arming its own shape, the toggle, case, Shift tier, auto-repeat and modifier chords; shortcuts declining while a field, the text overlay, the code search or any other control has focus, and resuming when the board takes focus back; board focus by click on a shape, on empty paper and by Tab, and that focus never enters undo; a shortcut badge on every palette button matching the shared table; whole-shape hover including over text, hover distinguished from selection, and a hittable interior for all 29 symbols; selection, marquee, drag coalescing to one undo step, a slow small-step drag not sticking to the grid, and guides not rewritten per frame; handles square and on the boundary while connection points are circles outside it, with a measured clearance from both the resize and rotate handles, moving correctly under resize, and thinning out on small shapes; connectors drawn with the pointer between every geometry family, snapping to the aimed-at point, the target highlight appearing before release, floating endpoints, staying attached when a shape moves, undo/redo, and surviving the source shape being deleted mid-gesture; and that the LaTeX and the exported SVG carry none of the new editor chrome; and that a deletion, a tool change, an undo or an Escape arriving mid-gesture, a locked selection, an empty export and shortcuts pressed on a blank canvas all pass without an exception or a console message |
| `compatibility.test.ts` | 9 | That the shipped example JSON still opens without warnings, still yields identical LaTeX to the committed `.tex` files in both modes, keeps every shape type, geometry, style and connection, round-trips unchanged, and that the save file gains no new fields; plus sparse and newer-than-current files, and that hit testing cannot perturb generation |
| `app.smoke.test.tsx` | 12 | Mounts the real application in jsdom and fails on any React warning: both panels present, empty state, shape placement rendering to canvas *and* code, code regeneration on a style change, connector staying attached when a shape moves, trace highlighting, mode switching, the text overlay, all palette thumbnails, autosave to storage, 80+ objects, and a corrupt shape not blanking the canvas |

### Import suites

No test touches the network: image imports run the real offline recogniser,
with the real Tesseract OCR under Node where text matters and without a text
reader where only shapes and stages matter, so decoding, background analysis and coordinate mapping are exercised
for real. PNG fixtures are decoded by a small test decoder so the real
background analysis runs on real pixels.

| File | Tests | Covers |
| --- | --- | --- |
| `import.detect.test.ts` | 11 | Detection by content for every raster type, SVG, draw.io (also as `.xml`), Excalidraw, app JSON and IR JSON; misnamed files; draw.io source embedded in SVG and PNG; header dimensions; rejection of unsupported extensions, empty/oversized files, pixel bombs, garbage, PDF, HTML and unknown JSON, with plain-sentence errors |
| `import.svg.test.ts` | 35 | XML safety (entity bombs, XXE, depth, prototype pollution, character references); sanitisation of scripts, handlers, `javascript:`, external references, active elements and `foreignObject`; full path grammar and transforms; the fixture flowchart mapped to native kinds, text, styles (CSS classes/ids, gradient, dash, shadow, radius), rotation, background removal, white fills kept, shape-bound connectors with labels, z-order, groups, unsupported elements reported, lint-clean LaTeX; a draw.io-style export with separate arrowheads, cylinder and predefined-process recognition and `<switch>` labels; invalid SVG; skew and unknown polygons as exact outlines; native-symbol polygon matching; `<use>`, viewBox and units; hidden elements; curved connectors; a lossless and deterministic IR → SVG → IR round trip |
| `import.drawio.test.ts` | 19 | The fixture file: every shape kind, container-relative geometry, style preservation, UserObject placeholders and data, unconsumed style keys kept verbatim, exit/entry ports, routing, arrows, labels (own and child cells), dangling edges, groups and swimlanes, layers and hidden layers, page background, z-order, routing and lint-clean LaTeX; compressed multi-page files, bare models, damaged files, triangle directions, edge-to-edge links, HTML labels; Excalidraw shapes, bound text and arrows, groups, rotation |
| `import.ir.test.ts` | 6 | Validation of untrusted IR input (NaN, Infinity, far coordinates, zero sizes, bad colours, unknown enums, control characters, missing fields, unknown references, unusable input, text kept as plain data) |
| `import.offline.test.ts` | 10 | The built-in offline recogniser on real pictures with real OCR (Tesseract under Node): filled shapes on a dark page (the "BASIC FLOWCHART EXAMPLE" picture) — kinds, fills, rounded corners, all seven arrows and their directions, labels, the dashed loop-back, the title recoloured for a white page, no network access; outlined shapes on white with a loop-back connector; cylinder, document, parallelogram, bold text and dashed connectors whose heads stand apart; white shapes on a white page. No text reader; cancelling mid-recognition. Building blocks: template classification (rectangle, ellipse, circle, diamond, parallelogram, triangle, terminator, exact polygon), an open arrow head, dashed-line chaining with a loose head, readable page text |
| `import.raster.test.ts` | 10 | Connectivity-based background detection: white shape on white page kept, coloured and noisy pages, transparent backgrounds, dashed outlines, no dominant border colour, background-free image copy, real fixtures; background decisions on recognised shapes (keep, clear, remove); normalisation (page rectangle, duplicates, text into shapes and onto connectors with position and offset); mapping from a cropped, downscaled image back to source pixels |
| `import.pipeline.test.ts` | 13 | End-to-end `runImport` for a PNG through the offline recogniser (stages in order, no network, SVG round trip, reference placement), an image that cannot be decoded here, pixel-bomb refusal, cancellation; every structured format including embedded draw.io sources; bad input; the worker message loop (progress, result, errors without stacks, cancel); the main-thread fallback; concurrent imports |
| `import.store.test.ts` | 15 | Committing into an empty canvas; replace with undo/redo restoring the exact document and LaTeX; insert without overlap or id collisions and with undo; repeated imports; open as new; no shared references; editing styles and text (re-escaped), moving shapes with connectors following, duplicate/lock/reorder/group/delete, free-form outlines resizing and rotating, editable routing and arrows; save/reload with identical LaTeX; corrupt outline/metadata in save files; autosave |
| `import.ui.test.tsx` | 12 | Import button and accepted types; readable errors without `alert()`; the replace/insert/new dialog and Cancel; insert and `Ctrl+Z`; a responsive editor and cancellation during a slow recognition; no AI or API settings anywhere in the interface; the report dialog selecting objects; and the **Part 27 acceptance workflow for two PNGs (recognised offline with real OCR), SVG and draw.io** — pick a file through the real input, progress, background stages, objects on the canvas, transparent background, selection with LaTeX highlighting both ways, text/connector/style edits, moving with connectors following, undo/redo of the whole import, reference overlay, SVG/PNG/PDF export without chrome, save and reload with identical LaTeX, provenance on every object |

The end of the pipeline is verified separately by real `pdflatex` compilation —
see [`VERIFICATION.md`](VERIFICATION.md). The LaTeX generated from every import
fixture (four raster, three SVG, three draw.io variants) was also compiled with
`pdflatex`, and the import workflow was driven in Chromium against the built
app and the Web Worker.

## What the DOM suites can and cannot show

`interaction.test.tsx` runs in jsdom, which has layout but no rendering: it can
prove which element receives an event, what the model does in response and what
the component tree emits, but not what a pixel looks like. Anything that is
genuinely visual — that the focus ring does not shift the layout, that a badge
does not cover its thumbnail, that the palette stays usable at a given window
size — was checked by driving the built application in Chromium with real
input. Where such a check found a defect, the fix carries a headless test that
would have caught it.

## Conventions

The model and generator are pure functions, so most tests are plain
input/output assertions with no mocking. The store is exercised through its
public actions, as a component would. The one DOM suite mounts `<App />` rather
than a harness, because the point is to prove the panels are actually wired to
the store.

Two properties are worth calling out because they are easy to lose in
refactoring, and both have dedicated tests:

- **Byte-stability.** Generating twice from unchanged state gives identical
  output.
- **Diff-stability.** Moving one shape leaves every other object's generated
  block byte-identical, so regenerating into version control produces a small
  diff.
- **Statement integrity.** Option lists wrap for readability, so there are tests
  that every line stays within its budget, that every wrapped statement keeps
  its closing bracket and body, and that this holds across a sweep of label
  lengths that crosses the wrap boundary in both directions. A regression here
  once truncated a `\node` mid-statement, which static lint caught and a
  compile would have caught too.
