'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Compartment, Deck, HullSpec, Vessel, VesselComponent } from '@/lib/engine/types';
import { type HullSide, keepSideFor, sideSign } from '@/lib/geometry/hullShape';
import { type DeckBand, bulkheadStationsForBand } from '@/lib/geometry/deckBands';
import {
  buildBandEdgeGeometry,
  buildBandShellGeometry,
  buildBulkheadGeometry,
  buildDeckMarkingGeometry,
  buildDeckSlabGeometry,
  buildTransomGeometry,
} from './hullGeometry';
import { PAINT_BANDS, REFERENCE_COLORS, SURFACES } from './materials';
import { createSurfaceMaterial } from './pbr/surfaceMaterial';
import { buildDeckRailing, buildDeckhouse } from './parts/superstructure';
import { withNightWindows } from './nightWindows';
import { EXPLODE } from './sceneConfig';
import { registerFocusTarget } from './focusRegistry';
import { bandKey } from './bands';

const noRaycast = (): null => null;

/** Stable empty list, so a band without compartments does not churn its memos. */
const EMPTY_COMPARTMENTS: readonly Compartment[] = [];

/**
 * Structure materials live at module scope, created once and shared by every
 * band.
 *
 * They deliberately are NOT disposed in an effect. Under React Strict Mode the
 * mount/cleanup/mount cycle would dispose the very instances the second mount
 * reuses from the memo cache, and a disposed material renders nothing at all —
 * silently, with no console error. There is a fixed handful of these and they
 * live as long as the page, so owning them at module scope is both simpler and
 * safer than reference counting.
 *
 * The shell carries its paint scheme in a vertex colour attribute — antifouling,
 * boot top, topsides — so its material is white and lets those through, with the
 * waterline scum band keyed to the same height.
 */
const BAND_MATERIALS = {
  // The shell and the slabs are closed solids, so back faces can be culled.
  plating: createSurfaceMaterial(SURFACES.hullPlate, {
    vertexColors: true,
    waterline: PAINT_BANDS.antifoulTop,
    paintScheme: {
      heights: [PAINT_BANDS.antifoulTop, PAINT_BANDS.boottopTop],
      colors: [SURFACES.hullAntifoul.color, SURFACES.hullBoottop.color, SURFACES.hullPlate.color],
      roughness: [1.5, 0.95, 1],
    },
  }),
  cut: createSurfaceMaterial(SURFACES.cutFace),
  deck: createSurfaceMaterial(SURFACES.deckPlate),
  tankTop: createSurfaceMaterial(SURFACES.tankTop),
  // Bulkheads are single panels and are seen from both sides.
  bulkhead: createSurfaceMaterial(SURFACES.bulkhead, { side: THREE.DoubleSide }),
  deckhouse: createSurfaceMaterial(SURFACES.deckhouse, { side: THREE.DoubleSide }),
  // Lit cabins after dark (nightWindows.ts).
  glazing: withNightWindows(createSurfaceMaterial(SURFACES.glazing)),
  framing: createSurfaceMaterial(SURFACES.framing, { side: THREE.DoubleSide }),
  safetyOrange: createSurfaceMaterial(SURFACES.safetyOrange, { side: THREE.DoubleSide }),
  galvanised: createSurfaceMaterial(SURFACES.galvanised, { side: THREE.DoubleSide }),
  marking: (() => {
    const paint = createSurfaceMaterial(SURFACES.liveryYellow);
    // Sits a centimetre above the deck plate; pull it forward in depth too so
    // it never flickers against the plate from far away.
    paint.polygonOffset = true;
    paint.polygonOffsetFactor = -2;
    paint.polygonOffsetUnits = -2;
    return paint;
  })(),
} as const;

const CUT_CLOSED = new THREE.Color(SURFACES.hullPlate.color);

const CUT_OPEN = new THREE.Color(SURFACES.cutFace.color);

/**
 * Eases the cut-face colour with the explode. Lives once, at the top of the
 * structure, because the material is shared: every band opens together, so
 * there is nothing to animate per band.
 */
