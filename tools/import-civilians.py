#!/usr/bin/env python3
"""Rebuild the five civilian spritesheets from the design team's screenshots.

The civilian art (js/civilians.js) was delivered as phone screenshots of a
sprite viewer, not as PNGs, so the sheets in assets/units/Civ*.png are
*reconstructed* rather than copied. This script is the reconstruction, kept in
the repo so the step is reproducible and so the next person can see exactly
what was inferred rather than given.

    python3 tools/import-civilians.py [--src DIR] [--check]

What the screenshots are, and what has to be undone
---------------------------------------------------
Each screenshot shows one sheet laid out on the viewer's dark panel
(#1b2024), one animation per row. The art is magnified, and — this is the
part that matters — magnified by DIFFERENT factors in the two axes: 4.7325x
across and 5.1425x down, an 8.6% vertical stretch. Both were recovered by
fitting a comb of candidate periods to the columns/rows where the image
changes colour (a magnified pixel grid puts every colour transition on a
multiple of the block size); the two fits are stable to about +-0.005 across
all five screenshots, and they are what makes the frame pitch come out at
exactly 32 native pixels in BOTH axes, which is the check that they are right.
Undoing the stretch is therefore not optional: resampling both axes at 4.7325
would leave 32x33 frames and a sheet that drifts a row out of alignment by the
bottom.

Each native pixel is recovered by averaging the middle half of its block
(the outer half carries JPEG ringing from the neighbouring pixel), the
background is flood-filled away from the edges rather than colour-keyed
(nothing inside a figure is reachable from outside it, so a dark tunic is
never mistaken for backdrop), and the result is snapped to a palette
clustered out of the sheet itself, which removes the last of the JPEG
mottling.

Nothing is done to hold the tool heads out of the faction recolour, and that
is deliberate. `recolor(img, hue, 'cool')` in js/assets.js rotates any pixel
with hue 175-260 and saturation over 0.2, which catches most of a blade's
highlight as well as a tunic — but it catches the soldiers' blades in exactly
the same way and always has, because these sheets and the MinifolksHumans ones
share a palette (the same five-step blue ramp appears in both). A civilian
whose axe stays grey while the swordsman beside him carries a red one would be
the odd one out. An earlier pass here clamped pale blues down below the cutoff
to force steel to stay steel; all it actually did was wash out the farmer's
tunic, which is a light blue and was never steel. --check prints the
saturation of every blue on each sheet if you want to re-argue this.

Layout is the engine's: 32px frames, row 0 idle, row 1 walk, then
attack/hurt/death as the last three rows (`describeSheet`). Four of the five
screenshots have all five rows. The plain citizen has no attack row — an
empty-handed idler was never drawn one — so its idle row is copied into the
attack slot, because `describeSheet` counts the attack row back from the end
of the sheet and a four-row sheet would otherwise make 'attack' play the walk
cycle. A market worker is the only civilian who ever asks that sheet for an
attack, and standing still is a fair reading of minding a stall.

--check re-derives the grid and prints what it found without writing anything.
"""

import argparse
import math
import os
import sys
from collections import Counter

from PIL import Image

# Recovered magnification of the screenshots (see the module docstring). Not
# equal, and not a mistake: the screenshots are stretched vertically.
SCALE_X = 4.7325
SCALE_Y = 5.1425

UF = 32                 # engine frame size
FOOT_ROW = 30           # where a figure's feet sit inside its frame, and
FOOT_CENTRE = 16.0      # where they sit across it — both from the soldier sheets
PANEL = (27, 32, 36)    # the sprite viewer's backdrop
PANEL_TOL = 12          # how far a pixel may stray from it and still be backdrop
PALETTE_SIZE = 20
PALETTE_MERGE = 13      # centres closer than this collapse into one

