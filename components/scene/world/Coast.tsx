'use client';

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { daylight } from '../daylight';
import { useVesselStore } from '@/lib/state/useVesselStore';
import {
  GlowBatch,
  createGlowMaterial,
  createReflectionMaterial,
  glowPoints,
  reflectionColumns,
  updateGlowMaterial,
  updateReflectionMaterial,
  type GlowSpec,
} from './glow';
import { useDisposeOnRelease } from '../disposal';
// Not `./coast`: next to Coast.tsx that name resolves to this very file on
// case-insensitive file systems (macOS, Windows).
import { buildCoastSteps, coastGeometry, type CoastData } from './coastBuild';

/**
 * The Rio waterfront around the vessel: terrain, city blocks, city lights,
 * surf on the beaches and the cable car to the Pão de Açúcar (see coastBuild.ts).
 *
 * Shading is deliberately simple — sun, sky light and aerial perspective —
 * because at four to seventeen kilometres that is all the eye reads. The haze
 * colour is sampled from the rendered sky itself in the direction of each
 * fragment, so the mountains dissolve into exactly the horizon behind them:
 * warm towards the sunset, cool away from it. Land below the waterline is
 * discarded, so the sea (and the lagoon, which is just sea in a basin) is
 * always what shows at the shore.
 *
 * Every shader here avoids operations that are undefined in GLSL (reversed
 * smoothstep edges, normalising a zero vector): some GPUs return NaN for
 * those, and one NaN pixel is enough for the bloom pass to smear black across
 * the screen.
 */

const SKY_AMBIENT_VERTEX = /* glsl */ `
uniform samplerCube uSky;
uniform float uSkyIntensity;
uniform float uHasSky;
uniform vec3 uFallbackHaze;
varying vec3 vSkyUp;
varying vec3 vSkySide;
// Skylight is taken from fixed directions spread round the dome, so the
// cloud pattern in the sky map never prints itself onto the terrain.
void skyAmbient() {
  if (uHasSky < 0.5) {
    vSkyUp = uFallbackHaze;
    vSkySide = uFallbackHaze;
    return;
  }
  vec3 up = vec3(0.0);
  vec3 side = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float a = float(i) * 1.5707963 + 0.4;
    up += texture(uSky, normalize(vec3(cos(a) * 0.5, 0.87, sin(a) * 0.5))).rgb;
    side += texture(uSky, normalize(vec3(cos(a), 0.14, sin(a)))).rgb;
  }
  vSkyUp = up * 0.25 * uSkyIntensity;
  vSkySide = side * 0.25 * uSkyIntensity;
}
`;

const LAND_VERTEX = /* glsl */ `
${SKY_AMBIENT_VERTEX}
attribute vec4 aSurface;
varying vec3 vColor;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec4 vSurface;
void main() {
  vColor = color;
  vSurface = aSurface;
  skyAmbient();
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vLocal = position;
  vNormalW = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** Shared by land and buildings: lighting from the sky cube and the key light, and aerial perspective. */
const SHADING_COMMON = /* glsl */ `
uniform samplerCube uSky;
uniform float uSkyIntensity;
uniform float uHasSky;
uniform vec3 uFallbackHaze;
uniform vec3 uSunDir;
uniform vec3 uSunLight;
uniform float uAmbient;
uniform float uSeaLevel;
uniform float uHazeDistance;
uniform float uNight;
uniform sampler2D uHeight;
uniform vec4 uHeightRect;
uniform vec3 uSunLocal;
uniform float uShadowSteps;
uniform float uHasHeight;
varying vec3 vSkyUp;
varying vec3 vSkySide;

/** Light from the sky dome on a surface facing n. */
vec3 skyIrradiance(vec3 n) {
  return mix(vSkySide, vSkyUp, clamp(n.y * 0.6 + 0.45, 0.0, 1.0));
}

vec3 sky(vec3 dir) {
  return uHasSky > 0.5 ? textureCube(uSky, dir).rgb * uSkyIntensity : uFallbackHaze;
}

