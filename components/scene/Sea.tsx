'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { HullSpec } from '@/lib/engine/types';
import { halfWidthAt, stationToX } from '@/lib/geometry/hullShape';
import { EXPLODE } from './sceneConfig';
import { daylight } from './daylight';
import { FLAT_NORMAL, NO_FOAM, TEXTURE_TILE_METRES, loadDataTexture } from './pbr/textureSets';
import { G, MAX_SMALL_HULLS, WAVES, seaClock, smallHulls } from './seaState';

/**
 * Open sea.
 *
 * GEOMETRY. A polar grid centred on the vessel whose rings grow 2.5 % each step:
 * about half a metre apart alongside the hull, kilometres apart at the horizon
 * 30 km out. Detail is spent where the camera can see it, and the sea ends far
 * enough away that it meets the sky instead of stopping at an edge.
 *
 * SWELL. Eight Gerstner waves — the standard trochoidal model, where water moves
 * in circles so crests sharpen and troughs flatten, instead of the rounded
 * sines that read as jelly. Deep-water dispersion (ω² = g·k) keeps long waves
 * faster than short ones. Each wave fades out where the grid becomes too coarse
 * to carry it, so distant water never aliases into moiré.
 *
 * SURFACE. Two scrolling samples of a baked Phillips-spectrum normal map carry
 * the wind chop below the grid's resolution. Roughness rises with distance, the
 * way unresolved ripples blur the reflection of the sky towards the horizon.
 *
 * LIGHT. The stock physical material: Fresnel reflection of the sky, the sun's
 * specular glint, shadows from the hull. Added on top: light scattered through
 * the thin crests, whitecap foam where crests fold, and a lapping band of foam
 * along the hull.
 *
 * INSIDE THE HULL. Fragments inside the hull's waterplane are discarded, so a
 * sectioned hull shows its engine room rather than sea water sloshing through
 * it. The mask shrinks to nothing as the vessel is lifted clear for the
 * exploded view, closing the water over the place it stood.
 */

const RINGS = 296;
const SEGMENTS = 384;
const FIRST_SPACING = 0.5;
const GROWTH = 1.025;
const HULL_SAMPLES = 64;

