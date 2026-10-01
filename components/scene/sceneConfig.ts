/**
 * Scene-wide constants: the coordinate convention, camera defaults, render
 * layers and the colours the 3D view shares with the HUD.
 *
 * COORDINATE SYSTEM (identical to the one used by the JSON model):
 *   +X -> forward (bow)      +Y -> up (0 = baseline)      +Z -> starboard
 *   1 unit = 1 metre
 */

export const AXES = {
  forward: 'x',
  up: 'y',
  starboard: 'z',
} as const;

/** Tessellation of the lofted hull. Higher = smoother, heavier. */
export const HULL_TESSELLATION = {
  /** Transverse sections along the length. */
  stations: 40,
  /** Samples per half-section, keel to deck edge. */
  samples: 9,
  /** Draw a station line every N stations in the wireframe overlay. */
  stationLineStep: 4,
  /** Draw a longitudinal line every N section samples. */
  longitudinalLineStep: 3,
} as const;

/** Deck plates are cut from the hull outline at this resolution. */
export const DECK_OUTLINE_STATIONS = 48;

/** How the deck bands come apart in the exploded view. */
export const EXPLODE = {
  /** Vertical gap between consecutive bands at full explode, in metres. */
  gap: 11,
  /** Exponential easing rate towards the target offset. */
  easeSpeed: 3.4,
  /**
   * How far the whole vessel rises as it opens, in metres.
   *
   * The lowest band sits between the keel and the tank top — entirely below
   * the waterline. Pulling the decks apart without also lifting the ship
   * leaves that band underwater and hidden, which is precisely the part the
   * exploded view exists to show. Clearing the draught plus the wave crests
   * lifts it into daylight.
   */
  lift: 7.4,
} as const;

/*
 * Exposure and light balance live with the time of day now: they change as
 * the sun moves (components/scene/daylight.ts).
 */

export const CAMERA = {
  fov: 38,
  near: 0.6,
  /** The sea runs 30 km out, to meet the sky at the horizon. */
  far: 40000,
  /** Opening position: off the starboard bow, low enough to frame the setting sun. */
  position: [104, 30, 128] as const,
  /** Orbit target: slightly aft of amidships, where the machinery sits. */
  target: [-8, 8, 0] as const,
  minDistance: 12,
  maxDistance: 420,
  /** Stop the camera from dropping under the keel. */
  maxPolarAngle: Math.PI * 0.495,
  minPolarAngle: Math.PI * 0.04,
} as const;

/**
 * Render layers. Only markers are raycast; if the hull and the compartment
 * volumes stayed pickable they would swallow every click meant for a component.
 */
export const LAYERS = {
  default: 0,
  structure: 1,
  markers: 2,
} as const;

/** Colours shared with the HUD tokens in app/globals.css. */
export const SCENE_COLORS = {
  background: '#0a0f16',
  hullSurface: '#4d6b8a',
  hullWire: '#5f8fb0',
  deckPlate: '#3c5670',
  deckEdge: '#7aa6c2',
  compartment: '#2f4a66',
  compartmentActive: '#38d6f2',
  superstructure: '#415d78',
  waterline: '#2fa8c8',
  grid: '#16202e',
  markerIdle: '#9fb4c8',
  selection: '#38d6f2',
  hover: '#eaf6fb',
} as const;

/** Opacity of the see-through structure, tuned so interiors stay readable. */
export const SURFACE_OPACITY = {
  hull: 0.07,
  deck: 0.16,
  compartment: 0.05,
  compartmentActive: 0.14,
  superstructure: 0.06,
} as const;
