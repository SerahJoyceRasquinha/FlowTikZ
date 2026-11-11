# Charts from data

FlowTikZ builds charts from tabular data the way Power BI and Tableau do -
import a table, choose a chart type, assign columns to the chart's roles - and
writes the result as PGFPlots code for LaTeX. The code is self-contained: the
category names, the aggregated values, the field names used for titles and
legends, and every colour are written into it, so the spreadsheet is never
needed in Overleaf.

```
Excel / CSV  →  table (typed columns)  →  chart spec (type, fields, filters, style)
                                                  │
                                          aggregation  →  layout  ─┬→ canvas (SVG)
                                                                   └→ PGFPlots code
```

The canvas and the LaTeX are both drawn from one computed **layout** (plot
rectangle, axis ranges, ticks, bar positions, label anchors, colours), so the
two cannot disagree.

---

## 1. Getting data in

Press **Chart from data** in the toolbar, or **Chart from Excel / CSV** on the
empty canvas.

| Source | Notes |
| --- | --- |
| Excel `.xlsx` / `.xlsm` | Every sheet is listed; pick one from **Sheet**. Shared strings, rich text, cached formula results, booleans and date formats are read. Error cells (`#DIV/0!`) become blanks. |
| `.csv`, `.tsv`, `.txt` | Comma, semicolon, tab or pipe separated - detected automatically. Quoted fields, doubled quotes and line breaks inside quotes are handled. Semicolon files are read with decimal commas (`1.234,5`). UTF-8, or Windows-1252 as saved by Excel. |
| **Paste from Excel** | Copy cells (with the header row) in Excel or Google Sheets and paste them. |
| **Use sample sales data** | The Date / Product / Region / Sales / Quantity table from the brief. |

Old binary `.xls` files are refused with instructions to save as `.xlsx` or
CSV. Up to 20,000 rows and 60 columns are imported; the rest is reported.

**Column types.** Each column is read as **Number**, **Text** or **Date**:

- *Number* when at least 95% of its cells read as numbers. Thousands
  separators, currency signs (`₹ $ € £`, `Rs.`), a trailing `%` and accounting
  negatives `(300)` are understood. Cells that do not fit become blanks, and
  the count is reported.
- *Date* for ISO dates, `dd/mm/yyyy` (or `mm/dd/yyyy` when the column proves
  it), `1 Jan 2026`, `March 5, 2026`, and Excel cells formatted as dates.
- *Text* otherwise. Empty markers such as `-`, `n/a`, `null` count as blank.

The preview table shows the first rows with a type selector above each
column; change a type there if the guess is wrong. Title rows above the real
header (common in spreadsheets) are skipped automatically.

---

## 2. Building the chart

### Chart types

| Type | Use it for | Wells |
| --- | --- | --- |
| Column | Comparing values across categories | Axis, Values, Legend, Filters |
| Bar | The same, horizontally (long category names) | Axis, Values, Legend, Filters |
| Line | Trends over time or another ordered field | Axis, Values, Legend, Filters |
| Area | A trend with the magnitude filled in | Axis, Values, Legend, Filters |
| Scatter | The relationship between two numbers | X axis, Y axis, Colour by, Filters |
| Pie / Donut | Share of a whole, for a few categories | Slices, Slice size, Filters |
| Histogram | Distribution of one number | Field to bin, Filters |

Switching type keeps whatever still makes sense (a scatter needs two numbers,
so it picks them; a pie drops the legend).

### Field wells

Drag a field chip from **Fields** into a box, double-click a chip to put it in
the most likely box, or pick from the drop-down in each box - all three do the
same thing.

- **Axis** - the categories (Product, Region, Date ...). For a date field,
  **Group dates by** offers Month, Quarter or Year (a date hierarchy).
- **Values** - what is measured. Each value has an aggregation:
  **Sum, Average, Count, Distinct count, Minimum, Maximum, Median**. A text
  field dropped here is counted. **+ Count of records** counts rows. Several
  values give several series.
- **Legend** - splits the first value into one series per distinct value
  (e.g. Sales by Product, split by Region).
- **Filters** - keep only some rows: tick the values to keep for text and
  date fields (with search, All and None), or a minimum / maximum for numbers.
- **Sort** - as in the data (dates chronologically), largest or smallest
  first, or A to Z. **Show top** keeps the first N categories after sorting.
- **Stack the series** - for column, bar and area charts with several series.
- **Number of bins** - for histograms (blank = automatic, Sturges' rule with
  "nice" bin edges).

For the brief's table, *Axis = Product, Values = Sum of Sales, Legend = Region*
gives Laptop 50,000 / 40,000, Mobile 35,000 / 30,000, Tablet 20,000 / -,
exactly as Power BI would.

---

## 3. Formatting

