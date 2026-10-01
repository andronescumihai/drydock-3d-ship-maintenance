/**
 * Where each component actually is on screen.
 *
 * A component's JSON position is where it sits in the CLOSED ship. Once the
 * decks slide apart and the vessel lifts, the part the user clicked is metres
 * higher than that — which is why framing the data position sent the camera
 * under the hull. The scene registers each component's live Object3D here, and
 * the camera frames that object's world-space bounds instead, every frame, so
 * it follows the part while the decks are still moving.
 *
 * A plain module-level map: this is a lookup table for the camera, not UI
 * state, and putting Object3Ds in a React store would re-render on every write.
 */

import type * as THREE from 'three';

const targets = new Map<string, THREE.Object3D>();

export function registerFocusTarget(id: string, object: THREE.Object3D): () => void {
  targets.set(id, object);
  return () => {
    // Strict Mode mounts twice; only remove the entry if it is still ours.
    if (targets.get(id) === object) targets.delete(id);
  };
}

export function getFocusTarget(id: string): THREE.Object3D | undefined {
  return targets.get(id);
}

/** A piece inside a registered component, tagged with `userData.pieceId`. */
export function getFocusPiece(componentId: string, pieceId: string): THREE.Object3D | undefined {
  const root = targets.get(componentId);
  if (!root) return undefined;
  let found: THREE.Object3D | undefined;
  root.traverse((child) => {
    if (!found && child.userData.pieceId === pieceId) found = child;
  });
  return found;
}
