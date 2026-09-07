# Visual feature → TikZ mapping

Every mapping below is exercised by a test in `src/tests/generator.test.ts` and
by a fixture that is compiled with `pdflatex` in
`scripts/verify-latex.sh`.

## Coordinates and lengths

| Model | TikZ | Notes |
| --- | --- | --- |
| `x, y` (du, y down) | `(x/s, −y/s)` in cm | `s = settings.unitsPerCm`; the y axis is flipped |
| `w, h` | `minimum width`, `minimum height` in cm | Or explicit path coordinates |
| `strokeWidth` | `line width=…pt` | `(w/s) × 28.4527559` |
| `fontSize` | `font=\fontsize{…pt}{…pt}\selectfont` | Proportional, so text keeps its share of the shape |
| `rotation` (deg, cw) | `rotate=−θ` or `rotate around={−θ:(cx,cy)}` | Sign follows the y flip |
| Picture origin | Coarse grid multiple below the diagram bounds | Keeps regenerated output diff-stable |

## Shapes

Built-in TikZ node shapes, used where the bounding box can be pinned exactly:

| Symbol | TikZ | Library |
| --- | --- | --- |
| Process, Rectangle | `shape=rectangle` | core |
| Start/End (terminator) | `shape=rounded rectangle, rounded rectangle arc length=180` | `shapes.misc` |
| Decision | `shape=diamond` | `shapes.geometric` |
| Connector, Or, Summing junction | `shape=circle` | core |
| Ellipse | `shape=ellipse` | `shapes.geometric` |
| Text label | `\node` with `draw=none`, no fill | core |

Explicit `\draw` paths, generated from the same outline function the canvas
renders, plus a positioned label node and a named `\coordinate` at the centre:

| Symbol | Path |
| --- | --- |
| Input/Output | parallelogram |
| Predefined process | rectangle + two vertical rules |
| Preparation | hexagon |
| Manual input | rectangle with a slanted top |
| Manual operation | inverted trapezium |
| Delay | rectangle with a semicircular right end |
| Display | pointed left edge, rounded right |
| Off-page connector | pentagon pointing down |
| Merge / Extract | triangle down / up |
| Document | rectangle with a cubic wave along the bottom |
| Multiple documents | three offset sheets, front one waved |
| Database | cylinder with an elliptical lid |
| Stored data | rectangle with curved left and right edges |
| Internal storage | rectangle + top and left rules |
| Direct access storage | horizontal cylinder |
| Card | rectangle with a cut top-left corner |
| Loop limit | rectangle with cut top corners |
| Note | rectangle with a folded corner |
| Annotation bracket | open bracket, stroked only, never filled |

A circle whose width and height differ falls back to the explicit-path route, so
it cannot compile as a circle when it was drawn as an oval.

Where TikZ has no equivalent, the explicit path *is* the exact geometry, so
fidelity is not reduced by taking that route — only the readability of the
output changes.

## Fill and border

| Model | TikZ |
| --- | --- |
| `fill` | `fill=<name>` |
| `stroke` | `draw=<name>` |
| `strokeStyle: 'none'` | `draw=none` |
| `solid` | (no dash option) |
| `dashed` | `dash pattern=on 3w off 3w` |
| `dotted` | `line cap=round, dash pattern=on 0pt off 2.6w` |
| `dashdotted` | `line cap=round, dash pattern=on 3.5w off 2w on 0pt off 2w` |
| `cornerRadius` | `rounded corners=…cm` |
| `shadow` | `drop shadow={shadow xshift, shadow yshift, opacity=0.25}` (`shadows`) |
| `shading: 'axis-vertical'` | `top color=…, bottom color=…` |
| `shading: 'axis-horizontal'` | `left color=…, right color=…` |
| `shading: 'radial'` | `inner color=…, outer color=…` |
| `fillOpacity` | `fill opacity=…` |
| `strokeOpacity` | `draw opacity=…` |
| `opacity` | `opacity=…` |

Dash lengths scale with the line width, so a thick dashed border looks the same
proportionally on both sides. Fully-opaque values are omitted rather than
emitted as `opacity=1`.

## Colour

Every colour is registered once and named from its own hex value:

```latex
\definecolor{fc3366CC}{HTML}{3366CC}
```

Twenty shapes sharing a fill produce one definition. Names derive from the value,
not from insertion order, so reordering shapes never reshuffles the preamble.
The eight colours xcolor already provides (`black`, `white`, `red`, `green`,
`blue`, `cyan`, `magenta`, `yellow`) are used directly and never redefined.

## Text

