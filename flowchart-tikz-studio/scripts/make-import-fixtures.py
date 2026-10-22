#!/usr/bin/env python3
"""
Regenerates the raster fixtures used by the import tests, together with a
"ground truth" structured description (IR JSON) of each image.

The ground truth is in *source pixel* coordinates. The tests import it as an
IR JSON file and compare it with what the offline recogniser produces.

    python3 scripts/make-import-fixtures.py
"""
import json
import math
import os

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'tests', 'fixtures', 'import')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FONT_B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def font(size, bold=False):
    return ImageFont.truetype(FONT_B if bold else FONT, size)


def centred_text(d, box, text, size=14, fill='#000000', bold=False):
    f = font(size, bold)
    x, y, w, h = box
    lines = text.split('\n')
    lh = size * 1.25
    top = y + (h - lh * len(lines)) / 2
    for i, line in enumerate(lines):
        tw = d.textlength(line, font=f)
        d.text((x + (w - tw) / 2, top + i * lh), line, fill=fill, font=f)


def arrow(d, pts, fill='#000000', width=2, dash=None, head=10):
    for a, b in zip(pts, pts[1:]):
        if dash:
            seg_len = math.dist(a, b)
            n = int(seg_len // (dash * 2)) + 1
            for k in range(n):
                t0 = (k * 2 * dash) / seg_len
                t1 = min(1, (k * 2 * dash + dash) / seg_len)
                if t0 >= 1:
                    break
                d.line([(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0),
                        (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)], fill=fill, width=width)
        else:
            d.line([a, b], fill=fill, width=width)
    (x0, y0), (x1, y1) = pts[-2], pts[-1]
    ang = math.atan2(y1 - y0, x1 - x0)
    left = (x1 - head * math.cos(ang) + head * 0.45 * math.sin(ang), y1 - head * math.sin(ang) - head * 0.45 * math.cos(ang))
    right = (x1 - head * math.cos(ang) - head * 0.45 * math.sin(ang), y1 - head * math.sin(ang) + head * 0.45 * math.cos(ang))
    d.polygon([(x1, y1), left, right], fill=fill)


def rect(d, box, fill, outline='#000000', width=2, radius=0):
    x, y, w, h = box
    if radius:
        d.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=fill, outline=outline, width=width)
    else:
        d.rectangle([x, y, x + w, y + h], fill=fill, outline=outline, width=width)


def diamond(d, box, fill, outline='#000000', width=2):
    x, y, w, h = box
    pts = [(x + w / 2, y), (x + w, y + h / 2), (x + w / 2, y + h), (x, y + h / 2)]
    d.polygon(pts, fill=fill, outline=outline, width=width)


def obj(id, shape, box, text=None, fill='#ffffff', stroke='#000000', sw=2, z=0, **extra):
    o = {'id': id, 'shape': shape, 'x': box[0], 'y': box[1], 'w': box[2], 'h': box[3], 'z': z,
         'style': {'fill': fill, 'stroke': stroke, 'strokeWidth': sw}, 'confidence': 0.97}
    if text is not None:
        t = {'content': text, 'fontSize': extra.pop('fontSize', 14), 'color': extra.pop('color', '#000000'),
             'align': 'center', 'valign': 'middle', 'fontFamily': 'DejaVu Sans', 'confidence': extra.pop('textConfidence', 0.98)}
        if extra.pop('bold', False):
            t['bold'] = True
        o['text'] = t
    o.update(extra)
    return o


def con(id, s, t, pts, routing='straight', label=None, dash='solid', z=100, arrow_end='triangle', **extra):
    c = {'id': id, 'source': {'objectId': s} if s else None, 'target': {'objectId': t} if t else None,
         'points': [{'x': p[0], 'y': p[1]} for p in pts], 'routing': routing,
         'arrowStart': 'none', 'arrowEnd': arrow_end,
         'style': {'stroke': extra.pop('stroke', '#000000'), 'strokeWidth': 2, 'dash': dash}, 'z': z, 'confidence': 0.95}
    c = {k: v for k, v in c.items() if v is not None}
    if label:
        c['label'] = {'text': label, 'position': extra.pop('label_pos', 0.5), 'fontSize': 12, 'color': '#000000', 'background': True,
                      'confidence': extra.pop('label_conf', 0.97)}
    c.update(extra)
    return c


def write(name, img, answer, fmt='PNG', **kw):
    img.save(os.path.join(OUT, name), fmt, **kw)
    with open(os.path.join(OUT, name.rsplit('.', 1)[0] + '.ir.json'), 'w') as f:
        json.dump(answer, f, indent=2)


