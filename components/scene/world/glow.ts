import * as THREE from 'three';

/**
 * Point lights as the eye sees them at a distance: soft glowing dots, sized in
 * metres and projected like geometry, with a floor so a far light stays a
 * visible point instead of vanishing between pixels. Used for navigation
 * lights on aircraft and boats, the ship's anchor lights and lamp heads.
 *
 * Each light carries a "night" flag: 1 for lights that are only switched on
 * after dark (deck floodlights, a kayaker's torch), 0 for lights that burn
 * day and night (an aircraft's beacon and strobes). Night lights also grow a
 * little as the scene darkens: the same lamp reads as a larger glow against a
 * dark sky than against a bright one.
 *
 * Their reflections on the water are drawn by `reflectionColumns` below.
 */

const GLOW_VERTEX = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
attribute float aNight;
uniform float uPixelRatio;
uniform float uHalfHeight;
uniform float uNight;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = max(-mv.z, 1.0);
  float gate = mix(1.0, uNight, aNight);
  float grow = 1.0 + 0.7 * uNight * aNight;
  gl_PointSize = clamp(aSize * grow * projectionMatrix[1][1] * uHalfHeight / depth, 1.6 * uPixelRatio, 56.0);
  vColor = aColor;
  vAlpha = aAlpha * gate;
  if (vAlpha < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const GLOW_FRAGMENT = /* glsl */ `
uniform float uGain;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  // A hot core and a soft skirt, like a lamp seen through a little haze.
  float core = 1.0 - smoothstep(0.0, 0.16, d);
  float skirt = 1.0 - smoothstep(0.0, 0.5, d);
  float a = (core * 0.7 + skirt * skirt * 0.6) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * uGain, a);
}
`;




export interface GlowUniforms {
  readonly uPixelRatio: { value: number };
  readonly uHalfHeight: { value: number };
  readonly uNight: { value: number };
  readonly uGain: { value: number };
}

function additiveMaterial(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    // Light sources clip to white rather than being compressed.
    toneMapped: false,
  });
}

export function createGlowMaterial(gain = 1): THREE.ShaderMaterial {
  return additiveMaterial(GLOW_VERTEX, GLOW_FRAGMENT, {
    uPixelRatio: { value: 1 },
    uHalfHeight: { value: 450 },
    uNight: { value: 0 },
    uGain: { value: gain },
  });
}

/**
 * Reflections of lamps on the sea, as a real harbour shows them: a column of
 * light hanging from the waterline under the lamp, through the lamp's mirror
 * image and on beyond it (rippled water reflects the lamp over a whole range
 * of slopes), wavering, widening and fading as it comes towards the viewer.
 *
 * Each lamp is one screen-aligned quad, built in the vertex shader between the
 * projected sea point under the lamp and the projected mirror image. Its depth
 * is that of the sea surface itself along each pixel's ray, so the hull (or a
 * boat's topsides) hides the part of the column behind it, and the sea never
 * swallows the part that is "below" the waterline on screen.
 */
