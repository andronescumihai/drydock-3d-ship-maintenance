'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import type { ComponentGeometry, VesselComponent } from '@/lib/engine/types';
import { SCENE_COLORS } from './sceneConfig';

interface ComponentMarkerProps {
  readonly component: VesselComponent;
  readonly color: string;
  readonly selected: boolean;
  readonly hovered: boolean;
  readonly dimmed: boolean;
  readonly onSelect: (id: string) => void;
  readonly onHover: (id: string | null) => void;
}

/** Rotation that points a Y-aligned primitive down the requested axis. */
function axisRotation(axis: 'x' | 'y' | 'z'): [number, number, number] {
  if (axis === 'x') return [0, 0, Math.PI / 2];
  if (axis === 'z') return [Math.PI / 2, 0, 0];
  return [0, 0, 0];
}

function MarkerGeometry({ geometry }: { geometry: ComponentGeometry }): React.ReactElement {
  const tube = useMemo(() => {
    if (geometry.kind !== 'pipe') return null;
    const curve = new THREE.CatmullRomCurve3(
      geometry.path.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
    );
    return new THREE.TubeGeometry(curve, Math.max(geometry.path.length * 8, 24), geometry.radius, 12, false);
  }, [geometry]);

  switch (geometry.kind) {
    case 'box':
      return <boxGeometry args={[geometry.size.x, geometry.size.y, geometry.size.z]} />;
    case 'cylinder':
      return <cylinderGeometry args={[geometry.radius, geometry.radius, geometry.height, 24]} />;
    case 'sphere':
      return <sphereGeometry args={[geometry.radius, 24, 16]} />;
    case 'pipe':
      return <primitive object={tube ?? new THREE.BufferGeometry()} attach="geometry" />;
  }
}

/**
 * One component of the vessel, rendered as a clickable solid.
 *
 * The marker owns no state: colour, emphasis and dimming all arrive as props
 * derived from the store, so a change in the model re-renders the scene with
 * nothing to synchronise manually.
 */
export function ComponentMarker({
  component,
  color,
  selected,
  hovered,
  dimmed,
  onSelect,
  onHover,
}: ComponentMarkerProps): React.ReactElement {
  const { geometry, position } = component;

  const rotation = useMemo<[number, number, number]>(() => {
    if (geometry.kind === 'cylinder') return axisRotation(geometry.axis);
    if (geometry.kind === 'box' && geometry.rotationY) return [0, geometry.rotationY, 0];
    return [0, 0, 0];
  }, [geometry]);

  // A pipe carries its own world-space path, so the group must not offset it.
  const groupPosition: [number, number, number] =
    geometry.kind === 'pipe' ? [0, 0, 0] : [position.x, position.y, position.z];

  const handleClick = (event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation();
    onSelect(component.id);
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

  // Solid by default: this is a physical model, not a diagram. Only a dimmed
  // component (its system filtered out) drops to ghosting.
  const emissiveIntensity = selected ? 0.55 : hovered ? 0.3 : 0.04;
  const opacity = dimmed ? 0.14 : 1;

  return (
    <mesh
      position={groupPosition}
      rotation={rotation}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      renderOrder={5}
    >
      <MarkerGeometry geometry={geometry} />
      <meshStandardMaterial
        color={dimmed ? SCENE_COLORS.markerIdle : color}
        emissive={selected || hovered ? SCENE_COLORS.hover : color}
        emissiveIntensity={emissiveIntensity}
        transparent={dimmed}
        opacity={opacity}
        roughness={0.52}
        metalness={0}
      />
      {selected || hovered ? (
        <Edges
          scale={1.015}
          threshold={20}
          color={selected ? SCENE_COLORS.selection : SCENE_COLORS.hover}
        />
      ) : null}
    </mesh>
  );
}
