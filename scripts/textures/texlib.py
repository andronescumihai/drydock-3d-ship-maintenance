"""Tileable procedural texture toolkit (numpy/scipy).

Every operation here is periodic: FFT filtering, wrapped gradients, wrapped
warps and periodic Worley noise. The outputs therefore tile seamlessly, which
is what lets a 2048 px image cover a 90 m hull without visible seams.
"""
import numpy as np
from numpy.fft import fft2, ifft2, fftfreq
from scipy.ndimage import map_coordinates
from scipy.spatial import cKDTree
from PIL import Image

F32 = np.float32


def rng(seed):
    return np.random.default_rng(seed)


def freq_grid(n):
    f = fftfreq(n).astype(F32)
    fx, fy = np.meshgrid(f, f)
    return fx, fy


def spectral(n, beta, seed, fmin=1.0, fmax=None, aniso=(1.0, 1.0)):
    """Tileable 1/f^beta noise, normalised to zero mean, unit std.

    fmin / fmax are in cycles per tile. aniso stretches the spectrum, e.g.
    (1, 8) gives streaks elongated along X.
    """
    r = rng(seed)
    white = r.standard_normal((n, n)).astype(F32)
    fx, fy = freq_grid(n)
    k = np.sqrt((fx * aniso[0]) ** 2 + (fy * aniso[1]) ** 2) * n
    amp = np.where(k > 0, np.power(np.maximum(k, 1e-6), -beta / 2.0), 0).astype(F32)
    amp[k < fmin] = 0
    if fmax is not None:
        amp *= np.exp(-(k / fmax) ** 2).astype(F32)
    out = np.real(ifft2(fft2(white) * amp)).astype(F32)
    out -= out.mean()
    s = out.std()
    return out / (s if s > 0 else 1)


def blur(img, sigma):
    """Periodic gaussian blur, sigma in pixels."""
    if sigma <= 0:
        return img
    n0, n1 = img.shape
    f0 = fftfreq(n0).astype(F32)[:, None]
    f1 = fftfreq(n1).astype(F32)[None, :]
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (f0 ** 2 + f1 ** 2))
    return np.real(ifft2(fft2(img) * g)).astype(F32)


def blur_dir(img, sx, sy):
    n0, n1 = img.shape
    f0 = fftfreq(n0).astype(F32)[:, None]
    f1 = fftfreq(n1).astype(F32)[None, :]
    g = np.exp(-2 * np.pi ** 2 * ((sy * f0) ** 2 + (sx * f1) ** 2))
    return np.real(ifft2(fft2(img) * g)).astype(F32)


def warp(img, dx, dy):
    n0, n1 = img.shape
    yy, xx = np.mgrid[0:n0, 0:n1].astype(F32)
    return map_coordinates(img, [yy + dy, xx + dx], order=1, mode='grid-wrap').astype(F32)


def norm01(a, lo=None, hi=None):
    lo = a.min() if lo is None else lo
    hi = a.max() if hi is None else hi
    return np.clip((a - lo) / max(hi - lo, 1e-9), 0, 1).astype(F32)


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return (t * t * (3 - 2 * t)).astype(F32)


def worley(n, count, seed, second=False):
    """Periodic Worley (cellular) distance field, in units of the tile (0..~)."""
    r = rng(seed)
    pts = r.random((count, 2))
    tree = cKDTree(pts, boxsize=1.0)
    g = (np.arange(n) + 0.5) / n
    xx, yy = np.meshgrid(g, g)
    q = np.stack([xx.ravel(), yy.ravel()], 1)
    d, idx = tree.query(q, k=2 if second else 1)
    if second:
        return d[:, 0].reshape(n, n).astype(F32), d[:, 1].reshape(n, n).astype(F32), idx[:, 0].reshape(n, n)
    return d.reshape(n, n).astype(F32), idx.reshape(n, n)


def gradients(h):
    """Periodic central differences: d/dcol, d/drow."""
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    return gx, gy


def normal_map(h_m, px_m):
    """Height field in METRES -> OpenGL tangent-space normal map (RGB 0..1).

    three.js convention (flipY on load): +u to the right, +v up the image, so a
    height increasing towards the bottom row tilts the normal towards -v.
    """
    gx, gy = gradients(h_m)
    gx /= px_m
    gy /= px_m
    nx = -gx
    ny = gy  # rows run downwards; +v runs upwards
    nz = np.ones_like(h_m)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5


def cavity(h_m, sigma_px, strength):
    """Cheap AO: how far below its neighbourhood each texel sits."""
    d = blur(h_m, sigma_px) - h_m
    return np.clip(1.0 - np.maximum(d, 0) * strength, 0, 1).astype(F32)


def streaks_down(src, decay, seed, jitter=0.0):
    """Accumulate sources down the image (row 0 = top) with per-column decay.

    Wraps vertically by running two passes, so the result still tiles.
    """
    n0, n1 = src.shape
    r = rng(seed)
    col_decay = np.clip(decay + r.normal(0, 0.004, n1), 0.9, 0.9995).astype(F32)
    acc = np.zeros(n1, F32)
    out = np.zeros_like(src)
    for _ in range(2):
        for y in range(n0):
            acc = np.maximum(src[y], acc * col_decay)
            out[y] = acc
    return out


def save_rgb(path, rgb, quality=92, lossless=False):
    arr = (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)
    im = Image.fromarray(arr, 'RGB')
    if lossless:
        im.save(path, 'WEBP', lossless=True, quality=100, method=6)
    else:
        im.save(path, 'WEBP', quality=quality, method=6)
    return im


def pack(*chs):
    return np.stack(chs, -1).astype(F32)


def downsample(rgb, factor=2):
    n0, n1, c = rgb.shape
    return rgb.reshape(n0 // factor, factor, n1 // factor, factor, c).mean((1, 3))