# One entry per screenshot: the source file, the sheet it becomes, and the
# sub-pixel phase of the magnified pixel grid in each axis (from the same comb
# fit that produced SCALE_X/SCALE_Y). `synth_attack` marks the sheet that was
# drawn without a work animation.
SHEETS = [
    dict(src='IMG_4679', out='CivFarmer.png',     phase=(3.75, 4.24), tool='scythe'),
    dict(src='IMG_4681', out='CivWoodcutter.png', phase=(3.69, 0.68), tool='axe'),
    dict(src='IMG_4680', out='CivMiner.png',      phase=(1.49, 1.79), tool='pick'),
    dict(src='IMG_4682', out='CivBuilder.png',    phase=(4.22, 1.91), tool='hammer'),
    dict(src='IMG_4683', out='CivTownsfolk.png',  phase=(1.49, 4.91), tool=None,
         synth_attack=True),
]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, 'assets', 'units')


# ---------------------------------------------------------------------------
# Step 1: undo the magnification


def resample(img, phase):
    """Screenshot -> one output pixel per native pixel.

    Averages the middle half of each magnified block. The outer half is where
    JPEG ringing from the neighbouring native pixel lives, and pixel art has
    no gradients, so throwing it away costs nothing and cleans up a lot.
    """
    w, h = img.size
    px = img.load()
    phx, phy = phase
    nx = int((w - phx) // SCALE_X)
    ny = int((h - phy) // SCALE_Y)
    out = Image.new('RGB', (nx, ny))
    op = out.load()
    for j in range(ny):
        y0 = phy + j * SCALE_Y
        ya = int(round(y0 + SCALE_Y * 0.25))
        yb = max(ya + 1, int(round(y0 + SCALE_Y * 0.75)))
        yb = min(yb, h)
        for i in range(nx):
            x0 = phx + i * SCALE_X
            xa = int(round(x0 + SCALE_X * 0.25))
            xb = max(xa + 1, int(round(x0 + SCALE_X * 0.75)))
            xb = min(xb, w)
            r = g = b = n = 0
            for y in range(ya, yb):
                for x in range(xa, xb):
                    p = px[x, y]
                    r += p[0]
                    g += p[1]
                    b += p[2]
                    n += 1
            op[i, j] = (r // n, g // n, b // n)
    return out


# ---------------------------------------------------------------------------
# Step 2: lift the figures off the viewer's panel


def panel_like(p):
    """Is this pixel the viewer's panel rather than part of a figure?

    Averaging the middle of each magnified block leaves the panel remarkably
    clean — every panel pixel on every sheet lands within about 4 units of
    PANEL, right up to the ones touching a figure, so there is no JPEG halo
    left to argue with and a tight radius is all this needs. It has to be
    tight: the figures' outline is a near-black too, only ~17 units away, and
    an earlier version of this test (dark, and blue at least as strong as red)
    said yes to roughly a third of the outline pixels. The flood fill poured
    through those holes and the sheets came out with the figures' edges chewed
    into a speckle.

    Only ever the fill's passability test, never a colour key — a dark blue
    inside a tunic would pass it and survives because the fill cannot reach it.
    """
    return sum((a - b) ** 2 for a, b in zip(p, PANEL)) < PANEL_TOL ** 2


def panel_rect(img):
    """The viewer's backdrop, without the rules it draws around it.

    Those rules are neither panel-coloured nor figure, so the flood fill will
    not pass through them and they would end up in the sheet as stray lines —
    one of them is a single row four pixels in from the bottom, which is
    exactly the kind of thing a fixed margin gets wrong in both directions.
    Finding the backdrop instead of guessing at its inset costs nothing: a rule
    runs the full width and holds no backdrop at all, while even the busiest
    row of figures leaves a third of itself showing.
    """
    w, h = img.size
    px = img.load()
    rows = [sum(1 for x in range(w) if px[x, y] == PANEL) > w * 0.2
            for y in range(h)]
    cols = [sum(1 for y in range(h) if px[x, y] == PANEL) > h * 0.2
            for x in range(w)]

    def longest(flags):
        best = (0, 0, 0)
        start = None
        for i, ok in enumerate(flags + [False]):
            if ok and start is None:
                start = i
            elif not ok and start is not None:
                if i - start > best[0]:
                    best = (i - start, start, i)
                start = None
        return best[1], best[2]

    x0, x1 = longest(cols)
    y0, y1 = longest(rows)
    return x0, y0, x1, y1


def cut_background(img):
    """RGB -> RGBA with the panel flooded out from the image border."""
    w, h = img.size
    src = img.load()
    out = img.convert('RGBA')
    op = out.load()
    bx0, by0, bx1, by1 = panel_rect(img)
    for y in range(h):
        for x in range(w):
            if not (bx0 <= x < bx1 and by0 <= y < by1):
                src[x, y] = PANEL
    seen = bytearray(w * h)
    stack = []
    for x in range(w):
        stack.append((x, 0))
        stack.append((x, h - 1))
    for y in range(h):
        stack.append((0, y))
        stack.append((w - 1, y))
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        i = y * w + x
        if seen[i]:
            continue
        if not panel_like(src[x, y]):
            continue
        seen[i] = 1
        op[x, y] = (0, 0, 0, 0)
        stack.append((x + 1, y))
        stack.append((x - 1, y))
        stack.append((x, y + 1))
        stack.append((x, y - 1))
    # Backdrop the fill could not reach: the triangle a shouldered scythe makes
    # with the arm below it is fenced in by the figure's own outline, and left
    # opaque it becomes a near-black blot inside the sprite. Safe to clear
    # outright at this point — every colour the artist used is further from
    # PANEL than PANEL_TOL, so the only thing this can match is backdrop.
    for y in range(h):
        for x in range(w):
            if op[x, y][3] and panel_like(src[x, y]):
                op[x, y] = (0, 0, 0, 0)
    return out


# ---------------------------------------------------------------------------
# Step 3: snap to a palette


def quantise(img):
    """Cluster the sheet to PALETTE_SIZE colours and snap every pixel to one.

    JPEG turns each of the artist's flat colours into a cloud a few units
    wide; this pulls each cloud back to a point, which is what makes the sheet
    look like pixel art again rather than like a photograph of some.
    """
    w, h = img.size
    px = img.load()
    pixels = [px[x, y][:3] for y in range(h) for x in range(w) if px[x, y][3]]
    if not pixels:
        return img
    # Seed from a median cut. Seeding from the most common colours instead does
    # not work: JPEG smears each flat colour into a cloud of near-duplicates, so
    # the top of the histogram is several dozen shades of the outline and the
    # tunic never gets a seed at all.
    strip = Image.new('RGB', (len(pixels), 1))
    strip.putdata(pixels)
    pal = strip.quantize(colors=PALETTE_SIZE, method=Image.Quantize.MEDIANCUT)
    raw = pal.getpalette()[:PALETTE_SIZE * 3]
    centres = [tuple(raw[i:i + 3]) for i in range(0, len(raw), 3)]
    for _ in range(12):
        sums = [[0, 0, 0, 0] for _ in centres]
        for p in pixels:
            k = min(range(len(centres)),
                    key=lambda i: sum((a - b) ** 2 for a, b in zip(p, centres[i])))
            s = sums[k]
            s[0] += p[0]
            s[1] += p[1]
            s[2] += p[2]
            s[3] += 1
        moved = False
        for i, s in enumerate(sums):
            if not s[3]:
                continue
            c = (s[0] // s[3], s[1] // s[3], s[2] // s[3])
            if c != centres[i]:
                centres[i] = c
                moved = True
        if not moved:
            break
    # Median cut spends slots where the pixels are, and most of a 16px figure
    # is outline — so it comes back with a dozen near-identical near-blacks and
    # nothing left over for the small bright areas. Fold any two centres closer
    # than PALETTE_MERGE together (by weight) and settle again; what survives is
    # about the count the artist actually drew with.
    while len(centres) > 1:
        pairs = [(sum((a - b) ** 2 for a, b in zip(centres[i], centres[j])), i, j)
                 for i in range(len(centres)) for j in range(i + 1, len(centres))]
        d, i, j = min(pairs)
        if d > PALETTE_MERGE ** 2:
            break
        counts = [0, 0]
        for p in pixels:
            k = min(range(len(centres)),
                    key=lambda n: sum((a - b) ** 2 for a, b in zip(p, centres[n])))
            if k == i:
                counts[0] += 1
            elif k == j:
                counts[1] += 1
        wi, wj = counts[0] + 1, counts[1] + 1
        centres[i] = tuple((centres[i][c] * wi + centres[j][c] * wj) // (wi + wj)
                           for c in range(3))
        centres.pop(j)
    cache = {}
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            if not p[3]:
                continue
            key = p[:3]
            if key not in cache:
                cache[key] = min(centres,
                                 key=lambda c: sum((a - b) ** 2 for a, b in zip(key, c)))
            px[x, y] = cache[key] + (255,)
    return img


def rgb_to_hsl(r, g, b):
    r, g, b = r / 255, g / 255, b / 255
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    if mx == mn:
        return 0.0, 0.0, l
    d = mx - mn
    s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
    if mx == r:
        hh = ((g - b) / d + (6 if g < b else 0))
    elif mx == g:
        hh = (b - r) / d + 2
    else:
        hh = (r - g) / d + 4
    return hh * 60, s, l


def recolour_audit(img):
    """Which of the sheet's colours js/assets.js `recolor` will move.

    The rule there is hue 175-260 and saturation over 0.2, so this reports the
    saturation of every blue on the sheet and which side of the line it falls.
    What you want to see is the tunics well clear of it — a civilian in their
    nation's colours is the whole point — and the steel ramp sitting where the
    soldier sheets' steel sits, since the two share a palette. Printed by
    --check so the claim is checked rather than asserted.
    """
    w, h = img.size
    px = img.load()
    tally = Counter()
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            if p[3]:
                tally[p[:3]] += 1
    out = []
    for c, n in tally.most_common():
        hue, s, _ = rgb_to_hsl(*c)
        if 175 <= hue <= 260:
            out.append((c, n, s, s > 0.2))
    return out


# ---------------------------------------------------------------------------
# Step 4: find the frame grid and cut the sheet


def content_bands(img, margin=3):
    """Rows and columns of the resampled sheet that hold figures."""
    w, h = img.size
    px = img.load()
    rows = []
    for y in range(h):
        n = 0
        if margin <= y < h - margin:
            n = sum(1 for x in range(margin, w - margin) if px[x, y][3])
        rows.append(n)

    def bands(v, floor):
        out = []
        start = None
        for i, n in enumerate(v):
            if n > floor and start is None:
                start = i
            elif n <= floor and start is not None:
                out.append((start, i - 1))
                start = None
        if start is not None:
            out.append((start, len(v) - 1))
        return out

    row_bands = [b for b in bands(rows, 1) if b[1] - b[0] >= 4]
    out = []
    for (y0, y1) in row_bands:
        cols = [sum(1 for y in range(y0, y1 + 1) if px[x, y][3])
                for x in range(w)]
        out.append(((y0, y1), [c for c in bands(cols, 0) if c[1] - c[0] >= 2]))
    return out


def grid_origin(img, bands):
    """Where frame (0,0) starts, in resampled pixels.

    Both axes are anchored on the same thing: the boots of the idle row, put
    where every MinifolksHumans sheet puts them, so a civilian stands on a
    tile exactly the way a swordsman does — feet on FOOT_ROW, and centred
    across the frame on FOOT_CENTRE. Nothing else on these sheets is a
    trustworthy landmark. A figure's outline is not centred in its own frame
    (every tool is carried out to the left, so the body sits right of centre
    to make room), and hunting for the gutter between frames instead only
    works while there is a tool to make the margins uneven: on the one sheet
    drawn without one, the idler, the gap either side is twenty blank columns
    and the least-ink phase is a coin toss anywhere inside it — which is
    precisely how that sheet, and only that sheet, came out a pixel wide of
    the other four.

    Frames are exactly UF apart, so one offset per axis places the whole
    sheet; the horizontal one is averaged over the idle row's frames, since a
    boot lands a pixel either way through the animation and the average splits
    that difference the same way for every sheet. Taking the median instead
    left each sheet on whichever of the two the tie-break happened to land on,
    and the five of them disagreed by a pixel.
    """
    px = img.load()
    (_, y1), cols = bands[0]
    y0 = y1 - FOOT_ROW
    offsets = []
    for i, (cx0, cx1) in enumerate(cols):
        feet = [x for x in range(cx0, cx1 + 1)
                for y in (y1 - 1, y1) if px[x, y][3]]
        if feet:
            centre = (min(feet) + max(feet)) / 2
            offsets.append(centre - FOOT_CENTRE - i * UF)
    x0 = math.floor(sum(offsets) / len(offsets) + 0.5) if offsets else 0
    return x0, y0


def frame_counts(img, x0, y0, rows):
    """Frames per row, counted off the grid rather than off bounding boxes.

    A detached tool head — the woodcutter's axe as he falls — puts a gap in
    the middle of a figure, and counting content bands would read that as two
    frames.
    """
    w, h = img.size
    px = img.load()
    counts = []
    for r in range(rows):
        n = 0
        for f in range((w - x0) // UF + 1):
            has = False
            for y in range(max(0, y0 + r * UF), min(h, y0 + (r + 1) * UF)):
                for x in range(max(0, x0 + f * UF), min(w, x0 + (f + 1) * UF)):
                    if px[x, y][3]:
                        has = True
                        break
                if has:
                    break
            if has:
                n = f + 1
        counts.append(n)
    return counts


def build_sheet(img, bands, synth_attack):
    x0, y0 = grid_origin(img, bands)
    counts = frame_counts(img, x0, y0, len(bands))
    rows = len(bands)
    if synth_attack:
        counts = counts[:2] + [counts[0]] + counts[2:]
        rows += 1
    out = Image.new('RGBA', (max(counts) * UF, rows * UF), (0, 0, 0, 0))
    src_row = 0
    for r in range(rows):
        if synth_attack and r == 2:
            src_row = 0              # the idler's stand-in work animation
        elif synth_attack and r > 2:
            src_row = r - 1
        else:
            src_row = r
        for f in range(counts[r]):
            box = (x0 + f * UF, y0 + src_row * UF,
                   x0 + (f + 1) * UF, y0 + (src_row + 1) * UF)
            frame = img.crop(box)
            out.paste(frame, (f * UF, r * UF))
    return out, counts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=os.environ.get('CIV_SRC', ''),
                    help='directory holding the design screenshots')
    ap.add_argument('--check', action='store_true',
                    help='report the recovered grid without writing PNGs')
    args = ap.parse_args()
    if not args.src:
        sys.exit('need --src DIR (the folder with the IMG_46xx screenshots)')

    for spec in SHEETS:
        matches = [f for f in os.listdir(args.src) if spec['src'] in f]
        if not matches:
            sys.exit('missing screenshot for ' + spec['src'])
        path = os.path.join(args.src, matches[0])
        img = resample(Image.open(path).convert('RGB'), spec['phase'])
        img = cut_background(img)
        img = quantise(img)
        bands = content_bands(img)
        sheet, counts = build_sheet(img, bands, spec.get('synth_attack', False))
        print('%-18s %s frames/row=%s' % (spec['out'], sheet.size, counts))
        if args.check:
            for c, n, s, moves in recolour_audit(sheet):
                print('      %-16s x%-5d sat %.2f  %s'
                      % (c, n, s, 'faction colour' if moves else 'stays steel'))
        else:
            sheet.save(os.path.join(DEST, spec['out']))


if __name__ == '__main__':
    main()
