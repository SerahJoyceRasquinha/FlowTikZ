#!/usr/bin/env bash
# Compile every generated fixture with pdflatex and report the result.
# Requires a TeX distribution with tikz, xcolor and the standalone class.
set -uo pipefail

cd "$(dirname "$0")/.."
DIR=latex-verify
OUT="$DIR/out"
mkdir -p "$OUT"

if ! command -v pdflatex >/dev/null; then
  echo "pdflatex not found. Install TeX Live, or paste the fixtures into Overleaf instead."
  echo "See docs/VERIFICATION.md for the Overleaf workflow."
  exit 127
fi

fail=0
for tex in "$DIR"/*.tex; do
  name=$(basename "$tex" .tex)
  if pdflatex -halt-on-error -interaction=nonstopmode \
       -output-directory "$OUT" "$tex" >"$OUT/$name.log" 2>&1; then
    pages=$(pdfinfo "$OUT/$name.pdf" 2>/dev/null | awk '/^Pages/{print $2}')
    pw=$(pdfinfo "$OUT/$name.pdf" 2>/dev/null | awk '/^Page size/{print $3}')
    ph=$(pdfinfo "$OUT/$name.pdf" 2>/dev/null | awk '/^Page size/{print $5}')
    echo "PASS  $name  (${pages:-?} page, ${pw:-?}x${ph:-?} pt)"

    # Dimensional control: compare the compiled page against the size the
    # diagram model asked for.
    expect=$(grep -m1 '^% VERIFY page' "$tex" | awk '{print $4, $5}')
    if [ -n "$expect" ]; then
      read -r ew eh <<<"$expect"
      if awk -v a="$pw" -v b="$ew" -v c="$ph" -v d="$eh" \
           'BEGIN{exit !((a-b<1.5 && b-a<1.5) && (c-d<1.5 && d-c<1.5))}'; then
        echo "      geometry OK: expected ${ew}x${eh} pt, got ${pw}x${ph} pt"
      else
        echo "      GEOMETRY MISMATCH: expected ${ew}x${eh} pt, got ${pw}x${ph} pt"
        fail=1
      fi
    fi
  else
    echo "FAIL  $name  - see $OUT/$name.log"
    grep -m3 -E '^(!|l\.[0-9]+)' "$OUT/$name.log" | sed 's/^/        /'
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo
  echo "All fixtures compiled. PDFs are in $OUT/."
fi
exit "$fail"
