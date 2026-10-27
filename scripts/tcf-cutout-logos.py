"""Cut the site's art out of the event poster: the presenter and sponsor logo strips
onto transparency, plus the hero, share and poster images.

    python scripts/tcf-cutout-logos.py <poster image> public/tcf

Boxes are in the coordinates of the 1334 x 2000 poster (updated 2026-10-27: Hotel
Sogo joined the presenters, a top sponsor tier and two more rows were added).

The logos are bright or saturated; the poster ground behind them (rocks, night sky)
is dark and dull. A pixel's "logo-ness" is max(luminance, saturation x value); that
gives a soft alpha. Large holes inside a logo (a badge's dark face ringed by a bright
outline) are filled back in; small holes (the counters of letters) stay transparent.
"""
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = sys.argv[1]
OUT_DIR = sys.argv[2]
poster = Image.open(SRC).convert("RGB")


LOGOS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tcf-logos")


def logo_alpha(a, lo, hi):
    """Soft alpha for bright or saturated ink on a dark ground (a: float RGB in 0..1)."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    score = np.maximum(lum, sat * mx * 0.95)
    return np.clip((score - lo) / (hi - lo), 0, 1)


def paste_logo(rgb, alpha, file, box, scale, disc=None, fill=False, lo=0.12, hi=0.35, speck=0, whole=False, core=0):
    """Replace a logo the poster renders too small to cut cleanly with the sponsor's own
    file (dark ground, in scripts/tcf-logos): clear the box, then fit the clean mark into it.
    whole=True pastes the file as the full rectangle it is, nothing cut away (a logo whose
    background is part of the design). A round badge passes disc=(cx, cy, r) in file pixels and is kept whole, dark face and all;
    a badge with a bright outline of another shape passes fill=True to keep its face. Raise
    lo/hi when the file's ground is a busy photo rather than plain black, and set speck (file
    pixels) to drop the bits of that photo that still get through."""
    x0, y0, x1, y1 = [v * scale for v in box]
    pad = 8 * scale  # the poster's version bleeds a few pixels past its ink
    alpha[max(0, y0 - pad):y1 + pad, max(0, x0 - pad):x1 + pad] = 0
    src = Image.open(os.path.join(LOGOS, file)).convert("RGB")
    if whole:
        sa = np.ones((src.height, src.width))
    elif disc:
        cx, cy, r = disc
        yy, xx = np.mgrid[0:src.height, 0:src.width]
        sa = np.clip(r - np.hypot(xx - cx, yy - cy) + 0.5, 0, 1)
    else:
        sa = logo_alpha(np.asarray(src).astype(np.float32) / 255.0, lo, hi)
        # Drop stray marks along the file's edges (screenshot corners): the mark itself never
        # touches the border, and they would otherwise show and widen the fit.
        lab, n = ndimage.label(sa > 0.15)
        edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        sa = np.where(np.isin(lab, edge[edge > 0]), 0, sa)
        if speck and n:
            sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
            sa = np.where(np.isin(lab, np.nonzero(sizes < speck)[0] + 1), 0, sa)
        # Keep soft edges only where they hug a surviving mark; faint haze elsewhere goes.
        sa = np.where(ndimage.binary_dilation(sa > 0.15, iterations=2), sa, 0)
        if fill:
            sa = np.where(ndimage.binary_fill_holes(sa > 0.5), 1.0, sa)
    ys, xs = np.nonzero(sa > 0.05)
    fx0, fy0, fx1, fy1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    if core:
        # Size by the main body only (pieces of at least `core` file pixels) and let small
        # decoration around it (JOMS TV's sparks) spill a little past the box.
        lab, n = ndimage.label(sa > 0.5)
        sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
        cy, cx = np.nonzero(np.isin(lab, np.nonzero(sizes >= core)[0] + 1))
        bx0, by0, bx1, by1 = cx.min(), cy.min(), cx.max() + 1, cy.max() + 1
    else:
        bx0, by0, bx1, by1 = fx0, fy0, fx1, fy1
    k = min((x1 - x0) / (bx1 - bx0), (y1 - y0) / (by1 - by0))
    src = src.crop((fx0, fy0, fx1, fy1))
    sa = sa[fy0:fy1, fx0:fx1]
    w, h = round(src.width * k), round(src.height * k)
    src = np.asarray(src.resize((w, h), Image.LANCZOS)).astype(np.float32)
    sa = np.asarray(Image.fromarray((sa * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)) / 255.0
    # Centre the sizing body in the box, then clip whatever spills off the strip.
    px = x0 + (x1 - x0 - round((bx1 - bx0) * k)) // 2 - round((bx0 - fx0) * k)
    py = y0 + (y1 - y0 - round((by1 - by0) * k)) // 2 - round((by0 - fy0) * k)
    H, W = alpha.shape
    sx0, sy0 = max(0, -px), max(0, -py)
    dx0, dy0, dx1, dy1 = max(0, px), max(0, py), min(W, px + w), min(H, py + h)
    src, sa = src[sy0:sy0 + dy1 - dy0, sx0:sx0 + dx1 - dx0], sa[sy0:sy0 + dy1 - dy0, sx0:sx0 + dx1 - dx0]
    # Blend rather than overwrite, so a spill never clips a neighbouring logo.
    # Where nothing shows underneath, the logo's own colour is used as is (no dark fringe).
    region = rgb[dy0:dy1, dx0:dx1].astype(np.float32)
    mix = np.where(alpha[dy0:dy1, dx0:dx1] > 0.05, sa, 1.0)[..., None]
    rgb[dy0:dy1, dx0:dx1] = (src * mix + region * (1 - mix)).astype(np.uint8)
    alpha[dy0:dy1, dx0:dx1] = np.maximum(alpha[dy0:dy1, dx0:dx1], sa)


def cutout(box, name, lo=0.30, hi=0.52, min_hole=900, scale=2, speck=60, rocks=None, erase=(), max_width=None, logos=()):
    img = poster.crop(box)
    img = img.resize((img.width * scale, img.height * scale), Image.LANCZOS)
    a = np.asarray(img).astype(np.float32) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    alpha = logo_alpha(a, lo, hi)
    if rocks:
        # Sunlit orange rock in this corner of the poster: warm, saturated, not white.
        x0, y0, x1, y1 = [v * scale for v in rocks]
        warm = (r > g) & (g > b) & (sat > 0.3) & (mn < 0.6)
        zone = np.zeros_like(warm); zone[y0:y1, x0:x1] = True
        alpha = np.where(warm & zone, 0, alpha)
        # The logos in that corner (DNIS, Miguelikot) are near-white; keep only bright ink there.
        alpha = np.where(zone, np.minimum(alpha, np.clip((lum - 0.45) / 0.15, 0, 1)), alpha)

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
        # Sparks of lit rock along the top band: tiny components above the logo rows.
        if rocks:
            cy = ndimage.center_of_mass(np.ones_like(lab), lab, np.arange(1, n + 1))
            gr = ndimage.mean(g / np.maximum(r, 1e-3), lab, np.arange(1, n + 1))
            # A spark is small, high up and orange; the yellow RC Pinas star (green close to red) is kept.
            sparks = [i + 1 for i, (c, sz, q) in enumerate(zip(cy, sizes, gr)) if c[0] < 60 * scale and ((sz < 90 * scale * scale and q < 0.78) or sz < 25 * scale * scale)]
            keep &= ~np.isin(lab, sparks)
            # Faint smudges of rock never reach a solid core; every logo does.
            peak = ndimage.maximum(alpha, lab, np.arange(1, n + 1))
            keep &= ~np.isin(lab, [i + 1 for i, pk in enumerate(peak) if pk < 0.7])
        alpha = np.where(keep, alpha, 0)

    # Hand-picked leftovers of poster art next to the logos (crop coordinates).
    for x0, y0, x1, y1 in erase:
        alpha[y0 * scale:y1 * scale, x0 * scale:x1 * scale] = 0

    alpha = ndimage.gaussian_filter(alpha, 0.6)
    rgb = np.array(img)
    for file, lbox, *opts in logos:
        paste_logo(rgb, alpha, file, lbox, scale, **(opts[0] if opts else {}))
    # Trim to the logos' own bounds.
    ys, xs = np.nonzero(alpha > 0.05)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    pad = 6 * scale
    y0, x0 = max(0, y0 - pad), max(0, x0 - pad)
    y1, x1 = min(alpha.shape[0], y1 + pad), min(alpha.shape[1], x1 + pad)
    rgba = np.dstack([rgb, (alpha * 255).astype(np.uint8)])[y0:y1, x0:x1]
    out = Image.fromarray(rgba, "RGBA")
    # About twice the widest the page shows it, then a 256-colour palette: a tenth of the bytes.
    if max_width and out.width > max_width:
        out = out.resize((max_width, round(out.height * max_width / out.width)), Image.LANCZOS)
    # The palette averages alpha too, which left solid panels (Blue Lithium) a little see-through:
    # snap near-solid pixels to solid first, then put any near-solid palette entry back to 255.
    px = np.array(out)
    px[..., 3] = np.where(px[..., 3] >= 216, 255, np.where(px[..., 3] <= 10, 0, px[..., 3]))
    out = Image.fromarray(px, "RGBA").quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    pal = out.getpalette(rawmode="RGBA")
    pal[3::4] = [255 if v >= 216 else v for v in pal[3::4]]
    out.putpalette(pal, rawmode="RGBA")
    out.save(f"{OUT_DIR}/{name}.png", optimize=True)
    print(name, out.size)


def crop(box, name, size=None, quality=86):
    img = poster.crop(box)
    if size:
        img = img.resize(size, Image.LANCZOS)
    img.save(f"{OUT_DIR}/{name}.jpg", quality=quality, optimize=True, progressive=True)
    print(name, img.size)


# Presenters: Hotel Sogo, 2S06, NoInvite, RCX.
# The title's mountain peak pokes in under the RCX mark.
cutout((255, 88, 1105, 214), "presented-by", lo=0.2, hi=0.42, min_hole=400, speck=4, erase=[(765, 98, 850, 126)], max_width=1400)
# Sponsors: the Mudace / Platinum / Blue Lithium tier and three rows under it. Lit rock
# sits behind the top tier's right side.
cutout((40, 1550, 1320, 1972), "sponsors", lo=0.22, hi=0.42, min_hole=500, speck=12, rocks=(1000, 0, 1280, 185), erase=[(765, 0, 792, 20), (935, 0, 965, 26)], max_width=2000,
       logos=[
           ("mclicks.png", (6, 183, 204, 229)),  # thin tagline and rules break up at poster size
           # Round badges: their dark (RC Pinas) or white (Markado) face is lost to the cut-out.
           ("rcpinas.png", (720, 147, 830, 257), {"disc": (109.5, 108, 100)}),
           ("markado.png", (842, 157, 939, 254), {"disc": (106, 108.5, 85)}),
           # Top tier: Mudace's hexagon face (trees, jeep) and Platinum's thin rules and flag.
           ("mudace.png", (316, 7, 437, 151), {"fill": True}),
           ("platinum.png", (461, 24, 772, 122), {"lo": 0.3, "hi": 0.5, "speck": 60}),
           # Blue Lithium is a lit panel: the sponsor wants it in full, background and all.
           ("blue-lithium.png", (795, 26, 1001, 131), {"whole": True}),
           # Second row: Jlow Fitment keeps the black inside its outline; DNIS and
           # Miguelikot sit on textured grounds in their files.
           ("jlow-fitment.png", (222, 170, 350, 241), {"fill": True}),
           ("lfg.png", (371, 188, 501, 226)),
           ("nocturnal.png", (529, 165, 598, 240)),
           ("dnis.png", (967, 186, 1100, 234), {"lo": 0.3, "hi": 0.5, "speck": 30}),
           ("miguelikot.png", (1109, 187, 1263, 235), {"lo": 0.3, "hi": 0.5, "speck": 30}),
           # Third row. No Limits is a light panel, so it goes in whole.
           ("cheeeky-minute.png", (20, 260, 147, 319), {"lo": 0.3, "hi": 0.5, "speck": 15}),
           ("dailyuse.png", (172, 278, 313, 307)),
           ("ah.png", (340, 269, 417, 317)),
           ("knsei.png", (434, 284, 543, 313)),
           ("honda-nerd.png", (562, 284, 693, 324)),
           ("giorno-crew.png", (709, 275, 798, 332)),
           ("no-limits.png", (815, 279, 973, 336), {"whole": True}),
           ("syndicate-customs.png", (991, 270, 1118, 332)),
           ("fnf.png", (1134, 283, 1268, 325)),
           ("talembang.png", (626, 147, 705, 254), {"fill": True}),
           # Bottom row, on the poster's checkered band. hotcakes and AutoSlot are panels.
           ("tambay-nights.png", (156, 365, 358, 403), {"lo": 0.3, "hi": 0.5, "speck": 20}),
           ("joms-tv.png", (381, 353, 431, 418), {"core": 300}),
           ("acclings.png", (450, 368, 582, 406)),
           ("upstrm.png", (610, 363, 728, 406), {"lo": 0.3, "hi": 0.5, "speck": 20}),
           ("hotcakes.png", (739, 363, 932, 417), {"whole": True}),
           ("autoslot.png", (941, 363, 1085, 415), {"whole": True}),
       ])

crop((0, 0, 1334, 720), "hero-title")               # presenters, title lockup and tagline
crop((0, 700, 1334, 1258), "hero-track")            # the circuit scene under the title
crop((0, 600, 1334, 1300), "share", size=(1200, 630))
crop((0, 0, poster.width, poster.height), "poster", quality=88)
