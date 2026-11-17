#!/usr/bin/env python3
"""
Generate the LaTeX-project zip fixtures used by the tests.

    python3 scripts/make-project-fixtures.py

Writes small, realistic and deliberately broken archives into
src/tests/fixtures/project/. Everything is built from scratch with the
standard library, so the fixtures are reproducible.
"""
import io
import os
import struct
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "tests", "fixtures", "project")
PNG = open(os.path.join(HERE, "..", "src", "tests", "fixtures", "import", "simple.png"), "rb").read()
os.makedirs(OUT, exist_ok=True)


def write(name, files, compression=zipfile.ZIP_DEFLATED):
    path = os.path.join(OUT, name)
    with zipfile.ZipFile(path, "w", compression) as z:
        for arc, data in files:
            if arc.endswith("/"):
                z.writestr(zipfile.ZipInfo(arc), b"")
            else:
                z.writestr(arc, data if isinstance(data, bytes) else data.encode("utf-8"))
    return path


ARTICLE = r"""\documentclass[11pt,a4paper]{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{graphicx}
\usepackage[margin=2.5cm]{geometry}
\usepackage{booktabs}
\usepackage{hyperref}
\graphicspath{{figures/}}
\newcommand{\R}{\mathbb{R}}

\title{A Study of Flow Systems}
\author{Serah Rasquinha \and Vinutha S T}
\date{November 2026}

\begin{document}
\maketitle

\begin{abstract}
We describe a system that turns drawings into \LaTeX{} figures.
\end{abstract}

\section{Introduction}
\label{sec:intro}
Flowcharts are everywhere~\cite{knuth84}. This paper shows how they can be
drawn once and compiled forever. See Section~\ref{sec:method} and
Figure~\ref{fig:arch}.

% A comment with \section{Not a section} inside it.
The energy is given by
\begin{equation}
  E = mc^2 \label{eq:energy}
\end{equation}
which is Equation~\eqref{eq:energy}.

\input{sections/method}

\section{Results}
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.6\textwidth]{diagram}
  \caption{System architecture.}
  \label{fig:arch}
\end{figure}

\begin{table}[htbp]
  \centering
  \begin{tabular}{lcr}
    \toprule
    Method & Time & Score \\
    \midrule
    Ours & 1.2 & 98 \\
    Baseline & 3.4 & 71 \\
    \bottomrule
  \end{tabular}
  \caption{Comparison.}
  \label{tab:cmp}
\end{table}

\begin{itemize}
  \item First point with $x \in \R$.
  \item Second point.
\end{itemize}

\section{Conclusion}
It works.

\bibliographystyle{plain}
\bibliography{refs}
\end{document}
"""

METHOD = r"""\section{Method}
\label{sec:method}
We use a three-step pipeline.

\begin{enumerate}
  \item Draw.
  \item Generate.
  \item Compile.
\end{enumerate}
"""

BIB = r"""@book{knuth84,
  author = {Donald E. Knuth},
  title = {The {\TeX}book},
  publisher = {Addison-Wesley},
  year = {1984}
}
"""

write("overleaf-article.zip", [
    ("MyPaper/", b""),
    ("MyPaper/main.tex", ARTICLE),
    ("MyPaper/sections/", b""),
    ("MyPaper/sections/method.tex", METHOD),
    ("MyPaper/figures/", b""),
    ("MyPaper/figures/diagram.png", PNG),
    ("MyPaper/refs.bib", BIB),
])

# Packages kept in a separate preamble file.
write("preamble-file.zip", [
    ("main.tex", r"""\documentclass{report}
\input{preamble}
\begin{document}
\chapter{Start}
Some text in a report.

\chapter{More}
More text.
\end{document}
"""),
    ("preamble.tex", r"""\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{graphicx}
\usepackage{xcolor}
\usepackage{cleveref}
"""),
])

# Two complete documents with no clear winner, plus a standalone picture.
write("multi-main.zip", [
    ("paper.tex", "\\documentclass{article}\n\\begin{document}\nPaper.\n\\end{document}\n"),
    ("slides.tex", "\\documentclass{beamer}\n\\begin{document}\n\\begin{frame}{Hello}\nSlide.\n\\end{frame}\n\\end{document}\n"),
    ("figures/pic.tex", "\\documentclass{standalone}\n\\usepackage{tikz}\n\\begin{document}\n\\tikz\\draw (0,0)--(1,1);\n\\end{document}\n"),
])

# One clear main among a standalone figure and a subfile.
write("clear-main.zip", [
    ("thesis.tex", "\\documentclass{report}\n\\usepackage{subfiles}\n\\begin{document}\n\\subfile{chapters/intro}\n\\end{document}\n"),
    ("chapters/intro.tex", "\\documentclass[../thesis.tex]{subfiles}\n\\begin{document}\n\\chapter{Intro}\nHello.\n\\end{document}\n"),
    ("figures/pic.tex", "\\documentclass{standalone}\n\\begin{document}\nx\n\\end{document}\n"),
])

write("no-main.zip", [
    ("chapters/one.tex", "\\chapter{One}\nText.\n"),
    ("chapters/two.tex", "\\chapter{Two}\n% \\documentclass{article} commented out\n"),
    ("broken.tex", "\\documentclass{article}\n% no begin document\n"),
])

