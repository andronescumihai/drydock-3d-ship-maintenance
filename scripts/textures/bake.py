"""Bakes DryDock's tileable PBR texture sets.

Output (public/textures/*.webp), three maps per set:
  <set>_normal.webp  OpenGL tangent-space normal (RGB)
  <set>_orm.webp     R = cavity AO, G = relative roughness (0.5 = material value),
                     B = albedo detail (multiplies the paint colour)
  <set>_wear.webp    R = rust, G = grime, B = chipped paint / bare spots

Physical tile sizes (metres) are recorded in textures.json and read by the app.
Everything is generated from seeded noise: fully reproducible, no external
assets, CC0 by construction.
"""
import json, os, sys, time
import numpy as np
from texlib import *

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
os.makedirs(OUT, exist_ok=True)
manifest = {}
t0 = time.time()


def emit(name, tile_m, normal, orm, wear, extra_1k=False):
    save_rgb(f'{OUT}/{name}_normal.webp', normal, quality=94)
    save_rgb(f'{OUT}/{name}_orm.webp', orm, quality=90)
    save_rgb(f'{OUT}/{name}_wear.webp', wear, quality=88)
    manifest[name] = {'tile': tile_m, 'size': normal.shape[0]}
    if extra_1k:
        save_rgb(f'{OUT}/{name}_normal_1k.webp', downsample(normal), quality=94)
        save_rgb(f'{OUT}/{name}_orm_1k.webp', downsample(orm), quality=90)
        save_rgb(f'{OUT}/{name}_wear_1k.webp', downsample(wear), quality=88)
    print(f'{name}: done at {time.time() - t0:.1f}s', flush=True)


def seam_distance(coord, positions, period):
    """Distance (px) from each coordinate to the nearest seam, periodic."""
    d = np.full(coord.shape, 1e9, F32)
    for p in positions:
        a = np.abs(coord - p) % period
        d = np.minimum(d, np.minimum(a, period - a))
    return d


