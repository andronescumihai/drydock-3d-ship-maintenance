/**
 * DryDock — core domain types.
 *
 * IMPORTANT: this module is pure TypeScript. It must never import React,
 * Three.js or any browser API. The analysis engine has to stay testable in
 * isolation; the 3D scene and the HUD are only two views over its output.
 *
 * Coordinate system (shared by data and scene, see components/scene/sceneConfig.ts):
 *   +X -> forward (towards the bow)
 *   +Y -> up (0 = baseline / keel)
 *   +Z -> starboard
 * One unit = one metre.
 */

export type ComponentId = string;
export type SystemId = string;
export type CompartmentId = string;
export type DeckId = string;
export type AccessNodeId = string;

/** 1 = nice to have, 5 = vessel cannot operate without it. */
export type Criticality = 1 | 2 | 3 | 4 | 5;

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Physical hazards that make a repair riskier, feeding the urgency score. */
export type Hazard =
  | 'arc-flash'
  | 'flooding'
  | 'hot-surface'
  | 'hot-work'
  | 'confined-space'
  | 'pressurised'
  | 'fuel-spill';

export type Material =
  | 'steel-a36'
  | 'stainless-316l'
  | 'cast-iron-gg25'
  | 'bronze-b62'
  | 'copper-nickel-9010'
  | 'titanium-gr1'
  | 'aluminium-5083'
  | 'rubber-epdm'
  | 'grp-composite';

export type SystemKind =
  | 'propulsion'
  | 'electrical'
  | 'cooling'
  | 'fuel'
  | 'ballast'
  | 'bilge'
  | 'deck'
  | 'steering'
  | 'auxiliary'
  | 'navigation';

/**
 * What actually travels along a dependency edge. This matters: a component
 * needs ALL of the resource kinds it consumes, but within one kind ANY live
 * supplier is enough. Losing cooling stops the main engine even though its
 * fuel supply is intact, while losing one of two parallel generators does not
 * black out the switchboard.
 */
export type ResourceKind =
  | 'electrical'
  | 'fuel'
  | 'cooling'
  | 'seawater'
  | 'lubrication'
  | 'hydraulic'
  | 'mechanical'
  | 'control';

/** A directed edge of the dependency graph: `from` supplies `to`. */
export interface SupplyEdge {
  readonly to: ComponentId;
  readonly resource: ResourceKind;
}

/**
 * Which machinery archetype draws this component in 3D.
 *
 * The archetype decides how the component is assembled from parts — a
 * centrifugal pump gets a volute, a bearing housing, a motor and a terminal
 * box. Components without one fall back to their raw primitive shape.
 */
export type MachineArchetype =
  // Machinery spaces
  | 'centrifugal-pump'
  | 'medium-speed-diesel'
  | 'generator-set'
  | 'switchboard'
  | 'plate-heat-exchanger'
  | 'shaft-line'
  | 'sea-chest'
  | 'tank'
  | 'air-compressor'
  | 'purifier'
  | 'steering-gear'
  | 'bow-thruster'
  // Weather deck and outfit
  | 'deck-crane'
  | 'hatch-cover'
  | 'windlass'
  | 'mooring-winch'
  | 'bollard'
  | 'funnel'
  | 'mast'
  | 'lifeboat'
  // Underwater
  | 'propeller'
  | 'rudder';

/** Runtime condition of a component. Never persisted in the JSON data. */
export type ComponentStatus = 'ok' | 'degraded' | 'failed';

// ---------------------------------------------------------------------------
// Vessel structure
// ---------------------------------------------------------------------------

export interface Deck {
  readonly id: DeckId;
  readonly name: string;
  /** Height of the deck plate above baseline, in metres. */
  readonly level: number;
  readonly note: string;
}

/** Axis-aligned bounding box in vessel coordinates. */
export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface Compartment {
  readonly id: CompartmentId;
  readonly name: string;
  readonly deckId: DeckId;
  readonly bounds: Bounds;
  readonly note: string;
}

/** Parametric description of the hull, lofted into geometry at runtime. */
export interface HullSpec {
  /** Length overall, metres. */
  readonly lengthOverall: number;
  /** Moulded beam, metres. */
  readonly beam: number;
  /** Depth to main deck, metres. */
  readonly depth: number;
  /** Design draught, metres — used only for the waterline marker. */
  readonly draught: number;
  /** Fraction of LOA occupied by the parallel mid-body (0..1). */
  readonly parallelMidBody: number;
  /** Section fullness exponent amidships (higher = boxier). */
  readonly midshipFullness: number;
  /** Section fullness exponent at the bow (lower = finer V). */
  readonly bowFullness: number;
  /** Section fullness exponent at the stern. */
  readonly sternFullness: number;
  /** Half-beam at the transom as a fraction of max half-beam. */
  readonly transomWidthRatio: number;
  /** Rise of the deck edge at the bow, metres. */
  readonly sheerForward: number;
  /** Rise of the deck edge at the stern, metres. */
  readonly sheerAft: number;
}

