# Testing

```bash
npm test          # 178 tests
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
| `app.smoke.test.tsx` | 12 | Mounts the real application in jsdom and fails on any React warning: both panels present, empty state, shape placement rendering to canvas *and* code, code regeneration on a style change, connector staying attached when a shape moves, trace highlighting, mode switching, the text overlay, all palette thumbnails, autosave to storage, 80+ objects, and a corrupt shape not blanking the canvas |

The end of the pipeline is verified separately by real `pdflatex` compilation —
see [`VERIFICATION.md`](VERIFICATION.md).

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