def simple():
    W, H = 480, 520
    img = Image.new('RGB', (W, H), '#ffffff')
    d = ImageDraw.Draw(img)
    start = (170, 30, 140, 50)
    read = (150, 120, 180, 70)
    valid = (165, 240, 150, 100)
    end = (170, 410, 140, 50)
    rect(d, start, '#ffffff', radius=25)
    centred_text(d, start, 'Start')
    rect(d, read, '#ffffff')
    centred_text(d, read, 'Read input')
    diamond(d, valid, '#fff2cc', outline='#d6b656')
    centred_text(d, valid, 'Valid?')
    rect(d, end, '#d5e8d4', outline='#82b366', radius=25)
    centred_text(d, end, 'End')
    arrow(d, [(240, 80), (240, 120)])
    arrow(d, [(240, 190), (240, 240)])
    arrow(d, [(240, 340), (240, 410)])
    d.text((248, 362), 'Yes', fill='#000000', font=font(12))
    arrow(d, [(315, 290), (390, 290), (390, 155), (330, 155)])
    d.text((350, 272), 'No', fill='#000000', font=font(12))
    answer = {
        'canvas': {'width': W, 'height': H},
        'background': {'color': '#ffffff'},
        'objects': [
            obj('o1', 'terminator', start, 'Start', z=0),
            obj('o2', 'rectangle', read, 'Read input', z=1),
            obj('o3', 'diamond', valid, 'Valid?', fill='#fff2cc', stroke='#d6b656', z=2),
            obj('o4', 'terminator', end, 'End', fill='#d5e8d4', stroke='#82b366', z=3),
        ],
        'connectors': [
            con('c1', 'o1', 'o2', [(240, 80), (240, 120)], z=4),
            con('c2', 'o2', 'o3', [(240, 190), (240, 240)], z=5),
            con('c3', 'o3', 'o4', [(240, 340), (240, 410)], label='Yes', z=6),
            con('c4', 'o3', 'o2', [(315, 290), (390, 290), (390, 155), (330, 155)], routing='orthogonal', label='No', label_pos=0.1, z=7),
        ],
        'groups': [],
    }
    write('simple.png', img, answer)


def complex_():
    W, H = 760, 620
    bg = '#eef1f5'
    img = Image.new('RGB', (W, H), bg)
    d = ImageDraw.Draw(img)
    d.text((30, 20), 'Refund workflow', fill='#333333', font=font(20, True))
    req = (60, 80, 170, 60)
    chk = (60, 200, 170, 110)
    db = (330, 205, 110, 100)
    doc = (560, 80, 150, 80)
    appr = (300, 380, 170, 60)
    rej = (560, 380, 150, 60)
    io = (60, 490, 190, 60)
    rect(d, req, '#ffffff', outline='#1f2933')
    centred_text(d, req, 'Refund request')
    diamond(d, chk, '#ffffff', outline='#1f2933')
    centred_text(d, chk, 'Refnd\nvalid?')
    # cylinder
    x, y, w, h = db
    d.rectangle([x, y + 15, x + w, y + h - 15], fill='#dae8fc')
    d.ellipse([x, y + h - 30, x + w, y + h], fill='#dae8fc', outline='#6c8ebf', width=2)
    d.rectangle([x + 1, y + 15, x + w - 1, y + h - 16], fill='#dae8fc')
    d.line([x, y + 15, x, y + h - 15], fill='#6c8ebf', width=2)
    d.line([x + w, y + 15, x + w, y + h - 15], fill='#6c8ebf', width=2)
    d.ellipse([x, y, x + w, y + 30], fill='#dae8fc', outline='#6c8ebf', width=2)
    centred_text(d, (x, y + 30, w, h - 30), 'Orders')
    # document
    x, y, w, h = doc
    d.polygon([(x, y), (x + w, y), (x + w, y + h - 12), (x + w * 0.75, y + h - 2), (x + w * 0.5, y + h - 12), (x + w * 0.25, y + h - 22), (x, y + h - 12)], fill='#ffffff', outline='#1f2933', width=2)
    centred_text(d, (x, y, w, h - 14), 'Policy')
    rect(d, appr, '#d5e8d4', outline='#82b366', radius=10)
    centred_text(d, appr, 'Approve', bold=True)
    rect(d, rej, '#f8cecc', outline='#b85450')
    centred_text(d, rej, 'Reject')
    x, y, w, h = io
    d.polygon([(x + 25, y), (x + w, y), (x + w - 25, y + h), (x, y + h)], fill='#ffffff', outline='#1f2933', width=2)
    centred_text(d, io, 'Notify customer')
    arrow(d, [(145, 140), (145, 200)])
    arrow(d, [(230, 255), (330, 255)], dash=5)
    arrow(d, [(145, 310), (145, 410), (300, 410)])
    d.text((150, 350), 'Yes', fill='#000000', font=font(12))
    arrow(d, [(470, 410), (560, 410)])
    arrow(d, [(385, 440), (385, 520), (237, 520)])
    arrow(d, [(635, 160), (635, 380)], dash=5)
    answer = {
        'canvas': {'width': W, 'height': H},
        'background': {'color': bg},
        'objects': [
            # The model wrongly includes the page as a rectangle - the pipeline must drop it.
            obj('bg', 'rectangle', (0, 0, W, H), None, fill=bg, stroke='none', sw=0, z=0),
            obj('t1', 'text', (30, 18, 190, 28), 'Refund workflow', fill='none', stroke='none', z=1, fontSize=20, bold=True, color='#333333'),
            obj('o1', 'rectangle', req, 'Refund request', stroke='#1f2933', z=2),
            obj('o2', 'diamond', chk, 'Refnd\nvalid?', stroke='#1f2933', z=3, textConfidence=0.55),
            obj('o3', 'cylinder', db, 'Orders', fill='#dae8fc', stroke='#6c8ebf', z=4),
            obj('o4', 'document', doc, 'Policy', stroke='#1f2933', z=5),
            obj('o5', 'rounded-rectangle', appr, 'Approve', fill='#d5e8d4', stroke='#82b366', z=6, bold=True),
            obj('o6', 'rectangle', rej, 'Reject', fill='#f8cecc', stroke='#b85450', z=7),
            obj('o7', 'parallelogram', io, 'Notify customer', stroke='#1f2933', z=8),
            # A loose label the model failed to put on its connector: normalisation attaches it.
            obj('t2', 'text', (150, 348, 26, 16), 'Yes', fill='none', stroke='none', z=9, fontSize=12),
        ],
        'connectors': [
            con('c1', 'o1', 'o2', [(145, 140), (145, 200)], z=10),
            con('c2', 'o2', 'o3', [(230, 255), (330, 255)], dash='dashed', z=11),
            con('c3', 'o2', 'o5', [(145, 310), (145, 410), (300, 410)], routing='orthogonal', z=12),
            con('c4', 'o5', 'o6', [(470, 410), (560, 410)], z=13),
            con('c5', 'o5', 'o7', [(385, 440), (385, 520), (237, 520)], routing='orthogonal', z=14),
            con('c6', 'o4', 'o6', [(635, 160), (635, 380)], dash='dashed', z=15),
        ],
        'groups': [{'id': 'g1', 'memberIds': ['o5', 'o6'], 'name': 'Outcome'}],
    }
    answer['objects'][0]['style']['fill'] = bg
    write('complex.png', img, answer)