Select the chart on the canvas; everything is in the panel on the right
(double-click the chart or press `Enter` to jump there). **Open chart editor…**
reopens the larger editor with a preview, and lets you load different data
while keeping the field choices that still exist.

| Section | Options |
| --- | --- |
| Titles | Chart title, horizontal and vertical axis titles: automatic from the fields until you type your own; **Show** hides one. Text size. |
| Colours | Seven colour themes (Tableau-like, Power BI-like, teal and amber, pastel, blues, viridis, greyscale for print), a colour per series or slice, text and axis colours, optional background fill, outlines (white separators for pies). |
| Legend and labels | Legend below, right, inside top-left / top-right, or hidden. Data labels (values on bars and points) or, for pies, percentage / value / name / name and percentage. |
| Bars / Lines and points | Bar width; line width, solid / dashed / dotted; point marker (circle, square, triangle, diamond) and size; area fill opacity. |
| Axes and grid | Value axis minimum and maximum, gridlines (horizontal, vertical, both, none) and their colour, frame (left and bottom, or a full box), category label angle (automatic, horizontal, 45°, vertical). |
| Number format | Decimal places, thousands separator, short numbers (50K, 1.2M), prefix (e.g. `Rs. `) and suffix (e.g. `%`). |
| Size and position | X, Y, width and height (or drag the corner handles). The note shows the printed width at the current scale. |

Every control writes the chart's spec; the canvas and the code update
together, and each change is one undo step.

---

## 4. The LaTeX

A chart adds `\usepackage{pgfplots}` and `\pgfplotsset{compat=1.18}` to the
preamble (listed in the comments in snippet mode). Overleaf and TeX Live 2021+
ship PGFPlots 1.18.

```latex
% n1 - Column chart "Sum of Sales by Product and Region"
% Data: Sample sales data (12 of 12 rows used)
% Axis = Product; Values = Sum of Sales; Legend = Region
%   Product | North   | South
%   Laptop  | 158,000 | 87,000
%   Mobile  | 74,000  | 63,000
%   Tablet  | 44,000  | 18,000
\begin{axis}[
  scale only axis, width=9.3cm, height=5.6cm,
  xmin=-0.5, xmax=2.5, ymin=0, ymax=160000,
  xtick={0,1,2}, xticklabels={{Laptop},{Mobile},{Tablet}},
  ytick={0,20000,...}, yticklabels={{0},{20,000},...},
  title={Sum of Sales by Product and Region},
  xlabel={Product}, ylabel={Sum of Sales}, ...
]
% Series: North
\addplot[ybar, bar width=0.35, bar shift=-0.175, fill=fc4E79A7, draw=none]
  coordinates {
    (0,158000) % Laptop
    (1,74000) % Mobile
    (2,44000) % Tablet
  };
...
\end{axis}
```

How each part maps:

| On the canvas | In the code |
| --- | --- |
| Plot area | `at=`, `width=`, `height=` with `scale only axis` - the same rectangle |
| Axis ranges and ticks | explicit `xmin/xmax/ymin/ymax`, `xtick`/`ytick` |
| Tick labels | `xticklabels`/`yticklabels` with the exact strings shown (`50,000`, `Rs. 1.2K`) |
| Category names | tick labels, plus a `% name` comment on each coordinate |
| Aggregated values | `\addplot ... coordinates {...}` |
| Colours | `\definecolor{fcRRGGBB}{HTML}{RRGGBB}` - the same hex values |
| Grouped bars | `bar width` and `bar shift` in axis units |
| Stacked bars | `ybar stacked` / `xbar stacked` with each segment's own value |
| Areas | a filled band (`-- cycle`) and its top line |
| Scatter | `only marks` with the raw points |
| Pie / donut | TikZ `arc` slices with the share in a comment |
| Titles, axis titles | `title`, `xlabel`, `ylabel`, pinned with `axis description cs` |
| Legend, data labels | TikZ nodes and swatches at the canvas positions |
| Fonts | `\fontsize` scaled from the canvas size, sans-serif |

Special characters in data and titles (`& % # _ { } $ ~ ^ \`) are escaped,
and the comments are made safe too.

**Data travels with the code.** There is no `\pgfplotstableread{file.csv}`:
the values are literal coordinates. Turn **Comments** off for compact output;
the data stays.

---

## 5. Limits

- Text is set in TeX's sans-serif font, which is slightly narrower than the
  browser's; positions and anchors match, glyph widths differ a little (as for
  flowchart text).
- Charts are not rotated (the rotate handle is hidden for them).
- Line smoothing, trend lines, dual axes, maps and treemaps are not offered.
- A Legend field with more than 12 values shows the first 12 series; more than
  200 categories are cut to 200 (use a filter or Top N).
- Very large tables (up to 20,000 rows) are stored inside the diagram file and
  the autosave; the generated LaTeX contains only the aggregated values.
