/**
 * Industrial primitives.
 *
 * Machinery is assembled from these rather than from bare boxes: a flange with
 * a bolt circle, a motor with cooling fins, a stiffened plate. The shapes are
 * simple, but the *vocabulary* is what makes a pump read as a pump instead of
 * a coloured brick — and it stays fully procedural, so the repository carries
 * no 3D model files.
 *
 * Every helper returns geometry already positioned in the component's local
 * space, with the component centred on the origin.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Axis = 'x' | 'y' | 'z';
export type Triple = readonly [number, number, number];

const ORIGIN: Triple = [0, 0, 0];

/** Rotation that points a Y-aligned primitive down the requested axis. */
function axisRotation(axis: Axis): Triple {
  if (axis === 'x') return [0, 0, Math.PI / 2];
  if (axis === 'z') return [Math.PI / 2, 0, 0];
  return [0, 0, 0];
}

function place(
  geometry: THREE.BufferGeometry,
  at: Triple,
  rotation: Triple = ORIGIN,
): THREE.BufferGeometry {
  if (rotation[0]) geometry.rotateX(rotation[0]);
  if (rotation[1]) geometry.rotateY(rotation[1]);
  if (rotation[2]) geometry.rotateZ(rotation[2]);
  geometry.translate(at[0], at[1], at[2]);
  return geometry;
}

/** Merges a set of geometries into one. Returns an empty geometry if given none. */
export function merge(geometries: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const usable = geometries.filter((geometry) => geometry.getAttribute('position'));
  if (usable.length === 0) return new THREE.BufferGeometry();
  if (usable.length === 1) return usable[0] as THREE.BufferGeometry;
  return mergeGeometries(usable as THREE.BufferGeometry[], false) ?? new THREE.BufferGeometry();
}

// ---------------------------------------------------------------------------
// Basic solids
// ---------------------------------------------------------------------------

export function box(size: Triple, at: Triple = ORIGIN, rotY = 0): THREE.BufferGeometry {
  return place(new THREE.BoxGeometry(size[0], size[1], size[2]), at, [0, rotY, 0]);
}

export function cylinder(
  radius: number,
  height: number,
  axis: Axis = 'y',
  at: Triple = ORIGIN,
  segments = 14,
): THREE.BufferGeometry {
  return place(
    new THREE.CylinderGeometry(radius, radius, height, segments),
    at,
    axisRotation(axis),
  );
}

export function cone(
  radiusBottom: number,
  radiusTop: number,
  height: number,
  axis: Axis = 'y',
  at: Triple = ORIGIN,
  segments = 12,
): THREE.BufferGeometry {
  return place(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    at,
    axisRotation(axis),
  );
}

export function sphere(radius: number, at: Triple = ORIGIN, segments = 12): THREE.BufferGeometry {
  return place(new THREE.SphereGeometry(radius, segments, Math.round(segments * 0.6)), at);
}

/** A rounded-off box: cheaper than a real fillet, and enough to catch a highlight. */
export function chamferedBox(
  size: Triple,
  at: Triple = ORIGIN,
  chamfer = 0.04,
  rotY = 0,
): THREE.BufferGeometry {
  const c = Math.min(chamfer, size[0] / 3, size[1] / 3, size[2] / 3);
  return merge([
    box([size[0], size[1] - 2 * c, size[2] - 2 * c]),
    box([size[0] - 2 * c, size[1], size[2] - 2 * c]),
    box([size[0] - 2 * c, size[1] - 2 * c, size[2]]),
  ]).rotateY(rotY).translate(at[0], at[1], at[2]);
}

// ---------------------------------------------------------------------------
// Piping and joints
// ---------------------------------------------------------------------------

/** A raised flange face. */
export function flange(
  radius: number,
  thickness: number,
  axis: Axis = 'y',
  at: Triple = ORIGIN,
): THREE.BufferGeometry {
  return cylinder(radius, thickness, axis, at, 16);
}

/** The ring of bolts around a flange, merged into a single geometry. */
export function boltCircle(
  count: number,
  ringRadius: number,
  boltRadius: number,
  boltLength: number,
  axis: Axis = 'y',
  at: Triple = ORIGIN,
): THREE.BufferGeometry {
  const bolts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const u = Math.cos(angle) * ringRadius;
    const v = Math.sin(angle) * ringRadius;
    const offset: Triple =
      axis === 'y' ? [u, 0, v] : axis === 'x' ? [0, u, v] : [u, v, 0];
    bolts.push(
      cylinder(boltRadius, boltLength, axis, [
        at[0] + offset[0],
        at[1] + offset[1],
        at[2] + offset[2],
      ], 5),
    );
  }
  return merge(bolts);
}