vec3 safeNormalize(vec3 v, vec3 fallback) {
  float len = length(v);
  return len > 1e-5 ? v / len : fallback;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Shadows the terrain casts on itself: march from the point towards the key
// light through the height map, in steps that lengthen with distance, and
// keep the closest the ray came to passing under the ground. Soft-edged,
// as a shadow across kilometres of hazy air is.
float terrainShadow(vec3 local, vec3 n) {
  if (uHasHeight < 0.5 || uSunLocal.y <= 0.0) return 1.0;
  vec3 origin = local + n * 4.0;
  float t = 18.0;
  float light = 1.0;
  for (int i = 0; i < 40; i++) {
    if (float(i) >= uShadowSteps) break;
    vec3 p = origin + uSunLocal * t;
    vec2 uv = (p.xz - uHeightRect.xy) * uHeightRect.zw;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || p.y > 1250.0) break;
    float ground = texture2D(uHeight, uv).r;
    light = min(light, clamp(0.5 + (p.y - ground) / (0.035 * t + 3.0), 0.0, 1.0));
    if (light <= 0.0) break;
    t *= 1.16;
  }
  return light * light * (3.0 - 2.0 * light);
}

// Aerial perspective: thicker near the water, towards the sky just above the horizon.
vec3 aerial(vec3 colour, vec3 world, vec3 view, float dist) {
  float height = max(world.y - uSeaLevel, 0.0);
  float density = 0.35 + 0.6 * exp(-height / 300.0);
  float haze = 1.0 - exp(-dist / uHazeDistance * density);
  // The colour of the air is the colour of the horizon in that direction —
  // taken at the horizon itself, below the clouds, whose pattern would
  // otherwise print across the mountains.
  vec3 hazeDir = safeNormalize(vec3(view.x, 0.0025, view.z), vec3(0.0, 0.1, 1.0));
  return mix(colour, sky(hazeDir), clamp(haze, 0.0, 1.0));
}
`;

const LAND_FRAGMENT = /* glsl */ `
${SHADING_COMMON}
varying vec3 vColor;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec4 vSurface;

// Forest canopy: crowns of a few metres, clumps of tens, stands of hundreds.
float canopy(vec2 p) {
  return vnoise(p / 7.0) * 0.45 + vnoise(p / 23.0 + 5.2) * 0.35 + vnoise(p / 90.0 + 1.7) * 0.2;
}

