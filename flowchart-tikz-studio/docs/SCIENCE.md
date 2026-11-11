# Mathematics, physics and chemistry

FlowTikZ draws equations, circuits, physics sketches, chemical formulas and
molecular structures on the same canvas as flowcharts and charts. All of them
are ordinary objects: select, drag, snap, resize, rotate, group, align, layer,
copy, undo and save work as they do for any shape. Each generates real LaTeX.

| Toolbar | Opens | LaTeX it writes |
| --- | --- | --- |
| **Σ Mathematics** | Formula editor | amsmath math mode |
| **Physics** | Circuit parts, physics parts (left panel), physics symbols | CircuiTikZ, TikZ paths, amsmath |
| **Chemistry** | Formula, reaction and molecule editors | mhchem, chemfig |

Double-click (or press Enter on) a formula or molecule to edit it again.

## Formula editor

Pick a structure and fill in its boxes. Boxes nest, so a fraction can go inside
a root inside a matrix. Type `^` or `_` for a script (the previous character
becomes the base); arrow keys and Backspace move across boxes.

Select text before pressing a structure to wrap it. **LaTeX** switches to direct
source and back without losing anything: what the visual editor does not model
stays in the formula as raw LaTeX. **Colour part** colours one term;
**Copy as** gives `$...$`, `\[...\]` or `align*` for use outside a picture.

## Circuits

Drag a part from the **Circuit** tab of the left panel onto the canvas, or click
it and click the canvas. Drag from a round terminal to another terminal to wire
them: wires are right-angled, attach to the terminal and follow the part when
it moves or rotates. Drop a wire on another wire to tie in with a junction dot.

`R` turns the selection by 90 degrees; **Flip** in the selection bar mirrors it.
Name, value, voltage, current and current direction are in the right panel, as
LaTeX maths (`R_1`, `10\,\mathrm{k\Omega}`). Height scales the symbol; width
stretches its leads. Wire colour, width and dash are in the connector panel.

## Chemistry

**Formula** takes mhchem notation: `H2SO4`, `SO4^2-`, `^{14}_{6}C`,
`2H2 + O2 -> 2H2O`. Numbers after elements become subscripts by themselves.

**Reaction** builds equations from reactants, products, arrows and conditions,
over any number of steps, and reports whether each step is balanced.

**Molecule** is a drawing sheet. Drag to make a bond (snapped to 30 degrees and
one bond length), click a bond to change its type, click an atom with an element
or functional group to change or extend it. Empty corners are implicit carbon.
Charges, lone pairs and unpaired electrons are the **Mark** tools.

## How it is built

```
src/science/
├── types.ts                 Payload stored on Node.science
├── coerce.ts                Defensive reader for save files
├── editing.ts               Opening editors, placement, drag type
├── gallery.ts               Diagrams used by tests and the pdfLaTeX fixtures
├── recents.ts               Recent and frequent symbols
├── math/   engine.ts        Lazy loader and cache for the typesetter
│           mathjaxCore.ts   MathJax itself: a separate chunk
│           ast.ts           Formula tree, LaTeX parser and writer, edit operations
│           symbols.ts       Symbol tables (data only)
│           validate.ts      Checks on user TeX
├── physics/circuits.ts      Component table: canvas art + CircuiTikZ mapping
│           diagramShapes.ts Mechanics, field and optics parts
└── chem/   molecule.ts      Molecule graph, templates, geometry
            chemfig.ts       Graph -> chemfig
            reaction.ts      Reaction -> mhchem, atom balance
src/latex/science.ts         Emitters and the package registry
src/canvas/ScienceView.tsx   Canvas drawing
src/components/science/      Editors, symbol picker, inspector pane
```

A scientific object is a `Node` with an optional `science` payload, exactly as
a chart is a `Node` with `chart`. Circuit and physics parts are entries in the
existing shape registry, so hit testing, ports, resize and rotation are shared.
Wires are `Edge`s with `wire: true`. Nothing older than this feature needed to
change: old files have no such fields and load and generate identically.

To add a component, add a row to `CIRCUIT_DEFS`. To add an object type, see the
comment at the top of `science/types.ts`.

### Why MathJax, and how it is loaded

The formula has to appear as SVG inside the canvas, because the SVG, PNG and PDF
exporters clone the live canvas. MathJax's SVG output is plain vector paths and
needs no fonts or CSS; KaTeX's HTML output would have needed `foreignObject`,
which does not survive PNG rasterisation. MathJax also includes mhchem, so one
library typesets both maths and chemistry, and it runs under the test runner.

`@mathjax/src`, `@mathjax/mathjax-tex-font` and
`@mathjax/mathjax-mhchem-font-extension` are the only new dependencies. They
form a separate 2.8 MB chunk fetched from this app (no CDN) when the first
formula or editor needs it. A flowchart-only session never loads it, and until
it arrives formulas show a quiet placeholder. CircuiTikZ, mhchem and chemfig
are LaTeX packages, used only in the generated code.

### Geometry fidelity

- Formulas: the box size sets `scale=`, relative to the natural size in ems.
- Bipoles: `to[...]` runs between the two world-space terminals, and the height
  sets CircuiTikZ's `bipoles/length`.
- Transistors, op-amps and transformers: anchors were measured from a real
  CircuiTikZ compile and are pinned by `science.circuits.test.ts`.
- Molecules: every bond is written with an absolute angle and length.

### Safety

TeX from a formula, label or save file passes `validateTex` before it reaches
the document. File access, `\write18`, macro definitions and unbalanced input
are refused, and an invalid formula becomes a visible red placeholder plus an
entry in the issues list, so the document still compiles.
