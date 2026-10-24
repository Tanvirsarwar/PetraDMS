"""Draws the PetraDMS app icon (the BrandMark: red square, cream border, cream P) and writes build/icon.png and build/icon.ico.
Run: python3 tools/icons/make_icons.py   (needs Pillow). The outputs are committed, so CI never needs Python."""
import os, struct, io
from PIL import Image, ImageDraw

RED = (200, 32, 47, 255)
CREAM = (246, 241, 231, 255)
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'apps', 'desktop', 'build')

def draw(size: int) -> Image.Image:
    s = 8  # supersample for clean edges
    n = size * s
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    u = n / 40.0
    d.rectangle([1.5 * u, 1.5 * u, 38.5 * u, 38.5 * u], fill=RED, outline=CREAM, width=max(1, round(1.5 * u)))
    w = round(3.2 * u)
    # the P: stem 12,31 -> 12,9; bowl from 12,9 to 21.5,9, arc radius 6.5, back to 12,22
    d.line([(12 * u, 31 * u), (12 * u, 9 * u)], fill=CREAM, width=w)
    d.line([(12 * u - w / 2, 9 * u), (21.5 * u + 1, 9 * u)], fill=CREAM, width=w)
    d.arc([(21.5 - 6.5) * u - w / 2, 9 * u - w / 2, (21.5 + 6.5) * u + w / 2, 22 * u + w / 2], -90, 90, fill=CREAM, width=w)
    d.line([(21.5 * u + 1, 22 * u), (12 * u - w / 2, 22 * u)], fill=CREAM, width=w)
    return im.resize((size, size), Image.LANCZOS)

os.makedirs(OUT, exist_ok=True)
draw(512).save(os.path.join(OUT, 'icon.png'))
sizes = [16, 24, 32, 48, 64, 128, 256]
pngs = []
for sz in sizes:
    b = io.BytesIO()
    draw(sz).save(b, 'PNG')
    pngs.append(b.getvalue())
# ICO with PNG-compressed entries (supported by Windows Vista and later)
head = struct.pack('<HHH', 0, 1, len(sizes))
offset = 6 + 16 * len(sizes)
entries, body = b'', b''
for sz, data in zip(sizes, pngs):
    entries += struct.pack('<BBBBHHII', 0 if sz >= 256 else sz, 0 if sz >= 256 else sz, 0, 0, 1, 32, len(data), offset + len(body))
    body += data
open(os.path.join(OUT, 'icon.ico'), 'wb').write(head + entries + body)
print('icons written')
