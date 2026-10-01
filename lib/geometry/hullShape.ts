/**
 * Parametric hull form for the modeled sample vessel.
 *
 * Pure maths — no Three.js, no DOM — so it can be unit tested in Node. The
 * scene layer turns these numbers into geometry.
 *
 * The hull is described as a family of transverse sections. Each section is a
 * superellipse running from the keel to the deck edge:
 *
 *     z(u) = halfBeam * sin(theta) ^ (2/n)
 *     y(u) = keel   + (deck - keel) * (1 - cos(theta) ^ (2/n))
 *     theta = u * PI/2,  u in [0, 1]
 *
 * The exponent `n` controls fullness: a high n gives the boxy, almost
 * rectangular midship section of a cargo vessel, a low n gives the fine V of
 * the entrance. Sweeping n, the half-beam, the sheer and the keel rise along
 * the length produces a recognisable ship without any external 3D asset.
 *
 * NOTE: this is a plausible hull form for a demo, not a fair set of ship lines.
 * No hydrostatics, no stability, no real vessel.
 */

import type { HullSpec } from '@/lib/engine/types';

/** A point on a transverse section, in vessel coordinates. */
export interface SectionPoint {
  readonly y: number;
  readonly z: number;
}

/** Longitudinal parameter: -1 at the transom, 0 amidships, +1 at the stem. */
export type StationParam = number;

const EPS = 1e-9;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Normalised distance into the tapering region, 0 at the mid-body, 1 at the end. */
function taperProgress(t: StationParam, parallelMidBody: number): number {
  const absT = Math.abs(t);
  if (absT <= parallelMidBody) return 0;
  return (absT - parallelMidBody) / Math.max(1 - parallelMidBody, EPS);
}

/** Half-beam at station `t`, in metres. */
export function halfBeamAt(hull: HullSpec, t: StationParam): number {
  const maxHalfBeam = hull.beam / 2;
  const u = taperProgress(t, hull.parallelMidBody);
  if (u === 0) return maxHalfBeam;

  if (t > 0) {
    // Forward: a fine entrance that narrows to a slender stem.
    return maxHalfBeam * Math.max(1 - Math.pow(u, 2.1), 0.02);
  }
  // Aft: a fuller run that stops at a transom of finite width.
  const transom = clamp(hull.transomWidthRatio, 0, 1);
  return maxHalfBeam * (1 - (1 - transom) * Math.pow(u, 2.6));
}

/** Section fullness exponent at station `t`. */
export function fullnessAt(hull: HullSpec, t: StationParam): number {
  const u = taperProgress(t, hull.parallelMidBody);
  if (u === 0) return hull.midshipFullness;
  const target = t > 0 ? hull.bowFullness : hull.sternFullness;
  return hull.midshipFullness + (target - hull.midshipFullness) * Math.pow(u, 1.3);
}

/** Rise of the deck edge above the moulded depth at station `t`, in metres. */
export function sheerAt(hull: HullSpec, t: StationParam): number {
  const amplitude = t >= 0 ? hull.sheerForward : hull.sheerAft;
  return amplitude * t * t;
}

/** Rise of the keel line above the baseline at station `t`, in metres. */
export function keelRiseAt(hull: HullSpec, t: StationParam): number {
  // Forefoot: the keel sweeps up sharply towards the stem.
  if (t > 0.72) {
    const u = (t - 0.72) / 0.28;
    return 1.7 * u * u;
  }
  // Aft: a modest rise over the skeg and stern tube.
  if (t < -0.78) {
    const u = (-t - 0.78) / 0.22;
    return 1.1 * u * u;
  }
  return 0;
}

/** Height of the deck edge at station `t`, in metres above baseline. */
export function deckEdgeYAt(hull: HullSpec, t: StationParam): number {
  return hull.depth + sheerAt(hull, t);
}

/**
 * Half-section from keel to deck edge at station `t`.
 * Returns `samples + 1` points, ordered keel first.
 */
export function halfSectionAt(
  hull: HullSpec,
  t: StationParam,
  samples: number,
): SectionPoint[] {
  const halfBeam = halfBeamAt(hull, t);
  const n = fullnessAt(hull, t);
  const exponent = 2 / n;
  const keelY = keelRiseAt(hull, t);
  const deckY = deckEdgeYAt(hull, t);

  const points: SectionPoint[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const theta = (i / samples) * (Math.PI / 2);
    const z = halfBeam * Math.pow(Math.sin(theta), exponent);
    const y = keelY + (deckY - keelY) * (1 - Math.pow(Math.cos(theta), exponent));
    points.push({ y, z });
  }
  return points;
}

/**
 * Full transverse section, port deck edge -> keel -> starboard deck edge.
 * Returns `2 * samples + 1` points.
 */
