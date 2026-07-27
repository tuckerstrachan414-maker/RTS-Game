#!/usr/bin/env python3
"""Splice the PUNY_WORLD_v1 cliff/plateau set into assets/tileset16x16_1.png.

The game loads exactly one terrain sheet (assets/tileset16x16_1.png, an 8-column
16px grid that js/assets.js `AT` indexes by [col,row]). The cliff art lives in
assets/punyworld-overworld-tileset.png, a 27-column reference sheet that is never
loaded at runtime. This script copies the 17 cliff tiles across, appending them as
rows 14-16 so every pre-existing AT coordinate keeps pointing at the same pixels.

Re-running is safe: rows 14+ are rebuilt from scratch each time.

    python3 tools/splice-cliffs.py

Provenance note: the cliff art is greyish-olive (hue 70-80 deg, plus desaturated
greys). `recolor(tileset, hue, 'warm')` in js/assets.js only rotates hues in
[345,42] with saturation > 0.15, so the per-faction roof recolor leaves these
tiles untouched — cliffs stay neutral terrain for every nation.
"""

import os
from PIL import Image

TILE = 16
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'punyworld-overworld-tileset.png')
DST = os.path.join(ROOT, 'assets', 'tileset16x16_1.png')

KEPT_ROWS = 14   # rows 0-13 of the destination sheet are left byte-identical

# Destination cell -> source cell in the puny sheet. Order matches the AT.CLIFF_*
# entries in js/assets.js; see that table for what each piece is for.
LAYOUT = [
    # row 14 — the outer 9-slice, reading NW..SE with the plateau top in the middle
    ((0, 14), (11, 4), 'CLIFF_NW'),
    ((1, 14), (12, 4), 'CLIFF_N'),
    ((2, 14), (13, 4), 'CLIFF_NE'),
    ((3, 14), (11, 5), 'CLIFF_W'),
    ((4, 14), (12, 5), 'CLIFF_TOP'),
    ((5, 14), (13, 5), 'CLIFF_E'),
    ((6, 14), (11, 6), 'CLIFF_SW'),
    ((7, 14), (12, 6), 'CLIFF_S'),
    # row 15 — last outer corner, the four concave corners, and the ramp pieces
    ((0, 15), (13, 6), 'CLIFF_SE'),
    ((1, 15), (14, 4), 'CLIFF_INW'),
    ((2, 15), (15, 4), 'CLIFF_INE'),
    ((3, 15), (14, 6), 'CLIFF_ISW'),
    ((4, 15), (15, 6), 'CLIFF_ISE'),
    ((5, 15), (17, 4), 'RAMP_TOP'),
    ((6, 15), (17, 6), 'RAMP'),
    ((7, 15), (16, 5), 'RAMP_W'),
    # row 16
    ((0, 16), (18, 5), 'RAMP_E'),
]


def main():
    src = Image.open(SRC).convert('RGBA')
    dst = Image.open(DST).convert('RGBA')

    cols = dst.width // TILE
    rows = max(r for (_, r), _, _ in LAYOUT) + 1
    out = Image.new('RGBA', (dst.width, rows * TILE), (0, 0, 0, 0))
    out.paste(dst.crop((0, 0, dst.width, KEPT_ROWS * TILE)), (0, 0))

    for (dc, dr), (sc, sr), name in LAYOUT:
        assert dc < cols, f'{name}: column {dc} past sheet width'
        assert dr >= KEPT_ROWS, f'{name}: would overwrite existing row {dr}'
        cell = src.crop((sc * TILE, sr * TILE, sc * TILE + TILE, sr * TILE + TILE))
        out.paste(cell, (dc * TILE, dr * TILE))

    out.save(DST)
    print(f'{DST}: {dst.width}x{dst.height} -> {out.width}x{out.height} '
          f'({cols}x{rows} cells), spliced {len(LAYOUT)} cliff tiles')


if __name__ == '__main__':
    main()