/** The deckhouse, modelled as a simple block rather than a lofted surface. */
export interface Superstructure {
  readonly bounds: Bounds;
  readonly note: string;
}

export interface Vessel {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  /** Honesty label surfaced in the HUD and the README. */
  readonly disclaimer: string;
  readonly hull: HullSpec;
  readonly superstructure: Superstructure;
  readonly decks: readonly Deck[];
  readonly compartments: readonly Compartment[];
}

// ---------------------------------------------------------------------------
// Systems and components
// ---------------------------------------------------------------------------

export interface ShipSystem {
  readonly id: SystemId;
  readonly name: string;
  readonly kind: SystemKind;
  readonly criticality: Criticality;
  /** Hex colour used for this system in the 3D scene and the legend. */
  readonly hudColor: string;
  readonly note: string;
}

/** How long a fix takes and what it costs the crew. */
export interface RepairProfile {
  /** In-situ repair, minutes. */
  readonly meanRepairMinutes: number;
  /** Full replacement, minutes. */
  readonly replaceMinutes: number;
  readonly crewRequired: number;
  /** Welding or grinding — raises fire risk and needs a hot-work permit. */
  readonly requiresHotWork: boolean;
  /** The parent system must be shut down and isolated first. */
  readonly requiresSystemShutdown: boolean;
  readonly sparePartOnboard: boolean;
}

export type ComponentGeometry =
  | { readonly kind: 'box'; readonly size: Vec3; readonly rotationY?: number }
  | { readonly kind: 'cylinder'; readonly radius: number; readonly height: number; readonly axis: 'x' | 'y' | 'z' }
  | { readonly kind: 'sphere'; readonly radius: number }
  | { readonly kind: 'pipe'; readonly radius: number; readonly path: readonly Vec3[] };

export interface VesselComponent {
  readonly id: ComponentId;
  readonly name: string;
  readonly systemId: SystemId;
  readonly compartmentId: CompartmentId;
  /** Centre of the component in vessel coordinates. */
  readonly position: Vec3;
  readonly geometry: ComponentGeometry;
  /** Detailed 3D assembly to draw. Omitted components use `geometry` directly. */
  readonly archetype?: MachineArchetype;
  readonly material: Material;
  readonly criticality: Criticality;
  /**
   * A primary source (sea chest, fuel tank, diesel generator). Sources never
   * fail as a consequence of something upstream — they stop the cascade from
   * propagating backwards through feedback loops.
   */
  readonly isSource: boolean;
  /** Outgoing edges of the dependency graph: what this component supplies. */
  readonly feeds: readonly SupplyEdge[];
  /**
   * Standby units the crew can start by hand if this component is lost.
   * A standby does NOT stop the cascade — the failure still propagates — but
   * it lowers the urgency score and is surfaced in the repair card. Automatic
   * redundancy is modelled instead by two components supplying the same
   * resource kind to the same consumer.
   */
  readonly backedUpBy: readonly ComponentId[];
  /** Entry point of this component in the physical access graph. */
  readonly accessNodeId: AccessNodeId;
  readonly hazards: readonly Hazard[];
  readonly repair: RepairProfile;
  /** Plain-language record of what was modelled, for the honesty section. */
  readonly note: string;
}

// ---------------------------------------------------------------------------
// Access network
// ---------------------------------------------------------------------------

/**
 * What a node in the access network is. Everything except `walkway` and
 * `entry` is an obstacle that costs time to pass: a door to open, a hatch to
 * raise, a ladder to climb, floor plates or a spool piece to remove, or the
 * work face itself, where isolation happens before the job can start.
 */
export type AccessNodeKind = 'entry' | 'walkway' | 'door' | 'hatch' | 'ladder' | 'stair' | 'removal' | 'workface';

export interface AccessNode {
  readonly id: AccessNodeId;
  readonly name: string;
  readonly kind: AccessNodeKind;
  readonly deckId: DeckId;
  readonly compartmentId: CompartmentId;
  readonly position: Vec3;
  /** Minutes to pass, open or dismantle this obstacle. */
  readonly minutes: number;
  /** What the crew actually does here, in the imperative. */
  readonly action: string;
  /** Has to be put back afterwards, so it counts toward reassembly. */
  readonly reinstall?: boolean;
  /** Another component that has to be partly dismantled to get past. */
  readonly componentId?: ComponentId;
}

export interface AccessEdge {
  readonly from: AccessNodeId;
  readonly to: AccessNodeId;
  /** Explicit transit time; if absent the edge is walked at `walkingSpeed`. */
  readonly minutes?: number;
}

export interface AccessNetwork {
  readonly entryNodeId: AccessNodeId;
  /** Metres per second along walked edges. */
  readonly walkingSpeed: number;
  readonly note: string;
  readonly nodes: readonly AccessNode[];
  readonly edges: readonly AccessEdge[];
}