def jpeg():
    W, H = 420, 360
    bg = '#fdf6e3'
    img = Image.new('RGB', (W, H), bg)
    d = ImageDraw.Draw(img)
    a = (40, 40, 150, 60)
    b = (240, 40, 150, 60)
    c = (140, 220, 150, 70)
    rect(d, a, '#ffffff', outline='#268bd2')
    centred_text(d, a, 'Collect')
    rect(d, b, '#ffffff', outline='#268bd2')
    centred_text(d, b, 'Clean')
    d.ellipse([c[0], c[1], c[0] + c[2], c[1] + c[3]], fill='#eee8d5', outline='#859900', width=2)
    centred_text(d, c, 'Report')
    arrow(d, [(190, 70), (240, 70)])
    arrow(d, [(315, 100), (315, 160), (250, 160), (250, 225)])
    answer = {
        'canvas': {'width': W, 'height': H},
        'background': {'color': bg},
        'objects': [
            obj('o1', 'rectangle', a, 'Collect', stroke='#268bd2', z=0),
            obj('o2', 'rectangle', b, 'Clean', stroke='#268bd2', z=1),
            obj('o3', 'ellipse', c, 'Report', fill='#eee8d5', stroke='#859900', z=2),
        ],
        'connectors': [
            con('c1', 'o1', 'o2', [(190, 70), (240, 70)], z=3),
            con('c2', 'o2', 'o3', [(315, 100), (315, 160), (250, 160), (250, 225)], routing='orthogonal', z=4),
        ],
        'groups': [],
    }
    write('flow.jpg', img, answer, fmt='JPEG', quality=90)


def white_shapes():
    W, H = 360, 260
    img = Image.new('RGB', (W, H), '#ffffff')
    d = ImageDraw.Draw(img)
    a = (30, 40, 120, 70)
    b = (210, 40, 120, 70)
    c = (120, 160, 120, 60)
    rect(d, a, '#ffffff')
    centred_text(d, a, 'White A')
    rect(d, b, '#ffffff')
    centred_text(d, b, 'White B')
    rect(d, c, '#1f2933')
    centred_text(d, c, 'Dark', fill='#ffffff')
    arrow(d, [(150, 75), (210, 75)])
    answer = {
        'canvas': {'width': W, 'height': H},
        'objects': [
            obj('o1', 'rectangle', a, 'White A', z=0),
            obj('o2', 'rectangle', b, 'White B', z=1),
            obj('o3', 'rectangle', c, 'Dark', fill='#1f2933', z=2, color='#ffffff'),
            # A "shape" that is really just an empty patch of page - must be removed.
            obj('ghost', 'rectangle', (250, 170, 80, 60), None, stroke='none', sw=0, z=3),
        ],
        'connectors': [con('c1', 'o1', 'o2', [(150, 75), (210, 75)], z=4)],
        'groups': [],
    }
    write('white-shapes.png', img, answer)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    simple()
    complex_()
    jpeg()
    white_shapes()
    print('fixtures written to', os.path.abspath(OUT))
