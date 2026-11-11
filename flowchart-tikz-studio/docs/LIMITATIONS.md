# Limitations

Where the canvas and TikZ cannot match exactly, this is what happens instead. The
guiding rule: approximate visibly and say so, never silently.

## Text line breaking

**What differs.** The canvas estimates text width from an average character
width; TeX measures real glyph metrics and applies its own line-breaking
algorithm. Wrapped text can therefore break at a different word.

**What we do.** Both sides wrap at the same width, so the block occupies the same
region and never escapes the shape. Diagrams with wrapping raise an
informational note in the issues list. For a guaranteed break, type the line
break yourself — explicit newlines are honoured identically on both sides.

## Font shapes

**What differs.** The canvas uses the browser's Helvetica/Arial, Georgia or a
monospace face. pdfLaTeX sets the document font — Computer Modern by default.
Letterforms differ, so a given string is not exactly the same width.

**What we do.** Size, weight, slant, family class and colour are all reproduced,
and size is converted proportionally rather than snapped to a LaTeX size
command, so text keeps its share of the shape. For a closer match, add
`\usepackage[scaled]{helvet}\renewcommand\familydefault{\sfdefault}` to the
generated preamble.

## Very small shapes with long single words

A word longer than the shape cannot be broken, so it overflows the outline. This
happens identically on the canvas and in the PDF, so what you see is what you
get — but it is still a diagram to fix, not a rendering bug. Widen the shape,
reduce the font size, or add a break.

## Gradients with fill opacity

**What differs.** TikZ shadings do not honour `fill opacity`.

**What we do.** The gradient is emitted at full opacity and a warning names the
object. Use overall `opacity` instead, which does apply.

## Drop shadows

**What differs.** The canvas draws a hard offset copy of the outline; TikZ's
`drop shadow` from the `shadows` library is a similar offset copy but composites
slightly differently, and with a gradient underneath the two can diverge a
little at the edges.

**What we do.** Offset, opacity and colour are matched as closely as the two
models allow; combining a shadow with a gradient raises an informational note.

## Bounding box and stroke width

TikZ includes stroke width in a path's bounding box but not in a node's anchor
box, so the cropped page of a standalone document can differ from the theoretical
size by up to one line width. Measured on the dimensional control fixture: 0.5 pt
(0.17 mm) on a 130 pt page — about 0.4%. This affects the *page crop*, not the
geometry of the diagram.

## Arrowhead silhouettes

**What differs.** Canvas arrowheads are hand-drawn geometry approximating the
`arrows.meta` tips; the compiled tips are the real thing. Length, width and
direction match; the exact curve of a `Latex` tip's flare does not.

## Rotated text

Both sides rotate the whole shape and its text together, so the result matches.
Rotated text is rasterised differently by the two renderers, so hinting and
apparent weight differ slightly at small sizes — a display artefact, not a
geometry difference.

## Zig-zag connectors with arrowheads

The arrow sits on the final zig, so it points along that segment rather than
along the overall direction of travel. This is faithful — the canvas does the
same — but it can look angled. An informational note is raised. Use a straight or
elbow route if the arrow direction matters.

## Groups

Grouping ties objects together for selection and movement. It has no TikZ
counterpart: members are emitted individually rather than inside a `scope`.
Nothing is lost visually, and grouping is preserved in the save file.

## Layer order

`Diagram.order` determines emission order, and TikZ paints in source order, so
overlap resolves identically. The one exception is `drop shadow`, which is drawn
as part of its own object rather than as a separate layer, so a shadow cannot be
made to fall behind an object that was drawn earlier.

## Import

The import converts everything the editor can represent exactly, and reports
the rest. What cannot be exact:

- **Raster images** are *reconstructed*, not traced. Shape types, positions,
  text and connections are usually right, but a character can be misread or a
  faint line missed. Low-confidence text is flagged in the report, and the
  *Overlay*/*Difference* comparison shows the source image exactly behind the
  result.
- **The offline recogniser** is built for clean digital diagrams. It reads
  English text only; it does not handle hand drawings, photographs, rotated
  shapes, shapes that overlap or touch each other, curved connectors (they
  become polylines) or connectors that cross; shadows and gradients are not
  measured. Symbols outside its template set keep their exact outline as a
  polygon. Page-level text that was white on a dark page is recoloured to the
  page colour so it stays visible (the original colour is kept as metadata).
  For pictures like these, expect to tidy the result by hand.
- **Styles the model has no slot for** — custom dash patterns, diagonal or
  multi-stop gradients, hollow circle/diamond arrowheads, ER and other
  specialised arrowheads, per-run rich text inside one label, label
  background colours on shapes — are drawn with the nearest native equivalent;
  the exact source value is kept as metadata.
- **Nested groups** flatten into their outermost group, and connectors cannot
  be group members (they follow the grouped shapes they connect).
- **Connector attachment** snaps to the nearest named connection point, so an
  off-centre draw.io exit point moves to the middle of its side. Routes the
  native router cannot reproduce are kept as waypoints, which stay fixed when
  shapes move (as with any connector that has waypoints).
- **Curves** become the model's single symmetric curve; asymmetric or
  multi-segment curves are approximated.
- **Embedded images** (a logo in a draw.io file or SVG) become a labelled
  placeholder frame; small inline images are kept as metadata. External files
  are never fetched.
- **draw.io**: labels positioned outside their shape become separate text
  objects; a swimlane's header colour and collapse state are metadata only;
  hidden layers import visible; only one page is imported per file.
- **SVG**: clip paths, masks, filters other than drop shadows, and CSS
  transforms are ignored (reported); pattern fills become a flat colour;
  HTML inside `foreignObject` becomes plain text.

## What is not implemented

- **TikZ import (code → canvas).** The architecture is ready for it — the model
  is independent of the renderer and generation is one-way, so an importer needs
  only to produce a `Diagram`. Parsing arbitrary TikZ, which is Turing-complete
  macro expansion, is out of scope; a reliable importer would target this
  program's own output rather than TikZ in general.
- **Server-side compilation with a preview pane.** Would need a sandboxed TeX
  container. The Overleaf workflow covers the need without shipping an
  arbitrary-code-execution surface.
- **Live collaboration**, **shape-specific connection logic** beyond ports, and
  **automatic layout**.


## Charts

**Fonts.** Chart text is set in TeX's sans-serif font, slightly narrower than
the browser's. Plot area, ranges, ticks, bars, points, slices, colours and the
anchor of every label are identical; glyph widths differ a little.

**Rotation.** Charts cannot be rotated (the handle is hidden for them).

**Scope.** No line smoothing, trend lines, secondary axes, maps or treemaps.
A Legend field shows at most 12 series and an axis at most 200 categories
(filters and Top N narrow it). Old `.xls`, `.ods` and `.numbers` files must be
saved as `.xlsx` or CSV first.

**Size.** The table is stored in the diagram file (up to 20,000 rows), so a
diagram with a big table makes a big JSON file and autosave entry; the LaTeX
only ever contains the aggregated values.

## Mathematics, physics and chemistry

- **Maths fonts.** Formulas use LaTeX's maths fonts. Colour, size and bold apply;
  the font-family and italic controls do not, since they have no faithful
  equivalent in math mode.
- **Label placement.** Component labels are positioned by CircuiTikZ when
  compiled; the canvas places them on the same side but not to the point.
- **Symbol drawing.** Canvas circuit symbols closely approximate CircuiTikZ; the
  compiled symbol is CircuiTikZ's own. Terminals coincide exactly.
- **Wires** are routed automatically at right angles. Waypoints cannot be dragged
  by hand, as with connectors generally.
- **Fill** is available only on symbols with a closed body (sources, meters,
  lamps, fuses, the op-amp).
- **Aromatic circles** come from the *Benzene (circle)* template; custom rings
  are drawn with alternating bonds.
- **Unicode.** Greek letters and common operators typed directly are converted
  to macros. Other non-ASCII characters are refused in formulas, since pdfLaTeX
  cannot typeset them.
- **chemfig** needs the `simplekv` package, included in full TeX distributions
  and on Overleaf. On Debian/Ubuntu install `texlive-plain-generic`.
