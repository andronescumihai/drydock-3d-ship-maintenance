'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { daylight } from './daylight';
import { SKY_NOISE_GLSL, SKY_SETTINGS, cloudCoverageFor } from './environment';
import { useDisposeOnRelease } from './disposal';

/**
 * The stars and the moon, drawn as themselves rather than baked into the sky
 * cube map.
 *
 * In a cube map a star is a texel: blocky, the same size whatever the screen,
 * and smeared by filtering. Here each star is a point sprite a pixel or two
 * across, with a soft core, its own colour (blue-white to orange, as stars
 * are) and a slow scintillation, placed at infinity behind everything else.
 * The moon is a camera-facing disc with maria and limb darkening, sharp at any
 * resolution; the sky cube still carries its glow.
 *
 * Both sit behind the clouds the sky actually draws: the stock cloud layer's
 * own noise (shared from environment.ts) and the low cloud band are evaluated
 * again for each star, so a star never shines through a cloud. Over Rio the
 * city's light dome washes the faint ones out, as it does for real.
 */

const STAR_COUNT = 5200;

/** Unit vectors, magnitudes and colours, from a fixed seed: the same sky every night. */
function buildStars(): THREE.BufferGeometry {
  let seed = 1234567;
  const random = (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  // A band across the sky where stars crowd together, like the Milky Way.
  const band = new THREE.Vector3(0.35, 0.55, -0.76).normalize();
  const positions: number[] = [];
  const brightness: number[] = [];
  const colours: number[] = [];
  const phases: number[] = [];
  const colour = new THREE.Color();
  const v = new THREE.Vector3();
  while (positions.length / 3 < STAR_COUNT) {
    v.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
    const length = v.length();
    if (length > 1 || length < 1e-3) continue;
    v.multiplyScalar(1 / length);
    if (v.y < 0.02) continue;
    // Keep most stars near the band, thin them elsewhere.
    const inBand = Math.exp(-Math.pow(v.dot(band) / 0.16, 2));
    if (random() > 0.35 + 0.65 * inBand) continue;
    positions.push(v.x, v.y, v.z);
    // Many faint stars, a few bright ones.
    const r = random();
    brightness.push(0.32 + 2.6 * Math.pow(r, 14) + 0.7 * Math.pow(r, 4));
    const t = random();
    if (t < 0.18) colour.setRGB(0.72, 0.82, 1.0);
    else if (t < 0.8) colour.setRGB(1.0, 0.98, 0.95);
    else if (t < 0.94) colour.setRGB(1.0, 0.88, 0.7);
    else colour.setRGB(1.0, 0.72, 0.52);
    colours.push(colour.r, colour.g, colour.b);
    phases.push(random() * Math.PI * 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aBrightness', new THREE.Float32BufferAttribute(brightness, 1));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return geometry;
}

/** Cloud cover in a direction, as the sky shader draws it (stock layer + low band). */
const CLOUD_GLSL = /* glsl */ `
uniform float uCloudCoverage;
uniform float uCloudDensity;
uniform float uCloudElevation;
uniform float uCloudScale;
uniform float uLowCloud;
${SKY_NOISE_GLSL}

float cloudCover( vec3 d ) {
  if ( d.y <= 0.0 ) return 1.0;
  float elevation = mix( 1.0, 0.1, uCloudElevation );
  vec2 cloudUV = d.xz / ( d.y * elevation ) * uCloudScale;
  float cloudNoise = clamp( fbm( cloudUV * 1000.0, 0.0 ) * 0.7 + 0.5, 0.0, 1.0 );
  float region = noise( cloudUV * 300.0 ) * 0.37 + 0.5;
  float cov = clamp( uCloudCoverage + ( region - 0.5 ) * 0.6, 0.0, 1.0 );
  float threshold = 1.0 - cov;
  float depth = max( 0.0, cloudNoise - threshold );
  float horizonFade = smoothstep( 0.0, 0.03 + 0.06 * uCloudElevation, d.y );
  float stock = ( 1.0 - exp( depth * uCloudDensity * -12.0 ) ) * horizonFade;

  vec2 cp = d.xz / ( d.y + 0.06 ) * 1.4;
  float body = fbm( cp * 1.2 + vec2( 3.1, 7.7 ), 0.0 ) * 0.5 + 0.5;
  float detail = fbm( cp * 4.3 + 11.0, 0.0 );
  float band = smoothstep( uLowCloud, uLowCloud + 0.22, body + detail * 0.1 );
  band *= smoothstep( 0.004, 0.04, d.y ) * ( 1.0 - 0.7 * smoothstep( 0.3, 0.75, d.y ) );
  return 1.0 - ( 1.0 - stock ) * ( 1.0 - band * 0.94 );
}

// The city's light dome (same shape as in the sky shader).
float cityLight( vec3 dir ) {
  float az = mod( degrees( atan( dir.z, dir.x ) ) + 363.0, 360.0 );
  float rio = smoothstep( 168.0, 188.0, az ) * ( 1.0 - smoothstep( 226.0, 246.0, az ) );
  float barra = smoothstep( 116.0, 130.0, az ) * ( 1.0 - smoothstep( 160.0, 178.0, az ) );
  float w = max( rio, barra * 0.55 );
  float el = max( dir.y, 0.0 );
  return w * ( exp( -el / 0.08 ) * 0.85 + exp( -el / 0.3 ) * 0.15 );
}
`;

const STAR_VERTEX = /* glsl */ `
attribute float aBrightness;
attribute vec3 aColor;
attribute float aPhase;
uniform float uNight;
uniform float uTime;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vAlpha;
varying float vBright;
${CLOUD_GLSL}
void main() {
  vec3 dir = normalize( position );
  // Extinction near the horizon, light pollution over the city, cloud.
  float air = smoothstep( 0.02, 0.3, dir.y );
  float washed = 1.0 - 0.92 * smoothstep( 0.0, 0.45, cityLight( dir ) );
  float clear = 1.0 - cloudCover( dir );
  // Scintillation: faster and deeper near the horizon.
  float twinkle = 1.0 + ( 0.25 + 0.35 * ( 1.0 - air ) ) * sin( uTime * ( 2.3 + aPhase ) + aPhase * 7.0 ) * sin( uTime * 1.3 + aPhase * 3.0 );
  float visible = uNight * air * washed * clear;
  vAlpha = clamp( aBrightness * visible * twinkle, 0.0, 3.0 );
  vBright = aBrightness;
  vColor = aColor;
  vec4 clip = projectionMatrix * viewMatrix * vec4( cameraPosition + dir * 1000.0, 1.0 );
  // At infinity: behind every object, in front of the sky.
  clip.z = clip.w * 0.999995;
  gl_Position = vAlpha < 0.01 ? vec4( 2.0, 2.0, 2.0, 1.0 ) : clip;
  gl_PointSize = ( 1.6 + 1.9 * smoothstep( 0.4, 2.5, aBrightness ) ) * uPixelRatio * 1.6;
}
`;

const STAR_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vBright;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r2 = dot( q, q ) * 4.0;
  // A sharp core and, for bright stars only, a faint spread.
  float core = exp( -r2 * 9.0 );
  float halo = exp( -r2 * 2.5 ) * 0.25 * smoothstep( 0.8, 2.5, vBright );
  float a = ( core + halo ) * vAlpha;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( vColor * min( a, 1.6 ), 1.0 );
}
`;

/** Angular radius of the moon's disc, radians — larger than life, as it is remembered. */
const MOON_RADIUS = 0.0125;
/** The billboard covers the disc and a narrow corona around it. */
const MOON_QUAD = 2.4;

const MOON_VERTEX = /* glsl */ `
uniform vec3 uMoonDir;
uniform float uRadius;
uniform float uNight;
varying vec2 vDisc;
varying float vClear;
${CLOUD_GLSL}
void main() {
  vec3 right = normalize( cross( uMoonDir, vec3( 0.0, 1.0, 0.0 ) ) );
  vec3 up = cross( right, uMoonDir );
  vec3 p = cameraPosition + ( uMoonDir + ( right * position.x + up * position.y ) * uRadius * ${MOON_QUAD.toFixed(1)} ) * 1000.0;
  vec4 clip = projectionMatrix * viewMatrix * vec4( p, 1.0 );
  clip.z = clip.w * 0.999995;
  gl_Position = clip;
  vDisc = position.xy * ${MOON_QUAD.toFixed(1)};
  vClear = ( 1.0 - cloudCover( uMoonDir ) * 0.85 ) * uNight * smoothstep( 0.0, 0.05, uMoonDir.y );
}
`;

const MOON_FRAGMENT = /* glsl */ `
varying vec2 vDisc;
varying float vClear;
float mhash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float mnoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mhash( i ), mhash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( mhash( i + vec2( 0.0, 1.0 ) ), mhash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
void main() {
  float r = length( vDisc );
  float edge = max( fwidth( r ), 1e-3 );
  float disc = 1.0 - smoothstep( 1.0 - edge, 1.0 + edge, r );
  // Maria: the dark basalt plains, in broad patches; small craters on top.
  vec2 p = vDisc * 1.6 + vec2( 3.7, 1.9 );
  float maria = smoothstep( 0.45, 0.75, mnoise( p ) * 0.65 + mnoise( p * 2.3 + 5.0 ) * 0.35 );
  float craters = mnoise( vDisc * 9.0 ) * 0.5 + mnoise( vDisc * 21.0 ) * 0.5;
  float albedo = mix( 0.95, 0.62, maria ) * ( 0.9 + 0.1 * craters );
  float limb = 0.78 + 0.22 * sqrt( max( 0.0, 1.0 - r * r ) );
  vec3 surface = vec3( 1.0, 0.97, 0.9 ) * albedo * limb;
  // A thin corona hugging the disc (the wide glow is in the sky map).
  float corona = ( 1.0 - disc ) * exp( -max( r - 1.0, 0.0 ) * 3.0 ) * 0.1;
  float a = ( disc + corona ) * vClear;
  if ( a < 0.003 ) discard;
  gl_FragColor = vec4( mix( vec3( 0.75, 0.82, 1.0 ) * corona, surface * disc, disc ) * vClear, 1.0 );
}
`;

export function NightSky(): React.ReactElement {
  const assets = useMemo(() => {
    const cloudUniforms = {
      uCloudCoverage: { value: SKY_SETTINGS.cloudCoverage as number },
      uCloudDensity: { value: SKY_SETTINGS.cloudDensity },
      uCloudElevation: { value: SKY_SETTINGS.cloudElevation },
      uCloudScale: { value: SKY_SETTINGS.cloudScale },
      uLowCloud: { value: SKY_SETTINGS.lowCloudThreshold },
      uNight: { value: 0 },
    };
    const stars = buildStars();
    const starMaterial = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: { ...cloudUniforms, uTime: { value: 0 }, uPixelRatio: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const starPoints = new THREE.Points(stars, starMaterial);
    starPoints.frustumCulled = false;
    starPoints.raycast = () => undefined;
    starPoints.renderOrder = -1;

    const moonGeometry = new THREE.PlaneGeometry(2, 2);
    const moonMaterial = new THREE.ShaderMaterial({
      vertexShader: MOON_VERTEX,
      fragmentShader: MOON_FRAGMENT,
      uniforms: {
        ...cloudUniforms,
        uMoonDir: { value: daylight.moonDirection.clone() },
        uRadius: { value: MOON_RADIUS },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const moon = new THREE.Mesh(moonGeometry, moonMaterial);
    moon.frustumCulled = false;
    moon.raycast = () => undefined;
    moon.renderOrder = -1;
    return { starPoints, moon, cloudUniforms, starMaterial, disposables: [stars, starMaterial, moonGeometry, moonMaterial] };
  }, []);
  useDisposeOnRelease(assets.disposables);

  useFrame(({ clock, gl }) => {
    const night = daylight.night;
    assets.cloudUniforms.uNight.value = night;
    assets.cloudUniforms.uCloudCoverage.value = cloudCoverageFor(daylight.sunElevation);
    assets.starMaterial.uniforms.uTime!.value = clock.elapsedTime;
    assets.starMaterial.uniforms.uPixelRatio!.value = gl.getPixelRatio();
    // Always drawn — by day they discard themselves — so their shaders are
    // compiled at start-up, not with a stall at nightfall.
  });

  return (
    <>
      <primitive object={assets.starPoints} />
      <primitive object={assets.moon} />
    </>
  );
}
