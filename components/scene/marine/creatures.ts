/**
 * Procedural sea life: bottlenose dolphin, humpback whale, small pelagic fish
 * and a gull, built from lathed bodies and extruded fins.
 *
 * Every body is modelled along +X (head forward) with +Y up and its centre of
 * mass near the origin, so the animation code can place and pitch them without
 * knowing their shape. Colour is baked per vertex — dark on the back, pale on
 * the belly (counter-shading, as in the real animals) — so each creature is a
 * single geometry and a single draw call.
 *
 * Proportions follow the real species roughly; this is scenery, not biology.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Radius profile along the body: [position 0 = tail tip .. 1 = snout, radius / length]. */
type Profile = readonly (readonly [number, number])[];

/** Lathes a profile into a body lying along +X, centred on its length. */
function body(length: number, profile: Profile, segments: number, flatten = 0.86): THREE.BufferGeometry {
  const points = profile.map(([t, r]) => new THREE.Vector2(Math.max(r * length, 0.0005), (t - 0.5) * length));
  const geometry = new THREE.LatheGeometry(points, segments);
  // Lathe revolves about +Y; lay it along +X with the snout forward.
  geometry.rotateZ(-Math.PI / 2);
  // Cetaceans are a little deeper than they are wide.
  geometry.scale(1, 1, flatten);
  return geometry;
}

/** A fin from an outline in its own XY plane, extruded thin. */
function fin(outline: readonly (readonly [number, number])[], thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const [first, ...rest] = outline;
  if (!first) throw new Error('fin outline is empty');
  shape.moveTo(first[0], first[1]);
  for (const [x, y] of rest) shape.lineTo(x, y);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.4,
    bevelSize: thickness * 0.6,
    bevelSegments: 1,
    curveSegments: 4,
  });
  geometry.translate(0, 0, -thickness / 2);
  return geometry;
}

/** Merges parts and paints them: `back` above the waterline of the body, `belly` below. */
function finish(
  parts: THREE.BufferGeometry[],
  back: string,
  belly: string,
  split: (position: THREE.Vector3, normal: THREE.Vector3) => number,
): THREE.BufferGeometry {
  const flat = parts.map((part) => {
    const g = part.index ? part.toNonIndexed() : part;
    g.deleteAttribute('uv');
    return g;
  });
  const merged = mergeGeometries(flat, false);
  if (!merged) throw new Error('could not merge creature geometry');
  merged.computeVertexNormals();

  const backColor = new THREE.Color(back);
  const bellyColor = new THREE.Color(belly);
  const colour = new THREE.Color();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const positions = merged.getAttribute('position');
  const normals = merged.getAttribute('normal');
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i += 1) {
    p.fromBufferAttribute(positions, i);
    n.fromBufferAttribute(normals, i);
    colour.copy(bellyColor).lerp(backColor, THREE.MathUtils.clamp(split(p, n), 0, 1));
    colour.toArray(colors, i * 3);
  }
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.computeBoundingSphere();
  return merged;
}

const smooth = (a: number, b: number, x: number): number => THREE.MathUtils.smoothstep(x, a, b);

/** Bottlenose dolphin, about 2.5 m. */
export function buildDolphin(length = 2.5): THREE.BufferGeometry {
  const L = length;
  const torso = body(
    L,
    [
      [0.0, 0.012],
      [0.05, 0.022],
      [0.18, 0.035],
      [0.32, 0.06],
      [0.5, 0.092],
      [0.64, 0.1],
      [0.76, 0.092],
      [0.85, 0.074],
      [0.9, 0.06],
      [0.93, 0.03],
      [0.97, 0.022],
      [1.0, 0.008],
    ],
    18,
  );
  const dorsal = fin(
    [
      [0, 0],
      [0.34, 0],
      [0.1, 0.1],
      [-0.1, 0.26],
      [-0.08, 0.16],
    ].map(([x, y]) => [x! * L * 0.5, y! * L * 0.5] as const),
    0.025,
  );
  dorsal.translate(-L * 0.02, L * 0.085, 0);

  const flukeOutline = [
    [0.02, 0],
    [-0.12, 0.2],
    [-0.16, 0.26],
    [-0.1, 0.16],
    [-0.12, 0.02],
    [-0.12, -0.02],
    [-0.1, -0.16],
    [-0.16, -0.26],
    [-0.12, -0.2],
  ].map(([x, z]) => [x! * L * 0.6, z! * L * 0.6] as const);
  const flukes = fin(flukeOutline, 0.02);
  flukes.rotateX(Math.PI / 2);
  flukes.translate(-L * 0.47, 0, 0);

  const pectoral = (side: 1 | -1): THREE.BufferGeometry => {
    const g = fin(
      [
        [0, 0],
        [0.12, 0],
        [-0.05, -0.16],
        [-0.08, -0.12],
      ].map(([x, y]) => [x! * L * 0.5, y! * L * 0.5] as const),
      0.018,
    );
    g.rotateX(side * 0.6);
    g.translate(L * 0.2, -L * 0.04, side * L * 0.07);
    return g;
  };

  return finish([torso, dorsal, flukes, pectoral(1), pectoral(-1)], '#3e4a55', '#cfd5d9', (p, n) =>
    smooth(-0.06 * L, 0.03 * L, p.y + n.y * 0.02),
  );
}

