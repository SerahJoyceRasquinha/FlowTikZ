# LaTeX projects: drawing inside an Overleaf project

FlowTikZ can open a whole LaTeX project packed as a `.zip` (the file Overleaf
gives you under **Menu → Download → Source**). It shows the document in place of
the canvas, and you can click anywhere in it and draw a figure right there. The
packages the figure needs are added to the preamble, the text after it moves
down, and **Download .zip** gives the project back with your changes.

## Opening a project

**File → Open LaTeX project (.zip)**.

1. The zip is read without unpacking it all into memory. Only the `.tex`,
   `.bib`, `.sty`, `.cls` and other text files are decoded. Images are shown
   from the zip when the preview needs them. Every other file is carried
   through to the download untouched.
2. FlowTikZ looks for the **main file**: a `.tex` file with `\documentclass`
   and `\begin{document}`. It prefers `main.tex` and files near the top of the
   project, and it gives extra weight to files that `\input` or `\include`
   others or have a bibliography. It ignores `standalone` pictures and
   `subfiles` children.
3. If several files could be the main one, a dialog lists them and you pick.
   You can also change it later from the file tree (**Set as main**).
4. If there is no main file, nothing is opened. A message explains what is
   missing and lists the `.tex` files that were checked.

| Problem with the zip | What you see |
| --- | --- |
| Not a zip (or a damaged/truncated one) | "Please choose a .zip file…" or a description of the damage |
| Empty zip | "This zip archive is empty." |
| No `.tex` files | "There is no .tex file in this zip…" |
| `.tex` files but none with `\documentclass` + `\begin{document}` | "No main LaTeX file was found…", with each file and why it was not chosen |
| Encrypted entries, unusual compression | Those files cannot be previewed, but are copied into the download unchanged |
| Unsafe paths (`../`, absolute, drive letters) | Dropped. They can never be written outside the project. |
| `__MACOSX`, `.DS_Store`, `Thumbs.db` | Ignored |

A single wrapping folder (such as `MyPaper/main.tex`) is handled, and the
download keeps the original folder layout.

## The screen in project mode

| Region | Purpose |
| --- | --- |
| Left panel, **Files** | Folder tree with sizes. The main file and edited files are badged. |
| Left panel, **LaTeX** | The source of any file, with FlowTikZ figure lines highlighted |
| Left panel, **Drawing code** | The TikZ of the drawing you are working on |
| Left panel buttons | **Download .zip**, **Copy LaTeX** (the open file), **.tex** (download it), **Close** |
| Centre | The document preview, on a page with the document's own margins, columns and font size. Zoom with the − / + buttons. |
| Status bar | "Changes not downloaded" / "No new changes", and the project name and main file |

The preview follows `\input`, `\include`, `\subfile` and `\import`. It
renders headings with their numbers, paragraphs, maths (MathJax), lists,
tables, figures with images from the zip, theorems, `\ref`/`\cite`, the
bibliography and beamer frames. It is a guide to *where* things are, not a
pixel-perfect PDF.

## Drawing into the document

1. **Click** the paragraph, heading or figure the drawing should follow (click
   near the top edge of a block to put it before). A blue insertion bar appears.
2. Press **Draw here**, or `Enter`.
3. A drawing frame opens inside the page, and the text below moves down. All
   the usual tools work in it: the palette, templates, charts, maths, physics
   and chemistry.
4. Type a **caption** if you want one. Choose the placement:
   - **Exactly here**: the figure stays at that spot (`center` +
     `\captionof`).
   - **Floating figure**: a normal `figure` environment, using the same
     placement option (`[htbp]`, `[t]`…) and label prefix (`fig:`…) the
     document already uses.
5. Press **Insert** (`Ctrl+Enter`). **Cancel** discards the frame.

Click a FlowTikZ figure to **Edit** it (the drawing reopens exactly as it was),
add a drawing after it, or **Remove** it. `Ctrl+Z` / `Ctrl+Y` undo and redo
document changes whenever no frame is open. Inside a frame they act on the
drawing.

## What is written into the LaTeX

FlowTikZ does the least it can, and changes nothing outside the parts it adds.

- **Packages.** Only those the drawing needs and the document does not
  already load (or get from another package: `tikz` brings `xcolor`, the
  `beamer` class brings `graphicx`, `caption` provides `\captionof`). They go
  with the document's other `\usepackage` lines, before `hyperref`, `cleveref`
  and `bookmark`. If the packages live in a separate file (such as
  `preamble.tex`), they go there.
- **Definitions** (TikZ libraries, colours, styles, `pgfplots` compat) go
  just before `\begin{document}`.
- **The figure** goes on its own lines at the spot you clicked, with the
  indentation and line endings (LF or CRLF) of the file. It is wrapped in
  `\resizebox`, which shrinks it to `\linewidth` only when it is wider. So a
  figure can never push into the margin, and in a two-column document it fits
  the column.
- Each block is marked with `% ==== FlowTikZ figure <id> (begin) ====`
  comments. The drawing itself is stored compressed in `% flowtikz-data:`
  comment lines, which is what makes **Edit** possible. These are comments, so
  LaTeX ignores them.
- **Removing** the only figure restores the files byte for byte.
- Files keep their original encoding (UTF-8, or Windows-1252 for older
  projects) and byte-order mark.

Margins, `\textwidth`, the class options, `geometry` settings and the page count
of the rest are never touched. The compile tests check this with real
`pdflatex`.

## Large projects

Measured in Chrome against the production build:

| Project | Open | Insert a figure | Download | Memory |
| --- | --- | --- | --- | --- |
| 23 MB `main.tex`, 300 chapters, 85,801 paragraphs | 1.4 s | 0.7 s | 0.4 s | ~220 MB |
| 60,000 files | 0.9 s | 0.1 s | 0.5 s | ~115 MB |
| 70,000 files (Zip64) | 1.1 s | 0.1 s | 0.7 s | ~118 MB |
| 2 GB of figures | 0.2 s | 0.1 s | 16 s | ~23 MB |
| 4.5 GB (a 4.4 GB file, so Zip64 offsets) | 0.1 s | 0.1 s | 28 s | ~15 MB |

Every downloaded zip was checked with Python's `zipfile.testzip()`. Big files
are never read into memory: the download copies them straight from the
original zip. Long documents are drawn in windows as you scroll.

Limits that protect the browser: 500,000 entries, a 256 MB central directory,
256 MB per decompressed entry (zip-bomb guard), 32 MB per text file and 512 MB
of text in total. Files over the text limits are still carried through to the
download.