const COLUMN_VERTEX = /* glsl */ `
attribute vec3 iPosition;
attribute vec3 iColor;
attribute float iSize;
attribute float iNight;
uniform float uSeaLevel;
uniform float uNight;
uniform float uFade;
uniform float uPixelRatio;
uniform vec2 uViewport;
uniform mat4 uInverseViewProjection;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vPhase;
void main() {
  vec4 lamp = modelMatrix * vec4(iPosition, 1.0);
  float height = lamp.y - uSeaLevel;
  float gate = mix(1.0, uNight, iNight) * uFade;
  vec4 top = projectionMatrix * viewMatrix * vec4(lamp.x, uSeaLevel, lamp.z, 1.0);
  vec4 mirror = projectionMatrix * viewMatrix * vec4(lamp.x, uSeaLevel - height, lamp.z, 1.0);
  if (height < 0.3 || gate < 0.01 || top.w <= 0.0 || mirror.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 a = top.xy / top.w;
  vec2 b = mirror.xy / mirror.w;
  // On past the mirror image: ripples smear the reflection towards the viewer.
  vec2 bottom = a + (b - a) * 1.8;
  float distance = max(length(lamp.xyz - cameraPosition), 1.0);
  float lampPx = iSize * projectionMatrix[1][1] * uViewport.y * 0.5 / distance;
  float widthPx = max(1.6 * uPixelRatio, lampPx * 1.6) * mix(1.0, 2.4, position.y);
  vec2 ndc = mix(a, bottom, position.y) + vec2(position.x * widthPx * 2.0 / uViewport.x, 0.0);

  // Depth: where this pixel's ray meets the sea (a little above it, clear of the swell).
  vec4 nearPoint = uInverseViewProjection * vec4(ndc, -1.0, 1.0);
  vec4 farPoint = uInverseViewProjection * vec4(ndc, 1.0, 1.0);
  nearPoint /= nearPoint.w;
  farPoint /= farPoint.w;
  vec3 ray = farPoint.xyz - nearPoint.xyz;
  float t = ray.y < -1e-6 ? clamp((uSeaLevel + 0.7 - nearPoint.y) / ray.y, 0.0, 1.0) : 1.0;
  vec4 water = projectionMatrix * viewMatrix * vec4(nearPoint.xyz + ray * t, 1.0);
  gl_Position = vec4(ndc * water.w, water.z, water.w);

  vUv = position.xy;
  vColor = iColor;
  vAlpha = gate * clamp(lampPx * 0.5, 0.35, 1.0);
  vPhase = fract(sin(dot(lamp.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
}
`;

