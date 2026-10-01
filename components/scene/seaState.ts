/**
 * The sea's wave field, shared by the GPU (Sea.tsx) and the CPU (anything
 * that floats: boats, buoys). One definition, so a boat rides the very swell
 * that is drawn under it instead of a look-alike.
 */

export const G = 9.81;

export interface Wave {
  readonly length: number;
  readonly amplitude: number;
  /** Heading in radians, measured from +X towards +Z. */
  readonly heading: number;
  /** Gerstner steepness, 0 = sine, 1 = cusped. */
  readonly steepness: number;
}

/**
 * A light breeze sea: swell under a local wind chop. Eight components with
 * unrelated lengths and headings — with fewer, the distant sea resolves into
 * visibly parallel stripes.
 */
export const WAVES: readonly Wave[] = [
  { length: 61, amplitude: 0.3, heading: 0.5, steepness: 0.3 },
  { length: 41, amplitude: 0.24, heading: -0.35, steepness: 0.32 },
  { length: 28.7, amplitude: 0.17, heading: 1.05, steepness: 0.36 },
  { length: 20.9, amplitude: 0.12, heading: -0.92, steepness: 0.38 },
  { length: 14.3, amplitude: 0.085, heading: 0.18, steepness: 0.4 },
  { length: 9.7, amplitude: 0.058, heading: 1.42, steepness: 0.42 },
  { length: 6.2, amplitude: 0.038, heading: -0.61, steepness: 0.45 },
  { length: 4.1, amplitude: 0.024, heading: 0.83, steepness: 0.45 },
];

const PRECOMPUTED = WAVES.map((wave, index) => {
  const k = (Math.PI * 2) / wave.length;
  return {
    dx: Math.cos(wave.heading),
    dz: Math.sin(wave.heading),
    k,
    omega: Math.sqrt(G * k),
    amplitude: wave.amplitude,
    lambda: wave.length,
    phase: index * 1.7,
  };
});

/** The sea's clock, advanced by Sea.tsx each frame (seconds). */
export const seaClock = { time: 0 };

/** Sea grid spacing at a distance from the vessel; must match Sea.tsx. */
export const SEA_GRID = { firstSpacing: 0.5, growth: 1.025 } as const;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Height of the swell above mean sea level at world (x, z), now. Mirrors the
 * vertical term of `seaSwell` in the sea shader, including the way short
 * waves fade out where the grid is too coarse to draw them — without that,
 * a boat a few hundred metres off rides waves that are not there and dips
 * under the surface that is. (The small horizontal Gerstner drift is ignored.)
 */
export function seaHeightAt(x: number, z: number, time = seaClock.time): number {
  const spacing = SEA_GRID.firstSpacing + (SEA_GRID.growth - 1) * Math.hypot(x, z);
  let y = 0;
  for (const w of PRECOMPUTED) {
    const fade = 1 - smooth(w.lambda * 0.14, w.lambda * 0.3, spacing);
    if (fade <= 0) continue;
    y += fade * w.amplitude * Math.sin(w.k * (w.dx * x + w.dz * z) - w.omega * time + w.phase);
  }
  return y;
}

/**
 * The small craft's waterplanes, written each frame by Boats.tsx and read by
 * the sea shader, which leaves no water inside them. A kayak has a hand's
 * breadth of freeboard: without this, every passing crest would flood it.
 */
export const MAX_SMALL_HULLS = 8;
export const smallHulls = {
  /** Per hull: centre x, z and heading (unit dx, dz). */
  centres: new Float32Array(MAX_SMALL_HULLS * 4),
  /** Per hull: half length, half beam at the waterline. */
  sizes: new Float32Array(MAX_SMALL_HULLS * 2),
  count: 0,
};

export function addSmallHull(x: number, z: number, dx: number, dz: number, halfLength: number, halfBeam: number): void {
  const i = smallHulls.count;
  if (i >= MAX_SMALL_HULLS) return;
  smallHulls.centres.set([x, z, dx, dz], i * 4);
  smallHulls.sizes.set([halfLength, halfBeam], i * 2);
  smallHulls.count = i + 1;
}
