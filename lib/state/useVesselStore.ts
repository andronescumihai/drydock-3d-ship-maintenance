/**
 * UI state for the digital twin.
 *
 * Deliberately small. The 3D scene holds no state of its own: every marker
 * reads its appearance from here, so the scene stays a pure function of the
 * store and there is nothing to keep in sync by hand.
 */

'use client';

import { create } from 'zustand';
import type { ComponentId, SystemId } from '@/lib/engine/types';
import type { HullSide } from '@/lib/geometry/hullShape';

/**
 * How much GPU budget the scene is allowed to spend.
 *
 * Browsers cap how many WebGL contexts and how much video memory a page may
 * hold. Past that cap the context is taken away and the canvas goes blank for a
 * moment before it is restored — which reads as the image cutting out. Being
 * able to step down, automatically after a loss or by hand, is the difference
 * between a scene that recovers and one that flickers forever.
 */
export type RenderQuality = 'high' | 'balanced' | 'performance';

export interface QualityProfile {
  readonly devicePixelRatioCap: number;
  readonly multisampling: number;
  readonly shadowMapSize: number;
  readonly shadows: boolean;
  readonly ambientOcclusion: boolean;
  readonly bloom: boolean;
  /** Edge length of the visible sky cube, in pixels. */
  readonly skySize: number;
  /** Full-size (2K) hull textures, or the 1K variant. */
  readonly textureResolution: 'full' | 'reduced';
}

export const QUALITY_PROFILES: Readonly<Record<RenderQuality, QualityProfile>> = {
  high: {
    devicePixelRatioCap: 1.5,
    multisampling: 2,
    shadowMapSize: 2048,
    shadows: true,
    ambientOcclusion: true,
    bloom: true,
    skySize: 1024,
    textureResolution: 'full',
  },
  // The default. No effect chain at all: an EffectComposer holds several
  // full-resolution render targets, and on a machine that is already short of
  // video memory those are what push it over the edge.
  balanced: {
    devicePixelRatioCap: 1.15,
    multisampling: 0,
    shadowMapSize: 2048,
    shadows: true,
    ambientOcclusion: false,
    bloom: false,
    skySize: 768,
    textureResolution: 'full',
  },
  performance: {
    devicePixelRatioCap: 1,
    multisampling: 0,
    shadowMapSize: 512,
    shadows: false,
    ambientOcclusion: false,
    bloom: false,
    skySize: 512,
    textureResolution: 'reduced',
  },
};

const QUALITY_ORDER: readonly RenderQuality[] = ['high', 'balanced', 'performance'];
import { vesselModel } from '@/lib/data/loader';

export interface VesselUiState {
  readonly selectedId: ComponentId | null;
  /** Individual part inside the selected component, e.g. 'impeller'. */
  readonly selectedPieceId: string | null;
  readonly hoveredId: ComponentId | null;
  /** Systems currently drawn. Empty set would hide everything, so we guard it. */
  readonly visibleSystemIds: ReadonlySet<SystemId>;
  readonly showCompartments: boolean;
  readonly showStructure: boolean;
  /**
   * How far the deck bands are pulled apart, 0 (closed hull) to 1 (fully
   * exploded). The scene eases towards this value rather than snapping.
   */
  readonly explodeAmount: number;
  /** Which half of the hull is cut away to reveal the interior. Only ever changed by the user. */
  readonly cutSide: HullSide;
  /**
   * Bumped each time the WebGL context is restored after a loss. Everything
   * rendered once and kept (sky, environment light, shadow map) keys on it and
   * renders again, since a restored context starts empty.
   */
  readonly contextEpoch: number;
  /** Rolling render statistics, reported a few times a second in development. */
  readonly renderQuality: RenderQuality;
  readonly frameStats: {
    readonly fps: number;
    readonly ms: number;
    readonly pixels: string;
    /** Times the WebGL context has been lost. Anything above zero is the bug. */
    readonly contextLosses: number;
  };

  /** Which analysis view is open in the side panel. */
  readonly analysisTab: AnalysisTab;
  /**
   * The component whose failure is being simulated, or null. While set, the
   * scene shows the cascade and the HUD shows the incident.
   */
  readonly simulatedFailureId: ComponentId | null;
  /** performance.now() when the simulation started, to pace the cascade animation. */
  readonly simulationStartedAt: number;
  /** Draw the access route in 3D. */
  readonly showAccessPath: boolean;
  /**
   * Lighting of the scene. The sky, sun, sea and every light ease between the
   * two over a few seconds (the sun actually sets), see components/scene/daylight.ts.
   */
  readonly timeOfDay: TimeOfDay;

