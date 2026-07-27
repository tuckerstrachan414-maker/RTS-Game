#!/usr/bin/env python3
"""Splice the PUNY_WORLD_v1 cliff/plateau set into assets/tileset16x16_1.png.

The game loads exactly one terrain sheet (assets/tileset16x16_1.png, an 8-column
16px grid that js/assets.js `AT` indexes by [col,row]). The cliff art lives in
assets/punyworld-overworld-tileset.png, a 27-column reference sheet that is never
loaded at runtime. This script copies the cliff tiles across, appending them as
new rows so every pre-existing AT coordinate keeps pointing at the same pixels.

Re-running is safe: rows 14+ are rebuilt from scratch each time.

    python3 tools/splice-cliffs.py

Provenance note: the cliff art is greyish-olive (hue 70-80 deg, plus desaturated
greys). `recolor(tileset, hue, 'warm')` in js/assets.js only rotates hues in
[345,42] with saturation > 0.15, so the per-faction roof recolor leaves these
tiles untouched — cliffs stay neutral terrain for every nation.

The source pack drew exactly one staircase, cut into a south-facing rim (you
approach from the south and climb north onto the plateau). js/map.js cuts
ramps into any of the plateau's four sides, so the other three orientations
are the same four pieces (tread, top step, and the two jambs) rotated by 90,
180 and 270 degrees — done here with PIL's lossless 90-degree transpose, not
runtime canvas rotation, so the renderer still just indexes a flat atlas like
every other tile.
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
    # row 15 — last outer corner, the two authored concave corners, and the
    # ramp's native (south-facing) tread/top/jambs
    ((0, 15), (13, 6), 'CLIFF_SE'),
    ((1, 15), (14, 4), 'CLIFF_IN_NW'),
    ((2, 15), (15, 4), 'CLIFF_IN_NE'),
    ((5, 15), (17, 4), 'RAMP_TOP_0'),
    ((6, 15), (17, 6), 'RAMP_TREAD_0'),
    ((7, 15), (16, 5), 'RAMP_JAMB_NEG_0'),
]

# The concave corners the pack never drew. It supplies only NW and NE notches
# (cells 14,4 and 15,4) — but a plateau top tile can touch open ground off any
# of its four corners, and leaving the other two as flat turf left raised turf
# meeting grass with no rock between: a visible nick at the corner.
#
# These are the authored NW/NE pieces turned 180 degrees, which moves the notch
# to the opposite corner. The tempting alternative — paste the matching quadrant
# of the OUTER corner onto the plateau top — was tried first and does not work:
# an outer corner's quadrant carries its transparency but not the rock band that
# borders it, so the composed tile had flat turf meeting that transparency along
# the quadrant seam, which is the very defect being fixed (a uniform 6px hole in
# every such tile). Rotating an authored piece keeps the rock border intact by
# construction. It does invert the light on that corner's rock, which at 16px on
# a noisy grey-green texture does not read.
ROTATED_CORNERS = [
    ((3, 15), (15, 4), 'CLIFF_IN_SW'),   # rot180 of the NE notch -> notch at SW
    ((4, 15), (14, 4), 'CLIFF_IN_SE'),   # rot180 of the NW notch -> notch at SE
]

# The three rotated orientations. `steps` is 90-degree turns *clockwise*;
# PIL's Transpose enum rotates counter-clockwise for a positive angle, so CW
# steps map onto it backwards: 1 step CW == ROTATE_270, 3 steps CW == ROTATE_90.
ROTATE_CW = {1: Image.ROTATE_270, 2: Image.ROTATE_180, 3: Image.ROTATE_90}

# Base pieces (rot 0, as drawn: south rim, climb north) and where each rotated
# copy lands. `map.js`'s RAMP_DIRS table is what actually decides, per plateau
# rim tile, which of these four rot values applies — this list only has to
# agree with it on which (piece, rot) pairs exist.
ROTATED_LAYOUT = [
    # rot 1 — west rim, climbs east
    ((1, 16), (17, 6), 1, 'RAMP_TREAD_1'),
    ((2, 16), (17, 4), 1, 'RAMP_TOP_1'),
    ((3, 16), (16, 5), 1, 'RAMP_JAMB_NEG_1'),
    ((4, 16), (18, 5), 1, 'RAMP_JAMB_POS_1'),
    # rot 2 — north rim, climbs south
    ((5, 16), (17, 6), 2, 'RAMP_TREAD_2'),
    ((6, 16), (17, 4), 2, 'RAMP_TOP_2'),
    ((7, 16), (16, 5), 2, 'RAMP_JAMB_NEG_2'),
    ((0, 17), (18, 5), 2, 'RAMP_JAMB_POS_2'),
    # rot 3 — east rim, climbs west
    ((1, 17), (17, 6), 3, 'RAMP_TREAD_3'),
    ((2, 17), (17, 4), 3, 'RAMP_TOP_3'),
    ((3, 17), (16, 5), 3, 'RAMP_JAMB_NEG_3'),
    ((4, 17), (18, 5), 3, 'RAMP_JAMB_POS_3'),
]
# rot 0's own jamb-positive piece (RAMP_E in the old naming) still needs a home;
# give it the next free cell rather than disturbing the row-15 layout above.
LAYOUT.append(((5, 17), (18, 5), 'RAMP_JAMB_POS_0'))

# Every jamb cell written above, in all four rotations — see strip_turf_from_jambs.
JAMB_CELLS = [c for c, _, n in LAYOUT if 'JAMB' in n] + \
             [c for c, _, _, n in ROTATED_LAYOUT if 'JAMB' in n]


TURF = (133, 166, 67)   # the plateau top's flat colour, as drawn in CLIFF_TOP


def strip_turf_from_jambs(sheet):
    """Erase plateau turf from the stair jambs.

    A jamb is drawn as an OVERLAY on top of whatever rim piece its tile already
    has (js/ui.js), so all it should contribute is the rock post. The pack drew
    each jamb with a strip of plateau turf down its inner edge, which is
    invisible in the art's native south-facing orientation — that edge faces the
    plateau top, which is turf anyway. Rotated to a north rim it ends up facing
    the open side instead, putting raised turf straight against low grass with no
    rock between: the same class of hole the concave corners fix. Dropping those
    pixels lets the rim piece underneath supply the turf, which it already does
    correctly for every orientation.
    """
    px = sheet.load()
    for dc, dr in JAMB_CELLS:
        for y in range(dr * TILE, dr * TILE + TILE):
            for x in range(dc * TILE, dc * TILE + TILE):
                r, g, b, a = px[x, y]
                if a and (r, g, b) == TURF:
                    px[x, y] = (0, 0, 0, 0)


def main():
    src = Image.open(SRC).convert('RGBA')
    dst = Image.open(DST).convert('RGBA')

    cols = dst.width // TILE
    rows = max([r for (_, r), _, _ in LAYOUT] + [r for (_, r), _, _, _ in ROTATED_LAYOUT]) + 1
    out = Image.new('RGBA', (dst.width, rows * TILE), (0, 0, 0, 0))
    out.paste(dst.crop((0, 0, dst.width, KEPT_ROWS * TILE)), (0, 0))

    for (dc, dr), (sc, sr), name in LAYOUT:
        assert dc < cols, f'{name}: column {dc} past sheet width'
        assert dr >= KEPT_ROWS, f'{name}: would overwrite existing row {dr}'
        cell = src.crop((sc * TILE, sr * TILE, sc * TILE + TILE, sr * TILE + TILE))
        out.paste(cell, (dc * TILE, dr * TILE))

    for (dc, dr), (sc, sr), steps, name in ROTATED_LAYOUT:
        assert dc < cols, f'{name}: column {dc} past sheet width'
        assert dr >= KEPT_ROWS, f'{name}: would overwrite existing row {dr}'
        cell = src.crop((sc * TILE, sr * TILE, sc * TILE + TILE, sr * TILE + TILE))
        cell = cell.transpose(ROTATE_CW[steps])
        out.paste(cell, (dc * TILE, dr * TILE))

    for (dc, dr), (sc, sr), name in ROTATED_CORNERS:
        assert dr >= KEPT_ROWS, f'{name}: would overwrite existing row {dr}'
        cell = src.crop((sc * TILE, sr * TILE, sc * TILE + TILE, sr * TILE + TILE))
        out.paste(cell.transpose(Image.ROTATE_180), (dc * TILE, dr * TILE))

    strip_turf_from_jambs(out)
    out.save(DST)
    total = len(LAYOUT) + len(ROTATED_LAYOUT) + len(ROTATED_CORNERS)
    print(f'{DST}: {dst.width}x{dst.height} -> {out.width}x{out.height} '
          f'({cols}x{rows} cells), spliced {total} cliff/ramp tiles')


if __name__ == '__main__':
    main()
