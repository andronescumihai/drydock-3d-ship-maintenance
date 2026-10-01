import * as THREE from 'three';

/**
 * Time of day, shared by everything that lights or is lit.
 *
 * The scene has two resting states — DAY (an afternoon sun over the bay) and
 * NIGHT (a moon, the city lights, the ship's working lights) — and it never
 * cuts between them: the sun is actually carried down the sky, through the
 * sunset and the blue hour, and back up again. One number drives it all:
 * `phase`, 0 for day and 1 for night, which eases towards the store's target.
 *
 * Every other quantity (sun direction and colour, key light, exposure, how
 * lit the city is...) is a pure function of the sun's elevation, evaluated
 * once per frame into the mutable `daylight` object below. Components read it
 * inside `useFrame`, the same way the sea shares its clock (seaState.ts), so a
 * change of time of day re-renders no React tree at all.
 *
 * Azimuths are measured from +X (bow) towards +Z (starboard), in degrees.
 */

/**
 * Afternoon: the sun high over the starboard quarter of the opening view —
 * behind and to the left of the camera. It lights the side of the ship you see
 * first, and it rakes across the Rio waterfront from the side, so every ridge
 * and valley casts its shadow and the mountains read in relief.
 */
export const DAY_SUN = { elevation: 32, azimuth: 105 } as const;
/**
 * Evening: the sun travels across the sky above the city and goes down over
 * the open water to the right of Rio (the sunset the scene was first composed
 * around, azimuth 241° = −119°), then on below the horizon.
 */
export const SUNSET_SUN = { elevation: 5.5, azimuth: 241 } as const;
export const NIGHT_SUN = { elevation: -24, azimuth: 248 } as const;
/** Morning: after the night the sun comes up out of the sea to starboard. */
export const DAWN_SUN = { elevation: -24, azimuth: 88 } as const;

/** Share of the evening transition spent getting from afternoon to sunset. */
const SUNSET_AT = 0.58;

/**
 * The moon stands behind the opening camera (over the starboard bow), so at
 * night it lights the side of the ship you see first, and silvers the Rio
 * mountains across the water. Turn round and it hangs over its own glitter path.
 */
export const MOON = { elevation: 31, azimuth: 42 } as const;

/** Seconds for a full day → night (or night → day) change: a time-lapse of the evening. */
export const TRANSITION_SECONDS = 7;

export function directionFrom(elevationDeg: number, azimuthDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  return out.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
}

type Curve = readonly (readonly [number, number])[];

/** Piecewise curve over sun elevation, smoothly interpolated between keys. */
function curve(keys: Curve, x: number): number {
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i += 1) {
    const b = keys[i]!;
    if (x <= b[0]) {
      const a = keys[i - 1]!;
      const t = (x - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * t * t * (3 - 2 * t);
    }
  }
  return last[1];
}

/** Colour of direct sunlight after the atmosphere, by elevation. */
const SUN_COLOURS: readonly (readonly [number, THREE.Color])[] = [
  [-1, new THREE.Color('#ff6a2e')],
  [2, new THREE.Color('#ff9150')],
  [5.5, new THREE.Color('#ffb877')],
  [11, new THREE.Color('#ffd9aa')],
  [20, new THREE.Color('#ffebcf')],
  [30, new THREE.Color('#fff3e2')],
];

function sunColourAt(elevation: number, out: THREE.Color): THREE.Color {
  const first = SUN_COLOURS[0]!;
  const last = SUN_COLOURS[SUN_COLOURS.length - 1]!;
  if (elevation <= first[0]) return out.copy(first[1]);
  if (elevation >= last[0]) return out.copy(last[1]);
  for (let i = 1; i < SUN_COLOURS.length; i += 1) {
    const b = SUN_COLOURS[i]!;
    if (elevation <= b[0]) {
      const a = SUN_COLOURS[i - 1]!;
      return out.copy(a[1]).lerp(b[1], (elevation - a[0]) / (b[0] - a[0]));
    }
  }
  return out.copy(last[1]);
}

/** Moonlight as the eye reads it at night: cool and silvery (the Purkinje shift). */
const MOON_COLOUR = new THREE.Color('#aec4ff');

// Balance tables, all keyed on sun elevation in degrees. At 5.5° they
// reproduce the original sunset tuning (exposure 1, sky 0.42, sun 9).
const SUN_INTENSITY: Curve = [[-1.5, 0], [1, 3.5], [5.5, 9], [14, 10.5], [27, 11]];
const MOON_INTENSITY: Curve = [[-24, 1.5], [-10, 1.5], [-3, 0]];
const EXPOSURE: Curve = [[-24, 1.45], [-10, 1.4], [-4, 1.25], [0, 1.08], [5.5, 1.0], [27, 0.95]];
const ENVIRONMENT: Curve = [[-24, 1.5], [-10, 1.4], [-3, 0.7], [5.5, 0.42], [27, 0.26]];
const BACKGROUND: Curve = [[-24, 0.85], [-10, 0.85], [-3, 0.6], [5.5, 0.42], [27, 0.28]];
/** Metres of air that halve the contrast of the coast: clear by day, thicker at sunset. */
const HAZE: Curve = [[-24, 24000], [-4, 18000], [5.5, 17000], [14, 36000], [30, 60000]];

