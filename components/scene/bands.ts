/**
 * The deck bands, computed once and shared by everything that needs to know
 * which band a deck belongs to — the structure, the component placement and
 * the overlays that follow a band as it moves in the exploded view.
 */

import * as THREE from 'three';
import type { DeckId, Vec3 } from '@/lib/engine/types';
import { vesselModel } from '@/lib/data/loader';
import { buildDeckBands, buildDeckToBandIndex } from '@/lib/geometry/deckBands';
import { getFocusTarget } from './focusRegistry';

export const BANDS = buildDeckBands(vesselModel.vessel);
export const DECK_TO_BAND = buildDeckToBandIndex(BANDS);

/** Registry key for a band's live group. */
export const bandKey = (bandDeckId: DeckId): string => `band:${bandDeckId}`;

/**
 * A point given in ship coordinates on `deckId`, moved to where that deck's
 * band currently is in the world. Returns false while the band is not mounted.
 */
export function bandWorldPoint(deckId: DeckId, point: Vec3, out: THREE.Vector3): boolean {
  const band = DECK_TO_BAND.get(deckId);
  const group = band ? getFocusTarget(bandKey(band.deckId)) : undefined;
  if (!group) return false;
  out.set(point.x, point.y, point.z);
  group.updateWorldMatrix(true, false);
  group.localToWorld(out);
  return true;
}
