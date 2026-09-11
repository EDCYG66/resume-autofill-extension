"""Renders the extension icon into the PNG sizes Chrome asks for.

Everything is drawn at 8x and downsampled with Lanczos, so the curves and the
hairline gaps between elements stay clean even at 16px.

This script is the build pipeline for icons/*.png. icons/icon.svg holds the same
artwork as a vector reference for docs and store listings; keep the two in step
if the design changes.

Run:  python tools/make_icons.py
"""
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'icons')

DESIGN = 128          # artwork is authored in a 128x128 space
SUPERSAMPLE = 8       # render scale before downsampling
SIZES = (128, 48, 32, 16)

# One hue family: the tile runs from a light tint of the accent to a deep shade,
# the field rows are a pale tint of the same blue, and the check is the accent.
TILE_TOP = (46, 155, 234)
TILE_BOTTOM = (0, 96, 180)
ACCENT = (0, 120, 212)
ROW_TINT = (169, 205, 238)
SHEET = (255, 255, 255)
SHADOW = (0, 49, 94)

# Geometry in design units.
TILE_RADIUS = 28
SHEET_BOX = (36, 27, 92, 101)      # x0, y0, x1, y1
SHEET_RADIUS = 9
ROWS = ((46, 41, 82, 47), (46, 52, 72, 58))
CHECK_POINTS = ((46, 82), (55, 90), (78, 67))
CHECK_WIDTH = 9


def scale_box(box, s):
    return tuple(round(v * s) for v in box)


def tile_mask(size, radius, s):
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=round(radius * s), fill=255)
    return mask


def vertical_gradient(size, top, bottom):
    grad = Image.new('RGB', (1, size))
    draw = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / max(size - 1, 1)
        draw.point((0, y), fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return grad.resize((size, size), Image.NEAREST)


def render(size):
    s = (size * SUPERSAMPLE) / DESIGN
    canvas = size * SUPERSAMPLE

    # Tile: gradient painted through a rounded-rect mask.
    icon = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    icon.paste(vertical_gradient(canvas, TILE_TOP, TILE_BOTTOM), (0, 0),
               tile_mask(canvas, TILE_RADIUS, s))

    # Soft shadow under the sheet, clipped back to the tile so it never leaks out.
    shadow = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    offset = round(2 * s)
    ImageDraw.Draw(shadow).rounded_rectangle(
        scale_box((SHEET_BOX[0], SHEET_BOX[1] + 2, SHEET_BOX[2], SHEET_BOX[3] + 2), s),
        radius=round(SHEET_RADIUS * s), fill=SHADOW + (110,))
    shadow = shadow.filter(ImageFilter.GaussianBlur(round(3 * s)))
    shadow.putalpha(Image.composite(shadow.getchannel('A'),
                                    Image.new('L', (canvas, canvas), 0),
                                    tile_mask(canvas, TILE_RADIUS, s)))
    icon = Image.alpha_composite(icon, shadow)
    icon = Image.alpha_composite(icon, Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0)))
    # Re-apply the tile alpha so the blur cannot soften the tile's own edge.
    icon.putalpha(Image.composite(icon.getchannel('A'),
                                  Image.new('L', (canvas, canvas), 0),
                                  tile_mask(canvas, TILE_RADIUS, s)))

    draw = ImageDraw.Draw(icon)
    draw.rounded_rectangle(scale_box(SHEET_BOX, s), radius=round(SHEET_RADIUS * s), fill=SHEET)
    for row in ROWS:
        draw.rounded_rectangle(scale_box(row, s), radius=round(3 * s), fill=ROW_TINT)

    # Check mark: stroked polyline plus round caps at both ends.
    points = [(round(x * s), round(y * s)) for x, y in CHECK_POINTS]
    width = max(1, round(CHECK_WIDTH * s))
    draw.line(points, fill=ACCENT, width=width, joint='curve')
    for x, y in (points[0], points[-1]):
        half = width / 2
        draw.ellipse((x - half, y - half, x + half, y + half), fill=ACCENT)

    return icon.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUT_DIR, 'icon-%d.png' % size)
        render(size).save(path, 'PNG')
        print('rendered icons/icon-%d.png' % size)


if __name__ == '__main__':
    main()