function CutFaceTint({ explodeAmount }: { explodeAmount: number }): null {
  const openness = useRef(explodeAmount);
  const initialised = useRef(false);

  useFrame((state, delta) => {
    // The resting colour has to be written at least once: skipping it while the
    // model is closed leaves the cut faces at their constructor red.
    if (!initialised.current) {
      initialised.current = true;
      BAND_MATERIALS.cut.color.copy(CUT_CLOSED).lerp(CUT_OPEN, openness.current);
    }

    const remaining = explodeAmount - openness.current;
    if (Math.abs(remaining) < 0.002) return;

    openness.current += remaining * (1 - Math.exp(-EXPLODE.easeSpeed * delta));
    BAND_MATERIALS.cut.color.copy(CUT_CLOSED).lerp(CUT_OPEN, openness.current);
    state.invalidate();
  });

  return null;
}

/**
 * Section geometry, built once per band and side and then kept.
 *
 * Switching FROM STBD / FROM PORT / WHOLE used to rebuild every band's plating,
 * and the replaced geometries were never freed (R3F does not dispose geometry
 * passed in as a prop), so video memory grew with every toggle. There are only
 * three sides, so keeping all variants caps the cost and makes the switch
 * instant the second time.
 */
const sectionCache = new Map<string, unknown>();
function cachedSection<T>(key: string, build: () => T): T {
  if (sectionCache.has(key)) return sectionCache.get(key) as T;
  const value = build();
  sectionCache.set(key, value);
  return value;
}

interface DeckBandGroupProps {
  readonly vessel: Vessel;
  readonly band: DeckBand;
  readonly cutSide: HullSide;
  readonly explodeAmount: number;
  readonly showCompartments: boolean;
  readonly showEdges: boolean;
  readonly compartments: readonly Compartment[];
  readonly decks: readonly Deck[];
  readonly activeCompartmentId: string | null;
  readonly children?: React.ReactNode;
}

/**
 * One horizontal slice of the ship: floor, shell plating, bulkheads and
 * whatever sits on that level.
 *
 * The explode offset is eased here in `useFrame` rather than stored per frame
 * in React state — re-rendering the tree sixty times a second to move a group
 * would be wasteful, and the store only needs to hold the target.
 */
