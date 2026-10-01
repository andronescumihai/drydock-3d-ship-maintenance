"""
Bake the two small raster images the HUD animations draw from.

  public/art/veil-blueprint.png   the plan the left-column dither veil reveals
  public/art/disclaimer-tag.png   the "modeled sample vessel" tag in the corner

Both are drawn from scratch here (no third-party imagery) using the fonts the
app already ships (Inter and JetBrains Mono via Fontsource, OFL-1.1), so the
tag reads in the same type as the rest of the interface.

    python3 scripts/art/make_hud_art.py

Needs Pillow and fontTools with brotli (to read the .woff2 fonts).
"""

from __future__ import annotations

import io
import math
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "art"
FONTS = ROOT / "node_modules" / "@fontsource-variable"

INK = (7, 12, 20)
CYAN = (56, 214, 242)
AMBER = (242, 169, 59)


def load_font(family: str, file: str, size: int, weight: int) -> ImageFont.FreeTypeFont:
    """Decompress a Fontsource variable .woff2 and pin its weight axis."""
    ttf = TTFont(FONTS / family / "files" / file)
    ttf.flavor = None
    buffer = io.BytesIO()
    ttf.save(buffer)
    buffer.seek(0)
    font = ImageFont.truetype(buffer, size)
    try:
        font.set_variation_by_axes([weight])
    except OSError:
        pass  # FreeType without variation support: the default instance is fine
    return font


def mono(size: int, weight: int = 500) -> ImageFont.FreeTypeFont:
    return load_font("jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2", size, weight)


def sans(size: int, weight: int = 450) -> ImageFont.FreeTypeFont:
    return load_font("inter", "inter-latin-wght-normal.woff2", size, weight)


