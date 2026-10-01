/**
 * Builds every machinery assembly outside the browser and reports its cost.
 *
 * Geometry is constructed on the main thread when the scene mounts, so a slow
 * or malformed archetype shows up as a frozen tab with no error. Running the
 * builders in Node turns that into a number and a stack trace.
 *
 * Usage: npx vite-node scripts/bench-assemblies.ts
 */

import { vesselModel } from '@/lib/data/loader';
import { buildAssembly } from '@/components/scene/parts/archetypes';
import { specFromGeometry } from '@/components/scene/parts/spec';

let pieces = 0;
let triangles = 0;
let problems = 0;
const slowest: { id: string; ms: number }[] = [];
const start = performance.now();

for (const component of vesselModel.components) {
  if (!component.archetype) continue;

  const componentStart = performance.now();
  try {
    const assembly = buildAssembly(component.archetype, specFromGeometry(component.geometry));
    if (!assembly) {
      console.log(`UNKNOWN  ${component.id} (${component.archetype})`);
      problems += 1;
      continue;
    }

    for (const part of assembly.pieces) {
      const position = part.geometry.getAttribute('position');
      if (!position || position.count === 0) {
        console.log(`EMPTY    ${component.id} / ${part.id}`);
        problems += 1;
        continue;
      }

      const array = position.array as ArrayLike<number>;
      for (let i = 0; i < array.length; i += 1) {
        if (!Number.isFinite(array[i] as number)) {
          console.log(`NaN      ${component.id} / ${part.id}`);
          problems += 1;
          break;
        }
      }

      pieces += 1;
      triangles += (part.geometry.index ? part.geometry.index.count : position.count) / 3;
    }
  } catch (error) {
    problems += 1;
    console.log(`THREW    ${component.id} (${component.archetype}): ${(error as Error).message}`);
  }
  slowest.push({ id: component.id, ms: performance.now() - componentStart });
}

slowest.sort((a, b) => b.ms - a.ms);
console.log('\nslowest assemblies:');
for (const entry of slowest.slice(0, 5)) {
  console.log(`  ${entry.ms.toFixed(1).padStart(7)} ms  ${entry.id}`);
}
console.log(
  `\n${Math.round(performance.now() - start)} ms total · ${pieces} pieces · ` +
    `${Math.round(triangles)} triangles · ${problems} problems`,
);
