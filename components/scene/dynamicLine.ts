import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

const noRaycast = (): void => undefined;

export interface DynamicLineOptions {
  readonly color: string;
  /** Width in screen pixels. */
  readonly width: number;
  readonly dashed?: boolean;
  readonly dashSize?: number;
  readonly gapSize?: number;
  /** Most points the line will ever hold; the buffers are sized once for this. */
  readonly maxPoints: number;
}

/**
 * A fat line (three's Line2) whose points change every frame without
 * allocating.
 *
 * `LineGeometry.setPositions` and `computeLineDistances` create fresh GPU
 * buffers on every call, and three never frees the ones they replace — called
 * per frame, that is a steady video-memory leak. Here the interleaved buffers
 * are created once at full size and rewritten in place; only the number of
 * segments drawn changes.
 */
export class DynamicLine {
  readonly line: Line2;
  readonly material: LineMaterial;
  private readonly geometry: LineGeometry;
  private readonly maxPoints: number;

  constructor(options: DynamicLineOptions) {
    this.maxPoints = Math.max(2, options.maxPoints);
    this.material = new LineMaterial({
      color: new THREE.Color(options.color).getHex(),
      linewidth: options.width,
      worldUnits: false,
      dashed: options.dashed ?? false,
      dashSize: options.dashSize ?? 0.9,
      gapSize: options.gapSize ?? 0.55,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.geometry = new LineGeometry();
    this.geometry.setPositions(new Float32Array(this.maxPoints * 3));
    this.line = new Line2(this.geometry, this.material);
    this.line.computeLineDistances();
    this.geometry.instanceCount = 0;
    this.line.frustumCulled = false;
    this.line.renderOrder = 20;
    this.line.raycast = noRaycast;
  }

  /** Sets the polyline from `count` points packed as x, y, z in `points`. */
  setPoints(points: ArrayLike<number>, count: number): void {
    const n = Math.min(count, this.maxPoints);
    const segments = Math.max(0, n - 1);
    const start = this.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute;
    const distanceStart = this.geometry.attributes.instanceDistanceStart as THREE.InterleavedBufferAttribute;
    const positions = start.data.array as Float32Array;
    const distances = distanceStart.data.array as Float32Array;
    let travelled = 0;
    for (let i = 0; i < segments; i += 1) {
      const a = i * 3;
      const b = a + 3;
      const o = i * 6;
      const ax = points[a] ?? 0, ay = points[a + 1] ?? 0, az = points[a + 2] ?? 0;
      const bx = points[b] ?? 0, by = points[b + 1] ?? 0, bz = points[b + 2] ?? 0;
      positions[o] = ax;
      positions[o + 1] = ay;
      positions[o + 2] = az;
      positions[o + 3] = bx;
      positions[o + 4] = by;
      positions[o + 5] = bz;
      distances[i * 2] = travelled;
      travelled += Math.hypot(bx - ax, by - ay, bz - az);
      distances[i * 2 + 1] = travelled;
    }
    start.data.needsUpdate = true;
    distanceStart.data.needsUpdate = true;
    this.geometry.instanceCount = segments;
  }

  setResolution(width: number, height: number): void {
    this.material.resolution.set(width, height);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
