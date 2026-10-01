/**
 * Spray, splashes and whale blows: one pooled particle system for all of them.
 *
 * Particles are simulated on the CPU (a few hundred at most, trivially cheap)
 * and drawn as soft, depth-tested points in a single draw call. Two kinds:
 *
 *   spray  — heavy droplets thrown up where a body breaks the surface; full
 *            gravity, gone as soon as they fall back into the sea.
 *   mist   — a whale's blow: light, slow, drifting and swelling as it fades.
 */

import * as THREE from 'three';

const GRAVITY = 9.81;

export interface SplashOptions {
  readonly count: number;
  /** Horizontal radius over which particles start, metres. */
  readonly radius: number;
  /** Vertical launch speed range, m/s. */
  readonly up: readonly [number, number];
  /** Horizontal launch speed range, m/s. */
  readonly out: readonly [number, number];
  /** Point size in metres. */
  readonly size: number;
  readonly life: readonly [number, number];
  readonly mist?: boolean;
  /** Extra horizontal velocity carried from the body, m/s. */
  readonly carry?: THREE.Vector3;
}

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uPixelScale;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelScale / max(-mv.z, 0.1);
    vAlpha = aAlpha;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = dot(c, c);
    if (r > 1.0) discard;
    float soft = 1.0 - r;
    gl_FragColor = vec4(uColor, vAlpha * soft * soft);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class SplashSystem {
  readonly points: THREE.Points;
  private readonly capacity: number;
  private readonly position: Float32Array;
  private readonly velocity: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly mist: Uint8Array;
  private next = 0;
  private readonly material: THREE.ShaderMaterial;

  constructor(capacity = 1400, private readonly waterLevel = 0) {
    this.capacity = capacity;
    this.position = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.mist = new Uint8Array(capacity);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uPixelScale: { value: 800 },
        uColor: { value: new THREE.Color('#eef4f6') },
      },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.raycast = () => undefined;
    this.points.renderOrder = 2;
  }

  emit(origin: THREE.Vector3, options: SplashOptions): void {
    const [upMin, upMax] = options.up;
    const [outMin, outMax] = options.out;
    const [lifeMin, lifeMax] = options.life;
    for (let n = 0; n < options.count; n += 1) {
      const i = this.next;
      this.next = (this.next + 1) % this.capacity;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * options.radius;
      const out = outMin + Math.random() * (outMax - outMin);
      this.position[i * 3] = origin.x + Math.cos(angle) * radius;
      this.position[i * 3 + 1] = origin.y + Math.random() * 0.2;
      this.position[i * 3 + 2] = origin.z + Math.sin(angle) * radius;
      this.velocity[i * 3] = Math.cos(angle) * out + (options.carry?.x ?? 0);
      this.velocity[i * 3 + 1] = upMin + Math.random() * (upMax - upMin);
      this.velocity[i * 3 + 2] = Math.sin(angle) * out + (options.carry?.z ?? 0);
      this.baseSize[i] = options.size * (0.6 + Math.random() * 0.8);
      this.age[i] = 0;
      this.life[i] = lifeMin + Math.random() * (lifeMax - lifeMin);
      this.mist[i] = options.mist ? 1 : 0;
    }
  }

  update(delta: number, camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    const dt = Math.min(delta, 0.05);
    for (let i = 0; i < this.capacity; i += 1) {
      if (this.life[i]! <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      const age = (this.age[i] = this.age[i]! + dt);
      const life = this.life[i]!;
      const mist = this.mist[i] === 1;
      const vy = i * 3 + 1;
      // Mist hangs in the air and slows; spray falls.
      this.velocity[vy] = this.velocity[vy]! - GRAVITY * (mist ? 0.12 : 1) * dt;
      const drag = mist ? Math.exp(-1.6 * dt) : Math.exp(-0.25 * dt);
      for (let axis = 0; axis < 3; axis += 1) {
        const k = i * 3 + axis;
        this.velocity[k] = this.velocity[k]! * (axis === 1 && !mist ? 1 : drag);
        this.position[k] = this.position[k]! + this.velocity[k]! * dt;
      }
      const t = age / life;
      const fellBack = !mist && this.position[vy]! < this.waterLevel - 0.1 && this.velocity[vy]! < 0;
      if (t >= 1 || fellBack) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        continue;
      }
      this.size[i] = this.baseSize[i]! * (mist ? 1 + t * 1.8 : 1);
      this.alpha[i] = (mist ? 0.6 : 0.85) * (1 - t) * Math.min(1, age * 12);
    }

    const geometry = this.points.geometry;
    (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;

    // Metres to pixels at unit distance.
    const uniform = this.material.uniforms.uPixelScale;
    if (uniform) uniform.value = (viewportHeight / 2) * camera.projectionMatrix.elements[5]!;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