def tracked(draw: ImageDraw.ImageDraw, xy, text, font, fill, tracking: float) -> float:
    """Draw text with letter spacing; returns the end x."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking
    return x


# ---------------------------------------------------------------------------
# Blueprint (portrait: bow up, as the column is tall and narrow)
# ---------------------------------------------------------------------------


def hull_half_width(t: float, beam: float) -> float:
    """Half breadth along the length, t = 0 at the transom, 1 at the stem."""
    if t < 0.08:
        return beam * (0.78 + 0.22 * (t / 0.08) ** 0.5)
    if t < 0.62:
        return beam
    u = (t - 0.62) / 0.38
    return beam * math.cos(u * math.pi / 2) ** 0.85


def blueprint(width: int = 640, height: int = 1600, ss: int = 2) -> Image.Image:
    W, H = width * ss, height * ss
    base = Image.new("RGB", (W, H), (6, 16, 26))
    grid = ImageDraw.Draw(base)
    minor, major = 16 * ss, 80 * ss
    for x in range(0, W, minor):
        grid.line([(x, 0), (x, H)], fill=(18, 58, 76) if x % major == 0 else (11, 32, 44), width=ss)
    for y in range(0, H, minor):
        grid.line([(0, y), (W, y)], fill=(18, 58, 76) if y % major == 0 else (11, 32, 44), width=ss)

    lines = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(lines)
    cx = W / 2
    top, bottom = 140 * ss, 1080 * ss
    beam = 150 * ss

    def pt(t: float, side: int) -> tuple[float, float]:
        return cx + side * hull_half_width(t, beam), bottom - t * (bottom - top)

    steps = 160
    outline = [pt(i / steps, 1) for i in range(steps + 1)] + [pt(1 - i / steps, -1) for i in range(steps + 1)]
    outline.append(outline[0])
    d.line(outline, fill=CYAN, width=3 * ss, joint="curve")
    # Deck edge inboard of the shell, and the centreline.
    inner = [(cx + (x - cx) * 0.9, y) for x, y in outline]
    d.line(inner, fill=(30, 130, 160), width=ss)
    for y in range(int(top - 40 * ss), int(bottom + 40 * ss), 18 * ss):
        d.line([(cx, y), (cx, y + 10 * ss)], fill=(40, 150, 180), width=ss)

    # Bulkheads with frame numbers.
    label = mono(11 * ss, 500)
    for i, t in enumerate([0.1, 0.24, 0.38, 0.52, 0.66, 0.8]):
        x0, y = pt(t, -1)
        x1, _ = pt(t, 1)
        d.line([(x0, y), (x1, y)], fill=(44, 170, 200), width=2 * ss)
        tracked(d, (x1 + 14 * ss, y - 8 * ss), f"FR {12 + i * 14}", label, (70, 190, 215), 1.5 * ss)

    # Machinery footprints in the engine room.
    for (fx, fy, fw, fh) in [(-60, 0.16, 120, 70), (-110, 0.3, 70, 40), (40, 0.3, 70, 40), (-30, 0.44, 60, 50)]:
        x = cx + fx * ss
        y = bottom - fy * (bottom - top)
        d.rounded_rectangle([x, y - fh * ss, x + fw * ss, y], radius=6 * ss, outline=AMBER, width=2 * ss)
        d.line([(x, y - fh * ss), (x + fw * ss, y)], fill=(150, 104, 36), width=ss)

    # Body plan at the foot of the sheet.
    by = 1330 * ss
    for k in range(7):
        s = 1 - k * 0.12
        pts = []
        for i in range(41):
            a = math.pi * i / 40
            pts.append((cx + math.cos(a) * 170 * ss * s, by + math.sin(a) ** 1.6 * 120 * ss * (0.6 + 0.4 * s)))
        d.line(pts, fill=CYAN if k == 0 else (36, 140, 170), width=(2 if k == 0 else 1) * ss)
    d.line([(cx - 200 * ss, by), (cx + 200 * ss, by)], fill=(40, 150, 180), width=ss)

    # Dimension line along the length.
    dx = cx - beam - 60 * ss
    d.line([(dx, top), (dx, bottom)], fill=(70, 190, 215), width=ss)
    for y in (top, bottom):
        d.line([(dx - 8 * ss, y), (dx + 8 * ss, y)], fill=(70, 190, 215), width=ss)
    tracked(d, (dx - 18 * ss, (top + bottom) / 2), "LOA", label, (70, 190, 215), 2 * ss)

    # Title block.
    tb = 1500 * ss
    d.rectangle([40 * ss, tb, W - 40 * ss, tb + 70 * ss], outline=(44, 170, 200), width=ss)
    tracked(d, (56 * ss, tb + 14 * ss), "DRYDOCK · GENERAL ARRANGEMENT", mono(15 * ss, 700), CYAN, 2.5 * ss)
    tracked(d, (56 * ss, tb + 40 * ss), "MODELED SAMPLE VESSEL · NOT TO SCALE", label, (70, 190, 215), 2 * ss)

    # Lines over the grid, plus a soft bloom so the reveal reads as lit.
    glow = lines.filter(ImageFilter.GaussianBlur(6 * ss)).point(lambda v: int(v * 0.8))
    out = Image.composite(lines, base, lines.convert("L").point(lambda v: 255 if v > 8 else 0))
    out = ImageChops.add(out, glow)
    return out.resize((width, height), Image.LANCZOS)


# ---------------------------------------------------------------------------
# Disclaimer tag (a maintenance tag: hazard band, grommet, three lines of type)
# ---------------------------------------------------------------------------


def disclaimer_tag(width: int = 1520, height: int = 440) -> Image.Image:
    img = Image.new("RGB", (width, height), (239, 231, 214))
    d = ImageDraw.Draw(img)
    band = 250
    # Hazard stripes.
    stripes = Image.new("RGB", (band, height), (27, 31, 39))
    sd = ImageDraw.Draw(stripes)
    for x in range(-height, band + height, 64):
        sd.polygon([(x, height), (x + 32, height), (x + 32 + height, 0), (x + height, 0)], fill=AMBER)
    img.paste(stripes, (0, 0))
    # Reinforced punch hole.
    gx, gy, r = band / 2, height / 2, 46
    d.ellipse([gx - r - 18, gy - r - 18, gx + r + 18, gy + r + 18], fill=(210, 200, 182), outline=(120, 112, 98), width=4)
    d.ellipse([gx - r, gy - r, gx + r, gy + r], fill=(24, 28, 36))
    d.line([(band, 0), (band, height)], fill=(27, 31, 39), width=6)
    # Inset keyline.
    d.rectangle([band + 22, 22, width - 22, height - 22], outline=(190, 178, 156), width=3)

    x = band + 60
    # The latin subset of the mono face has no ▲, so the warning mark is drawn.
    d.polygon([(x, 128), (x + 27, 76), (x + 54, 128)], fill=(27, 31, 39))
    tracked(d, (x + 80, 58), "MODELED SAMPLE VESSEL", mono(70, 800), (27, 31, 39), 5)
    tracked(d, (x + 2, 160), "SIMULATION · NOT A REAL SHIP", mono(46, 600), (170, 98, 0), 6)
    body = sans(44, 480)
    d.text((x + 2, 246), "The analysis engine is real;", font=body, fill=(58, 63, 74))
    d.text((x + 2, 306), "the vessel data is a documented model.", font=body, fill=(58, 63, 74))
    tracked(d, (width - 250, height - 64), "DD-TAG 001", mono(26, 500), (140, 130, 112), 4)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    blueprint().save(OUT / "veil-blueprint.png", optimize=True)
    disclaimer_tag().save(OUT / "disclaimer-tag.png", optimize=True)
    for name in ("veil-blueprint.png", "disclaimer-tag.png"):
        print(name, (OUT / name).stat().st_size // 1024, "KiB")


if __name__ == "__main__":
    main()