function DeckBandGroup({
  vessel,
  band,
  cutSide,
  explodeAmount,
  showCompartments,
  showEdges,
  compartments,
  decks,
  activeCompartmentId,
  children,
}: DeckBandGroupProps): React.ReactElement {
  const groupRef = useRef<THREE.Group>(null);
  const hull: HullSpec = vessel.hull;

  // Overlays (access route, cascade links) follow this band as it moves.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return undefined;
    return registerFocusTarget(bandKey(band.deckId), group);
  }, [band.deckId]);
  // `cutSide` is the half removed; the builders want the half kept.
  const keepSide = keepSideFor(cutSide);

  const shell = useMemo(
    () =>
      band.isDeckhouse
        ? null
        : cachedSection(`shell|${band.deckId}|${keepSide}`, () =>
            buildBandShellGeometry(hull, band.yBottom, band.yTop, keepSide),
          ),
    [hull, band, keepSide],
  );
  const transom = useMemo(
    () =>
      band.isDeckhouse
        ? null
        : cachedSection(`transom|${band.deckId}|${keepSide}`, () =>
            buildTransomGeometry(hull, band.yBottom, band.yTop, keepSide),
          ),
    [hull, band, keepSide],
  );
  const floorSlabs = useMemo(
    () =>
      band.containedDeckIds
        .map((deckId) => decks.find((deck) => deck.id === deckId))
        .filter((deck): deck is Deck => Boolean(deck))
        // A deck plate is cut from the hull outline at its own height, so only
        // decks inside the hull can have one. Anything above the moulded depth
        // is deckhouse structure and is built there instead — clamping its
        // height and then lifting it put a full-length plate through the cranes.
        .filter((deck) => deck.level <= hull.depth + 1e-6)
        .map((deck) => ({
          deck,
          geometry: cachedSection(`slab|${deck.id}|${keepSide}`, () => buildDeckSlabGeometry(hull, deck.level, keepSide)),
          // Only the weather deck carries painted walkway lines.
          markings:
            Math.abs(deck.level - hull.depth) < 1e-3
              ? cachedSection(`markings|${deck.id}|${keepSide}`, () =>
                  buildDeckMarkingGeometry(hull, deck.level, keepSide),
                )
              : null,
        })),
    [hull, band, keepSide, decks],
  );
  const sheerEdge = useMemo(
    () =>
      band.isDeckhouse
        ? null
        : cachedSection(`edge|${band.deckId}|${keepSide}`, () => buildBandEdgeGeometry(hull, band.yTop, keepSide)),
    [hull, band, keepSide],
  );
  const railing = useMemo(
    () =>
      band.isDeckhouse ? cachedSection(`railing|${keepSide}`, () => buildDeckRailing(hull, hull.depth, keepSide)) : null,
    [band.isDeckhouse, hull, keepSide],
  );

  const bulkheads = useMemo(() => {
    if (band.isDeckhouse) return [];
    return cachedSection(`bulkheads|${band.deckId}|${keepSide}`, () =>
      bulkheadStationsForBand(vessel, band).map((x) => ({
        x,
        geometry: buildBulkheadGeometry(hull, x, band.yBottom, band.yTop, keepSide),
      })),
    );
  }, [vessel, hull, band, keepSide]);

  const compartmentEdges = useMemo(
    () =>
      compartments.map((compartment) => {
        const { min, max } = compartment.bounds;
        const size: [number, number, number] = [max.x - min.x, max.y - min.y, max.z - min.z];
        return {
          id: compartment.id,
          centre: [
            (max.x + min.x) / 2,
            (max.y + min.y) / 2,
            (max.z + min.z) / 2,
          ] as [number, number, number],
          geometry: new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)),
        };
      }),
    [compartments],
  );

  const targetY = band.index * EXPLODE.gap * explodeAmount;

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const remaining = targetY - group.position.y;
    if (Math.abs(remaining) < 0.001) {
      group.position.y = targetY;
      return;
    }
    group.position.y += remaining * (1 - Math.exp(-EXPLODE.easeSpeed * delta));
    state.invalidate();
  });

  return (
    <group ref={groupRef}>
      {/* Shell plating as a solid: material 0 is the plating itself, material 1
          the exposed thickness where the band was cut. */}
      {shell ? (
        <mesh
          geometry={shell}
          material={[BAND_MATERIALS.plating, BAND_MATERIALS.cut]}
          raycast={noRaycast}
          castShadow
          receiveShadow
        />
      ) : null}

      {transom ? <mesh geometry={transom} material={BAND_MATERIALS.plating} raycast={noRaycast} castShadow receiveShadow /> : null}

      {/* Deck slabs. Material 0 is the plating, material 1 the extruded rim —
          which, on the centreline, is exactly the cut. Red oxide there is the
          convention that tells the eye this model was sliced open. */}
      {floorSlabs.map(({ deck, geometry, markings }) =>
        geometry ? (
          <group key={deck.id} position={[0, deck.level, 0]}>
            <mesh
              geometry={geometry}
              material={[deck.level < 0.1 ? BAND_MATERIALS.tankTop : BAND_MATERIALS.deck, BAND_MATERIALS.cut]}
              raycast={noRaycast}
              receiveShadow
            />
            {markings ? (
              <mesh geometry={markings} material={BAND_MATERIALS.marking} raycast={noRaycast} receiveShadow />
            ) : null}
          </group>
        ) : null,
      )}

      {bulkheads.map(({ x, geometry }) => (
        <mesh
          key={`bhd-${x.toFixed(2)}`}
          geometry={geometry}
          material={BAND_MATERIALS.bulkhead}
          raycast={noRaycast}
          receiveShadow
        />
      ))}

      {railing ? (
        <mesh geometry={railing} material={BAND_MATERIALS.galvanised} raycast={noRaycast} castShadow />
      ) : null}

      {sheerEdge ? (
        <lineSegments geometry={sheerEdge} raycast={noRaycast}>
          <lineBasicMaterial color={REFERENCE_COLORS.sheerLine} transparent opacity={0.5} />
        </lineSegments>
      ) : null}

      {showCompartments && showEdges
        ? compartmentEdges.map((box) => (
            <lineSegments
              key={box.id}
              geometry={box.geometry}
              position={box.centre}
              raycast={noRaycast}
            >
              <lineBasicMaterial
                color={
                  box.id === activeCompartmentId
                    ? REFERENCE_COLORS.compartmentEdgeActive
                    : REFERENCE_COLORS.compartmentEdge
                }
                transparent
                opacity={box.id === activeCompartmentId ? 0.85 : 0.18}
              />
            </lineSegments>
          ))
        : null}

      {children}
    </group>
  );
}

