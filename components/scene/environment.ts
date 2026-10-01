/**
 * Sky, sun, moon and image-based lighting.
 *
 * The daytime sky is a physically based atmosphere — the Preetham scattering
 * model with a cloud layer, as shipped in three.js (`examples/jsm/objects/Sky.js`,
 * MIT) — rendered into a cube map. That cube is both the visible background
 * and, run through PMREM, the environment every material reflects and is lit
 * by. One source for both is the point: the horizon you see is the horizon the
 * hull reflects, and the sun that casts shadows is the sun glowing in the sky.
 *
 * The stock model has no night: once the sun is a couple of degrees down it
 * simply goes black. So the shader is extended with what a real night over a
 * city by the sea has: the afterglow of the blue hour, a dark blue sky that is
 * brighter at the horizon, the orange dome of light pollution over the city,
 * stars (thinned out by that glow and by the thick air near the horizon), a
 * moon with its halo, and clouds lit from below by the city and from above by
 * the moon.
 *
 * The cube is re-rendered only when the time of day changes (a few times a
 * second while the sun is moving, never otherwise), into render targets that
 * are allocated once.
 *
 * Why not a photographed HDRI: every CC0 HDRI we could ship was shot on land,
 * and trees, pylons or apartment blocks on the horizon of an open-sea scene
 * give the game away at once. An atmosphere model has a clean sea horizon and
 * lets the sun be placed where it lights the vessel best.
 */

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { DaylightState } from './daylight';
import { directionFrom } from './daylight';

/**
 * Reference sunset, in degrees: the sun a few degrees above the open water to
 * the right of Rio. The day/night cycle passes through it; a few things that
 * are laid out relative to the sunset (the whales' feeding ground) use it.
 */
export const SUN = {
  elevation: 5.5,
  azimuth: -119,
} as const;

/** Unit vector towards the reference sunset sun (+X bow, +Y up, +Z starboard). */
export const SUN_DIRECTION = directionFrom(SUN.elevation, SUN.azimuth);

export const SKY_SETTINGS = {
  turbidity: 2.6,
  rayleigh: 1.25,
  mieCoefficient: 0.0016,
  mieDirectionalG: 0.82,
  cloudCoverage: 0.58,
  cloudDensity: 0.7,
  cloudElevation: 0.55,
  cloudScale: 0.00018,
  /** Tint of open water seen at a distance, relative to the horizon brightness. */
  seaTint: [0.07, 0.12, 0.155] as const,
  /** Noise level above which the low cloud layer forms: lower = more cloud. */
  lowCloudThreshold: 0.5,
} as const;

/** A fair-weather afternoon has fewer clouds than the dramatic sunset sky. */
export function cloudCoverageFor(sunElevation: number): number {
  return SKY_SETTINGS.cloudCoverage - 0.17 * THREE.MathUtils.smoothstep(sunElevation, 8, 26);
}

/**
 * The stock cloud layer's noise (three.js Sky, MIT), lifted out of its shader
 * so the stars can be hidden behind exactly the clouds the sky draws.
 */
export const SKY_NOISE_GLSL: string = (() => {
  const source = (Sky.SkyShader as { fragmentShader: string }).fragmentShader;
  const start = source.indexOf('vec2 gradient(');
  const end = source.indexOf('// constants for atmospheric scattering');
  if (start < 0 || end < start) throw new Error('[DryDock] Sky shader layout changed — cannot share its cloud noise');
  return source.slice(start, end);
})();

/** Glow colour of the sodium-lit city on the night sky and on cloud bases. */
export const CITY_GLOW = new THREE.Vector3(0.08, 0.043, 0.02);

