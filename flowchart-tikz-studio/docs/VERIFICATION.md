# LaTeX compilation verification

Output that merely *looks* like TikZ is not good enough. This is how the
generated code is proven to compile and to reproduce the canvas.

## The three layers

1. **Static lint** (`src/tests/latexLint.ts`, run on every generated fixture in
   the test suite). Checks balanced braces and brackets, one terminating
   semicolon per drawing statement, balanced `scope`/`document`/`tikzpicture`
   environments, every referenced colour defined exactly once, every referenced
   `\tikzset` style defined, every library implied by the body actually loaded,
   and no `NaN`/`Infinity`/`undefined` anywhere in a coordinate.

2. **Real compilation** (`scripts/verify-latex.sh`). Seven fixtures compiled
   with `pdflatex -halt-on-error`.

3. **Dimensional control.** Fixture 07 contains a single rectangle of known
   size. Because the `standalone` class crops to the picture plus an 8 pt
   border, the compiled page size is a direct measurement of the du → cm
   conversion. The script compares it against the value the model asked for.

## Running it

```bash
npm run latex:fixtures        # writes latex-verify/*.tex
bash scripts/verify-latex.sh  # compiles them, checks dimensions
```

Requires a TeX distribution with `tikz`, `xcolor` and the `standalone` class —
on Debian/Ubuntu, `texlive-latex-base texlive-latex-extra texlive-pictures`.

## Latest result

```
PASS  01-example            (1 page, 339.996x413.697 pt)
PASS  02-all-shapes         (1 page, 613.063x493.067 pt)
PASS  03-all-styles         (1 page, 489.168x521.81 pt)
PASS  04-all-connectors     (1 page, 583.776x697.161 pt)
PASS  05-empty              (1 page, 15.94x15.94 pt)
PASS  06-scaled             (1 page, 97.102x115.38 pt)
PASS  07-geometry-control   (1 page, 130.233x73.54 pt)
      geometry OK: expected 130.72x73.82 pt, got 130.233x73.54 pt

All fixtures compiled.
```

## What each fixture covers

| Fixture | Covers |
| --- | --- |
| 01-example | The worked example: mixed symbols, gradient, shadow, custom colours, labelled decision branches, three routing styles |
| 02-all-shapes | Every one of the 29 symbols, each with text |
| 03-all-styles | All border styles, opacity modes, all three gradients, corner radius, shadow, rotations, all alignments, all font families, bold/italic/underline, wrapping, and the full special-character set |
| 04-all-connectors | All 7 routings, all 8 arrowheads at both ends, dashed connectors, labels with and without a plate, and a detached connector |
| 05-empty | An empty diagram must still compile |
| 06-scaled | The example at 200 units/cm, exercising the conversion at an extreme |
| 07-geometry-control | Dimensional accuracy |

## Checked for

- Compilation errors and TeX capacity problems
- Missing packages and missing TikZ libraries
- Undefined colours and undefined `\tikzset` styles
- Invalid coordinates, dimensions and paths
- Incorrect escaping (visually confirmed against the rendered `specials`,
  `accents` and `symbols` boxes in fixture 03)
- Duplicate definitions
- Page geometry against the model

## Visual verification

```bash
pdftoppm -r 110 -png latex-verify/out/01-example.pdf example
```

Compare the PNG against the canvas. Fixture 02 is the quickest way to check that
a newly added symbol compiles the way it draws.

## The Overleaf workflow

If no local TeX is available:

1. `npm run latex:fixtures`.
2. Create a new Overleaf project and upload `latex-verify/01-example.tex`.
3. Set it as the main document and **Recompile**.
4. Repeat for the other fixtures — 02, 03 and 04 are the ones that exercise the
   breadth of the emitter.
5. For your own diagram, press **Copy** in the app and paste into a new project.

Overleaf's default is pdfLaTeX, which is what the generated preamble targets. If
your text warned about characters needing a Unicode engine, switch the project
to XeLaTeX or LuaLaTeX in *Menu → Compiler*.