export function fullSectionAt(
  hull: HullSpec,
  t: StationParam,
  samples: number,
): SectionPoint[] {
  const half = halfSectionAt(hull, t, samples);
  const port: SectionPoint[] = [];
  for (let i = half.length - 1; i >= 1; i -= 1) {
    const p = half[i];
    if (p) port.push({ y: p.y, z: -p.z });
  }
  return [...port, ...half];
}

/**
 * Half-width of the hull at station `t` and height `y`.
 *
 * Inverts the section equation in closed form:
 *   q     = 1 - (y - keel) / (deck - keel)
 *   theta = acos(q ^ (n/2))
 *   z     = halfBeam * sin(theta) ^ (2/n)
 *
 * Returns 0 below the keel at that station, and the deck-edge half-beam at or
 * above the sheer line (used to terminate deck plates at the bulwark).
 */
export function halfWidthAt(hull: HullSpec, t: StationParam, y: number): number {
  const keelY = keelRiseAt(hull, t);
  const deckY = deckEdgeYAt(hull, t);
  const halfBeam = halfBeamAt(hull, t);
  if (y <= keelY) return 0;
  if (y >= deckY) return halfBeam;

  const n = fullnessAt(hull, t);
  const q = 1 - (y - keelY) / (deckY - keelY);
  const cosTheta = clamp(Math.pow(clamp(q, 0, 1), n / 2), 0, 1);
  const theta = Math.acos(cosTheta);
  return halfBeam * Math.pow(Math.sin(theta), 2 / n);
}

export interface OutlinePoint {
  readonly x: number;
  readonly halfWidth: number;
}

/**
 * Plan outline of the hull at a given height, sampled along the length.
 * Used to cut deck plates to the shape of the hull.
 */
export function outlineAtHeight(
  hull: HullSpec,
  y: number,
  stations: number,
): OutlinePoint[] {
  const halfLength = hull.lengthOverall / 2;
  const points: OutlinePoint[] = [];
  for (let i = 0; i <= stations; i += 1) {
    const t = -1 + (2 * i) / stations;
    points.push({ x: t * halfLength, halfWidth: halfWidthAt(hull, t, y) });
  }
  return points;
}

/** Station parameter -> x coordinate in metres. */
export function stationToX(hull: HullSpec, t: StationParam): number {
  return t * (hull.lengthOverall / 2);
}

// ---------------------------------------------------------------------------
// Sectioned maquette helpers
// ---------------------------------------------------------------------------

/** Which half of the hull survives the centreline cut. */
export type HullSide = 'port' | 'starboard' | 'both';

/** Sign applied to z for a given side. Port is -z, starboard is +z. */
export function sideSign(side: HullSide): -1 | 1 {
  return side === 'port' ? -1 : 1;
}

/**
 * Given the half that is cut AWAY, returns the half that survives.
 *
 * The distinction is easy to get backwards and the symptom is subtle — you end
 * up staring at the outside of the near shell and wondering why the interior
 * never appears — so the conversion lives in one named function.
 */
export function keepSideFor(cutSide: HullSide): HullSide {
  if (cutSide === 'both') return 'both';
  return cutSide === 'starboard' ? 'port' : 'starboard';
}

/**
 * Vertical strip of a transverse section between two heights.
 *
 * Parametrising by height rather than by the section curve is what makes the
 * hull sliceable: a band knows exactly where it starts and stops, so the
 * slices stack back together without a seam.
 */
export function sectionStripAt(
  hull: HullSpec,
  t: StationParam,
  yBottom: number,
  yTop: number,
  samples: number,
): SectionPoint[] {
  const points: SectionPoint[] = [];
  for (let j = 0; j <= samples; j += 1) {
    const y = yBottom + ((yTop - yBottom) * j) / samples;
    points.push({ y, z: halfWidthAt(hull, t, y) });
  }
  return points;
}

/**
 * Half-plan outline at a height, from bow to stern, for one side only.
 * Stations where the hull has not yet formed (below the keel) are dropped, so
 * the resulting polygon is always closed and non-degenerate.
 */
export function halfOutlineAtHeight(
  hull: HullSpec,
  y: number,
  stations: number,
  minWidth = 0.05,
): OutlinePoint[] {
  return outlineAtHeight(hull, y, stations).filter((point) => point.halfWidth > minWidth);
}

/**
 * Highest point of the hull at a station — the deck edge, or the top of the
 * band, whichever is lower. Used to stop bulkheads and section faces at the
 * shell instead of poking through it.
 */
export function clampedTopAt(hull: HullSpec, t: StationParam, yTop: number): number {
  return Math.min(yTop, deckEdgeYAt(hull, t));
}

/** Lowest point of the hull at a station — the keel, or the band floor. */
export function clampedBottomAt(hull: HullSpec, t: StationParam, yBottom: number): number {
  return Math.max(yBottom, keelRiseAt(hull, t));
}

/** x -> station parameter. Inverse of stationToX. */
export function xToStation(hull: HullSpec, x: number): StationParam {
  return x / (hull.lengthOverall / 2);
}
