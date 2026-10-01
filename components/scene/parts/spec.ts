/**
 * Derives an archetype's envelope from a component's raw primitive shape.
 *
 * Pure logic, kept out of the component file so it can be exercised by tests
 * and tooling without dragging JSX along.
 */

import type { ComponentGeometry } from '@/lib/engine/types';
import type { ArchetypeSpec } from './assembly';

export function specFromGeometry(geometry: ComponentGeometry): ArchetypeSpec {
  switch (geometry.kind) {
    case 'box':
      return { length: geometry.size.x, height: geometry.size.y, width: geometry.size.z };
    case 'cylinder': {
      const diameter = geometry.radius * 2;
      if (geometry.axis === 'x') return { length: geometry.height, height: diameter, width: diameter };
      if (geometry.axis === 'z') return { length: diameter, height: diameter, width: geometry.height };
      return { length: diameter, height: geometry.height, width: diameter };
    }
    case 'sphere':
      return { length: geometry.radius * 2, height: geometry.radius * 2, width: geometry.radius * 2 };
    case 'pipe':
      return { length: geometry.radius * 2, height: geometry.radius * 2, width: geometry.radius * 2 };
  }
}
