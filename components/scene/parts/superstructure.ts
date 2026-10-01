/**
 * The deckhouse and the weather-deck railings.
 *
 * These are ship STRUCTURE rather than maintainable components, so they are not
 * part of the archetype registry and carry no ids for selection — but they do
 * most of the work of making the vessel read as a ship rather than a hull with
 * a brick on it.
 */

import * as THREE from 'three';
import type { Bounds } from '@/lib/engine/types';
import { type HullSide, halfWidthAt, outlineAtHeight, sideSign } from '@/lib/geometry/hullShape';
import type { HullSpec } from '@/lib/engine/types';
import { box, chamferedBox, cylinder, merge, repeatAlong } from './primitives';

export interface StructurePiece {
  readonly id: string;
  /** Key into the structure material set, not a raw colour. */
  readonly surface: 'deckhouse' | 'glazing' | 'framing' | 'safetyOrange' | 'galvanised' | 'deck';
  readonly geometry: THREE.BufferGeometry;
}

interface Tier {
  /** Fraction of the deckhouse length this tier occupies. */
  readonly lengthRatio: number;
  readonly widthRatio: number;
  readonly heightRatio: number;
  /** Shifted aft (negative) or forward, as a fraction of the full length. */
  readonly offsetRatio: number;
}

const TIERS: readonly Tier[] = [
  { lengthRatio: 1.0, widthRatio: 1.0, heightRatio: 0.36, offsetRatio: 0 },
  { lengthRatio: 0.88, widthRatio: 0.92, heightRatio: 0.32, offsetRatio: -0.02 },
  { lengthRatio: 0.72, widthRatio: 0.86, heightRatio: 0.32, offsetRatio: 0.04 },
];

/**
 * A three-tier deckhouse with a window band on every level, bridge wings on the
 * top tier, doors, and a railed monkey island.
 *
 * `keepSide` halves it on the same side as the hull section, so the cut runs
 * continuously from the keel to the bridge.
 */
export function buildDeckhouse(bounds: Bounds, keepSide: HullSide): StructurePiece[] {
  const fullLength = bounds.max.x - bounds.min.x;
  const fullWidth = bounds.max.z - bounds.min.z;
  const fullHeight = bounds.max.y - bounds.min.y;
  const centreX = (bounds.max.x + bounds.min.x) / 2;

  const halved = keepSide !== 'both';
  const sign = halved ? sideSign(keepSide) : 1;
  /** Centre and width of a box of `width`, after the centreline cut. */
  const cut = (width: number): { width: number; centreZ: number } =>
    halved ? { width: width / 2, centreZ: (sign * width) / 4 } : { width, centreZ: 0 };

  const pieces: StructurePiece[] = [];
  let y = bounds.min.y;

  TIERS.forEach((tier, index) => {
    const length = fullLength * tier.lengthRatio;
    const width = fullWidth * tier.widthRatio;
    const height = fullHeight * tier.heightRatio;
    const x = centreX + fullLength * tier.offsetRatio;
    const midY = y + height / 2;
    const casing = cut(width);

    pieces.push({
      id: `tier-${index}`,
      surface: 'deckhouse',
      geometry: chamferedBox([length, height, casing.width], [x, midY, casing.centreZ], 0.1),
    });

    // Window band: a slightly proud dark box wrapped around the tier. Windows
    // are what stop a deckhouse reading as a packing crate.
    const bandHeight = height * 0.3;
    const bandY = midY + height * 0.12;
    const glass = cut(width + 0.06);
    pieces.push({
      id: `tier-${index}-windows`,
      surface: 'glazing',
      geometry: merge([
        box([length * 0.94, bandHeight, glass.width], [x, bandY, glass.centreZ]),
        box([length + 0.06, bandHeight, casing.width * 0.94], [x, bandY, casing.centreZ]),
      ]),
    });

    // Mullions break the band into individual windows.
    pieces.push({
      id: `tier-${index}-mullions`,
      surface: 'deckhouse',
      geometry: repeatAlong(9, length * 0.86, (_, offset) =>
        box([length * 0.012, bandHeight * 1.05, casing.width + 0.1], [x + offset, bandY, casing.centreZ]),
      ),
    });

    // Deck edge between tiers, with a rail around the walkway it creates.
    if (index < TIERS.length - 1) {
      const nextWidth = cut(fullWidth * (TIERS[index + 1]?.widthRatio ?? 1));
      pieces.push({
        id: `tier-${index}-ledge`,
        surface: 'deck',
        geometry: box([length + 0.5, 0.12, casing.width + 0.5], [x, y + height, casing.centreZ]),
      });
      pieces.push({
        id: `tier-${index}-rail`,
        surface: 'galvanised',
        geometry: buildRailLoop(length + 0.4, casing.width + 0.4, 1.0, [x, y + height, casing.centreZ], !halved),
        });
      void nextWidth;
    }

    y += height;
  });

  // Bridge wings: the top tier reaches out past the deckhouse sides.
  const wingY = bounds.max.y - fullHeight * 0.16;
  const wingLength = fullLength * 0.16;
  const wingReach = fullWidth * 0.62;
  const wingX = centreX + fullLength * 0.22;
  const wings: THREE.BufferGeometry[] = [];
  for (const wingSign of halved ? [sign] : [-1, 1]) {
    wings.push(box([wingLength, fullHeight * 0.2, wingReach * 0.5], [wingX, wingY, (wingSign * wingReach) / 1.6]));
  }
  pieces.push({ id: 'bridge-wings', surface: 'deckhouse', geometry: merge(wings) });

  // Monkey island: the roof, and the rail around it.
  const roof = cut(fullWidth * 0.86);
  pieces.push({
    id: 'roof',
    surface: 'deck',
    geometry: box([fullLength * 0.72, 0.14, roof.width], [centreX + fullLength * 0.04, bounds.max.y, roof.centreZ]),
  });
  pieces.push({
    id: 'roof-rail',
    surface: 'galvanised',
    geometry: buildRailLoop(fullLength * 0.7, roof.width, 1.0, [centreX + fullLength * 0.04, bounds.max.y, roof.centreZ], !halved),
  });

  // An access door on each tier, facing aft.
  pieces.push({
    id: 'doors',
    surface: 'framing',
    geometry: merge(
      TIERS.map((tier, index) => {
        const doorY = bounds.min.y + fullHeight * TIERS.slice(0, index).reduce((a, t) => a + t.heightRatio, 0);
        return box([0.1, fullHeight * 0.2, 0.9], [
          centreX - (fullLength * tier.lengthRatio) / 2 - 0.02,
          doorY + fullHeight * 0.11,
          sign * fullWidth * 0.18,
        ]);
      }),
    ),
  });

  return pieces;
}

