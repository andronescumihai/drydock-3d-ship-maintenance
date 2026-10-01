'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { VesselComponent } from '@/lib/engine/types';
import { REFERENCE_COLORS } from './materials';
import { buildAssembly } from './parts/archetypes';
import { specFromGeometry } from './parts/spec';
import { getPieceMaterial, type PieceState } from './pbr/surfaceMaterial';
import { registerFocusTarget } from './focusRegistry';
import { liveryFor } from './livery';
import { getXRayMaterial, type XRayKind } from './xray';

const noRaycast = (): null => null;

interface ComponentAssemblyProps {
  readonly component: VesselComponent;
  /** System colour, painted onto the `accent` pieces so machinery stays identifiable. */
  readonly accentColor: string;
  readonly selected: boolean;
  readonly hovered: boolean;
  readonly dimmed: boolean;
  readonly selectedPieceId: string | null;
  readonly onSelectPiece: (componentId: string, pieceId: string | null) => void;
  readonly onHover: (id: string | null) => void;
  /** Role in a simulated failure: the failed part, or one lost in the cascade. */
  readonly incident?: 'failed' | 'lost' | null;
  /** Delay before the incident state shows, so the cascade plays out in waves. */
  readonly incidentDelayMs?: number;
  /**
   * Draw the machine through the hull plating (selected in cyan, incident in
   * red / amber) — used while the hull is closed and the part sits inside it.
   */
  readonly xray?: boolean;
}

/**
 * A component drawn as a real machine rather than a coloured block.
 *
 * Every named part of the archetype becomes its own mesh, which is what makes
 * it selectable in its own right — the point of modelling "down to the part"
 * is being able to point at the impeller, not just at the pump.
 */
export const ComponentAssembly = memo(function ComponentAssembly({
  component,
  accentColor,
  selected,
  hovered,
  dimmed,
  selectedPieceId,
  onSelectPiece,
  onHover,
  incident = null,
  incidentDelayMs = 0,
  xray = false,
}: ComponentAssemblyProps): React.ReactElement | null {
  // The cascade reveals itself wave by wave rather than all at once.
  const [revealed, setRevealed] = useState<'failed' | 'lost' | null>(null);
  useEffect(() => {
    if (!incident) {
      setRevealed(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setRevealed(incident), incidentDelayMs);
    return () => window.clearTimeout(timer);
  }, [incident, incidentDelayMs]);

  const groupRef = useRef<THREE.Group>(null);
  const livery = useMemo(() => liveryFor(component), [component]);

  // Let the camera find this machine where it really is, decks exploded or not.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return undefined;
    return registerFocusTarget(component.id, group);
  }, [component.id]);

  const assembly = useMemo(() => {
    if (!component.archetype) return null;
    return buildAssembly(component.archetype, specFromGeometry(component.geometry));
  }, [component.archetype, component.geometry]);

  const envelope = useMemo(() => {
    if (!assembly) return null;
    const bounds = new THREE.Box3();
    for (const part of assembly.pieces) {
      part.geometry.computeBoundingBox();
      if (part.geometry.boundingBox) bounds.union(part.geometry.boundingBox);
    }
    if (bounds.isEmpty()) return null;

    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    return {
      size: [size.x * 1.06 + 0.1, size.y * 1.06 + 0.1, size.z * 1.06 + 0.1] as [number, number, number],
      centre: [centre.x, centre.y, centre.z] as [number, number, number],
      outline: new THREE.EdgesGeometry(
        new THREE.BoxGeometry(size.x * 1.1 + 0.15, size.y * 1.1 + 0.15, size.z * 1.1 + 0.15),
      ),
    };
  }, [assembly]);

  if (!assembly || !envelope) return null;

  const rotationY = component.geometry.kind === 'box' ? component.geometry.rotationY ?? 0 : 0;

  const pickable = !dimmed || revealed !== null;
  const xrayKind: XRayKind | null = !xray ? null : revealed ?? (selected ? 'selected' : null);

  /**
   * Two-step selection: the first click picks the machine, a second click on one
   * of its parts drills into that part, and clicking it again steps back out.
   * Going straight to a part would make it hard to ever select the whole thing.
   */
  const handleClick = (pieceId: string) => (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (!selected) {
      onSelectPiece(component.id, null);
      return;
    }
    onSelectPiece(component.id, selectedPieceId === pieceId ? null : pieceId);
  };

  const handlePointerOver = (event: ThreeEvent<PointerEvent>): void => {
    event.stopPropagation();
    onHover(component.id);
    document.body.style.cursor = 'pointer';
  };

  const handlePointerOut = (event: ThreeEvent<PointerEvent>): void => {
    event.stopPropagation();
    onHover(null);
    document.body.style.cursor = 'auto';
  };

  return (
    <group
      ref={groupRef}
      position={[component.position.x, component.position.y, component.position.z]}
      rotation={[0, rotationY, 0]}
    >
      {assembly.pieces.map((part) => {
        const isPieceSelected = selected && selectedPieceId === part.id;
        const state: PieceState = revealed && !isPieceSelected
          ? revealed
          : dimmed
          ? 'dimmed'
          : isPieceSelected
            ? 'piece'
            : selected
              ? 'selected'
              : hovered
                ? 'hover'
                : 'idle';

        return (
          <mesh
            key={part.id}
            geometry={part.geometry}
            material={getPieceMaterial(part.surface, accentColor, state, livery)}
            userData={{ pieceId: part.id }}
            raycast={pickable ? undefined : noRaycast}
            onClick={pickable ? handleClick(part.id) : undefined}
            onPointerOver={pickable ? handlePointerOver : undefined}
            onPointerOut={pickable ? handlePointerOut : undefined}
            castShadow={!dimmed}
            receiveShadow={!dimmed}
          />
        );
      })}

      {xrayKind
        ? assembly.pieces.map((part) => (
            <mesh
              key={`xray-${part.id}`}
              geometry={part.geometry}
              material={getXRayMaterial(xrayKind)}
              renderOrder={16}
              raycast={noRaycast}
            />
          ))
        : null}

      {selected || hovered ? (
        <lineSegments geometry={envelope.outline} position={envelope.centre} raycast={noRaycast}>
          <lineBasicMaterial
            color={selected ? REFERENCE_COLORS.selection : REFERENCE_COLORS.hover}
            transparent
            opacity={selected ? 0.8 : 0.35}
            depthTest={false}
          />
        </lineSegments>
      ) : null}
    </group>
  );
});
