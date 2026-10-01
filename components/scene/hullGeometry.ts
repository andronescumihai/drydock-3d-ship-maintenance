/**
 * Turns the parametric hull description into Three.js geometry for a
 * sectioned maquette.
 *
 * The hull is not one shell. It is built as horizontal BANDS, sliced exactly at
 * the deck levels, so the model can be pulled apart deck by deck and pushed
 * back together without a seam. Each band is cut at the centreline, leaving one
 * half standing — the dollhouse view that lets you see the machinery inside.
 *
 * Everything is procedural: the repository carries no 3D model files.
 */

import * as THREE from 'three';
import type { HullSpec } from '@/lib/engine/types';
import {
  type HullSide,
  halfWidthAt,
  halfOutlineAtHeight,
  outlineAtHeight,
  sectionStripAt,
  sideSign,
  stationToX,
  xToStation,
} from '@/lib/geometry/hullShape';
import { DECK_OUTLINE_STATIONS, HULL_TESSELLATION } from './sceneConfig';
import { SURFACES } from './materials';

export interface HullTessellation {
  readonly stations: number;
  readonly samples: number;
}

const DEFAULT_TESSELLATION: HullTessellation = {
  stations: HULL_TESSELLATION.stations,
  samples: HULL_TESSELLATION.samples,
};

/** Signs of the halves that survive the cut, in scene z. */
function activeSigns(side: HullSide): readonly number[] {
  return side === 'both' ? [-1, 1] : [sideSign(side)];
}

// ---------------------------------------------------------------------------
// Shell bands
// ---------------------------------------------------------------------------

/**
 * Shell plating between two heights, built as a SOLID with real thickness.
 *
 * An outer surface, an inner surface offset inboard, and rims closing the gap
 * at the top and bottom of the band. The thickness is what sells the maquette:
 * a single-surface shell shows a paper edge wherever a band is cut or pulled
 * apart, and the eye reads it as a diagram rather than an object.
 *
 * The index buffer carries two groups, so the caller can paint the plating and
 * the cut rims with different materials — red oxide on the rims is the
 * convention that says "this was sliced".
 */
