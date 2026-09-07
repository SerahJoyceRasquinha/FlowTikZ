# Architecture

## The central principle

There is exactly one source of truth: the `Diagram` object in
`src/model/types.ts`. Everything else reads from it.

```
                    ┌──────────────────────────┐
   pointer / keys   │                          │
   ────────────────►│      Diagram model       │
   inspector edits  │  (plain, serialisable)   │
                    └───────────┬──────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
        SVG renderer      TikZ emitter      JSON persistence
        (what you see)  (what you compile)  (what you save)
```

The application never reads the generated LaTeX back to work out what is on the
canvas. Code generation is a pure, one-way function of the model, so a change
can never leave the two representations disagreeing.

The model is also free of anything environment-specific — no DOM nodes, no
React, no pixels-of-the-current-viewport. That is what makes zoom, export, save,
load and code generation all straightforward, and it is what would make a future
TikZ *importer* tractable: it would only need to produce a `Diagram`, and every
existing feature would work on the result.

## Module map

```
src/
├── model/                  # Pure logic. No React, no DOM.
│   ├── types.ts            # Diagram, Node, Edge, styles, settings
│   ├── geometry.ts         # Vector maths, rotation, bounds, Bezier helpers
│   ├── path.ts             # The M/L/C/Z path language + SVG serialiser
│   ├── shapes.ts           # Shape registry: 29 definitions
│   ├── routing.ts          # Connector geometry, ports, anchors
│   ├── diagram.ts          # Ordering, alignment, deletion, snapping, bounds
│   ├── defaults.ts         # Factory functions and default styles
│   ├── ids.ts              # Stable id allocation
│   └── sample.ts           # The worked example
├── latex/                  # Model → TikZ. Also pure.
│   ├── units.ts            # du ↔ cm ↔ pt, coordinate flip, number formatting
│   ├── escape.ts           # Text escaping and symbol mapping
│   ├── colors.ts           # Deduplicating colour registry
│   ├── styles.ts           # Option builders, library registry, dash patterns
│   ├── nodes.ts            # Node/shape emitter
│   ├── edges.ts            # Connector emitter, arrow tips
│   ├── generator.ts        # Document assembly, traceability map
│   ├── validate.ts         # Pre-generation checks
│   └── highlight.ts        # LaTeX tokeniser for the code panel
├── canvas/                 # Rendering and interaction
│   ├── CanvasStage.tsx     # SVG root, pointer state machine, grid, zoom/pan
│   ├── ShapeView.tsx       # One node
│   ├── ConnectorView.tsx   # One edge, with arrowheads and label
│   ├── SelectionLayer.tsx  # Handles, ports, guides, marquee
│   ├── TextEditorOverlay.tsx
│   └── textLayout.ts       # Text layout mirroring the TikZ rules
├── components/             # UI chrome
│   ├── Toolbar.tsx  ShapePalette.tsx  PropertyInspector.tsx
│   ├── CodePanel.tsx  ColorField.tsx  SplitPane.tsx
│   ├── HelpDialog.tsx  StatusBar.tsx  EmptyState.tsx  ErrorBoundary.tsx
├── state/store.ts          # Zustand store: doc, selection, view, history
├── persistence/            # schema.ts (save format), autosave.ts (recovery)
├── export/                 # svg.ts, raster.ts, pdf.ts, file.ts
├── hooks/useKeyboardShortcuts.ts
└── tests/                  # 178 tests, including latexLint.ts
```

Dependencies point one way: `components` and `canvas` may import `model`,
`latex` and `state`; nothing in `model` or `latex` imports upwards.

## The data model

```ts
interface Node {
  id: string;            // 'n7' — allocated once, never regenerated
  kind: string;          // registry key: 'decision', 'database', …
  x, y, w, h: number;    // top-left and size, in diagram units
  rotation: number;      // degrees clockwise about the node centre
  text: string;          // raw user text, may contain '\n'
  style: ShapeStyle;     // fill, stroke, opacity, shading, shadow, radius
  textStyle: TextStyle;  // colour, size, family, weight, alignment, wrap
  locked: boolean;
  z: number;             // paint order, kept in step with Diagram.order
  groupId?: string;
}

interface Edge {
  id: string;                       // 'e3'
  source, target: Endpoint;         // { nodeId, port } or { point }
  routing: RoutingKind;             // 7 styles
  waypoints: Point[];
  bend, cornerRadius: number;
  arrowStart, arrowEnd: ArrowHead;  // 8 types
  arrowSize: number;
  stroke, strokeWidth, strokeStyle, strokeOpacity, opacity;
  label?: EdgeLabel;                // text, pos, offset, size, colour, plate
  z: number;
}
```