const NIGHT_GLSL = /* glsl */ `
uniform vec3 uSeaTint;
uniform float uLowCloud;
uniform float uNight;
uniform float uTwilight;
uniform vec3 uMoonDir;
uniform float uShowMoon;
uniform vec3 uCityGlow;
uniform float uCloudLight;
uniform float uIntensity;
uniform float uDither;

// Azimuth weight of the city's light dome: Copacabana to Leblon strongest,
// Barra (further east along the coast) weaker. Degrees, as in coastBuild.ts,
// turned by the same few degrees as the whole bay.
float cityWeight( vec3 dir ) {
  float az = degrees( atan( dir.z, dir.x ) );
  az = mod( az + 360.0 + 3.0, 360.0 );
  float rio = smoothstep( 168.0, 188.0, az ) * ( 1.0 - smoothstep( 226.0, 246.0, az ) );
  float barra = smoothstep( 116.0, 130.0, az ) * ( 1.0 - smoothstep( 160.0, 178.0, az ) );
  float niteroi = smoothstep( 255.0, 262.0, az ) * ( 1.0 - smoothstep( 272.0, 285.0, az ) );
  return max( rio, max( barra * 0.55, niteroi * 0.4 ) );
}

float cityGlow( vec3 dir ) {
  float el = max( dir.y, 0.0 );
  return cityWeight( dir ) * ( exp( -el / 0.055 ) * 0.8 + exp( -el / 0.2 ) * 0.2 );
}

vec3 nightSky( vec3 dir ) {
  float el = max( dir.y, 0.0 );
  vec3 zenith = vec3( 0.0032, 0.0052, 0.0135 );
  vec3 horizon = vec3( 0.014, 0.019, 0.03 );
  vec3 sky = mix( horizon, zenith, smoothstep( 0.0, 0.55, el ) );
  float glow = cityGlow( dir );
  sky += uCityGlow * glow;

  // Stars and the moon's disc are drawn as their own sprites (NightSky.tsx):
  // in a cube map they would be blocky texels. The sky keeps the moon's glow.
  float chord = length( dir - uMoonDir );
  sky += vec3( 0.55, 0.62, 0.78 ) * ( exp( -chord / 0.018 ) * 0.22 * uShowMoon + exp( -chord / 0.16 ) * 0.035 + exp( -chord / 0.7 ) * 0.01 );
  return sky;
}
`;

/** Needs `vSunDirection`, so it is inserted after the varyings. */
const TWILIGHT_GLSL = /* glsl */ `
// The blue hour: the sky keeps glowing for a while after the sun has gone.
vec3 twilightSky( vec3 dir ) {
  float el = max( dir.y, 0.0 );
  vec2 flatDir = normalize( dir.xz + vec2( 1e-5 ) );
  vec2 flatSun = normalize( vSunDirection.xz + vec2( 1e-5 ) );
  float toward = dot( flatDir, flatSun ) * 0.5 + 0.5;
  vec3 sky = vec3( 0.012, 0.022, 0.06 ) * ( 0.6 + 0.4 * ( 1.0 - smoothstep( 0.0, 0.6, el ) ) );
  sky += vec3( 0.22, 0.085, 0.035 ) * pow( clamp( toward, 0.0, 1.0 ), 3.0 ) * exp( -el / 0.1 );
  sky += vec3( 0.03, 0.04, 0.085 ) * exp( -el / 0.3 );
  // The pink "belt of Venus" above the opposite horizon.
  sky += vec3( 0.05, 0.03, 0.045 ) * pow( clamp( 1.0 - toward, 0.0, 1.0 ), 2.5 ) * smoothstep( 0.0, 0.06, el ) * exp( -el / 0.18 );
  return sky;
}
`;

/**
 * Extends the stock sky shader (see the file comment). The sky above is
 * untouched by day; below the horizon, the horizon colour for that azimuth
 * fades into deep water within a few degrees, as a real sea horizon does.
 */