export function buildBandShellGeometry(
  hull: HullSpec,
  yBottom: number,
  yTop: number,
  side: HullSide,
  tessellation: HullTessellation = DEFAULT_TESSELLATION,
  thickness = 0.3,
): THREE.BufferGeometry {
  const { stations, samples } = tessellation;
  const signs = activeSigns(side);
  const perStrip = samples + 1;

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const platingIndices: number[] = [];
  const rimIndices: number[] = [];

  // Outboard vertices are white: the plating shader paints the scheme itself
  // (antifouling, boot top, topsides) by height, which keeps the boundaries
  // crisp instead of smeared across a 0.7 m triangle. Inboard vertices carry
  // the machinery-space colour directly.
  const outboard = new THREE.Color(1, 1, 1);
  const inboard = new THREE.Color(SURFACES.hullInner.color);

  const pushSurface = (sign: number, inset: number): number => {
    const paint = inset > 0 ? inboard : outboard;
    const base = positions.length / 3;
    for (let i = 0; i <= stations; i += 1) {
      const t = -1 + (2 * i) / stations;
      const x = stationToX(hull, t);
      const strip = sectionStripAt(hull, t, yBottom, yTop, samples);

      // Arc length along the section, so plating tiles evenly around the turn
      // of the bilge instead of stretching where the hull is nearly flat.
      let arc = 0;
      let previous: { y: number; z: number } | null = null;

      for (const point of strip) {
        const z = Math.max(point.z - inset, 0);
        if (previous) arc += Math.hypot(point.y - previous.y, z - previous.z);
        previous = { y: point.y, z };

        positions.push(x, point.y, z * sign);
        uvs.push(x, arc);

        colors.push(paint.r, paint.g, paint.b);
      }
    }
    return base;
  };

  /**
   * Pushes a triangle, reversing its winding when asked. Mirroring the port
   * half through the centreline reverses every triangle's orientation, so the
   * port side flips them back — otherwise its plating would face inboard and
   * the section view would show the outside paint scheme from within.
   */
  const tri = (target: number[], a: number, b: number, c: number, flip: boolean): void => {
    if (flip) target.push(a, c, b);
    else target.push(a, b, c);
  };

  for (const sign of signs) {
    const outer = pushSurface(sign, 0);
    const inner = pushSurface(sign, thickness);
    const mirrored = sign < 0;

    for (let i = 0; i < stations; i += 1) {
      for (let j = 0; j < samples; j += 1) {
        const a = i * perStrip + j;
        const b = (i + 1) * perStrip + j;
        const c = (i + 1) * perStrip + j + 1;
        const d = i * perStrip + j + 1;
        tri(platingIndices, outer + a, outer + b, outer + d, mirrored);
        tri(platingIndices, outer + b, outer + c, outer + d, mirrored);
        // Reversed, so the inboard face looks into the compartment.
        tri(platingIndices, inner + a, inner + d, inner + b, mirrored);
        tri(platingIndices, inner + b, inner + d, inner + c, mirrored);
      }
    }

    // Rims: the exposed thickness at the floor and ceiling of the band. The
    // ceiling rim faces up, the floor rim down.
    for (const edge of [0, samples]) {
      const flip = mirrored !== (edge === 0);
      for (let i = 0; i < stations; i += 1) {
        const o1 = outer + i * perStrip + edge;
        const o2 = outer + (i + 1) * perStrip + edge;
        const i1 = inner + i * perStrip + edge;
        const i2 = inner + (i + 1) * perStrip + edge;
        tri(rimIndices, o1, o2, i1, flip);
        tri(rimIndices, o2, i2, i1, flip);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex([...platingIndices, ...rimIndices]);
  geometry.clearGroups();
  geometry.addGroup(0, platingIndices.length, 0);
  geometry.addGroup(platingIndices.length, rimIndices.length, 1);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The transom, capped so the stern does not read as an open tube.
 * Only the surviving half is built.
 */
export function buildTransomGeometry(
  hull: HullSpec,
  yBottom: number,
  yTop: number,
  side: HullSide,
  samples: number = DEFAULT_TESSELLATION.samples,
): THREE.BufferGeometry {
  const signs = activeSigns(side);
  const positions: number[] = [];
  const indices: number[] = [];
  const x = stationToX(hull, -1);

  for (const sign of signs) {
    const base = positions.length / 3;
    const strip = sectionStripAt(hull, -1, yBottom, yTop, samples);

    for (const point of strip) {
      positions.push(x, point.y, 0);
      positions.push(x, point.y, point.z * sign);
    }
    for (let j = 0; j < samples; j += 1) {
      const a = base + j * 2;
      const b = base + j * 2 + 1;
      const c = base + (j + 1) * 2 + 1;
      const d = base + (j + 1) * 2;
      // Mirrored to port, the winding reverses; flip it so both halves face aft.
      if (sign < 0) indices.push(a, d, b, b, d, c);
      else indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // Outboard plating: white, so the shader applies the paint scheme.
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(positions.length).fill(1), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

/**
 * A deck plate with real thickness, cut to the hull outline at its own height
 * and halved at the centreline. Thickness matters here: a zero-thickness plane
 * shows a paper edge at the cut, which instantly breaks the illusion of a
 * solid model.
 *
 * The geometry is built so the TOP of the slab sits at y = 0; the mesh places
 * it at the deck level.
 */
export function buildDeckSlabGeometry(
  hull: HullSpec,
  level: number,
  side: HullSide,
  thickness = 0.18,
  stations: number = DECK_OUTLINE_STATIONS,
): THREE.BufferGeometry | null {
  const outline = halfOutlineAtHeight(hull, level, stations);
  if (outline.length < 2) return null;

  const shape = new THREE.Shape();
  const sign = side === 'both' ? -1 : sideSign(side);

  // Shape-space +y maps to scene -z, so port (scene -z) uses positive shape y.
  const toShapeY = (halfWidth: number): number => (side === 'both' ? halfWidth : -sign * halfWidth);

  const first = outline[0];
  if (!first) return null;
  shape.moveTo(first.x, toShapeY(first.halfWidth));
  for (const point of outline.slice(1)) shape.lineTo(point.x, toShapeY(point.halfWidth));

  if (side === 'both') {
    for (let i = outline.length - 1; i >= 0; i -= 1) {
      const point = outline[i];
      if (point) shape.lineTo(point.x, -point.halfWidth);
    }
  } else {
    // Straight run back along the centreline: this edge is the cut.
    for (let i = outline.length - 1; i >= 0; i -= 1) {
      const point = outline[i];
      if (point) shape.lineTo(point.x, 0);
    }
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 1,
  });
  // Extrusion runs along shape +z, which becomes scene +y after this rotation.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -thickness, 0);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// Bulkheads
// ---------------------------------------------------------------------------

/**
 * A transverse bulkhead: the wall that divides one compartment from the next.
 * Spans from the centreline out to the shell, clipped to the hull at every
 * height so it stops exactly at the plating.
 */
export function buildBulkheadGeometry(
  hull: HullSpec,
  x: number,
  yBottom: number,
  yTop: number,
  side: HullSide,
  samples = 14,
): THREE.BufferGeometry {
  const t = xToStation(hull, x);
  const signs = activeSigns(side);
  const positions: number[] = [];
  const indices: number[] = [];

  for (const sign of signs) {
    const base = positions.length / 3;
    for (let j = 0; j <= samples; j += 1) {
      const y = yBottom + ((yTop - yBottom) * j) / samples;
      const halfWidth = halfWidthAt(hull, t, y);
      positions.push(x, y, 0);
      positions.push(x, y, halfWidth * sign);
    }
    for (let j = 0; j < samples; j += 1) {
      const a = base + j * 2;
      const b = base + j * 2 + 1;
      const c = base + (j + 1) * 2 + 1;
      const d = base + (j + 1) * 2;
      // Mirrored to port, the winding reverses; flip it so both halves face aft.
      if (sign < 0) indices.push(a, d, b, b, d, c);
      else indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// Reference lines
// ---------------------------------------------------------------------------

/** Closed loop tracing the hull at the design draught, as line segments. */
export function buildWaterlineGeometry(
  hull: HullSpec,
  stations: number = DECK_OUTLINE_STATIONS,
): THREE.BufferGeometry {
  const outline = outlineAtHeight(hull, hull.draught, stations);
  const starboard: THREE.Vector3[] = [];
  const port: THREE.Vector3[] = [];

  for (const point of outline) {
    if (point.halfWidth <= 0.01) continue;
    starboard.push(new THREE.Vector3(point.x, hull.draught, point.halfWidth));
    port.push(new THREE.Vector3(point.x, hull.draught, -point.halfWidth));
  }
  port.reverse();

  const loop = [...starboard, ...port];
  const segments: THREE.Vector3[] = [];
  for (let i = 0; i < loop.length; i += 1) {
    const from = loop[i];
    const to = loop[(i + 1) % loop.length];
    if (!from || !to) continue;
    segments.push(from, to);
  }
  return new THREE.BufferGeometry().setFromPoints(segments);
}

/**
 * The sheer line at the top of a band, and the cut edge along the centreline.
 * Thin highlights like these are what give an opaque model its silhouette.
 */
export function buildBandEdgeGeometry(
  hull: HullSpec,
  level: number,
  side: HullSide,
  stations: number = DECK_OUTLINE_STATIONS,
): THREE.BufferGeometry {
  const outline = halfOutlineAtHeight(hull, level, stations);
  const signs = activeSigns(side);
  const points: THREE.Vector3[] = [];

  for (const sign of signs) {
    for (let i = 0; i < outline.length - 1; i += 1) {
      const from = outline[i];
      const to = outline[i + 1];
      if (!from || !to) continue;
      points.push(new THREE.Vector3(from.x, level, from.halfWidth * sign));
      points.push(new THREE.Vector3(to.x, level, to.halfWidth * sign));
    }
  }

  const firstPoint = outline[0];
  const lastPoint = outline[outline.length - 1];
  if (side !== 'both' && firstPoint && lastPoint) {
    points.push(new THREE.Vector3(firstPoint.x, level, 0));
    points.push(new THREE.Vector3(lastPoint.x, level, 0));
  }

  return new THREE.BufferGeometry().setFromPoints(points);
}

/**
 * Painted safety lines on a deck: a stripe running a set distance inboard of
 * the deck edge on each kept side, marking the walkway along the bulwark.
 * Built as a flat ribbon a hair above the deck plate, in the deck's own space
 * (y = 0 is the deck top, like the slab).
 */
export function buildDeckMarkingGeometry(
  hull: HullSpec,
  level: number,
  side: HullSide,
  inset = 1.1,
  width = 0.12,
  stations: number = DECK_OUTLINE_STATIONS * 2,
): THREE.BufferGeometry | null {
  const outline = halfOutlineAtHeight(hull, level, stations);
  const positions: number[] = [];
  const indices: number[] = [];
  const lift = 0.012;

  for (const sign of activeSigns(side)) {
    // Only where the deck is wide enough for a walkway inboard of the line.
    const run = outline.filter((point) => point.halfWidth > inset + 0.6);
    if (run.length < 2) continue;
    const base = positions.length / 3;
    for (const point of run) {
      const outer = (point.halfWidth - inset) * sign;
      const inner = (point.halfWidth - inset - width) * sign;
      positions.push(point.x, lift, outer, point.x, lift, inner);
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      // Face up on both sides of the centreline.
      if (sign > 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, b, c, b, d, c);
    }
  }
  if (positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