write("no-tex.zip", [("figures/a.png", PNG), ("README.md", "Just images.\n")])

with zipfile.ZipFile(os.path.join(OUT, "empty.zip"), "w") as z:
    pass

with open(os.path.join(OUT, "not-a-zip.zip"), "wb") as f:
    f.write(b"This is plain text pretending to be a zip.\n" * 3)

full = open(os.path.join(OUT, "overleaf-article.zip"), "rb").read()
with open(os.path.join(OUT, "truncated.zip"), "wb") as f:
    f.write(full[: len(full) // 2])

# Unsafe and junk names alongside a real project.
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("main.tex", "\\documentclass{article}\n\\begin{document}\nSafe.\n\\end{document}\n")
    z.writestr("../evil.tex", "\\documentclass{article}\\begin{document}evil\\end{document}")
    z.writestr("/abs.tex", "x")
    z.writestr("C:/win.tex", "x")
    z.writestr("__MACOSX/._main.tex", "junk")
    z.writestr(".DS_Store", "junk")
open(os.path.join(OUT, "unsafe-paths.zip"), "wb").write(buf.getvalue())

# An image compressed with bzip2 (listed, carried over, not opened).
with zipfile.ZipFile(os.path.join(OUT, "bzip2-entry.zip"), "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("main.tex", "\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\nText.\n\n\\includegraphics{photo}\n\\end{document}\n")
    z.writestr(zipfile.ZipInfo("photo.png"), PNG, compress_type=zipfile.ZIP_BZIP2)


# Written to an unseekable stream: sizes come after the data (data descriptors).
class Unseekable(io.RawIOBase):
    def __init__(self):
        self.buf = bytearray()

    def writable(self):
        return True

    def write(self, b):
        self.buf.extend(b)
        return len(b)

    def seekable(self):
        return False


u = Unseekable()
with zipfile.ZipFile(u, "w", zipfile.ZIP_DEFLATED) as z:
    with z.open("main.tex", "w") as f:
        f.write(b"\\documentclass{article}\n\\begin{document}\nStreamed.\n\\end{document}\n")
    with z.open("data/notes.txt", "w") as f:
        f.write(b"notes\n" * 50)
open(os.path.join(OUT, "data-descriptor.zip"), "wb").write(bytes(u.buf))

# Password-protected entry: mark the flag by hand (contents are not real ciphertext).
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
    z.writestr("main.tex", "\\documentclass{article}\n\\begin{document}\nHi.\n\\end{document}\n")
    z.writestr("secret.tex", "\\documentclass{article}\\begin{document}secret\\end{document}")
data = bytearray(buf.getvalue())
# Set bit 0 of the general-purpose flags for secret.tex in both headers.
name = b"secret.tex"
i = 0
while True:
    i = data.find(name, i)
    if i < 0:
        break
    for sig, flag_off in ((b"PK\x03\x04", 6), (b"PK\x01\x02", 8)):
        for back in (30, 46):
            s = i - back
            if s >= 0 and data[s:s + 4] == sig:
                flags = struct.unpack_from("<H", data, s + flag_off)[0] | 1
                struct.pack_into("<H", data, s + flag_off, flags)
    i += len(name)
open(os.path.join(OUT, "encrypted-entry.zip"), "wb").write(bytes(data))

# Latin-1 source with Windows line endings.
latin = "\\documentclass{article}\r\n\\usepackage[latin1]{inputenc}\r\n\\begin{document}\r\nCaf\xe9 cr\xe8me.\r\n\r\nSecond paragraph.\r\n\\end{document}\r\n"
write("latin1-crlf.zip", [("main.tex", latin.encode("cp1252"))])

# UTF-8 with a byte-order mark.
write("bom.zip", [("main.tex", b"\xef\xbb\xbf\\documentclass{article}\n\\begin{document}\nB\xc3\xb6m.\n\\end{document}\n")])

# Report with \include'd chapters, two-column article inside a subfolder layout.
write("report-include.zip", [
    ("main.tex", r"""\documentclass[12pt]{report}
\usepackage{tikz}
\usetikzlibrary{arrows.meta}
\begin{document}
\tableofcontents
\include{chapters/ch1}
\include{chapters/ch2}
\end{document}
"""),
    ("chapters/ch1.tex", "\\chapter{First}\n\\label{ch:first}\nIntro text.\n\n\\section{Detail}\nMore.\n"),
    ("chapters/ch2.tex", "\\chapter{Second}\nSee Chapter~\\ref{ch:first}.\n\n\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}\n"),
])

write("twocolumn.zip", [
    ("main.tex", r"""\documentclass[10pt,twocolumn]{article}
\usepackage{float}
\usepackage{caption}
\begin{document}
\section{Left}
Two column text. """ + "Words flow here. " * 40 + r"""

\begin{figure}[H]
\centering
\fbox{placeholder}
\caption{An existing figure.}\label{figure:old}
\end{figure}

\section{Right}
More words.
\end{document}
"""),
])

print("fixtures written to", os.path.relpath(OUT))
