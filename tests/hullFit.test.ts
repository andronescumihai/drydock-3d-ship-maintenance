import { describe, expect, it } from 'vitest';
import { vesselModel } from '@/lib/data/loader';
import { deckEdgeYAt, halfBeamAt, halfWidthAt, keelRiseAt, xToStation } from '@/lib/geometry/hullShape';
import type { ComponentGeometry } from '@/lib/engine/types';

/**
 * Every component must sit inside the hull it belongs to. The check samples
 * the corners of each component's bounding box: at deck level and above it
 * must stay inside the deck edge, below deck inside the shell at that height.
 *
 * A few things hang outboard on real ships and are exempt by design: the
 * propeller and rudder behind the stern, the sea chest (an opening in
 * the shell itself), lifeboats swung out in their davits, and the
 * crane jibs whose picking box sweeps past the rail.
 */
const OVERHANG_BY_DESIGN = new Set(['PROP-01', 'LIFEBOAT-P', 'LIFEBOAT-S', 'CRANE-01', 'CRANE-02', 'RUDDER-01', 'SEA-CHEST-01']);
/** Plate thickness and bulwark: components keep this far in from the moulded line. */
const CLEARANCE = 0.1;

interface Probe {
  readonly centre: { x: number; y: number; z: number };
  readonly half: { x: number; y: number; z: number };
}

/** Boxes that bound a component: one for solids, one per path point for pipes. */
function probes(position: { x: number; y: number; z: number }, geometry: ComponentGeometry): Probe[] {
  switch (geometry.kind) {
    case 'box':
      return [{ centre: position, half: { x: geometry.size.x / 2, y: geometry.size.y / 2, z: geometry.size.z / 2 } }];
    case 'sphere': {
      const r = geometry.radius;
      return [{ centre: position, half: { x: r, y: r, z: r } }];
    }
    case 'cylinder': {
      const r = geometry.radius;
      const h = geometry.height / 2;
      const half = geometry.axis === 'x' ? { x: h, y: r, z: r } : geometry.axis === 'z' ? { x: r, y: r, z: h } : { x: r, y: h, z: r };
      return [{ centre: position, half }];
    }
    case 'pipe': {
      const r = geometry.radius;
      return geometry.path.map((point) => ({ centre: point, half: { x: r, y: r, z: r } }));
    }
  }
}

describe('component placement', () => {
  const hull = vesselModel.vessel.hull;

  it('keeps every component inside the hull footprint', () => {
    const offenders: string[] = [];
    for (const component of vesselModel.components) {
      if (OVERHANG_BY_DESIGN.has(component.id)) continue;
      for (const { centre, half } of probes(component.position, component.geometry)) {
        const { x, y, z } = centre;
        for (const sx of [-1, 1]) {
          const t = xToStation(hull, x + sx * half.x);
          if (Math.abs(t) > 1) {
            offenders.push(`${component.id}: past the ends of the hull`);
            continue;
          }
          const deck = deckEdgeYAt(hull, t);
          // Below deck the shell is checked a little above the component's
          // underside: machinery sits on the tank top, not on the keel line,
          // and the modelled section is round-bilged rather than box-shaped.
          const bottom = y - half.y;
          const sample = Math.min(Math.max(bottom, keelRiseAt(hull, t)) + 0.6, y);
          const limit = bottom >= deck ? halfBeamAt(hull, t) : halfWidthAt(hull, t, sample);
          const outboard = Math.abs(z) + half.z;
          if (outboard > limit - CLEARANCE) {
            offenders.push(`${component.id}: ${outboard.toFixed(2)} m outboard vs ${limit.toFixed(2)} m hull at x=${(x + sx * half.x).toFixed(1)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