# ---------------------------------------------------------------------------
# HULL / BULKHEAD PLATING — 9.6 m tile, 2048 px (4.7 mm/px)
# ---------------------------------------------------------------------------
def bake_hull():
    n, tile = 2048, 9.6
    px = tile / n
    rows, cols = np.mgrid[0:n, 0:n].astype(F32)
    strake_h = n // 4                       # 2.4 m strakes
    plate_l = n // 2                        # 4.8 m plates
    frame = int(round(0.6 / px))            # 0.6 m frame spacing -> 128 px
    strake = (rows // strake_h).astype(int)
    offsets = np.array([0, 383, 701, 214])
    butt_off = offsets[strake]

    # Seam distances: horizontal (strake edges) and vertical (plate butts).
    d_h = seam_distance(rows, [0], strake_h)
    d_v = seam_distance(cols - butt_off, [0], plate_l)
    d_seam = np.minimum(d_h, d_v) * px            # metres

    # Weld bead with a rippled crown, and the shallow pull-down beside it.
    ripple = 1 + 0.35 * spectral(n, 1.0, 11, fmin=300)
    bead = 0.0016 * np.exp(-(d_seam / 0.007) ** 2) * ripple
    pull = -0.0007 * np.exp(-(d_seam / 0.05) ** 2)

    # "Hungry horse" dishing between frames: every panel sags a little.
    fx = (cols % frame) / frame
    ry = (rows % strake_h) / strake_h
    panel_id = (cols // frame).astype(int) * 7 + strake * 131
    panel_rand = rng(5).uniform(0.35, 1.25, panel_id.max() + 1).astype(F32)[panel_id]
    dish = -0.0026 * panel_rand * np.sin(np.pi * fx) ** 2 * np.sin(np.pi * ry) ** 0.6

    # Paint: roller texture + orange peel + slight film-build variation.
    roller = spectral(n, 2.0, 12, fmin=40, aniso=(1.0, 3.0)) * 0.00006
    peel = spectral(n, 1.2, 13, fmin=250) * 0.00003
    film = spectral(n, 3.2, 14, fmin=2) * 0.0002

    # Chips: small flakes, more likely near welds and on lower strakes.
    chip_noise = spectral(n, 1.6, 15, fmin=60)
    chip_bias = np.exp(-(d_seam / 0.08) ** 2) * 0.9 + 0.12 * spectral(n, 3.0, 16, fmin=2)
    chips = sstep(2.55, 2.85, chip_noise + chip_bias * 1.3)
    chips = np.clip(chips, 0, 1)
    chip_depth = -0.00025 * blur(chips, 0.7)

    height = bead + pull + dish + roller + peel + film + chip_depth
    normal = normal_map(height, px)

    # Rust: sources on welds and on chips, running down the plate.
    r = rng(17)
    src = np.zeros((n, n), F32)
    weld_line = (d_seam < 0.012).astype(F32)
    src += weld_line * (r.random((n, n)) < 0.003) * r.uniform(0.3, 1, (n, n)).astype(F32)
    src += chips * (r.random((n, n)) < 0.04)
    point_src = (r.random((n, n)) < 0.00003).astype(F32)
    src = np.maximum(src, blur(point_src, 1.5) * 25)
    src = np.clip(blur(src, 0.8) * 2.5, 0, 1)
    streak = streaks_down(src, 0.991, 18)
    streak = blur_dir(streak, 1.2, 3.0)
    breakup = norm01(spectral(n, 2.0, 19, fmin=20, aniso=(1.0, 0.25)))
    rust = np.clip(streak * (0.2 + 0.9 * breakup) * sstep(0.35, 0.75, norm01(spectral(n, 3.0, 27, fmin=1))), 0, 1)
    rust = np.maximum(rust, blur(chips, 1.2) * 0.9)
    rust = np.clip(rust * 1.1, 0, 1)

    # Grime: broad blotches plus dirt washed down from the horizontal welds.
    ledge = (np.exp(-(d_h * px / 0.02) ** 2) * (r.random((n, n)) < 0.004)).astype(F32)
    wash = streaks_down(blur(ledge, 1.0) * 4, 0.995, 20)
    wash = blur_dir(wash, 4, 12)
    grime = 0.6 * sstep(0.3, 0.9, norm01(spectral(n, 3.0, 21, fmin=2))) + 0.35 * np.clip(wash, 0, 1)
    grime = np.clip(grime * norm01(spectral(n, 1.5, 22, fmin=8)) * 1.6, 0, 1)

    # Touch-up patches: rectangles of newer paint, slightly different shade.
    touch = np.zeros((n, n), F32)
    for _ in range(9):
        cx, cy = r.integers(0, n, 2)
        w, h = r.integers(60, 260), r.integers(40, 180)
        m = ((np.abs(((cols - cx + n / 2) % n) - n / 2) < w) & (np.abs(((rows - cy + n / 2) % n) - n / 2) < h)).astype(F32)
        wob = spectral(n, 2.5, int(r.integers(1000)), fmin=6) * 12
        m = warp(m, wob, np.roll(wob, 300, 0))
        touch = np.maximum(touch, blur(m, 1.5) * r.uniform(0.4, 1.0))

    ao = cavity(height, 6, 350) * cavity(height, 40, 120)
    rough = 0.5 + 0.06 * spectral(n, 2.5, 23, fmin=4) + 0.04 * spectral(n, 1.2, 24, fmin=120) \
        - 0.12 * touch + 0.08 * np.exp(-(d_seam / 0.01) ** 2)
    albedo = 0.9 + 0.035 * spectral(n, 3.0, 25, fmin=2) + 0.012 * spectral(n, 1.0, 26, fmin=200) \
        + 0.035 * touch - 0.05 * np.exp(-(d_seam / 0.006) ** 2)

    emit('hull', tile, normal, pack(ao, np.clip(rough, 0, 1), np.clip(albedo, 0, 1)),
         pack(rust, grime, chips), extra_1k=True)


# ---------------------------------------------------------------------------
# WEATHER DECK — non-skid coating over welded plate, 4.8 m tile, 1024 px
# ---------------------------------------------------------------------------
def bake_deck():
    n, tile = 1024, 4.8
    px = tile / n
    rows, cols = np.mgrid[0:n, 0:n].astype(F32)
    d_h = seam_distance(rows, [0, n // 2], n)
    d_v = seam_distance(cols, [0], n)
    d_v2 = seam_distance(cols, [n // 2 + 170], n)
    d_v = np.where(rows < n // 2, d_v, d_v2)
    d_seam = np.minimum(d_h, d_v) * px

    grit = spectral(n, 0.6, 31, fmin=200) * 0.00022           # aggregate
    roller = spectral(n, 2.0, 32, fmin=20, aniso=(3.0, 1.0)) * 0.00025
    bead = 0.0012 * np.exp(-(d_seam / 0.01) ** 2)
    dish = -0.0015 * norm01(spectral(n, 3.5, 33, fmin=2))

    # Foot traffic polishes the grit flat along a few paths.
    paths = sstep(0.55, 0.9, norm01(blur(spectral(n, 3.0, 34, fmin=1, aniso=(0.3, 1.0)), 6)))
    height = grit * (1 - 0.7 * paths) + roller + bead + dish
    normal = normal_map(height, px)

    r = rng(35)
    chips = sstep(2.7, 3.0, spectral(n, 1.5, 36, fmin=40) + 0.8 * np.exp(-(d_seam / 0.05) ** 2))
    scuffs = np.zeros((n, n), F32)
    for _ in range(26):
        cx, cy = r.integers(0, n, 2)
        L, W, ang = r.uniform(30, 140), r.uniform(2, 7), r.uniform(0, np.pi)
        dx = ((cols - cx + n / 2) % n) - n / 2
        dy = ((rows - cy + n / 2) % n) - n / 2
        u = dx * np.cos(ang) + dy * np.sin(ang)
        v = -dx * np.sin(ang) + dy * np.cos(ang)
        scuffs = np.maximum(scuffs, np.exp(-(u / L) ** 2 - (v / W) ** 2) * r.uniform(0.3, 0.8))

    rust_src = np.clip(blur(chips, 1) * 2 + np.exp(-(d_seam / 0.012) ** 2) * (r.random((n, n)) < 0.02), 0, 1)
    rust = np.clip(blur(rust_src, 2.5) * 2.2 * norm01(spectral(n, 2, 37, fmin=10)), 0, 1)
    grime = np.clip(0.5 * norm01(spectral(n, 3.0, 38, fmin=1)) + 0.7 * scuffs +
                    0.5 * np.exp(-(d_seam / 0.03) ** 2) * norm01(spectral(n, 2, 39, fmin=20)) - 0.2, 0, 1)

    ao = cavity(height, 3, 900) * cavity(height, 30, 200)
    rough = 0.55 + 0.05 * spectral(n, 2.0, 40, fmin=4) - 0.22 * paths + 0.05 * spectral(n, 0.8, 41, fmin=150)
    albedo = 0.88 + 0.04 * spectral(n, 3, 42, fmin=2) + 0.06 * paths + 0.03 * spectral(n, 0.6, 43, fmin=150)
    emit('deck', tile, normal, pack(ao, np.clip(rough, 0, 1), np.clip(albedo, 0, 1)), pack(rust, grime, chips))


# ---------------------------------------------------------------------------
# MACHINERY PAINT — sand-cast and fabricated parts under enamel, 1.6 m, 1024 px
# ---------------------------------------------------------------------------
def bake_paint():
    n, tile = 1024, 1.6
    px = tile / n
    cast = spectral(n, 2.6, 51, fmin=6) * 0.00035
    pits = -sstep(2.6, 3.2, spectral(n, 0.8, 52, fmin=150)) * 0.00015
    peel = spectral(n, 1.4, 53, fmin=120) * 0.00003
    r = rng(54)
    chips = sstep(2.75, 3.05, spectral(n, 1.5, 55, fmin=30) + 0.25 * spectral(n, 3, 56, fmin=2))
    height = cast + pits + peel - chips * 0.0001
    normal = normal_map(height, px)

    oil = np.clip(sstep(0.5, 0.95, norm01(spectral(n, 2.8, 57, fmin=2))) * 1.2, 0, 1)
    drip_src = (r.random((n, n)) < 0.000012).astype(F32)
    drips = np.clip(blur_dir(streaks_down(blur(drip_src, 2) * 30, 0.992, 58), 1.5, 4) * 1.4, 0, 1)
    grime = np.clip(0.55 * oil + drips * 0.9 + 0.25 * norm01(spectral(n, 2, 59, fmin=6)) - 0.1, 0, 1)
    rust = np.clip(blur(chips, 1.5) * 1.4 * norm01(spectral(n, 2, 60, fmin=8)), 0, 1)

    ao = cavity(height, 4, 700)
    rough = 0.5 + 0.05 * spectral(n, 2.2, 61, fmin=4) + 0.03 * spectral(n, 1, 62, fmin=150)
    albedo = 0.92 + 0.03 * spectral(n, 3, 63, fmin=2) + 0.015 * spectral(n, 1, 64, fmin=150)
    emit('paint', tile, normal, pack(ao, np.clip(rough, 0, 1), np.clip(albedo, 0, 1)), pack(rust, grime, chips))


# ---------------------------------------------------------------------------
# BARE METAL — brushed / handled steel, bronze, galvanising, 1.0 m, 1024 px
# ---------------------------------------------------------------------------
def bake_metal():
    n, tile = 1024, 1.0
    px = tile / n
    rows, cols = np.mgrid[0:n, 0:n].astype(F32)
    brushed = spectral(n, 1.2, 71, fmin=30, aniso=(0.08, 1.0)) * 0.000012
    r = rng(72)
    scratches = np.zeros((n, n), F32)
    for _ in range(140):
        cx, cy = r.uniform(0, n, 2)
        ang = r.uniform(0, np.pi)
        L = r.uniform(20, 260)
        dx = ((cols - cx + n / 2) % n) - n / 2
        dy = ((rows - cy + n / 2) % n) - n / 2
        u = dx * np.cos(ang) + dy * np.sin(ang)
        v = -dx * np.sin(ang) + dy * np.cos(ang)
        scratches = np.maximum(scratches, (np.abs(v) < 0.8) * sstep(L, L * 0.6, np.abs(u)) * r.uniform(0.3, 1))
    scratches = blur(scratches, 0.5)
    dents = spectral(n, 3.0, 73, fmin=3) * 0.00012
    height = brushed + dents - scratches * 0.00002
    normal = normal_map(height, px)

    # Galvanised spangle: cells of slightly different brightness and sheen.
    d, idx = worley(n, 900, 74)
    cell = rng(75).random(idx.max() + 1).astype(F32)[idx]
    tarnish = sstep(0.45, 0.95, norm01(spectral(n, 2.8, 76, fmin=2))) * 0.7
    rust = np.clip(sstep(0.62, 0.9, norm01(spectral(n, 2.4, 77, fmin=4))) * norm01(spectral(n, 1, 78, fmin=40)) * 1.5, 0, 1)
    pits = sstep(2.8, 3.2, spectral(n, 0.8, 79, fmin=120))

    ao = cavity(height, 3, 3000)
    rough = 0.5 + 0.08 * (cell - 0.5) + 0.12 * spectral(n, 1.5, 80, fmin=20, aniso=(0.2, 1.0)) * 0.5 \
        + 0.18 * tarnish - 0.15 * scratches
    albedo = 0.88 + 0.06 * (cell - 0.5) + 0.04 * spectral(n, 2.5, 81, fmin=3) + 0.08 * scratches - 0.06 * tarnish
    emit('metal', tile, normal, pack(ao, np.clip(rough, 0, 1), np.clip(albedo, 0, 1)), pack(rust, tarnish, pits))


# ---------------------------------------------------------------------------
# SEA — capillary / wind-chop normal map from a Phillips spectrum, 24 m tile
# ---------------------------------------------------------------------------
def bake_water():
    n, tile = 1024, 24.0
    g, V = 9.81, 5.5
    L = V * V / g
    r = rng(91)
    fx, fy = freq_grid(n)
    kx = fx * n * 2 * np.pi / tile
    ky = fy * n * 2 * np.pi / tile
    k = np.sqrt(kx ** 2 + ky ** 2)
    k[0, 0] = 1e-6
    wind = np.array([np.cos(0.5), np.sin(0.5)])
    kd = (kx * wind[0] + ky * wind[1]) / k
    ph = np.exp(-1.0 / (k * L) ** 2) / k ** 4 * np.abs(kd) ** 2 * np.exp(-(k * 0.02) ** 2)
    # Long waves belong to the animated geometry, not to this map.
    ph *= 1 - np.exp(-(k / 1.6) ** 2)
    ph[0, 0] = 0
    spec = (r.standard_normal((n, n)) + 1j * r.standard_normal((n, n))) * np.sqrt(ph / 2)
    h = np.real(ifft2(spec)).astype(F32)
    h = h / np.abs(h).max()
    px = tile / n
    # Scale so the steepest chop sits around 0.45 slope.
    gx, gy = gradients(h)
    s = 0.45 / np.percentile(np.sqrt(gx ** 2 + gy ** 2) / px, 99.5)
    normal = normal_map(h * s, px)
    save_rgb(f'{OUT}/water_normal.webp', normal, quality=95)
    manifest['water'] = {'tile': tile, 'size': n}

    # Foam: bubble lattice (Worley edges) broken up by fbm, 6 m tile.
    m = 512
    d1, d2, _ = worley(m, 700, 92, second=True)
    lattice = sstep(0.0, 0.012, d2 - d1)
    fine_d1, fine_d2, _ = worley(m, 3000, 93, second=True)
    fine = sstep(0.0, 0.006, fine_d2 - fine_d1)
    body = norm01(spectral(m, 2.2, 94, fmin=2))
    foam = np.clip((0.55 * lattice + 0.45 * fine) * (0.4 + body), 0, 1)
    streaky = norm01(spectral(m, 2.5, 95, fmin=1, aniso=(0.25, 1.0)))
    save_rgb(f'{OUT}/foam.webp', pack(foam, body, streaky), quality=90)
    manifest['foam'] = {'tile': 6.0, 'size': m}
    print(f'water: done at {time.time() - t0:.1f}s', flush=True)


which = sys.argv[2:] or ['hull', 'deck', 'paint', 'metal', 'water']
for w in which:
    globals()[f'bake_{w}']()

path = f'{OUT}/textures.json'
old = json.load(open(path)) if os.path.exists(path) else {}
old.update(manifest)
json.dump(old, open(path, 'w'), indent=2)
print(json.dumps(old))