  select: (id: ComponentId | null) => void;
  setAnalysisTab: (tab: AnalysisTab) => void;
  simulateFailure: (id: ComponentId) => void;
  clearSimulation: () => void;
  setShowAccessPath: (value: boolean) => void;
  selectPiece: (componentId: ComponentId, pieceId: string | null) => void;
  hover: (id: ComponentId | null) => void;
  toggleSystem: (id: SystemId) => void;
  showAllSystems: () => void;
  isolateSystem: (id: SystemId) => void;
  setShowCompartments: (value: boolean) => void;
  setShowStructure: (value: boolean) => void;
  setExplodeAmount: (value: number) => void;
  toggleExplode: () => void;
  setCutSide: (side: HullSide) => void;
  reportFrameStats: (stats: { fps: number; ms: number; pixels: string; contextLosses: number }) => void;
  setRenderQuality: (quality: RenderQuality) => void;
  /** Steps down one level. Called automatically when the GPU drops the context. */
  degradeRenderQuality: () => void;
  /** Called by the context guard when the browser hands the WebGL context back. */
  markContextRestored: () => void;
  setTimeOfDay: (value: TimeOfDay) => void;
}

export type TimeOfDay = 'day' | 'night';

export type AnalysisTab = 'overview' | 'impact' | 'access' | 'repair' | 'urgency';

const ALL_SYSTEM_IDS: ReadonlySet<SystemId> = new Set(
  vesselModel.systems.map((system) => system.id),
);

export const useVesselStore = create<VesselUiState>()((set) => ({
  selectedId: null,
  selectedPieceId: null,
  hoveredId: null,
  visibleSystemIds: ALL_SYSTEM_IDS,
  showCompartments: false,
  showStructure: true,
  explodeAmount: 0,
  cutSide: 'both',
  contextEpoch: 0,
  renderQuality: 'balanced',
  frameStats: { fps: 0, ms: 0, pixels: '', contextLosses: 0 },
  analysisTab: 'overview',
  simulatedFailureId: null,
  simulationStartedAt: 0,
  showAccessPath: false,
  timeOfDay: 'day',

  select: (id) => set({ selectedId: id, selectedPieceId: null }),
  setAnalysisTab: (tab) => set({ analysisTab: tab, showAccessPath: tab === 'access' }),
  simulateFailure: (id) =>
    set({
      simulatedFailureId: id,
      simulationStartedAt: typeof performance === 'undefined' ? 0 : performance.now(),
      analysisTab: 'impact',
      showAccessPath: false,
    }),
  clearSimulation: () => set({ simulatedFailureId: null }),
  setShowAccessPath: (value) => set({ showAccessPath: value }),
  selectPiece: (componentId, pieceId) => set({ selectedId: componentId, selectedPieceId: pieceId }),
  hover: (id) => set({ hoveredId: id }),

  toggleSystem: (id) =>
    set((state) => {
      const next = new Set(state.visibleSystemIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Never let the user end up with an empty scene and no way back.
      if (next.size === 0) return { visibleSystemIds: ALL_SYSTEM_IDS };
      return { visibleSystemIds: next };
    }),

  showAllSystems: () => set({ visibleSystemIds: ALL_SYSTEM_IDS }),
  isolateSystem: (id) => set({ visibleSystemIds: new Set([id]) }),
  setShowCompartments: (value) => set({ showCompartments: value }),
  setShowStructure: (value) => set({ showStructure: value }),

  setExplodeAmount: (value) => set({ explodeAmount: Math.min(1, Math.max(0, value)) }),
  toggleExplode: () => set((state) => ({ explodeAmount: state.explodeAmount > 0.5 ? 0 : 1 })),
  setCutSide: (side) => set({ cutSide: side }),
  reportFrameStats: (stats) => set({ frameStats: stats }),

  setRenderQuality: (quality) => set({ renderQuality: quality }),
  degradeRenderQuality: () =>
    set((state) => {
      const next = QUALITY_ORDER[QUALITY_ORDER.indexOf(state.renderQuality) + 1];
      return next ? { renderQuality: next } : {};
    }),
  markContextRestored: () => set((state) => ({ contextEpoch: state.contextEpoch + 1 })),
  setTimeOfDay: (value) => set({ timeOfDay: value }),
}));
