/**
 * Surface catalogue: what every part of the vessel is made of and how it has
 * aged.
 *
 * Values follow physically based conventions. Paint is a DIELECTRIC — its
 * metalness is 0 whatever it is painted onto — and only bare metal (galvanising,
 * bronze, copper, wire rope) is metallic. Getting that one rule right is most of
 * the difference between "painted steel" and "grey plastic".
 *
 * `set` picks the baked texture set (see `pbr/textureSets.ts`) that supplies the
 * micro-surface: plating seams and weld beads, non-skid grit, cast texture,
 * brushed metal. `wear` scales the three baked wear masks — rust, grime, and
 * chipped paint — per surface, so a deckhouse stays cleaner than a tank top.
 */

export type TextureSetName = 'hull' | 'deck' | 'paint' | 'metal';

export interface SurfaceSpec {
  /** Base colour (sRGB). For paint, the paint; for metal, the reflectance tint. */
  readonly color: string;
  /** Roughness where the baked roughness map is neutral. */
  readonly roughness: number;
  readonly metalness: number;
  /** Baked micro-surface; omitted for surfaces that are smooth by nature (glass). */
  readonly set?: TextureSetName;
  /** Amount of [rust, grime, chipped paint] applied from the wear masks, 0..1+. */
  readonly wear?: readonly [number, number, number];
  /** What shows through a chip: red-oxide primer on painted steel. */
  readonly chipColor?: string;
  /** Metalness where chipped (bare metal under the paint, or none under primer). */
  readonly chipMetalness?: number;
  /** Rust colour — iron oxide by default, verdigris for copper alloys. */
  readonly rustColor?: string;
  /** Roughness added by grime: positive for dust, negative for oil films. */
  readonly grimeRoughness?: number;
  /** Strength of the normal map. */
  readonly normalStrength?: number;
  /** Strength of large-scale, non-repeating tonal variation. */
  readonly macro?: number;
  /** Multiplier on reflections — glass is defined by what it reflects. */
  readonly envMapIntensity?: number;
}

const PRIMER = '#6a3322';
const IRON_OXIDE = '#5a2a14';
const VERDIGRIS = '#4d7a66';