/** A pipe with a flange at each end — the commonest sight in a machinery space. */
export function flangedStub(
  radius: number,
  length: number,
  axis: Axis,
  at: Triple,
  flangeRatio = 1.5,
): THREE.BufferGeometry {
  const half = length / 2;
  const outer: Triple =
    axis === 'x' ? [at[0] + half, at[1], at[2]]
    : axis === 'y' ? [at[0], at[1] + half, at[2]]
    : [at[0], at[1], at[2] + half];

  return merge([
    cylinder(radius, length, axis, at, 12),
    flange(radius * flangeRatio, radius * 0.34, axis, outer),
    boltCircle(6, radius * 1.22, radius * 0.11, radius * 0.45, axis, outer),
  ]);
}

/** A straight pipe run between two points, with optional end flanges. */
export function pipeBetween(
  from: Triple,
  to: Triple,
  radius: number,
  withFlanges = true,
): THREE.BufferGeometry {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length < 1e-6) return new THREE.BufferGeometry();

  const pipe = new THREE.CylinderGeometry(radius, radius, length, 10);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize(),
  );
  pipe.applyQuaternion(quaternion);
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  pipe.translate(midpoint.x, midpoint.y, midpoint.z);

  if (!withFlanges) return pipe;

  const collar = (at: THREE.Vector3): THREE.BufferGeometry => {
    const ring = new THREE.CylinderGeometry(radius * 1.45, radius * 1.45, radius * 0.4, 10);
    ring.applyQuaternion(quaternion);
    ring.translate(at.x, at.y, at.z);
    return ring;
  };

  return merge([pipe, collar(start), collar(end)]);
}

// ---------------------------------------------------------------------------
// Machinery detail
// ---------------------------------------------------------------------------

/** An electric motor body: a barrel wrapped in longitudinal cooling fins. */
export function finnedCylinder(
  radius: number,
  length: number,
  axis: Axis,
  at: Triple,
  finCount = 14,
  finDepth = 0.06,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [cylinder(radius, length, axis, at, 14)];

  for (let i = 0; i < finCount; i += 1) {
    const angle = (i / finCount) * Math.PI * 2;
    const r = radius + finDepth / 2;
    const u = Math.cos(angle) * r;
    const v = Math.sin(angle) * r;
    const offset: Triple =
      axis === 'y' ? [u, 0, v] : axis === 'x' ? [0, u, v] : [u, v, 0];
    const finSize: Triple =
      axis === 'y'
        ? [finDepth * 2.2, length * 0.94, radius * 0.16]
        : axis === 'x'
          ? [length * 0.94, finDepth * 2.2, radius * 0.16]
          : [radius * 0.16, finDepth * 2.2, length * 0.94];

    const fin = box(finSize, [at[0] + offset[0], at[1] + offset[1], at[2] + offset[2]]);
    if (axis === 'y') fin.rotateY(0);
    parts.push(fin);
  }

  return merge(parts);
}

/** A plate stiffened with evenly spaced ribs — bulkheads, tank walls, bedplates. */
export function ribbedPanel(
  size: Triple,
  at: Triple,
  ribCount = 6,
  ribDepth = 0.06,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [box(size, at)];
  const spacing = size[0] / (ribCount + 1);

  for (let i = 1; i <= ribCount; i += 1) {
    const x = at[0] - size[0] / 2 + spacing * i;
    parts.push(box([ribDepth * 1.6, size[1] * 0.86, size[2] + ribDepth * 2], [x, at[1], at[2]]));
  }
  return merge(parts);
}

/** Four machine feet with holding-down bolts. */
export function machineFeet(
  spanX: number,
  spanZ: number,
  y: number,
  footSize = 0.22,
  height = 0.12,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const at: Triple = [(spanX / 2) * sx, y, (spanZ / 2) * sz];
      parts.push(box([footSize * 1.6, height, footSize * 1.6], at));
      parts.push(cylinder(footSize * 0.2, height * 1.9, 'y', at, 8));
    }
  }
  return merge(parts);
}

/** A run of evenly spaced identical items — cylinder heads, plates, sections. */
export function repeatAlong(
  count: number,
  spanX: number,
  build: (index: number, x: number) => THREE.BufferGeometry,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const step = count > 1 ? spanX / (count - 1) : 0;
  for (let i = 0; i < count; i += 1) {
    const x = count > 1 ? -spanX / 2 + step * i : 0;
    parts.push(build(i, x));
  }
  return merge(parts);
}