function patchSkyShader(material: THREE.ShaderMaterial): void {
  const replace = (source: string, anchor: string, code: string): string => {
    if (!source.includes(anchor)) throw new Error(`[DryDock] Sky shader layout changed — missing "${anchor}"`);
    return source.replace(anchor, code);
  };
  material.uniforms.uSeaTint = { value: new THREE.Vector3(...SKY_SETTINGS.seaTint) };
  material.uniforms.uLowCloud = { value: SKY_SETTINGS.lowCloudThreshold };
  material.uniforms.uNight = { value: 0 };
  material.uniforms.uTwilight = { value: 0 };
  material.uniforms.uMoonDir = { value: new THREE.Vector3(0, 1, 0) };
  material.uniforms.uShowMoon = { value: 1 };
  material.uniforms.uCityGlow = { value: CITY_GLOW.clone() };
  material.uniforms.uCloudLight = { value: 1 };
  material.uniforms.uIntensity = { value: 1 };
  material.uniforms.uDither = { value: 0 };

  let fragment = material.fragmentShader;
  // The helpers need the stock noise functions, so they go after them.
  fragment = replace(
    fragment,
    '// constants for atmospheric scattering',
    `${NIGHT_GLSL}\n${TWILIGHT_GLSL}\n// constants for atmospheric scattering`,
  );
  fragment = replace(
    fragment,
    'vec3 texColor = ( Lin + L0 ) * 0.04 + sundiscColor + vec3( 0.0, 0.0003, 0.00075 );',
    `vec3 texColor = ( Lin + L0 ) * 0.04 + sundiscColor + vec3( 0.0, 0.0003, 0.00075 );
     if ( uTwilight > 0.0 ) texColor += uTwilight * twilightSky( direction );
     if ( uNight > 0.0 ) texColor += uNight * nightSky( direction );`,
  );
  // Brighter cumulus with the sun high (the stock lighting is tuned for a low sun).
  fragment = replace(
    fragment,
    'vec3 sunColor = vSunE * Fex * 0.22 * 0.04;',
    'vec3 sunColor = vSunE * Fex * 0.22 * 0.04 * uCloudLight;',
  );
  // Clouds after dark: moonlit tops, city-lit bases, and the last of the
  // sunset on their undersides in the blue hour.
  fragment = replace(
    fragment,
    'cloudColor *= max( dayFactor, 0.03 );',
    `cloudColor *= max( dayFactor, 0.03 );
     {
       vec2 flatDir = normalize( direction.xz + vec2( 1e-5 ) );
       vec2 flatSun = normalize( vSunDirection.xz + vec2( 1e-5 ) );
       float toward = dot( flatDir, flatSun ) * 0.5 + 0.5;
       cloudColor += uTwilight * vec3( 0.16, 0.07, 0.05 ) * ( 0.35 + pow( clamp( toward, 0.0, 1.0 ), 2.0 ) ) * shade;
       float moonSide = pow( max( dot( direction, uMoonDir ), 0.0 ), 4.0 );
       cloudColor += uNight * ( vec3( 0.012, 0.015, 0.022 ) * shade + vec3( 0.05, 0.055, 0.07 ) * silver * edge * moonSide
         + uCityGlow * cityWeight( direction ) * 0.8 * ( 1.0 - 0.5 * shade ) * smoothstep( 0.35, 0.0, direction.y ) );
     }`,
  );
  const anchor = 'gl_FragColor = vec4( texColor, 1.0 );';
  fragment = replace(
    fragment,
    anchor,
    `// Low cloud band: the stock cloud layer dissolves into haze near the
     // horizon, which is exactly where a sunset is looked at. This layer sits
     // low, is lit from the sky it covers, and catches a warm rim towards the sun.
     if ( direction.y > 0.0 ) {
       vec2 cp = direction.xz / ( direction.y + 0.06 ) * 1.4;
       float body = fbm( cp * 1.2 + vec2( 3.1, 7.7 ), 0.0 ) * 0.5 + 0.5;
       float detail = fbm( cp * 4.3 + 11.0, 0.0 );
       float density = smoothstep( uLowCloud, uLowCloud + 0.22, body + detail * 0.1 );
       density *= smoothstep( 0.004, 0.04, direction.y ) * ( 1.0 - 0.7 * smoothstep( 0.3, 0.75, direction.y ) );
       float towardSun = pow( max( dot( direction, vSunDirection ), 0.0 ), 6.0 );
       float lum = dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) );
       vec3 shade = lum * mix( vec3( 0.5, 0.47, 0.58 ), vec3( 0.78, 0.8, 0.86 ), smoothstep( 0.1, 0.36, vSunDirection.y ) );
       // Warm-lit at sunset, plain white cumulus with the sun high.
       float highSun = smoothstep( 0.1, 0.36, vSunDirection.y );
       vec3 lit = lum * mix( vec3( 1.85, 1.12, 0.72 ), vec3( 1.3, 1.28, 1.25 ), highSun );
       float thin = 1.0 - smoothstep( 0.0, 0.8, density );
       // With the sun high these are fair-weather cumulus: white, greying
       // only in their thickest cores.
       vec3 cloud = mix( shade, lit, clamp( 0.18 + 0.5 * highSun + 0.9 * towardSun + 0.55 * thin - 0.35 * highSun * smoothstep( 0.5, 1.0, density ), 0.0, 1.0 ) );
       // At night the band is a silhouette against the city glow, lit from below.
       cloud = mix( cloud, uCityGlow * cityGlow( direction ) * 0.9 + vec3( 0.005, 0.007, 0.012 ), uNight );
       texColor = mix( texColor, cloud, density * 0.94 );
     }
     if ( direction.y < 0.0 ) {
       float horizonLum = dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) );
       vec3 sea = horizonLum * uSeaTint * 3.2;
       texColor = mix( texColor * 0.9, sea, smoothstep( 0.0, 0.09, -direction.y ) );
     }
     // Never let an invalid value into the cube: prefiltering would smear one
     // NaN texel over the whole environment map, and every material lit by it
     // would go black (Apple GPUs return NaN for undefined operations).
     {
       uvec3 bits = floatBitsToUint( texColor ) & uvec3( 0x7f800000u );
       if ( any( equal( bits, uvec3( 0x7f800000u ) ) ) ) texColor = vec3( 0.0 );
       texColor = clamp( texColor, vec3( 0.0 ), vec3( 64.0 ) );
     }
     texColor *= uIntensity;
     ${anchor}`,
  );
  // Dither the final 8-bit colour by half a step, so the long, slow gradients
  // of a night sky do not break into visible bands.
  fragment = replace(
    fragment,
    '#include <colorspace_fragment>',
    `#include <colorspace_fragment>
     if ( uDither > 0.0 ) {
       vec2 dp = gl_FragCoord.xy;
       float dn = fract( 52.9829189 * fract( dot( dp, vec2( 0.06711056, 0.00583715 ) ) ) );
       gl_FragColor.rgb += ( dn - 0.5 ) * uDither;
     }`,
  );
  material.fragmentShader = fragment;
}