/** Rings of geometric spacing: dense at the hull, sparse at the horizon. */
function buildSeaGeometry(): THREE.BufferGeometry {
  const radii: number[] = [0];
  let spacing = FIRST_SPACING;
  for (let i = 0; i < RINGS; i += 1) {
    radii.push((radii[radii.length - 1] ?? 0) + spacing);
    spacing *= GROWTH;
  }

  const positions = new Float32Array(radii.length * SEGMENTS * 3);
  const normals = new Float32Array(radii.length * SEGMENTS * 3);
  radii.forEach((radius, ring) => {
    for (let s = 0; s < SEGMENTS; s += 1) {
      // Alternate rings are rotated half a step, which keeps the triangles
      // close to equilateral instead of long slivers.
      const angle = ((s + (ring % 2) * 0.5) / SEGMENTS) * Math.PI * 2;
      const i = (ring * SEGMENTS + s) * 3;
      positions[i] = Math.cos(angle) * radius;
      positions[i + 1] = 0;
      positions[i + 2] = Math.sin(angle) * radius;
      normals[i + 1] = 1;
    }
  });

  const indices: number[] = [];
  for (let ring = 0; ring < radii.length - 1; ring += 1) {
    for (let s = 0; s < SEGMENTS; s += 1) {
      const a = ring * SEGMENTS + s;
      const b = ring * SEGMENTS + ((s + 1) % SEGMENTS);
      const c = (ring + 1) * SEGMENTS + s;
      const d = (ring + 1) * SEGMENTS + ((s + 1) % SEGMENTS);
      // Wound so the faces point up (+Y).
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radii[radii.length - 1] ?? 1);
  return geometry;
}

/** Half-breadth of the hull at the waterline, sampled bow to stern. */
function hullWaterplane(hull: HullSpec): { widths: Float32Array; xAft: number; xFwd: number } {
  const widths = new Float32Array(HULL_SAMPLES);
  for (let i = 0; i < HULL_SAMPLES; i += 1) {
    const t = -1 + (2 * i) / (HULL_SAMPLES - 1);
    // Widest of the band the waves wash over, plus a hand's breadth, so no
    // crest ever shows water inside the plating.
    const w = Math.max(
      halfWidthAt(hull, t, hull.draught - 0.7),
      halfWidthAt(hull, t, hull.draught),
      halfWidthAt(hull, t, hull.draught + 0.7),
    );
    widths[i] = w > 0 ? w + 0.06 : 0;
  }
  return { widths, xAft: stationToX(hull, -1), xFwd: stationToX(hull, 1) };
}

const WAVE_GLSL = /* glsl */ `
uniform float uTime;
uniform vec4 uWaveA[${WAVES.length}];   // dir.x, dir.y, k, omega
uniform vec2 uWaveB[${WAVES.length}];   // amplitude, steepness
varying vec3 vSeaWorld;
varying float vSeaCrest;
varying float vSeaHeight;

// Displacement and normal from the same sum, so shading matches the shape.
vec3 seaSwell(vec2 p, out vec3 n, out float crest) {
  vec3 offset = vec3(0.0);
  vec3 grad = vec3(0.0);
  float fold = 0.0;
  // Grid spacing at this radius: waves shorter than ~4 cells are faded out.
  float spacing = ${FIRST_SPACING.toFixed(2)} + ${(GROWTH - 1).toFixed(4)} * length(p);
  for (int i = 0; i < ${WAVES.length}; i++) {
    vec4 a = uWaveA[i];
    vec2 b = uWaveB[i];
    float lambda = 6.2831853 / a.z;
    float fade = 1.0 - smoothstep(lambda * 0.14, lambda * 0.3, spacing);
    float amp = b.x * fade;
    float theta = a.z * dot(a.xy, p) - a.w * uTime + float(i) * 1.7;
    float c = cos(theta);
    float s = sin(theta);
    float qa = b.y / (a.z * max(b.x, 1e-4) * ${WAVES.length}.0) * amp;
    offset.x += qa * a.x * c;
    offset.z += qa * a.y * c;
    offset.y += amp * s;
    grad.x += a.x * a.z * amp * c;
    grad.z += a.y * a.z * amp * c;
    fold += qa * a.z * s;
  }
  n = normalize(vec3(-grad.x, 1.0 - fold, -grad.z));
  crest = fold;
  return offset;
}
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform float uTime;
uniform sampler2D uChop;
uniform sampler2D uFoam;
uniform float uChopScale;
uniform float uFoamScale;
uniform float uHullW[${HULL_SAMPLES}];
uniform float uHullXAft;
uniform float uHullXFwd;
uniform float uHullMask;
uniform vec4 uSmallHullA[${MAX_SMALL_HULLS}];
uniform vec2 uSmallHullB[${MAX_SMALL_HULLS}];
uniform float uSmallHullCount;
uniform vec3 uSunDir;
uniform vec3 uDeep;
uniform vec3 uScatter;
varying vec3 vSeaWorld;
varying float vSeaCrest;
varying float vSeaHeight;

float hullHalfWidth(float x) {
  float t = (x - uHullXAft) / (uHullXFwd - uHullXAft);
  if (t <= 0.0 || t >= 1.0) return 0.0;
  float f = t * ${(HULL_SAMPLES - 1).toFixed(1)};
  int i = int(floor(f));
  float w0 = 0.0;
  float w1 = 0.0;
  // Dynamic indexing of uniform arrays is fine in WebGL2.
  w0 = uHullW[i];
  w1 = uHullW[min(i + 1, ${HULL_SAMPLES - 1})];
  return mix(w0, w1, fract(f));
}
`;

const FRAGMENT_SURFACE = /* glsl */ `
  float seaDist = length(vSeaWorld - cameraPosition);
  float hw = hullHalfWidth(vSeaWorld.x) * uHullMask;
  float hullGap = abs(vSeaWorld.z) - hw;
  if (hw > 0.0 && hullGap < 0.0) discard;
  // Nor inside the small craft (boats, kayaks).
  for (int i = 0; i < ${MAX_SMALL_HULLS}; i++) {
    if (float(i) >= uSmallHullCount) break;
    vec4 sh = uSmallHullA[i];
    vec2 sd = vSeaWorld.xz - sh.xy;
    vec2 se = vec2(dot(sd, sh.zw), dot(sd, vec2(-sh.w, sh.z))) / uSmallHullB[i];
    if (dot(se, se) < 1.0) discard;
  }

  // Wind chop: two scrolling layers at unrelated scales and headings.
  vec2 uvA = vSeaWorld.xz * uChopScale + vec2(uTime * 0.021, uTime * 0.013);
  vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * vSeaWorld.xz * uChopScale * 2.63 + vec2(-uTime * 0.017, uTime * 0.026);
  vec3 chopA = texture2D(uChop, uvA).xyz * 2.0 - 1.0;
  vec3 chopB = texture2D(uChop, uvB).xyz * 2.0 - 1.0;
  float chopFade = 1.0 - smoothstep(60.0, 1400.0, seaDist) * 0.85;
  vec2 chop = (chopA.xy + chopB.xy * 0.6) * chopFade;

  // Whitecaps where crests fold over, plus lapping foam along the hull.
  vec3 foamTex = texture2D(uFoam, vSeaWorld.xz * uFoamScale + vec2(uTime * 0.01, 0.0)).rgb;
  float crestFoam = smoothstep(0.4, 0.68, vSeaCrest + foamTex.g * 0.22) * foamTex.r;
  // Broken, patchy white water where the swell slaps the plating — not a
  // continuous rim, which would read as a glow round the waterline.
  float contact = (hw > 0.0 ? exp(-max(hullGap, 0.0) / 0.28) : 0.0) * uHullMask;
  float lap = contact * smoothstep(0.55, 0.95, foamTex.r + foamTex.b * 0.45 + 0.3 * sin(uTime * 1.3 + vSeaWorld.x * 0.4));
  float seaFoam = clamp(crestFoam * 0.9 + lap * 0.28, 0.0, 1.0);

  diffuseColor.rgb = mix(uDeep, vec3(0.74, 0.78, 0.8), seaFoam);
`;

const FRAGMENT_ROUGHNESS = /* glsl */ `
  roughnessFactor = mix(0.035, 0.24, smoothstep(30.0, 3000.0, seaDist));
  roughnessFactor = mix(roughnessFactor, 0.7, seaFoam);
`;

const FRAGMENT_NORMAL = /* glsl */ `
  {
    vec3 geo = normalize(vNormal);
    // vNormal is view space; rebuild the world normal from the view matrix.
    vec3 worldGeo = normalize((vec4(geo, 0.0) * viewMatrix).xyz);
    vec3 worldN = normalize(worldGeo + vec3(chop.x, 0.0, chop.y) * 0.42);
    normal = normalize((viewMatrix * vec4(worldN, 0.0)).xyz);
  }
`;

const FRAGMENT_SCATTER = /* glsl */ `
  {
    // Light passing through the thin tops of waves between viewer and sun:
    // the green-blue glow in a crest just before it breaks.
    vec3 viewDir = normalize(cameraPosition - vSeaWorld);
    vec2 towardsSun = normalize(uSunDir.xz);
    float backlit = pow(max(dot(-viewDir.xz, towardsSun) * 0.5 + 0.5, 0.0), 3.0);
    float thin = clamp(vSeaHeight * 1.4 + 0.25, 0.0, 1.0);
    totalEmissiveRadiance += uScatter * thin * (0.06 + backlit) * (1.0 - seaFoam);
  }
`;

/** Light scattered through thin crests, at the reference sunset (key light 9). */
const SCATTER = new THREE.Color('#0c4a5e').multiplyScalar(0.32);

function patch(source: string, anchor: string, code: string, where: 'after' | 'replace'): string {
  if (!source.includes(anchor)) throw new Error(`[DryDock] sea shader anchor missing: ${anchor}`);
  return source.replace(anchor, where === 'replace' ? code : `${anchor}\n${code}`);
}

export function Sea({ hull, explodeAmount }: { hull: HullSpec; explodeAmount: number }): React.ReactElement {
  const geometry = useMemo(() => buildSeaGeometry(), []);
  const waterplane = useMemo(() => hullWaterplane(hull), [hull]);
  const mask = useRef(1 - explodeAmount);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uWaveA: {
        value: WAVES.map((wave) => {
          const k = (Math.PI * 2) / wave.length;
          return new THREE.Vector4(Math.cos(wave.heading), Math.sin(wave.heading), k, Math.sqrt(G * k));
        }),
      },
      uWaveB: { value: WAVES.map((wave) => new THREE.Vector2(wave.amplitude, wave.steepness)) },
      uChop: { value: FLAT_NORMAL as THREE.Texture },
      uFoam: { value: NO_FOAM as THREE.Texture },
      uChopScale: { value: 1 / TEXTURE_TILE_METRES.water },
      uFoamScale: { value: 1 / TEXTURE_TILE_METRES.foam },
      uHullW: { value: Array.from(waterplane.widths) },
      uHullXAft: { value: waterplane.xAft },
      uHullXFwd: { value: waterplane.xFwd },
      uHullMask: { value: mask.current },
      uSmallHullA: { value: Array.from({ length: MAX_SMALL_HULLS }, () => new THREE.Vector4()) },
      uSmallHullB: { value: Array.from({ length: MAX_SMALL_HULLS }, () => new THREE.Vector2(1, 1)) },
      uSmallHullCount: { value: 0 },
      uSunDir: { value: daylight.keyDirection.clone() },
      // Open-ocean body colour: deep water absorbs red and green first, so what
      // little light comes back up is a dark, slightly violet blue.
      uDeep: { value: new THREE.Color('#03182a') },
      uScatter: { value: SCATTER.clone() },
    }),
    [waterplane],
  );

  const material = useMemo(() => {
    const surface = new THREE.MeshStandardMaterial({
      color: '#03182a',
      roughness: 0.05,
      metalness: 0,
      // Reflect the sky at the brightness it is displayed with.
      envMapIntensity: daylight.background / daylight.environment,
      // Long, smooth gradients: dither, or they band in 8-bit output.
      dithering: true,
    });
    // Distance haze is the sky's job: at grazing angles the sea reflects the
    // horizon, which is exactly the colour it should fade to.
    surface.fog = false;

    surface.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      let vertex = shader.vertexShader;
      vertex = patch(vertex, '#include <common>', WAVE_GLSL, 'after');
      vertex = patch(
        vertex,
        '#include <beginnormal_vertex>',
        `vec3 seaNormal;
         float seaCrest;
         vec2 seaXZ = (modelMatrix * vec4(position, 1.0)).xz;
         vec3 seaOffset = seaSwell(seaXZ, seaNormal, seaCrest);
         vec3 objectNormal = seaNormal;`,
        'replace',
      );
      vertex = patch(
        vertex,
        '#include <begin_vertex>',
        `vec3 transformed = position + seaOffset;
         vSeaCrest = seaCrest;
         vSeaHeight = seaOffset.y;
         vSeaWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        'replace',
      );
      shader.vertexShader = vertex;

      let fragment = shader.fragmentShader;
      fragment = patch(fragment, '#include <common>', FRAGMENT_DECLARATIONS, 'after');
      fragment = patch(fragment, '#include <color_fragment>', FRAGMENT_SURFACE, 'after');
      fragment = patch(fragment, '#include <roughnessmap_fragment>', FRAGMENT_ROUGHNESS, 'after');
      fragment = patch(fragment, '#include <normal_fragment_maps>', FRAGMENT_NORMAL, 'replace');
      fragment = patch(fragment, '#include <emissivemap_fragment>', FRAGMENT_SCATTER, 'after');
      // The ship's deck floodlights spill over the side, and on near-mirror
      // water a lamp's highlight is a blinding glitter column under the hull.
      // The sea ignores spotlights; the lamps' reflections are drawn as soft
      // streaks instead (world/glow.ts).
      fragment = patch(
        fragment,
        '#include <lights_fragment_begin>',
        patch(
          THREE.ShaderChunk.lights_fragment_begin,
          'getSpotLightInfo( spotLight, geometryPosition, directLight );',
          'directLight.color *= 0.0;',
          'after',
        ),
        'replace',
      );
      shader.fragmentShader = fragment;
    };
    surface.customProgramCacheKey = () => 'drydock-sea-v4';
    return surface;
  }, [uniforms]);

  useEffect(() => {
    loadDataTexture('/textures/water_normal.webp', (texture) => {
      uniforms.uChop.value = texture;
    });
    loadDataTexture('/textures/foam.webp', (texture) => {
      uniforms.uFoam.value = texture;
    });
  }, [uniforms]);

  useFrame((_, delta) => {
    uniforms.uTime.value += Math.min(delta, 0.1);
    seaClock.time = uniforms.uTime.value;
    // The vessel rises as it opens; the hole in the water closes behind it.
    const target = 1 - Math.min(1, explodeAmount * 1.6);
    mask.current += (target - mask.current) * (1 - Math.exp(-EXPLODE.easeSpeed * delta));
    uniforms.uHullMask.value = mask.current;
    for (let i = 0; i < smallHulls.count; i += 1) {
      uniforms.uSmallHullA.value[i]!.fromArray(smallHulls.centres, i * 4);
      uniforms.uSmallHullB.value[i]!.fromArray(smallHulls.sizes, i * 2);
    }
    uniforms.uSmallHullCount.value = smallHulls.count;
    // Crest glow comes from the key light: the sun, or faintly the moon.
    if (uniforms.uSunDir.value.equals(daylight.keyDirection) === false) uniforms.uSunDir.value.copy(daylight.keyDirection);
    // Reflect the sky at the brightness it is displayed with.
    material.envMapIntensity = daylight.background / daylight.environment;
    uniforms.uScatter.value.copy(SCATTER).multiplyScalar(Math.min(daylight.keyIntensity / 9, 1.2));
  });

  return (
    <mesh geometry={geometry} material={material} position={[0, hull.draught, 0]} raycast={() => null} receiveShadow />
  );
}