export const SURFACES = {
  /** Topsides above the boot top — offshore signal red. */
  hullPlate: {
    color: '#a3221a', roughness: 0.5, metalness: 0, set: 'hull',
    wear: [0.9, 0.55, 0.7], chipColor: PRIMER, macro: 0.16,
  },
  /** Boot top stripe and antifouling. Only their colours feed the paint scheme. */
  hullBoottop: { color: '#141619', roughness: 0.5, metalness: 0, set: 'hull' },
  hullAntifoul: { color: '#3f1a15', roughness: 0.75, metalness: 0, set: 'hull' },
  /** Inboard face of the shell — painted light, as machinery spaces are. */
  hullInner: {
    color: '#78857f', roughness: 0.55, metalness: 0, set: 'hull',
    wear: [0.35, 0.5, 0.35], chipColor: PRIMER, macro: 0.12,
  },
  /** Cut material, red-oxide primer. The strongest "this is sectioned" cue. */
  cutFace: { color: '#b4502f', roughness: 0.8, metalness: 0, set: 'hull', wear: [0, 0.2, 0], macro: 0.08 },
  /** Weather deck: green non-skid coating. */
  deckPlate: {
    color: '#3d6a4a', roughness: 0.82, metalness: 0, set: 'deck',
    wear: [0.7, 0.8, 0.8], chipColor: PRIMER, normalStrength: 1.2, macro: 0.2,
  },
  /** Tank top — darker, oil-filmed. */
  tankTop: {
    color: '#3b434b', roughness: 0.55, metalness: 0, set: 'hull',
    wear: [0.5, 1.0, 0.45], chipColor: PRIMER, grimeRoughness: -0.28, macro: 0.2,
  },
  /** Bulkheads, painted machinery-space grey-green. */
  bulkhead: {
    color: '#879489', roughness: 0.58, metalness: 0, set: 'hull',
    wear: [0.45, 0.55, 0.4], chipColor: PRIMER, macro: 0.12,
  },
  /** Deckhouse — white, as on most offshore and supply vessels. */
  deckhouse: {
    color: '#e6eaec', roughness: 0.42, metalness: 0, set: 'hull',
    wear: [0.55, 0.45, 0.35], chipColor: PRIMER, macro: 0.1, normalStrength: 0.8,
  },
  /** Bridge and accommodation glazing. */
  glazing: { color: '#141d26', roughness: 0.03, metalness: 0, envMapIntensity: 3 },
  /** Structural framing, brackets, machinery seatings. */
  framing: {
    color: '#39424c', roughness: 0.5, metalness: 0, set: 'paint',
    wear: [0.6, 0.6, 0.6], chipColor: PRIMER, macro: 0.1,
  },
  /** Handrails, davits, anything marked for safety. */
  safetyOrange: {
    color: '#d4541a', roughness: 0.4, metalness: 0, set: 'paint',
    wear: [0.45, 0.45, 0.6], chipColor: PRIMER, macro: 0.08,
  },
  safetyYellow: {
    color: '#d6a31e', roughness: 0.42, metalness: 0, set: 'paint',
    wear: [0.45, 0.5, 0.6], chipColor: PRIMER, macro: 0.08,
  },
  /** Livery accents: cranes and deck markings in safety yellow. */
  liveryYellow: {
    color: '#eeb00a', roughness: 0.42, metalness: 0, set: 'paint',
    wear: [0.45, 0.5, 0.65], chipColor: PRIMER, macro: 0.08,
  },
  /** Company colour: funnel band and deck machinery. */
  liveryBlue: {
    color: '#1d4f91', roughness: 0.4, metalness: 0, set: 'paint',
    wear: [0.35, 0.45, 0.5], chipColor: PRIMER, macro: 0.08,
  },
  /** Hatch cover panels. */
  hatchPanel: {
    color: '#39648f', roughness: 0.5, metalness: 0, set: 'hull',
    wear: [0.7, 0.6, 0.7], chipColor: PRIMER, macro: 0.14,
  },
  /** Pipework painted to its ISO 14726 colour; the colour itself comes from the livery. */
  paintedPipe: {
    color: '#808080', roughness: 0.42, metalness: 0, set: 'paint',
    wear: [0.3, 0.55, 0.45], chipColor: PRIMER, grimeRoughness: -0.15, macro: 0.06,
  },
  /** Galvanised gratings, walkways, guards — zinc, which "rusts" white. */
  galvanised: {
    color: '#a4abb1', roughness: 0.5, metalness: 0.9, set: 'metal',
    wear: [0.35, 0.6, 0.3], rustColor: '#aaa597', chipColor: '#6f757b', chipMetalness: 0.9, macro: 0.12,
  },
  /** Pump casings and sea-water valves. */
  bronze: {
    color: '#b27f48', roughness: 0.34, metalness: 1, set: 'metal',
    wear: [0.35, 0.5, 0.2], rustColor: VERDIGRIS, chipColor: '#8a6034', chipMetalness: 1, macro: 0.1,
  },
  /** Cooling pipework. */
  copper: {
    color: '#b9714b', roughness: 0.3, metalness: 1, set: 'metal',
    wear: [0.3, 0.45, 0.2], rustColor: VERDIGRIS, chipColor: '#7c4a30', chipMetalness: 1, macro: 0.1,
  },
  /** Machinery block castings, painted engine grey. */
  castIron: {
    color: '#4f565e', roughness: 0.48, metalness: 0, set: 'paint',
    wear: [0.25, 0.9, 0.45], chipColor: '#3b3d40', chipMetalness: 0.7, grimeRoughness: -0.25, macro: 0.1,
  },
  /** Switchboard and control cabinets. */
  cabinet: {
    color: '#7b838c', roughness: 0.4, metalness: 0, set: 'paint',
    wear: [0.05, 0.35, 0.2], chipColor: '#9aa0a6', chipMetalness: 0.8, macro: 0.06,
  },
  /** Wire rope, chain, rigging. */
  rigging: {
    color: '#5d636a', roughness: 0.55, metalness: 0.85, set: 'metal',
    wear: [0.7, 0.8, 0.2], chipColor: '#3f4247', chipMetalness: 0.85, grimeRoughness: -0.15, macro: 0.1,
  },
} as const satisfies Record<string, SurfaceSpec>;

export type SurfaceName = keyof typeof SURFACES;

/** Defaults for the system-coloured "accent" parts: enamel on machinery. */
export const ACCENT_SURFACE: Omit<SurfaceSpec, 'color'> = {
  roughness: 0.38,
  metalness: 0,
  set: 'paint',
  wear: [0.2, 0.55, 0.45],
  chipColor: PRIMER,
  grimeRoughness: -0.15,
  macro: 0.06,
};

export const WEAR_COLORS = {
  rust: IRON_OXIDE,
  /** Grime multiplies the surface: a warm, sooty brown-grey. */
  grime: '#5b544b',
} as const;

/** Heights, in metres above baseline, where the hull paint scheme changes. */
export const PAINT_BANDS = {
  /**
   * Top of the antifouling — the summer load line. The ship floats a little
   * above it (vessel.json draught 3.85 m), so a strip of antifouling shows
   * above the water, as on any working ship not loaded to her marks.
   */
  antifoulTop: 4.2,
  /** Top of the boot top stripe. */
  boottopTop: 5.0,
} as const;

/** Waterline and other reference marks that should read as drawn, not lit. */
export const REFERENCE_COLORS = {
  background: '#0a0f16',
  waterline: '#2fa8c8',
  keelLine: '#26323f',
  sheerLine: '#7d90a4',
  grid: '#141d28',
  gridSection: '#243243',
  compartmentEdge: '#6f8296',
  compartmentEdgeActive: '#38d6f2',
  selection: '#38d6f2',
  hover: '#eaf6fb',
} as const;