/** Posts and two rails around a rectangle. */
function buildRailLoop(
  length: number,
  width: number,
  height: number,
  at: readonly [number, number, number],
  closed: boolean,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const [cx, cy, cz] = at;
  const postR = 0.035;
  const spacing = 1.5;

  const run = (from: [number, number], to: [number, number]): void => {
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const span = Math.hypot(dx, dz);
    if (span < 0.2) return;
    const count = Math.max(2, Math.round(span / spacing));

    for (let i = 0; i <= count; i += 1) {
      const x = from[0] + (dx * i) / count;
      const z = from[1] + (dz * i) / count;
      parts.push(cylinder(postR, height, 'y', [x, cy + height / 2, z], 6));
    }
    for (const railY of [height * 0.55, height]) {
      const rail = new THREE.BoxGeometry(span, 0.05, 0.05);
      rail.rotateY(-Math.atan2(dz, dx));
      rail.translate(from[0] + dx / 2, cy + railY, from[1] + dz / 2);
      parts.push(rail);
    }
  };

  const x0 = cx - length / 2;
  const x1 = cx + length / 2;
  const z0 = cz - width / 2;
  const z1 = cz + width / 2;

  run([x0, z0], [x1, z0]);
  run([x0, z1], [x1, z1]);
  if (closed) {
    run([x0, z0], [x0, z1]);
    run([x1, z0], [x1, z1]);
  }

  return merge(parts);
}

/**
 * Bulwark rail following the sheer line, on the surviving side only.
 * Runs the length of the weather deck and stops short of the bow.
 */
export function buildDeckRailing(hull: HullSpec, level: number, keepSide: HullSide): THREE.BufferGeometry {
  const outline = outlineAtHeight(hull, level, 40).filter(
    (point) => point.halfWidth > 1.2 && Math.abs(point.x) < hull.lengthOverall / 2 - 1.5,
  );
  if (outline.length < 2) return new THREE.BufferGeometry();

  const signs = keepSide === 'both' ? [-1, 1] : [sideSign(keepSide)];
  const parts: THREE.BufferGeometry[] = [];

  for (const sign of signs) {
    for (let i = 0; i < outline.length - 1; i += 1) {
      const from = outline[i];
      const to = outline[i + 1];
      if (!from || !to) continue;

      const z0 = (from.halfWidth - 0.25) * sign;
      const z1 = (to.halfWidth - 0.25) * sign;
      const span = Math.hypot(to.x - from.x, z1 - z0);

      parts.push(cylinder(0.035, 1.05, 'y', [from.x, level + 0.52, z0], 6));
      for (const railY of [0.6, 1.05]) {
        const rail = new THREE.BoxGeometry(span, 0.05, 0.05);
        rail.rotateY(-Math.atan2(z1 - z0, to.x - from.x));
        rail.translate((from.x + to.x) / 2, level + railY, (z0 + z1) / 2);
        parts.push(rail);
      }
    }
  }

  void halfWidthAt;
  return merge(parts);
}
