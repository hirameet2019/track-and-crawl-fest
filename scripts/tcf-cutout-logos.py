"""Cut the presenter and sponsor logo strips out of the poster onto transparency.

The logos are bright or saturated; the poster ground behind them (rocks, night sky)
is dark and dull. A pixel's "logo-ness" is max(luminance, saturation x value); that
gives a soft alpha. Large holes inside a logo (a badge's dark face ringed by a bright
outline) are filled back in; small holes (the counters of letters) stay transparent.
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = sys.argv[1]
OUT_DIR = sys.argv[2]
poster = Image.open(SRC).convert("RGB")


def cutout(box, name, lo=0.30, hi=0.52, min_hole=900, scale=2, speck=60, rocks=None):
    img = poster.crop(box)
    img = img.resize((img.width * scale, img.height * scale), Image.LANCZOS)
    a = np.asarray(img).astype(np.float32) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    score = np.maximum(lum, sat * mx * 0.95)
    alpha = np.clip((score - lo) / (hi - lo), 0, 1)
    if rocks:
        # Sunlit orange rock in this corner of the poster: warm, saturated, not white.
        x0, y0, x1, y1 = [v * scale for v in rocks]
        warm = (r > g) & (g > b) & (sat > 0.3) & (mn < 0.6)
        zone = np.zeros_like(warm); zone[y0:y1, x0:x1] = True
        alpha = np.where(warm & zone, 0, alpha)

    # Fill big enclosed holes (badge faces); leave letter counters open.
    solid = alpha > 0.5
    filled = ndimage.binary_fill_holes(solid)
    holes, n = ndimage.label(filled & ~solid)
    if n:
        sizes = ndimage.sum(np.ones_like(holes), holes, index=np.arange(1, n + 1))
        big = np.isin(holes, np.nonzero(sizes >= min_hole * scale * scale)[0] + 1)
        alpha = np.where(big, 1.0, alpha)

    # Drop specks: components smaller than a few dozen pixels are rock texture.
    lab, n = ndimage.label(alpha > 0.15)
    if n:
        sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
        keep = np.isin(lab, np.nonzero(sizes >= speck * scale * scale)[0] + 1)
        # Sunlit rock streaks run in from the crop's top edge; no logo touches it.
        top = np.unique(lab[0][lab[0] > 0])
        keep &= ~np.isin(lab, top)
        alpha = np.where(keep, alpha, 0)

    alpha = ndimage.gaussian_filter(alpha, 0.6)
    # Trim to the logos' own bounds.
    ys, xs = np.nonzero(alpha > 0.05)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    pad = 6 * scale
    y0, x0 = max(0, y0 - pad), max(0, x0 - pad)
    y1, x1 = min(alpha.shape[0], y1 + pad), min(alpha.shape[1], x1 + pad)
    rgba = np.dstack([np.asarray(img), (alpha * 255).astype(np.uint8)])[y0:y1, x0:x1]
    out = Image.fromarray(rgba, "RGBA")
    out.save(f"{OUT_DIR}/{name}.png", optimize=True)
    print(name, out.size)


cutout((425, 95, 1125, 232), "presented-by", lo=0.2, hi=0.42, min_hole=400, speck=4)
cutout((30, 1715, 1460, 1985), "sponsors", lo=0.30, hi=0.52, min_hole=500, rocks=(980, 0, 1430, 120))