void main() {
  if (vWorld.y < uSeaLevel + 0.15) discard;
  vec3 n = safeNormalize(vNormalW, vec3(0.0, 1.0, 0.0));
  if (!gl_FrontFacing) n = -n;
  vec3 toFragment = vWorld - cameraPosition;
  float dist = max(length(toFragment), 1.0);
  vec3 view = toFragment / dist;

  float forest = vSurface.x;
  float rock = vSurface.y;
  float built = vSurface.z;
  float ao = vSurface.w;

  // Surface detail below the terrain grid, faded out where it would only shimmer.
  float footprint = max(length(fwidth(vWorld.xz)), 0.01);
  float fine = 1.0 - smoothstep(2.5, 9.0, footprint);
  vec3 albedo = vColor;

  // Relief below the grid: knolls, spurs and gullies tens of metres across,
  // folded into the lighting (not the geometry) so every slope catches light
  // on one side and shade on the other. Each octave fades out once it is
  // smaller than a few pixels, so nothing shimmers.
  float land = smoothstep(4.0, 30.0, vWorld.y - uSeaLevel) * (1.0 - built * 0.8);
  if (land > 0.0) {
    float o1 = 1.0 - smoothstep(40.0, 90.0, footprint);
    float o2 = 1.0 - smoothstep(12.0, 30.0, footprint);
    float o3 = fine;
    vec2 p = vWorld.xz;
    vec2 e = vec2(4.0, 0.0);
    #define DETAIL(q) (vnoise((q) / 170.0) * 34.0 * o1 + vnoise(mat2(0.8, -0.6, 0.6, 0.8) * (q) / 58.0 + 7.3) * 11.0 * o2 + vnoise((q) / 21.0 + 3.1) * 3.5 * o3)
    float d0 = DETAIL(p);
    float dx = DETAIL(p + e.xy) - d0;
    float dz = DETAIL(p + e.yx) - d0;
    #undef DETAIL
    n = normalize(n + vec3(-dx, 0.0, -dz) / e.x * land * 0.9);
    // Gullies collect shade and moisture: darker, lusher.
    albedo *= mix(1.0, 0.82 + 0.36 * smoothstep(-6.0, 10.0, d0 - 17.0), land * forest);
  }

  // Broad variation across the forest: older, darker stands and paler, younger growth.
  float stand = vnoise(vWorld.xz / 650.0 + 4.0);
  albedo *= mix(vec3(1.0), mix(vec3(0.82, 0.9, 0.86), vec3(1.12, 1.1, 0.92), stand), forest);

  // Canopy: crowns lit on the side facing the key light, dark gaps between.
  vec2 lightXZ = safeNormalize(vec3(uSunDir.x, 0.0, uSunDir.z), vec3(1.0, 0.0, 0.0)).xz;
  float c0 = canopy(vWorld.xz);
  float c1 = canopy(vWorld.xz + lightXZ * 2.5);
  float crown = mix(1.0, 0.7 + 0.6 * c0 + (c0 - c1) * 1.6, fine);
  float stands = 0.82 + 0.36 * vnoise(vWorld.xz / 140.0 + 9.0);
  albedo *= mix(1.0, crown * stands, forest);

  // Bare granite breaks through the forest wherever the slope is steep —
  // the grey slabs and boulder fields all over Rio's hills.
  float steep = 1.0 - n.y;
  float slabs = smoothstep(0.32, 0.55, steep + (vnoise(vWorld.xz / 70.0 + 2.0) - 0.5) * 0.35 + (vnoise(vWorld.xz / 22.0) - 0.5) * 0.12 * fine);
  vec3 granite = vec3(0.135, 0.128, 0.118) * (0.7 + 0.6 * vnoise(vec2((vWorld.x + vWorld.z) / 9.0, vWorld.y / 60.0)));
  albedo = mix(albedo, granite, slabs * forest * 0.8);
  rock = max(rock, slabs * forest);
  // Slopes facing the sun dry out a little: yellower, lighter greens.
  float sunny = clamp(dot(n.xz, normalize(uSunLocal.xz + vec2(1e-4))) * 0.5 + 0.5, 0.0, 1.0);
  albedo *= mix(vec3(1.0), vec3(1.08, 1.06, 0.9), forest * (1.0 - slabs) * sunny * 0.6);

  // Granite: rain streaks running down the rock, lichen and wet stains.
  float streak = vnoise(vec2((vWorld.x + vWorld.z) / 5.0, vWorld.y / 45.0)) * 0.6 + vnoise(vec2((vWorld.x - vWorld.z) / 17.0, vWorld.y / 120.0)) * 0.4;
  albedo *= mix(1.0, 0.72 + 0.5 * streak, rock * mix(0.5, 1.0, fine));

  // By moonlight colour drains away: the eye sees in greys and blues.
  albedo = mix(albedo, vec3(dot(albedo, vec3(0.3, 0.59, 0.11))), uNight * 0.6);

  // Direct light, softly wrapped (foliage scatters), and skylight from the
  // dome in the direction the surface faces, both shadowed by the terrain itself.
  float wrap = max((dot(n, uSunDir) + 0.18) / 1.18, 0.0);
  float shade = terrainShadow(vLocal, n);
  vec3 skyLight = skyIrradiance(n) * uAmbient * ao;
  vec3 colour = albedo * (uSunLight * wrap * shade * mix(1.0, ao, 0.65) + skyLight);

  // After dark the built-up areas glow: street lighting on the ground,
  // sodium-orange, patchy by block.
  if (uNight > 0.0 && built > 0.0) {
    float blocks = vnoise(vWorld.xz / 60.0 + 3.0) * 0.6 + vnoise(vWorld.xz / 14.0) * 0.4 * fine + 0.2;
    colour += vec3(1.0, 0.56, 0.22) * built * blocks * uNight * 0.09;
  }

  colour = aerial(colour, vWorld, view, dist);
  gl_FragColor = vec4(max(colour, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const BUILDING_VERTEX = /* glsl */ `
${SKY_AMBIENT_VERTEX}
attribute vec3 aWindow;
varying vec3 vColor;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec3 vWindow;
void main() {
  vColor = color;
  vWindow = aWindow;
  skyAmbient();
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vLocal = position;
  vNormalW = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const BUILDING_FRAGMENT = /* glsl */ `
${SHADING_COMMON}
varying vec3 vColor;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec3 vWindow;

void main() {
  if (vWorld.y < uSeaLevel + 0.15) discard;
  vec3 n = safeNormalize(vNormalW, vec3(0.0, 1.0, 0.0));
  if (!gl_FrontFacing) n = -n;
  vec3 toFragment = vWorld - cameraPosition;
  float dist = max(length(toFragment), 1.0);
  vec3 view = toFragment / dist;

  float seed = vWindow.x;
  float groundY = vWindow.y;
  float kind = vWindow.z;
  vec3 albedo = vColor;
  vec3 glow = vec3(0.0);

  if (kind < 1.5 && abs(n.y) < 0.5) {
    // Facade: floors of windows. Apartment blocks have wide bays, favela
    // houses small openings. Where a window is smaller than a pixel or two the
    // pattern is replaced by its average, so distant facades never shimmer.
    vec2 tangent = safeNormalize(vec3(-n.z, 0.0, n.x), vec3(1.0, 0.0, 0.0)).xz;
    vec2 cellSize = kind < 0.5 ? vec2(3.3, 3.0) : vec2(2.6, 2.7);
    vec2 g = vec2(dot(vWorld.xz, tangent), vWorld.y - groundY) / cellSize;
    vec2 cell = floor(g);
    vec2 f = fract(g);
    vec2 fw = fwidth(g);
    float far = smoothstep(0.3, 0.8, max(fw.x, fw.y));
    vec2 inset = kind < 0.5 ? vec2(0.1, 0.2) : vec2(0.3, 0.3);
    float pane = step(inset.x, f.x) * step(f.x, 1.0 - inset.x) * step(inset.y, f.y) * step(f.y, 0.86);
    float area = (1.0 - 2.0 * inset.x) * (0.86 - inset.y);
    float window = mix(pane, area, far) * step(0.0, g.y);

    // By day: glass is dark and cool, reflecting a little sky.
    vec3 glass = vec3(0.05, 0.065, 0.08) + sky(reflect(view, n)) * 0.06;
    albedo = mix(albedo * 0.9, glass, window * 0.92);
    // Ground-floor shopfronts and the grime line at street level.
    albedo *= mix(0.82, 1.0, smoothstep(0.0, 1.0, g.y));

    if (uNight > 0.0) {
      float h = hash12(cell + seed * 913.0);
      float floorMood = hash12(vec2(cell.y, seed * 71.0));
      float fraction = kind < 0.5 ? 0.3 + 0.35 * floorMood : 0.55;
      float lit = step(h, fraction);
      vec3 warm = mix(vec3(1.0, 0.68, 0.36), vec3(1.0, 0.88, 0.7), fract(h * 7.1));
      // A few cold, blue-white rooms: televisions and office LEDs.
      warm = mix(warm, vec3(0.75, 0.85, 1.0), step(0.9, fract(h * 23.7)));
      float fineGlow = pane * lit * (0.6 + 0.8 * fract(h * 13.3));
      float farGlow = area * fraction * (0.7 + 0.6 * hash12(floor(cell / vec2(5.0, 3.0)) + seed * 17.0));
      float shop = (1.0 - step(1.0, g.y)) * step(0.0, g.y) * 0.8 * (kind < 0.5 ? 1.0 : 0.0);
      glow = (warm * mix(fineGlow, farGlow, far) + vec3(1.0, 0.8, 0.55) * shop) * step(0.0, g.y) * uNight * 1.25;
    }
  }

  float wrap = max((dot(n, uSunDir) + 0.15) / 1.15, 0.0);
  float shade = terrainShadow(vLocal, vec3(0.0, 1.0, 0.0));
  vec3 skyLight = skyIrradiance(n) * uAmbient;
  vec3 colour = albedo * (uSunLight * wrap * shade + skyLight) + glow;

  colour = aerial(colour, vWorld, view, dist);
  gl_FragColor = vec4(max(colour, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const LIGHTS_VERTEX = /* glsl */ `
attribute vec3 lightData; // size, phase, blinks
uniform float uTime;
uniform float uPixelRatio;
uniform float uNight;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 1.0);
  float twinkle = 0.8 + 0.2 * sin(uTime * 1.7 + lightData.y * 5.0);
  float beacon = lightData.z > 0.5 ? 1.0 : 0.0;
  float blink = beacon > 0.5 ? step(0.55, fract(uTime * 0.55 + lightData.y)) : 1.0;
  // Street and window lights come on at dusk; the aviation beacons never go off.
  float on = beacon > 0.5 ? 1.0 : uNight;
  vAlpha = twinkle * blink * on * clamp(1.15 - dist / 22000.0, 0.3, 1.0);
  gl_PointSize = clamp(lightData.x * (1.0 + 0.35 * uNight) * uPixelRatio * clamp(6000.0 / dist, 0.7, 1.6), 1.0, 24.0);
  vColor = color;
  if (vAlpha < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const LIGHTS_FRAGMENT = /* glsl */ `
uniform float uGain;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.05, 0.5, d)) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * uGain, a);
}
`;


const SURF_VERTEX = /* glsl */ `
attribute float aAlong;
varying float vAlong;
varying float vAcross;
void main() {
  vAlong = aAlong;
  vAcross = float(gl_VertexID % 2);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SURF_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying float vAlong;
varying float vAcross;
void main() {
  // Sets of breakers rolling along the beach, brightest where they break.
  float set = 0.5 + 0.5 * sin(vAlong * 0.021 - uTime * 0.55) * sin(vAlong * 0.0063 + uTime * 0.21);
  float band = (1.0 - smoothstep(0.55, 1.0, vAcross)) * smoothstep(0.0, 0.35, vAcross);
  float alpha = band * (0.35 + 0.65 * set) * 0.75;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

function createMaterials(seaLevel: number): {
  land: THREE.ShaderMaterial;
  buildings: THREE.ShaderMaterial;
  lights: THREE.ShaderMaterial;
  reflections: THREE.ShaderMaterial;
  surf: THREE.ShaderMaterial;
  cable: THREE.LineBasicMaterial;
} {
  // Updated every frame from the time of day (see the component below).
  const shared = {
    uSky: { value: null as THREE.Texture | null },
    uSkyIntensity: { value: daylight.background },
    uHasSky: { value: 0 },
    uFallbackHaze: { value: new THREE.Color('#8a7f86') },
    uSunDir: { value: daylight.keyDirection.clone() },
    // Lambert irradiance of the key light, as the scene's own materials see it.
    uSunLight: { value: daylight.keyIrradiance.clone() },
    uAmbient: { value: 0.8 },
    uSeaLevel: { value: seaLevel },
    uHazeDistance: { value: 16000 },
    uNight: { value: daylight.night },
    uHeight: { value: null as THREE.Texture | null },
    uHeightRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uSunLocal: { value: new THREE.Vector3(0, 1, 0) },
    uShadowSteps: { value: 32 },
    uHasHeight: { value: 0 },
  };
  const land = new THREE.ShaderMaterial({
    vertexShader: LAND_VERTEX,
    fragmentShader: LAND_FRAGMENT,
    uniforms: shared,
    vertexColors: true,
  });
  const buildings = new THREE.ShaderMaterial({
    vertexShader: BUILDING_VERTEX,
    fragmentShader: BUILDING_FRAGMENT,
    uniforms: shared,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const lightUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uGain: { value: 1.3 },
    uNight: { value: daylight.night },
    uSeaLevel: { value: seaLevel },
    uHalfHeight: { value: 400 },
  };
  const lights = new THREE.ShaderMaterial({
    vertexShader: LIGHTS_VERTEX,
    fragmentShader: LIGHTS_FRAGMENT,
    uniforms: lightUniforms,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  // The waterfront's lights on the sea (see world/glow.ts), a little dimmer
  // than a lamp seen directly.
  const reflections = createReflectionMaterial(seaLevel, 0.16);
  const surf = new THREE.ShaderMaterial({
    vertexShader: SURF_VERTEX,
    fragmentShader: SURF_FRAGMENT,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#e9e4dc') } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const cable = new THREE.LineBasicMaterial({ color: '#2a2622', transparent: true, opacity: 0.8 });
  return { land, buildings, lights, reflections, surf, cable };
}

/**
 * Runs the (generator) build a few milliseconds at a time between frames, so
 * the page never stalls while the bay is being made. Plain macrotasks rather
 * than animation frames: on a slow frame rate the build would otherwise crawl.
 */
function useCoastData(seaLevel: number): CoastData | null {
  const [data, setData] = useState<CoastData | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const steps = buildCoastSteps(seaLevel, 6);
    const run = (): void => {
      if (cancelled) return;
      try {
        const result = steps.next();
        if (result.done) {
          setData(result.value);
          return;
        }
      } catch (error) {
        // Scenery only: without it the twin still works.
        console.warn('[DryDock] could not build the coastline', error);
        return;
      }
      timer = setTimeout(run, 0);
    };
    // Let the vessel appear first.
    timer = setTimeout(run, 600);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [seaLevel]);
  return data;
}

/**
 * Night traffic on the beach avenues: headlights one way, tail lights the
 * other, flowing along the waterfront — from the sea, the moving line of
 * light under the buildings is what says "city" more than any building.
 */
interface Road {
  readonly points: Float32Array;
  /** Distance along the road at each point, metres. */
  readonly along: Float32Array;
  readonly length: number;
}

interface Car {
  readonly road: number;
  readonly start: number;
  /** m/s; negative for the lane running the other way. */
  readonly speed: number;
  readonly lane: number;
}

const HEADLIGHT = new THREE.Color('#fff0d2');
const TAIL_LIGHT = new THREE.Color('#ff2a1a');

function buildTraffic(polylines: readonly Float32Array[]): { roads: Road[]; cars: Car[] } {
  const roads = polylines.map((points) => {
    const n = points.length / 3;
    const along = new Float32Array(n);
    for (let i = 1; i < n; i += 1) {
      along[i] = along[i - 1]! + Math.hypot(points[i * 3]! - points[i * 3 - 3]!, points[i * 3 + 2]! - points[i * 3 - 1]!);
    }
    return { points, along, length: along[n - 1] ?? 0 };
  });
  const cars: Car[] = [];
  let seed = 7;
  const random = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  roads.forEach((road, index) => {
    for (const lane of [-1, 1]) {
      // Bunched like real traffic: platoons behind the lights, gaps between.
      for (let s = random() * 40; s < road.length; s += 18 + random() * 70) {
        cars.push({ road: index, start: s, speed: lane * (11 + random() * 5), lane });
      }
    }
  });
  return { roads, cars };
}

/** Point `distance` metres along a road (wrapping), shifted sideways by `offset`. */
function pointAlong(road: Road, distance: number, offset: number, out: THREE.Vector3): void {
  const d = ((distance % road.length) + road.length) % road.length;
  let lo = 0;
  let hi = road.along.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (road.along[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const span = Math.max(road.along[hi]! - road.along[lo]!, 1e-6);
  const f = (d - road.along[lo]!) / span;
  const p = road.points;
  const ax = p[lo * 3]!;
  const az = p[lo * 3 + 2]!;
  const bx = p[hi * 3]!;
  const bz = p[hi * 3 + 2]!;
  const dx = (bx - ax) / span;
  const dz = (bz - az) / span;
  out.set(ax + (bx - ax) * f - dz * offset, p[lo * 3 + 1]! + (p[hi * 3 + 1]! - p[lo * 3 + 1]!) * f, az + (bz - az) * f + dx * offset);
}

const NOTHING: readonly { dispose(): void }[] = [];
const noRaycast = (): void => undefined;

/** Rotation of the whole bay about the vessel, radians (positive turns it towards higher azimuths). */
const COAST_TURN = (3 * Math.PI) / 180;

const SURF_COLOR = new THREE.Color('#e9e4dc');
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Two cabins per span, shuttling up and down like the real cable car. */
const CABLE_PERIOD = 150;

export function Coast({ seaLevel }: { seaLevel: number }): React.ReactElement | null {
  const scene = useThree((state) => state.scene);
  const data = useCoastData(seaLevel);
  const geometry = useMemo(() => (data ? coastGeometry(data) : null), [data]);
  const materials = useMemo(() => createMaterials(seaLevel), [seaLevel]);
  const renderQuality = useVesselStore((state) => state.renderQuality);

  // The height map for terrain shadows, as a half-float texture.
  const heightTexture = useMemo(() => {
    if (!data) return null;
    const { data: heights, size } = data.heightmap;
    const half = new Uint16Array(heights.length);
    for (let i = 0; i < heights.length; i += 1) half[i] = THREE.DataUtils.toHalfFloat(heights[i]!);
    const texture = new THREE.DataTexture(half, size, size, THREE.RedFormat, THREE.HalfFloatType);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }, [data]);
  const ownedHeight = useMemo(() => (heightTexture ? [heightTexture] : NOTHING), [heightTexture]);
  useDisposeOnRelease(ownedHeight);

  useEffect(() => {
    const uniforms = materials.land.uniforms;
    if (!heightTexture || !data) {
      uniforms.uHasHeight!.value = 0;
      return;
    }
    const { minX, minZ, span } = data.heightmap;
    uniforms.uHeight!.value = heightTexture;
    (uniforms.uHeightRect!.value as THREE.Vector4).set(minX, minZ, 1 / span, 1 / span);
    uniforms.uHasHeight!.value = 1;
  }, [heightTexture, data, materials]);

  useEffect(() => {
    materials.land.uniforms.uShadowSteps!.value = renderQuality === 'performance' ? 16 : 34;
  }, [renderQuality, materials]);

  const cable = useMemo(() => {
    if (!data) return null;
    const stations = data.cable.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const line = new THREE.BufferGeometry().setFromPoints(stations);
    const cabins = new THREE.BufferGeometry();
    const positions = new Float32Array(4 * 3);
    cabins.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    const colours = new Float32Array(4 * 3).fill(1);
    for (let i = 0; i < 4; i += 1) colours.set([1, 0.93, 0.8], i * 3);
    cabins.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const data4 = new Float32Array([2.2, 0, 0, 2.2, 1, 0, 2.2, 2, 0, 2.2, 3, 0]);
    cabins.setAttribute('lightData', new THREE.BufferAttribute(data4, 3));
    cabins.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 18500);
    const wire = new THREE.Line(line, materials.cable);
    wire.raycast = noRaycast;
    wire.frustumCulled = false;
    return { stations, line, wire, cabins, positions };
  }, [data, materials]);

  const ownedGeometry = useMemo(
    () =>
      geometry && cable
        ? [geometry.land, geometry.buildings, geometry.lights, geometry.surf, cable.line, cable.cabins]
        : NOTHING,
    [geometry, cable],
  );
  const ownedMaterials = useMemo(
    () => [materials.land, materials.buildings, materials.lights, materials.reflections, materials.surf, materials.cable],
    [materials],
  );
  useDisposeOnRelease(ownedGeometry);
  useDisposeOnRelease(ownedMaterials);

  const scratch = useMemo(() => new THREE.Vector3(), []);

  // Reflections of the waterfront lights: lamps low enough to stand by the
  // water (the beach avenues, the first rows of buildings), not the hills.
  const waterfront = useMemo(() => {
    if (!data) return null;
    const { position, color, lightData } = data.lights;
    const specs: GlowSpec[] = [];
    for (let i = 0; i < lightData.length / 3; i += 1) {
      if (lightData[i * 3 + 2]! > 0.5) continue; // the blinking summit beacons
      const y = position[i * 3 + 1]!;
      if (y - seaLevel > 70) continue;
      specs.push({
        position: [position[i * 3]!, y, position[i * 3 + 2]!],
        color: new THREE.Color(color[i * 3]!, color[i * 3 + 1]!, color[i * 3 + 2]!),
        size: lightData[i * 3]! * 2.4,
      });
    }
    return reflectionColumns(specs, materials.reflections);
  }, [data, materials, seaLevel]);
  const ownedWaterfront = useMemo(() => (waterfront ? [waterfront.geometry] : NOTHING), [waterfront]);
  useDisposeOnRelease(ownedWaterfront);

  const traffic = useMemo(() => {
    if (!data) return null;
    const { roads, cars } = buildTraffic(data.roads);
    const batch = new GlowBatch(cars.length);
    const material = createGlowMaterial(1.1);
    return { roads, cars, batch, material, points: glowPoints(batch.geometry, material, 2) };
  }, [data]);
  const trafficOwned = useMemo(() => (traffic ? [traffic.batch, traffic.material] : NOTHING), [traffic]);
  useDisposeOnRelease(trafficOwned);

  useFrame(({ clock, gl, size, camera }) => {
    const background = scene.userData.skyCube as THREE.Texture | undefined;
    const uniforms = materials.land.uniforms;
    if (background instanceof THREE.Texture) {
      if (uniforms.uSky!.value !== background) uniforms.uSky!.value = background;
      uniforms.uHasSky!.value = 1;
    } else {
      uniforms.uHasSky!.value = 0;
    }
    // Light and colour follow the time of day.
    uniforms.uSkyIntensity!.value = daylight.background;
    (uniforms.uSunDir!.value as THREE.Vector3).copy(daylight.keyDirection);
    (uniforms.uSunLight!.value as THREE.Color).copy(daylight.keyIrradiance);
    uniforms.uNight!.value = daylight.night;
    uniforms.uHazeDistance!.value = daylight.haze;
    // The key light in the bay's own (slightly turned) coordinates, for the shadow march.
    (uniforms.uSunLocal!.value as THREE.Vector3).copy(daylight.keyDirection).applyAxisAngle(Y_AXIS, COAST_TURN);
    materials.lights.uniforms.uNight!.value = daylight.night;
    // The surf is white water: as bright as the light that falls on it.
    const surfLight = Math.min(1, 0.12 + daylight.keyIntensity / 9);
    (materials.surf.uniforms.uColor!.value as THREE.Color).copy(SURF_COLOR).multiplyScalar(surfLight);

    const t = clock.elapsedTime;
    materials.lights.uniforms.uTime!.value = t;
    materials.lights.uniforms.uPixelRatio!.value = gl.getPixelRatio();
    updateReflectionMaterial(materials.reflections, camera, gl.getPixelRatio(), size, daylight.night, t);
    materials.surf.uniforms.uTime!.value = t;

    if (traffic) {
      const night = daylight.night;
      updateGlowMaterial(traffic.material, gl.getPixelRatio(), size.height, night, t);
      if (night < 0.01) {
        if (traffic.batch.geometry.drawRange.count !== 0) traffic.batch.commit(0);
      } else {
        traffic.cars.forEach((car, i) => {
          pointAlong(traffic.roads[car.road]!, car.start + car.speed * t, car.lane * 3.5, scratch);
          traffic.batch.set(i, scratch, car.lane > 0 ? HEADLIGHT : TAIL_LIGHT, car.lane > 0 ? 3.2 : 2.6, 0.95, true);
        });
        traffic.batch.commit(traffic.cars.length);
      }
    }

    if (cable) {
      // Each span carries two cabins that pass in the middle.
      for (let span = 0; span < 2; span += 1) {
        const a = cable.stations[span]!;
        const b = cable.stations[span + 1]!;
        const phase = (t / CABLE_PERIOD + span * 0.37) % 1;
        const u = phase < 0.5 ? phase * 2 : 2 - phase * 2;
        for (let cabin = 0; cabin < 2; cabin += 1) {
          const f = cabin === 0 ? u : 1 - u;
          scratch.lerpVectors(a, b, f);
          // The cable sags a little between the towers.
          scratch.y -= Math.sin(f * Math.PI) * a.distanceTo(b) * 0.03 + 4;
          cable.positions.set([scratch.x, scratch.y, scratch.z], (span * 2 + cabin) * 3);
        }
      }
      (cable.cabins.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  });

  if (!geometry || !cable) return null;
  return (
    // The whole layout is turned a few degrees so the waterfront opens up in
    // the opening shot, with the Pão de Açúcar beside the setting sun.
    <group rotation-y={-COAST_TURN}>
      <mesh geometry={geometry.land} material={materials.land} raycast={noRaycast} frustumCulled={false} />
      <mesh geometry={geometry.buildings} material={materials.buildings} raycast={noRaycast} frustumCulled={false} />
      <mesh geometry={geometry.surf} material={materials.surf} raycast={noRaycast} frustumCulled={false} renderOrder={1} />
      <points geometry={geometry.lights} material={materials.lights} raycast={noRaycast} frustumCulled={false} renderOrder={2} />
      {waterfront ? <primitive object={waterfront} /> : null}
      <primitive object={cable.wire} />
      {traffic ? <primitive object={traffic.points} /> : null}
      <points geometry={cable.cabins} material={materials.lights} raycast={noRaycast} frustumCulled={false} renderOrder={2} />
    </group>
  );
}