| Model | TikZ |
| --- | --- |
| Multi-line text | lines joined with `\\` |
| `bold` / `italic` / `underline` | `\textbf{}` / `\textit{}` / `\underline{}`, per line |
| `color` | `text=<name>` |
| `align` | `align=left\|center\|right` |
| `valign` | node body when middle, otherwise a separate node with `anchor=north\|south` |
| `wrapWidth`, text box | `text width=…cm` (always pinned) |
| `fontFamily` | `\sffamily` / `\rmfamily` / `\ttfamily` |

Formatting is applied per line so a group never spans a line break. Text width
is always pinned because an unpinned TikZ node grows to fit its body, which
would make the compiled shape wider than the canvas one.

### Escaping

`# $ % & _ { }` become `\#` … `\}`. `\ ~ ^ < > |` become `\textbackslash{}`,
`\textasciitilde{}`, `\textasciicircum{}`, `\textless{}`, `\textgreater{}`,
`\textbar{}`. Dashes and quotes map to their TeX forms; `≤ ≥ ≠ × ÷ ± → ← ⇒ ∞ °`
and the common Greek letters map to real commands, with `amsmath` added only if a
maths escape was actually emitted. Latin-1 and Latin-Extended-A accents pass
through unchanged (`fontenc`/`inputenc` are loaded). Anything beyond that is
passed through with a warning naming the characters and suggesting XeLaTeX or
LuaLaTeX.

## Connectors

| Model | TikZ |
| --- | --- |
| `straight`, `orthogonal`, `zigzag`, `polyline` | chained `--` through computed points |
| `rounded-orthogonal` | `--` with cubic corner fillets |
| `curved`, `bezier` | `.. controls (c1) and (c2) ..` |
| `stroke`, `strokeWidth`, `strokeStyle` | `draw=`, `line width=`, dash pattern |
| `strokeOpacity`, `opacity` | `draw opacity=`, `opacity=` |
| Label | a `\node` at the computed point, optionally `fill=white` |

Endpoints are emitted as explicit coordinates rather than as `(n1.south)`. Both
would be valid TikZ, but explicit coordinates guarantee the compiled path starts
and ends exactly where the canvas path does, including for the explicit-path
symbols that have no node anchors.

### Arrowheads (`arrows.meta`)

| Model | TikZ |
| --- | --- |
| `none` | — |
| `stealth` | `Stealth[length, width]` |
| `latex` | `Latex[length, width]` |
| `triangle` | `Triangle[length, width]` |
| `open-triangle` | `Triangle[open, length, width]` |
| `bar` | `Bar[width]` |
| `circle` | `Circle[length]` |
| `diamond` | `Diamond[length, width]` |

Combined as `{Start}-{End}`, `-{End}`, `{Start}-`, or omitted entirely. Sizes are
in points derived from `arrowSize`, so tips scale with the diagram rather than
with the ambient line width. `arrows.meta` is loaded only when a tip is used.

## Generated document structure

```latex
% header comment
\documentclass[border=8pt]{standalone}   % standalone mode only
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{amsmath}                     % only if a maths escape was emitted
\usepackage{xcolor}
\usepackage{tikz}
\usetikzlibrary{…}                       % only what the diagram uses

% ---- Colour definitions ----
\definecolor{…}{HTML}{…}

% ---- Style definitions ----
\tikzset{ fcnode/.style={…}, fcpath/.style={…},
          fcedge/.style={…}, fclabel/.style={…} }

\begin{document}
\begin{tikzpicture}[x=1cm, y=1cm]
  % ---- Nodes ----
  % n1 - Start / End "Start"
  \node[fcnode, shape=rounded rectangle, …] (n1) at (5.2,-0.8) {Start};
  % ---- Connectors ----
  % e1 - n1 -> n2 (straight)
  \draw[fcedge, -{Stealth[length=5.12pt, width=3.84pt]}, …]
    (5.2,-1.36) -- (5.2,-2.8);
\end{tikzpicture}
\end{document}
```

Four reusable styles are emitted, and per-object options spell only what differs
from them. Sections are separated, nodes precede connectors, paths are wrapped
at a readable width, and each object gets a comment carrying its id and a
snippet of its text.

## Extending the mapping

To add a symbol, append one object to `defs` in `src/model/shapes.ts`:

```ts
{
  id: 'my-symbol',
  label: 'My symbol',
  category: 'Flow',
  defaultSize: { w: 160, h: 70 },
  outline: (w, h) => polygon([...]),      // local coords, feeds both renderers
  decorations: (w, h) => [polyline([...])], // stroked, never filled
  textBox: (w, h) => ({ x: 8, y: 6, w: w - 16, h: h - 12 }),
  ports: boxPorts,
  tikzNode: { shape: 'rectangle' },       // omit for the explicit-path route
}
```

The palette, canvas, exports, TikZ emitter and tests all pick it up
automatically. To add a styling property, extend `ShapeStyle`, add a default in
`defaults.ts`, a control in `PropertyInspector.tsx`, and one branch in
`latex/styles.ts`.