function createSky(showDiscs: boolean): Sky {
  const sky = new Sky();
  sky.scale.setScalar(1000);
  const uniforms = sky.material.uniforms;
  const set = (name: string, value: number): void => {
    const uniform = uniforms[name];
    if (uniform) uniform.value = value;
  };
  set('turbidity', SKY_SETTINGS.turbidity);
  set('rayleigh', SKY_SETTINGS.rayleigh);
  set('mieCoefficient', SKY_SETTINGS.mieCoefficient);
  // The lighting copy drops the bright forward-scattering halo around the sun.
  // Image-based light is never shadowed, so a glow that strong would light
  // every shadow from the sun's own direction; the directional light already
  // carries that energy, with shadows.
  set('mieDirectionalG', showDiscs ? SKY_SETTINGS.mieDirectionalG : 0.05);
  set('showSunDisc', showDiscs ? 1 : 0);
  set('cloudCoverage', SKY_SETTINGS.cloudCoverage);
  set('cloudDensity', SKY_SETTINGS.cloudDensity);
  set('cloudElevation', SKY_SETTINGS.cloudElevation);
  set('cloudScale', SKY_SETTINGS.cloudScale);
  if (!uniforms.sunPosition) throw new Error('[DryDock] Sky shader has no sunPosition uniform');
  patchSkyShader(sky.material);
  set('uShowMoon', showDiscs ? 1 : 0);
  return sky;
}

interface SkyPass {
  readonly sky: Sky;
  readonly scene: THREE.Scene;
  readonly target: THREE.WebGLCubeRenderTarget;
  readonly camera: THREE.CubeCamera;
}