export interface DaylightState {
  /** 0 = day, 1 = night, eased. */
  phase: number;
  /** Where `phase` is heading. */
  target: number;
  /**
   * Which way round the sun goes: westward through the sunset on the way to
   * night, up out of the east on the way back to day. Chosen when a change
   * starts from rest; a change reversed half-way retraces its own path.
   */
  path: 'dusk' | 'dawn';
  /** True while a change of time of day is under way. */
  moving: boolean;
  sunElevation: number;
  /** Unit vector towards the sun. */
  readonly sunDirection: THREE.Vector3;
  readonly sunColor: THREE.Color;
  /** How much of the sun's disc and glare is above the horizon, 0..1. */
  sunVisible: number;
  readonly moonDirection: THREE.Vector3;
  /** 0 by day, 1 in full night: city lights, ship's working lights, stars. */
  night: number;
  /** Peaks in the blue hour, just after sunset: the sky's afterglow. */
  twilight: number;
  /** The one shadow-casting light: the sun by day, the moon by night. */
  readonly keyDirection: THREE.Vector3;
  readonly keyColor: THREE.Color;
  keyIntensity: number;
  /** Direct sunlight as a Lambert irradiance (colour × intensity / π), for hand-written shaders. */
  readonly keyIrradiance: THREE.Color;
  exposure: number;
  environment: number;
  background: number;
  /** Aerial-perspective distance scale for the far coast, metres. */
  haze: number;
  /** Increments whenever any value above changes; lets consumers skip idle frames. */
  revision: number;
}

export const daylight: DaylightState = {
  phase: 0,
  target: 0,
  path: 'dusk',
  moving: false,
  sunElevation: DAY_SUN.elevation,
  sunDirection: new THREE.Vector3(),
  sunColor: new THREE.Color(),
  sunVisible: 1,
  moonDirection: directionFrom(MOON.elevation, MOON.azimuth),
  night: 0,
  twilight: 0,
  keyDirection: new THREE.Vector3(),
  keyColor: new THREE.Color(),
  keyIntensity: 0,
  keyIrradiance: new THREE.Color(),
  exposure: 1,
  environment: 0.4,
  background: 0.4,
  haze: 16000,
  revision: 0,
};

const smooth = (t: number): number => t * t * (3 - 2 * t);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Recomputes every derived value for a given phase. Pure apart from writing `out`. */
export function evaluateDaylight(phase: number, out: DaylightState = daylight): DaylightState {
  const p = Math.min(1, Math.max(0, phase));
  let elevation: number;
  let azimuth: number;
  if (out.path === 'dusk') {
    // Afternoon → sunset: the sun swings west while sinking, slowly at first.
    // Sunset → night: straight down past the horizon.
    if (p < SUNSET_AT) {
      const u = smooth(p / SUNSET_AT);
      const sink = u * u * (1.6 - 0.6 * u);
      elevation = DAY_SUN.elevation + (SUNSET_SUN.elevation - DAY_SUN.elevation) * sink;
      azimuth = DAY_SUN.azimuth + (SUNSET_SUN.azimuth - DAY_SUN.azimuth) * u;
    } else {
      // Lingers at the sunset, then goes down.
      const u = (p - SUNSET_AT) / (1 - SUNSET_AT);
      const e = smooth(u);
      elevation = SUNSET_SUN.elevation + (NIGHT_SUN.elevation - SUNSET_SUN.elevation) * e;
      azimuth = SUNSET_SUN.azimuth + (NIGHT_SUN.azimuth - SUNSET_SUN.azimuth) * u;
    }
  } else {
    // Night → morning: up out of the sea to starboard, climbing to the afternoon position.
    const u = smooth(1 - p);
    elevation = DAWN_SUN.elevation + (DAY_SUN.elevation - DAWN_SUN.elevation) * u;
    azimuth = DAWN_SUN.azimuth + (DAY_SUN.azimuth - DAWN_SUN.azimuth) * u;
  }
  out.phase = phase;
  out.sunElevation = elevation;
  directionFrom(elevation, azimuth, out.sunDirection);
  sunColourAt(elevation, out.sunColor);
  out.sunVisible = smoothstep(-0.8, 1.2, elevation);
  out.night = smoothstep(3, -9, elevation);
  out.twilight = smoothstep(4, -1, elevation) * (1 - smoothstep(-5, -14, elevation));

  // The key light hands over from sun to moon while both are at zero, so the
  // switch of direction (and of the shadow map) is never seen.
  const sunI = curve(SUN_INTENSITY, elevation);
  const moonI = curve(MOON_INTENSITY, elevation);
  if (elevation > -2) {
    out.keyDirection.copy(out.sunDirection);
    out.keyColor.copy(out.sunColor);
    out.keyIntensity = sunI;
  } else {
    out.keyDirection.copy(out.moonDirection);
    out.keyColor.copy(MOON_COLOUR);
    out.keyIntensity = moonI;
  }
  out.keyIrradiance.copy(out.keyColor).multiplyScalar(out.keyIntensity / Math.PI);
  out.exposure = curve(EXPOSURE, elevation);
  out.environment = curve(ENVIRONMENT, elevation);
  out.background = curve(BACKGROUND, elevation);
  out.haze = curve(HAZE, elevation);
  out.revision += 1;
  return out;
}

evaluateDaylight(0);

/**
 * Advances the phase towards the target. Called once per frame by the
 * scene's driver; returns true if anything changed.
 */
export function stepDaylight(delta: number): boolean {
  const d = daylight;
  if (d.phase === d.target) {
    d.moving = false;
    return false;
  }
  if (!d.moving) d.path = d.target > d.phase ? 'dusk' : 'dawn';
  const step = Math.min(delta, 0.1) / TRANSITION_SECONDS;
  d.phase = d.target > d.phase ? Math.min(d.target, d.phase + step) : Math.max(d.target, d.phase - step);
  d.moving = d.phase !== d.target;
  evaluateDaylight(d.phase);
  return true;
}

/** Jumps straight to a state (first frame, tests, screenshots). */
export function setDaylightImmediately(target: number, path: DaylightState['path'] = 'dusk'): void {
  daylight.target = target;
  daylight.path = path;
  daylight.moving = false;
  evaluateDaylight(target);
}