interface VesselStructureProps {
  readonly vessel: Vessel;
  readonly cutSide: HullSide;
  readonly explodeAmount: number;
  readonly showCompartments: boolean;
  readonly showEdges: boolean;
  readonly activeCompartmentId: string | null;
  readonly componentsByBand: ReadonlyMap<string, readonly VesselComponent[]>;
  readonly compartmentsByBand: ReadonlyMap<string, readonly Compartment[]>;
  readonly bands: readonly DeckBand[];
  readonly renderComponent: (component: VesselComponent) => React.ReactNode;
}

/**
 * Lifts the vessel clear of the sea while it is open.
 *
 * Separate from the per-band offsets: those spread the decks apart, this raises
 * the whole thing so the bottom band is not left submerged.
 */
function useVesselLift(explodeAmount: number): React.RefObject<THREE.Group | null> {
  const groupRef = useRef<THREE.Group>(null);
  const target = explodeAmount * EXPLODE.lift;

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const remaining = target - group.position.y;
    if (Math.abs(remaining) < 0.001) {
      group.position.y = target;
      return;
    }
    group.position.y += remaining * (1 - Math.exp(-EXPLODE.easeSpeed * delta));
    state.invalidate();
  });

  return groupRef;
}

/** The whole sectioned hull, band by band. */
export function VesselStructure({
  vessel,
  cutSide,
  explodeAmount,
  showCompartments,
  showEdges,
  activeCompartmentId,
  componentsByBand,
  compartmentsByBand,
  bands,
  renderComponent,
}: VesselStructureProps): React.ReactElement {
  const liftRef = useVesselLift(explodeAmount);

  return (
    <group ref={liftRef}>
      <CutFaceTint explodeAmount={explodeAmount} />
      {bands.map((band) => {
        const compartments = compartmentsByBand.get(band.deckId) ?? EMPTY_COMPARTMENTS;
        const components = componentsByBand.get(band.deckId) ?? [];

        return (
          <DeckBandGroup
            key={band.deckId}
            vessel={vessel}
            band={band}
            cutSide={cutSide}
            explodeAmount={explodeAmount}
            showCompartments={showCompartments}
            showEdges={showEdges}
            compartments={compartments}
            decks={vessel.decks}
            activeCompartmentId={activeCompartmentId}
          >
            {band.isDeckhouse ? <Deckhouse vessel={vessel} cutSide={cutSide} /> : null}
            {components.map((component) => renderComponent(component))}
          </DeckBandGroup>
        );
      })}
    </group>
  );
}

/**
 * The deckhouse: three tiers, window bands, bridge wings and railed walkways.
 *
 * Built from the same primitives as the machinery, and halved on the same side
 * as the hull so the section runs continuously from the keel to the bridge.
 */
function Deckhouse({ vessel, cutSide }: { vessel: Vessel; cutSide: HullSide }): React.ReactElement {
  const keepSide = keepSideFor(cutSide);
  const pieces = useMemo(
    () => cachedSection(`deckhouse|${keepSide}`, () => buildDeckhouse(vessel.superstructure.bounds, keepSide)),
    [vessel.superstructure.bounds, keepSide],
  );

  return (
    <group>
      {pieces.map((part) => (
        <mesh
          key={part.id}
          geometry={part.geometry}
          material={BAND_MATERIALS[part.surface]}
          raycast={noRaycast}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}