/** Humpback whale, about 13 m, with its long pale flippers. */
export function buildWhale(length = 13): THREE.BufferGeometry {
  const L = length;
  const torso = body(
    L,
    [
      [0.0, 0.01],
      [0.06, 0.03],
      [0.2, 0.06],
      [0.38, 0.11],
      [0.55, 0.138],
      [0.7, 0.135],
      [0.82, 0.115],
      [0.92, 0.085],
      [0.97, 0.045],
      [1.0, 0.012],
    ],
    22,
    0.9,
  );
  // Small dorsal hump two-thirds of the way back.
  const hump = fin(
    [
      [0, 0],
      [0.9, 0],
      [0.1, 0.45],
      [-0.2, 0.5],
    ],
    0.35,
  );
  hump.translate(-L * 0.18, L * 0.095, 0);

  const flukeOutline = [
    [0.4, 0],
    [-0.6, 1.2],
    [-1.3, 2.0],
    [-1.0, 1.0],
    [-1.1, 0.15],
    [-1.1, -0.15],
    [-1.0, -1.0],
    [-1.3, -2.0],
    [-0.6, -1.2],
  ].map(([x, z]) => [x! * L * 0.07, z! * L * 0.07] as const);
  const flukes = fin(flukeOutline, 0.14);
  flukes.rotateX(Math.PI / 2);
  flukes.translate(-L * 0.48, 0, 0);

  // Humpback flippers: up to a third of the body length.
  const flipper = (side: 1 | -1): THREE.BufferGeometry => {
    const g = fin(
      [
        [0, 0],
        [0.9, 0],
        [0.3, -1.6],
        [-0.1, -3.9],
        [-0.45, -3.7],
        [-0.3, -1.5],
      ],
      0.16,
    );
    g.rotateX(side * 1.05);
    g.rotateY(side * -0.35);
    g.translate(L * 0.2, -L * 0.05, side * L * 0.1);
    return g;
  };

  return finish([torso, hump, flukes, flipper(1), flipper(-1)], '#2a3036', '#7d858a', (p, n) => {
    // Flippers and the underside of the flukes are white on a humpback.
    if (Math.abs(p.z) > L * 0.14) return 0.15 + 0.5 * smooth(-0.2, 0.6, n.y);
    return smooth(-0.07 * L, 0.02 * L, p.y + n.y * 0.1);
  });
}

/** A small pelagic fish, about 0.3 m. */
export function buildFish(length = 0.36): THREE.BufferGeometry {
  const L = length;
  const torso = body(
    L,
    [
      [0.0, 0.01],
      [0.12, 0.03],
      [0.4, 0.085],
      [0.62, 0.1],
      [0.85, 0.075],
      [1.0, 0.01],
    ],
    10,
    0.55,
  );
  const tail = fin(
    [
      [0.05, 0],
      [-0.12, 0.13],
      [-0.08, 0],
      [-0.12, -0.13],
    ].map(([x, y]) => [x! * L, y! * L] as const),
    0.004,
  );
  tail.translate(-L * 0.47, 0, 0);
  return finish([torso, tail], '#3f6680', '#c9d3d9', (p) => smooth(-0.01 * L, 0.04 * L, p.y));
}

export interface GullParts {
  readonly body: THREE.BufferGeometry;
  /** Right wing, hinged at the origin, spanning +Z; mirror for the left. */
  readonly wing: THREE.BufferGeometry;
}

/** Herring-gull-sized seabird: 1.4 m span. Wings are separate so they can flap. */
export function buildGull(): GullParts {
  const torso = body(
    0.55,
    [
      [0.0, 0.02],
      [0.2, 0.08],
      [0.5, 0.15],
      [0.75, 0.13],
      [0.88, 0.12],
      [0.95, 0.08],
      [1.0, 0.02],
    ],
    10,
    1,
  );
  const beak = new THREE.ConeGeometry(0.018, 0.07, 6);
  beak.rotateZ(-Math.PI / 2);
  beak.translate(0.3, 0.0, 0);
  const tail = fin(
    [
      [0, -0.06],
      [0, 0.06],
      [-0.12, 0.05],
      [-0.12, -0.05],
    ],
    0.01,
  );
  tail.rotateX(Math.PI / 2);
  tail.translate(-0.24, 0.01, 0);
  const bodyGeometry = finish([torso, beak, tail], '#e9edef', '#f4f6f7', (p) => (p.x > 0.28 ? 0 : 1));
  // Beak yellow.
  const colors = bodyGeometry.getAttribute('color');
  const positions = bodyGeometry.getAttribute('position');
  const beakColor = new THREE.Color('#e3b422');
  for (let i = 0; i < positions.count; i += 1) {
    if (positions.getX(i) > 0.27) colors.setXYZ(i, beakColor.r, beakColor.g, beakColor.b);
  }

  const wing = fin(
    [
      [0.08, 0],
      [0.1, 0.25],
      [0.02, 0.55],
      [-0.12, 0.72],
      [-0.1, 0.4],
      [-0.08, 0],
    ].map(([x, z]) => [x!, z!] as const),
    0.012,
  );
  wing.rotateX(Math.PI / 2);
  const wingGeometry = finish([wing], '#9aa4ab', '#eef1f2', (p, n) => {
    // Black wing tips, grey mantle on top, white below.
    if (Math.abs(p.z) > 0.55) return 1.4;
    return smooth(-0.3, 0.3, n.y);
  });
  const wingColors = wingGeometry.getAttribute('color');
  const wingPositions = wingGeometry.getAttribute('position');
  for (let i = 0; i < wingPositions.count; i += 1) {
    if (Math.abs(wingPositions.getZ(i)) > 0.56) wingColors.setXYZ(i, 0.03, 0.03, 0.035);
  }
  return { body: bodyGeometry, wing: wingGeometry };
}