function skyPass(size: number, showDiscs: boolean): SkyPass {
  const target = new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const scene = new THREE.Scene();
  const sky = createSky(showDiscs);
  scene.add(sky);
  return { sky, scene, target, camera: new THREE.CubeCamera(1, 4000, target) };
}

/** Writes the time of day into a sky material's uniforms. */
function applyDaylight(material: THREE.ShaderMaterial, state: DaylightState): void {
  const uniforms = material.uniforms;
  (uniforms.sunPosition!.value as THREE.Vector3).copy(state.sunDirection).multiplyScalar(1000);
  uniforms.uNight!.value = state.night;
  uniforms.uTwilight!.value = state.twilight;
  (uniforms.uMoonDir!.value as THREE.Vector3).copy(state.moonDirection);
  const high = THREE.MathUtils.smoothstep(state.sunElevation, 8, 26);
  uniforms.cloudCoverage!.value = cloudCoverageFor(state.sunElevation);
  uniforms.uCloudLight!.value = 1 + 0.9 * high;
}

/**
 * The visible sky, computed for every pixel of the screen.
 *
 * A cube map, however large, is a grid of texels stretched over the screen:
 * on a high-density display a 1024² face puts each texel across several
 * pixels, so clouds go soft and blocky and the dark gradients of a night sky
 * step into bands. Evaluating the atmosphere per pixel costs about a
 * millisecond on a laptop GPU and is sharp at any resolution. It is drawn
 * after everything opaque, at the far plane, so only uncovered pixels pay,
 * and it follows the sun every frame — no stepping during the day/night change.
 */
export function createSkyDome(): { mesh: THREE.Mesh; update(state: DaylightState, camera: THREE.Camera): void; dispose(): void } {
  const sky = createSky(true);
  const material = sky.material;
  material.uniforms.uDither!.value = 1 / 255;
  // At the far plane (the stock vertex shader puts it there), behind everything.
  material.depthWrite = false;
  material.depthTest = true;
  sky.frustumCulled = false;
  sky.renderOrder = 1000;
  sky.raycast = () => undefined;
  return {
    mesh: sky,
    update(state, camera) {
      applyDaylight(material, state);
      material.uniforms.uIntensity!.value = state.background;
      sky.position.copy(camera.position);
    },
    dispose() {
      sky.geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * Owns the sky's cube render targets — a small copy of the visible sky, which
 * the coast samples for its haze and skylight, and the prefiltered lighting
 * copy every material is lit by — and re-renders them for a time of day.
 * The caller owns the renderer and must call `dispose()` when it goes away.
 */
export class SkyRenderer {
  private readonly visible: SkyPass;
  private readonly lighting: SkyPass;
  private readonly pmrem: THREE.PMREMGenerator;
  private prefiltered: THREE.WebGLRenderTarget | null = null;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.visible = skyPass(256, true);
    this.lighting = skyPass(256, false);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  /** The visible sky as a cube map (for the coast's haze and skylight). */
  get cube(): THREE.CubeTexture {
    return this.visible.target.texture;
  }

  /** Prefiltered radiance for image-based lighting, without the discs (the key light supplies them). */
  get environment(): THREE.Texture | null {
    return this.prefiltered?.texture ?? null;
  }

  update(state: DaylightState): void {
    for (const pass of [this.visible, this.lighting]) applyDaylight(pass.sky.material, state);
    const previousToneMapping = this.renderer.toneMapping;
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.visible.camera.update(this.renderer, this.visible.scene);
    this.lighting.camera.update(this.renderer, this.lighting.scene);
    this.renderer.toneMapping = previousToneMapping;
    // The first call allocates the prefiltered target; later calls reuse it.
    this.prefiltered = this.pmrem.fromCubemap(this.lighting.target.texture, this.prefiltered);
    this.renderer.setRenderTarget(previousTarget);
  }

  dispose(): void {
    for (const pass of [this.visible, this.lighting]) {
      pass.sky.geometry.dispose();
      pass.sky.material.dispose();
      pass.target.dispose();
    }
    this.prefiltered?.dispose();
    this.pmrem.dispose();
  }
}