`Endpoint` is deliberately a union: an endpoint is *either* bound to a node port
*or* floating at a fixed coordinate. Deleting a shape converts attached
endpoints to floating ones at their last position, so a connector is never left
holding a dangling reference — which is what would otherwise corrupt undo and
break code generation.

### The coordinate system

Diagram units (du) are logical and viewport-independent. Origin top-left, +x
right, **+y down** (screen convention, so interaction code needs no mental
flips).

The canvas renders 1 du = 1 CSS pixel at zoom 1; zoom and pan are a single SVG
transform and never touch the model. The TikZ emitter converts with one factor,
`settings.unitsPerCm`:

```
x_tikz = (x_du − origin_x) / unitsPerCm          [cm]
y_tikz = −(y_du − origin_y) / unitsPerCm         [cm, axis flipped]
length_pt = (length_du / unitsPerCm) × 28.4527559
rotation_tikz = −rotation_canvas                 [flip follows the y axis]
```

The origin snaps down to a coarse multiple of the grid rather than tracking the
diagram bounds exactly. Nudging one shape therefore does not renumber every
coordinate in the document, which keeps regenerated output diff-friendly — there
is a test for this.

### One geometry definition per shape

Each entry in the shape registry defines its outline **once**, in local
coordinates, using the four-command path language in `model/path.ts` (move,
line, cubic, close). Elliptical arcs are converted to cubics at construction
time because TikZ has an exact spelling for a cubic (`.. controls .. and .. ..`)
and the canvas has one too (`C`), so both renderers trace identical curves.

That single definition feeds the SVG renderer, the TikZ path emitter, and the
palette thumbnails. A new symbol is one object in one file and it works
everywhere.

### Two node emission strategies

Where TikZ owns a shape whose bounding box can be pinned exactly — rectangle,
rounded rectangle, diamond, circle, ellipse — the emitter produces the idiomatic
`\node[shape=diamond, minimum width=…, minimum height=…]`, which is what a
LaTeX author would have written and is easy to extend by hand afterwards.

Every other symbol becomes an explicit `\draw` path from the same outline
function, plus a positioned label node and a named `\coordinate` at its centre
so it can still be referenced from hand-written TikZ. The two strategies produce
the same geometry; the choice is about readability of the output.

Text width is always pinned with `text width`. Without it a TikZ node silently
grows to fit a long label and the compiled shape would no longer match the
canvas.

## Rendering and interaction

The canvas is one SVG element with a single transformed content group. Shapes and
connectors are memoised components keyed by id, so moving one object re-renders
one object.

Interaction is a state machine held in a ref, not in React state — pointer moves
must not queue a render per event:

```
none → move | resize | rotate | marquee | pan | connect → none
```

Editor chrome (handles, ports, guides, marquee, grid) is marked `data-ui` so the
SVG exporter can strip it and ship exactly the diagram.

## History

`beginInteraction()` takes one snapshot; `endInteraction()` pushes it if
anything actually changed. A 200-frame drag is therefore a single undo step, and
a gesture that changes nothing records nothing. Discrete edits go through
`commit()`, which snapshots, applies, normalises ordering and pushes in one go.

Snapshots are structured clones of the whole diagram. For documents of this size
(hundreds of objects, tens of kilobytes) that is far cheaper than the bug
surface of a command/inverse-command system, and it makes it impossible for undo
to leave the model in a state the renderer or generator has never seen.

## Performance

- The store holds one plain object; components subscribe to the slices they use.
- Shape and connector views are `memo`ised.
- The code panel reads the document through `useDeferredValue`, so a drag stays
  at 60 fps while the LaTeX catches up on the next idle frame — the panel shows
  "updating" for those few milliseconds rather than blocking the gesture.
- Autosave is debounced to 700 ms.
- Generation is O(objects). The 200-object stress test generates in well under
  the 4-second test budget, and typically in tens of milliseconds.

## Error handling

Failures are isolated at three levels: each object's emission is wrapped, so a
corrupt shape becomes a reported issue and the other 99 objects still emit; the
renderer skips malformed nodes rather than throwing; and each panel sits behind
an `ErrorBoundary`, so a UI fault shows a retry card instead of a white screen —
the work is safe in the store either way.

## Security

Every piece of user text passes through `latex/escape.ts` before entering the
output, so no diagram content can inject a control sequence. Nothing is
`eval`ed, no LaTeX is executed, and opened files are parsed defensively — a
hand-edited or truncated save file yields as much of the diagram as can be read
plus warnings, never a crash. The app is entirely client-side: no diagram data
leaves the browser, and autosave writes only geometry and styling to
`localStorage`.
