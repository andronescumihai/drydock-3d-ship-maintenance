/**
 * The contract every machinery and outfit builder follows.
 *
 * An archetype returns NAMED PIECES rather than one geometry, which is what
 * makes a component selectable down to its individual parts — the impeller of a
 * pump, the jib of a crane — instead of only as a whole.
 */

import type * as THREE from 'three';
import type { MachineArchetype } from '@/lib/engine/types';
import type { SurfaceName } from '../materials';

/** `accent` is resolved to the owning system's colour when the piece is drawn. */
export type PieceSurface = SurfaceName | 'accent';

export interface PartPiece {
  readonly id: string;
  readonly name: string;
  readonly surface: PieceSurface;
  /** Positioned in the component's local space, centred on the origin. */
  readonly geometry: THREE.BufferGeometry;
}

export interface PartAssembly {
  readonly pieces: readonly PartPiece[];
}

/** Overall envelope the assembly has to fill, in metres. */
export interface ArchetypeSpec {
  readonly length: number;
  readonly height: number;
  readonly width: number;
}

export type ArchetypeBuilder = (spec: ArchetypeSpec) => PartAssembly;

/** Re-exported for readability at call sites; the domain owns the union. */
export type ArchetypeId = MachineArchetype;

export const piece = (
  id: string,
  name: string,
  surface: PieceSurface,
  geometry: THREE.BufferGeometry,
): PartPiece => ({ id, name, surface, geometry });
