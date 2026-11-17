#!/usr/bin/env python3
"""
Build very large LaTeX project zips for stress-testing the importer.

    python3 scripts/make-stress-projects.py /tmp/stress [--huge]

Writes:
  big-tex.zip        a 25 MB main.tex (thousands of sections, maths, lists) + 300 chapter files
  many-files.zip     60,000 files (figures, data) around a normal main.tex
  zip64-70k.zip      70,000 files: needs Zip64 for the entry count
  huge-2gb.zip       2 GB of incompressible figures (stored) + main.tex       (--huge)
  over-4gb.zip       a 4.4 GB file *before* main.tex, so offsets need Zip64   (--huge)
"""
import os
import random
import sys
import zipfile

out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/stress"
huge = "--huge" in sys.argv
os.makedirs(out, exist_ok=True)
random.seed(7)

PRE = r"""\documentclass[11pt]{article}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{hyperref}
\begin{document}
\title{Stress}\maketitle
"""


def section(i):
    paras = []
    for p in range(20):
        paras.append(
            f"Paragraph {p} of section {i}. " + "Words that flow on and on. " * 12 + f"Inline $a_{{{p}}}^2 + b = c$."
        )
    return (
        f"\\section{{Section {i}}}\\label{{sec:{i}}}\n"
        + "\n\n".join(paras)
        + f"\n\\begin{{equation}} x_{{{i}}} = \\frac{{{i}}}{{2}} \\end{{equation}}\n"
        + "\\begin{itemize}\\item one\\item two\\end{itemize}\n\n"
    )


def big_tex():
    path = os.path.join(out, "big-tex.zip")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        body = [PRE]
        for i in range(1, 3001):
            body.append(section(i))
        for c in range(1, 301):
            body.append(f"\\input{{chapters/ch{c}}}\n")
            z.writestr(f"chapters/ch{c}.tex", "".join(section(10000 + c * 10 + k) for k in range(3)))
        body.append("\\end{document}\n")
        z.writestr("main.tex", "".join(body))
    return path


def many(path, n):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("main.tex", PRE + "Hello.\n\n\\section{A}Text.\n\\end{document}\n")
        for i in range(n):
            folder = f"assets/{i // 1000:03d}"
            z.writestr(f"{folder}/file{i:06d}.dat", f"data {i}\n")
    return path


def huge_2gb():
    path = os.path.join(out, "huge-2gb.zip")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as z:
        z.writestr("main.tex", PRE + "Big figures follow.\n\n\\section{Figures}Text.\n\\end{document}\n")
        block = os.urandom(5 * 1024 * 1024)
        for i in range(400):
            # Incompressible, distinct enough: rotate the block.
            k = (i * 7919) % len(block)
            z.writestr(f"figures/photo{i:03d}.bin", block[k:] + block[:k])
    return path


def over_4gb():
    path = os.path.join(out, "over-4gb.zip")
    size = int(4.4 * 1024 ** 3)
    chunk = b"\0" * (8 * 1024 * 1024)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED, allowZip64=True) as z:
        with z.open(zipfile.ZipInfo("data/blob.bin"), "w", force_zip64=True) as f:
            left = size
            while left > 0:
                n = min(left, len(chunk))
                f.write(chunk[:n])
                left -= n
        z.writestr("main.tex", PRE + "After four gigabytes.\n\n\\section{End}Done.\n\\end{document}\n")
    return path


for fn in [big_tex, lambda: many(os.path.join(out, "many-files.zip"), 60000), lambda: many(os.path.join(out, "zip64-70k.zip"), 70000)] + ([huge_2gb, over_4gb] if huge else []):
    p = fn()
    print(f"{os.path.basename(p)}: {os.path.getsize(p) / 1048576:.1f} MB")