const COLUMN_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uGain;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vPhase;
void main() {
  float down = vUv.y;
  // Wavering sideways as the ripples pass, more so further down.
  float x = vUv.x + sin(down * 14.0 - uTime * 1.7 + vPhase) * 0.18 * down + sin(down * 37.0 + uTime * 2.3 + vPhase * 2.0) * 0.07;
  float across = exp(-x * x * 5.0);
  float along = smoothstep(0.0, 0.05, down) * (1.0 - smoothstep(0.35, 1.0, down)) * (1.0 - 0.45 * down);
  // Broken a little into patches of glitter, not a solid bar.
  float shimmer = 0.6 + 0.4 * sin(down * 23.0 - uTime * 2.9 + vPhase * 3.0) * sin(down * 9.0 + uTime * 1.1);
  float a = across * along * shimmer * vAlpha * 0.6;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * uGain, a);
}
`;

export function createReflectionMaterial(seaLevel: number, gain = 1): THREE.ShaderMaterial {
  const material = additiveMaterial(COLUMN_VERTEX, COLUMN_FRAGMENT, {
    uSeaLevel: { value: seaLevel },
    uNight: { value: 0 },
    // 0..1: lets the owner hide the reflections (the ship's, while it is lifted clear of the water).
    uFade: { value: 1 },
    uPixelRatio: { value: 1 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uInverseViewProjection: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uGain: { value: gain },
  });
  return material;
}

/** One reflection column per light, as an instanced quad. */
export function reflectionColumns(specs: readonly GlowSpec[], material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  const positions = new Float32Array(specs.length * 3);
  const colours = new Float32Array(specs.length * 3);
  const sizes = new Float32Array(specs.length);
  const night = new Float32Array(specs.length);
  const colour = new THREE.Color();
  specs.forEach((spec, i) => {
    positions.set(spec.position, i * 3);
    colour.set(spec.color);
    colours.set([colour.r, colour.g, colour.b], i * 3);
    sizes[i] = spec.size;
    night[i] = spec.nightOnly === false ? 0 : 1;
  });
  geometry.setAttribute('iPosition', new THREE.InstancedBufferAttribute(positions, 3));
  geometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(colours, 3));
  geometry.setAttribute('iSize', new THREE.InstancedBufferAttribute(sizes, 1));
  geometry.setAttribute('iNight', new THREE.InstancedBufferAttribute(night, 1));
  geometry.instanceCount = specs.length;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.raycast = () => undefined;
  mesh.renderOrder = 2;
  return mesh;
}

const inverseViewProjection = new THREE.Matrix4();

/** Per-frame uniforms for the reflection columns. */
export function updateReflectionMaterial(
  material: THREE.ShaderMaterial,
  camera: THREE.Camera,
  pixelRatio: number,
  size: { width: number; height: number },
  night: number,
  time: number,
): void {
  const u = material.uniforms;
  camera.updateMatrixWorld();
  inverseViewProjection.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
  (u.uInverseViewProjection!.value as THREE.Matrix4).copy(inverseViewProjection);
  (u.uViewport!.value as THREE.Vector2).set(size.width * pixelRatio, size.height * pixelRatio);
  u.uPixelRatio!.value = pixelRatio;
  u.uNight!.value = night;
  u.uTime!.value = time;
}

/** Per-frame uniforms: viewport, pixel ratio, how dark it is, time. */
export function updateGlowMaterial(
  material: THREE.ShaderMaterial,
  pixelRatio: number,
  viewportHeight: number,
  night: number,
  time: number,
): void {
  const u = material.uniforms;
  u.uPixelRatio!.value = pixelRatio;
  u.uHalfHeight!.value = (viewportHeight * pixelRatio) / 2;
  u.uNight!.value = night;
  if (u.uTime) u.uTime.value = time;
}

export interface GlowSpec {
  readonly position: readonly [number, number, number];
  readonly color: THREE.ColorRepresentation;
  /** Apparent size of the glow, metres. */
  readonly size: number;
  readonly alpha?: number;
  /** Only lit at night. Default true. */
  readonly nightOnly?: boolean;
}

/** A fixed set of lights in an object's own coordinates (they move with it). */
export function glowGeometry(specs: readonly GlowSpec[]): THREE.BufferGeometry {
  const positions = new Float32Array(specs.length * 3);
  const colors = new Float32Array(specs.length * 3);
  const sizes = new Float32Array(specs.length);
  const alphas = new Float32Array(specs.length);
  const night = new Float32Array(specs.length);
  const colour = new THREE.Color();
  specs.forEach((spec, i) => {
    positions.set(spec.position, i * 3);
    colour.set(spec.color);
    colors.set([colour.r, colour.g, colour.b], i * 3);
    sizes[i] = spec.size;
    alphas[i] = spec.alpha ?? 1;
    night[i] = spec.nightOnly === false ? 0 : 1;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aNight', new THREE.BufferAttribute(night, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Points object for a glow geometry; never pickable, drawn after the opaque scene. */
export function glowPoints(geometry: THREE.BufferGeometry, material: THREE.Material, renderOrder = 3): THREE.Points {
  const points = new THREE.Points(geometry, material);
  points.raycast = () => undefined;
  points.renderOrder = renderOrder;
  points.frustumCulled = false;
  return points;
}

/** A batch of lights rewritten every frame (aircraft, whose lights move in world space). */
export class GlowBatch {
  readonly geometry = new THREE.BufferGeometry();
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly night: Float32Array;

  constructor(readonly capacity: number) {
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.night = new Float32Array(capacity);
    const dynamic = (array: Float32Array, size: number): THREE.BufferAttribute =>
      new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', dynamic(this.positions, 3));
    this.geometry.setAttribute('aColor', dynamic(this.colors, 3));
    this.geometry.setAttribute('aSize', dynamic(this.sizes, 1));
    this.geometry.setAttribute('aAlpha', dynamic(this.alphas, 1));
    this.geometry.setAttribute('aNight', dynamic(this.night, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40000);
  }

  set(i: number, p: THREE.Vector3, color: THREE.Color, size: number, alpha: number, nightOnly = false): void {
    if (i >= this.capacity) return;
    this.positions.set([p.x, p.y, p.z], i * 3);
    this.colors.set([color.r, color.g, color.b], i * 3);
    this.sizes[i] = size;
    this.alphas[i] = alpha;
    this.night[i] = nightOnly ? 1 : 0;
  }

  commit(count: number): void {
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha', 'aNight']) {
      (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
    this.geometry.setDrawRange(0, Math.min(count, this.capacity));
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
