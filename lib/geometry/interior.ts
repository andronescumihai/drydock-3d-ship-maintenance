import type { HullSpec, VesselComponent } from '@/lib/engine/types';

/**
 * True when a component sits below the main deck, inside the closed hull,
 * where it cannot be seen unless the hull is sectioned (or drawn in x-ray).
 */
export function isInsideHull(component: Pick<VesselComponent, 'position'>, hull: Pick<HullSpec, 'depth'>): boolean {
  return component.position.y < hull.depth - 0.3;
}
