'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useDisposeOnRelease } from '../disposal';
import { buildAirliner, buildHelicopter } from './craft';
import { GlowBatch, createGlowMaterial, updateGlowMaterial } from './glow';
import { daylight } from '../daylight';

/**
 * Air traffic over the bay: two jets crossing high in the sunset with vapour
 * trails, an airliner on a long descent past the Pão de Açúcar into the bay
 * (as the approach to the city's waterfront airport really runs), and a
 * sightseeing helicopter circling.
 *
 * Every aircraft flies a closed-form path — position is a pure function of
 * time — and so does every trail: a trail is simply where the engines were
 * over the last minute, drifting with the wind, so it looks the same at any
 * frame rate. Trails are camera-facing ribbons, thin and dense where they
 * form (a little behind the engines, where the exhaust has cooled enough to
 * condense) and spreading, softening and fading with age.
 *
 * Navigation lights follow real practice: red on the left wingtip, green on
 * the right, white at the tail, a red beacon and white strobes.
 */

const DEG = Math.PI / 180;
const polar = (az: number, r: number, y: number): THREE.Vector3 =>
  new THREE.Vector3(Math.cos(az * DEG) * r, y, Math.sin(az * DEG) * r);

interface Flight {
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  /** Seconds to fly the leg. */
  readonly duration: number;
  /** Seconds out of sight before the next one appears. */
  readonly pause: number;
  readonly offset: number;
  readonly trail: boolean;
  /** Eases the altitude like a glide path rather than a straight line. */
  readonly descent?: boolean;
}

const FLIGHTS: readonly Flight[] = [
  { from: polar(165, 17000, 2300), to: polar(292, 15500, 2500), duration: 120, pause: 40, offset: 30, trail: true },
  { from: polar(310, 23000, 3300), to: polar(185, 21000, 3100), duration: 150, pause: 60, offset: 110, trail: true },
  {
    from: polar(38, 12500, 1150),
    to: polar(237, 11500, 140),
    duration: 125,
    pause: 50,
    offset: 5,
    trail: false,
    descent: true,
  },
];

const TAILS = ['#1f5fa8', '#c8102e', '#12807a'];

/** Wind drifting the trails, m/s. */
const WIND = new THREE.Vector3(2.6, 0, 1.4);

/** Position and heading of a flight at time t; false while it is out of sight. */
function flightState(flight: Flight, t: number, position: THREE.Vector3, direction: THREE.Vector3): boolean {
  const cycle = flight.duration + flight.pause;
  const local = (((t + flight.offset) % cycle) + cycle) % cycle;
  if (local > flight.duration) return false;
  const u = local / flight.duration;
  position.lerpVectors(flight.from, flight.to, u);
  if (flight.descent) {
    // Level at first, then a steady glide down past the islands.
    const glide = THREE.MathUtils.smoothstep(u, 0.15, 1);
    position.y = THREE.MathUtils.lerp(flight.from.y, flight.to.y, glide);
  }
  direction.subVectors(flight.to, flight.from).setY(0).normalize();
  return true;
}

// ---------------------------------------------------------------------------
// Vapour trails (camera-facing ribbons)
// ---------------------------------------------------------------------------

const TRAIL_SECONDS = 55;
const TRAIL_STEP = 0.12;
const TRAIL_SAMPLES = Math.ceil(TRAIL_SECONDS / TRAIL_STEP);
/** Condensation starts about a fuselage length behind the engines. */
const TRAIL_GAP = 0.18;

const TRAIL_VERTEX = /* glsl */ `
attribute float aAge;
attribute float aSide;
attribute float aAlong;
varying float vAge;
varying float vSide;
varying float vAlong;
void main() {
  vAge = aAge;
  vSide = aSide;
  vAlong = aAlong;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const TRAIL_FRAGMENT = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShade;
varying float vAge;
varying float vSide;
varying float vAlong;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float across = 1.0 - vSide * vSide;
  // Young trail: a tight, bright line. Old trail: soft, lumpy, sun-warmed cloud.
  float puff = mix(1.0, 0.55 + 0.45 * noise(vec2(vAlong * 0.012, vSide * 1.7 + vAge * 3.0)), smoothstep(0.05, 0.5, vAge));
  float fadeIn = smoothstep(0.0, 0.02, vAge);
  float fadeOut = pow(clamp(1.0 - vAge, 0.0, 1.0), 1.35);
  float alpha = across * across * puff * fadeIn * fadeOut * 0.62;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(mix(uLit, uShade, smoothstep(0.2, 1.0, vAge) * 0.5), alpha);
}
`;

class TrailRibbon {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly positions = new Float32Array(TRAIL_SAMPLES * 2 * 3);
  private readonly ages = new Float32Array(TRAIL_SAMPLES * 2);
  private readonly along = new Float32Array(TRAIL_SAMPLES * 2);

  constructor(material: THREE.ShaderMaterial) {
    const sides = new Float32Array(TRAIL_SAMPLES * 2);
    const index: number[] = [];
    for (let i = 0; i < TRAIL_SAMPLES; i += 1) {
      sides[i * 2] = -1;
      sides[i * 2 + 1] = 1;
      if (i < TRAIL_SAMPLES - 1) {
        const a = i * 2;
        index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAge', new THREE.BufferAttribute(this.ages, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAlong', new THREE.BufferAttribute(this.along, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
    this.geometry.setIndex(index);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40000);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => undefined;
    this.mesh.renderOrder = 1;
  }

  /**
   * Rebuilds the ribbon from `count` centre points (packed x, y, z), each
   * with an age in 0..1, facing the camera.
   */
  update(centres: Float32Array, ages: Float32Array, count: number, camera: THREE.Vector3): void {
    const toCamera = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const side = new THREE.Vector3();
    let travelled = 0;
    for (let i = 0; i < count; i += 1) {
      const c = i * 3;
      const prev = Math.max(0, i - 1) * 3;
      const next = Math.min(count - 1, i + 1) * 3;
      tangent.set(centres[next]! - centres[prev]!, centres[next + 1]! - centres[prev + 1]!, centres[next + 2]! - centres[prev + 2]!);
      toCamera.set(camera.x - centres[c]!, camera.y - centres[c + 1]!, camera.z - centres[c + 2]!);
      side.crossVectors(tangent, toCamera);
      const len = side.length();
      if (len > 1e-6) side.multiplyScalar(1 / len);
      else side.set(0, 1, 0);
      const age = ages[i]!;
      const width = 1.6 + 70 * Math.pow(age, 0.8);
      if (i > 0) travelled += Math.hypot(centres[c]! - centres[c - 3]!, centres[c + 1]! - centres[c - 2]!, centres[c + 2]! - centres[c - 1]!);
      for (const s of [-1, 1]) {
        const o = (i * 2 + (s > 0 ? 1 : 0)) * 3;
        this.positions[o] = centres[c]! + side.x * s * width;
        this.positions[o + 1] = centres[c + 1]! + side.y * s * width;
        this.positions[o + 2] = centres[c + 2]! + side.z * s * width;
        this.ages[i * 2 + (s > 0 ? 1 : 0)] = age;
        this.along[i * 2 + (s > 0 ? 1 : 0)] = travelled;
      }
    }
    for (const name of ['position', 'aAge', 'aAlong']) {
      (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
    this.geometry.setDrawRange(0, Math.max(0, count - 1) * 6);
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

const TRAIL_LIT = new THREE.Color('#fff0e6');
const TRAIL_SHADE = new THREE.Color('#c9b6c4');
/** Vapour at night: faintly moonlit, just visible against the stars. */
const TRAIL_NIGHT = new THREE.Color('#2a3140');

const SEARCHLIGHT_ANGLE = 0.09;
/** Below the horizon, radians. */
const SEARCHLIGHT_PITCH = 0.75;
const BEAM_LENGTH = 190;

/** The beam in the air: brightest at the lamp, fading along its length and at its edge. */
const BEAM_VERTEX = /* glsl */ `
varying float vAlong;
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  // The cone was built along -Y before it was turned: uv.y runs base to apex.
  vAlong = 1.0 - uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const BEAM_FRAGMENT = /* glsl */ `
uniform float uStrength;
varying float vAlong;
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  // Thickest where the eye looks through the most of the beam.
  float through = pow(clamp(1.0 - abs(dot(normalize(vNormalV), normalize(vViewV))), 0.0, 1.0), 1.5);
  float fade = pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.6);
  float a = (1.0 - through) * fade * 0.16 * uStrength;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vec3(0.92, 0.94, 1.0), a);
}
`;

/** The searchlight's pool on the sea: soft-edged, rippling with the water. */
const POOL_VERTEX = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const POOL_FRAGMENT = /* glsl */ `
uniform float uStrength;
uniform float uTime;
varying vec2 vLocal;
void main() {
  float r2 = dot(vLocal, vLocal);
  float fall = exp(-r2 * 3.2);
  float ripple = 0.7 + 0.3 * sin(vLocal.x * 23.0 + uTime * 1.7) * sin(vLocal.y * 19.0 - uTime * 1.3);
  float a = fall * ripple * uStrength * 0.32;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vec3(0.85, 0.9, 1.0), a);
}
`;

const COLOR = {
  red: new THREE.Color('#ff2a2a'),
  green: new THREE.Color('#2aff6a'),
  white: new THREE.Color('#ffffff'),
  landing: new THREE.Color('#fff4dc'),
};

export function Aircraft({ seaLevel }: { seaLevel: number }): React.ReactElement {
  const assets = useMemo(() => {
    const planes = FLIGHTS.map((_, i) => buildAirliner(TAILS[i % TAILS.length]!));
    const heli = buildHelicopter();
    const craftMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.34,
      metalness: 0.28,
      side: THREE.DoubleSide,
    });
    const glassMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.08,
      metalness: 0.5,
      emissive: '#ffd49a',
      emissiveIntensity: 0,
    });
    const lightMaterial = createGlowMaterial();
    const trailMaterial = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERTEX,
      fragmentShader: TRAIL_FRAGMENT,
      uniforms: {
        // Vapour lit by a low sun: warm on the lit side, lilac in the shade.
        uLit: { value: TRAIL_LIT.clone() },
        uShade: { value: TRAIL_SHADE.clone() },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const planeObjects = planes.map((plane) => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(plane.geometry, craftMaterial);
      const glass = new THREE.Mesh(plane.glass, glassMaterial);
      group.add(body, glass);
      group.traverse((child) => {
        child.raycast = () => undefined;
      });
      group.visible = false;
      return group;
    });

    const heliGroup = new THREE.Group();
    const heliBody = new THREE.Mesh(heli.body, craftMaterial);
    const rotor = new THREE.Mesh(heli.rotor, craftMaterial);
    rotor.position.copy(heli.rotorHub);
    const tailRotor = new THREE.Mesh(heli.tailRotor, craftMaterial);
    tailRotor.position.copy(heli.tailHub);
    heliGroup.add(heliBody, rotor, tailRotor);

    // Night searchlight under the nose, aimed ahead and down at the water: a
    // visible beam in the air and a pool of light where it meets the sea. (Not
    // a real spotlight: on near-mirror water a point light's highlight is a
    // blinding glitter column, and every light costs every material.)
    const lampPosition = new THREE.Vector3(2.2, -1.1, 0);
    const poolMaterial = new THREE.ShaderMaterial({
      vertexShader: POOL_VERTEX,
      fragmentShader: POOL_FRAGMENT,
      uniforms: { uStrength: { value: 0 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const poolGeometry = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
    const pool = new THREE.Mesh(poolGeometry, poolMaterial);
    pool.frustumCulled = false;
    pool.renderOrder = 1;
    pool.raycast = () => undefined;
    const beamMaterial = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      uniforms: { uStrength: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const beamGeometry = new THREE.ConeGeometry(Math.tan(SEARCHLIGHT_ANGLE * 0.8) * BEAM_LENGTH, BEAM_LENGTH, 28, 1, true)
      // Apex at the lamp, opening along +X, then tilted down.
      .translate(0, -BEAM_LENGTH / 2, 0)
      .rotateZ(Math.PI / 2 - SEARCHLIGHT_PITCH);
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.position.copy(lampPosition);
    beam.renderOrder = 2;
    // Always drawn (it discards itself by day), so its shader is compiled at
    // start-up rather than with a stall on the first night.
    heliGroup.add(beam);
    heliGroup.traverse((child) => {
      child.raycast = () => undefined;
    });

    const lights = new GlowBatch(FLIGHTS.length * 9 + 8);
    const lightPoints = new THREE.Points(lights.geometry, lightMaterial);
    lightPoints.frustumCulled = false;
    lightPoints.raycast = () => undefined;
    lightPoints.renderOrder = 3;

    // One ribbon per engine of each aircraft that leaves a trail.
    const trails = FLIGHTS.map((flight, index) =>
      flight.trail ? planes[index]!.lights.engines.map((engine) => ({ engine, ribbon: new TrailRibbon(trailMaterial) })) : [],
    );

    return {
      planes,
      heli,
      planeObjects,
      heliGroup,
      lampPosition,
      pool,
      poolMaterial,
      beam,
      beamMaterial,
      glassMaterial,
      trailMaterial,
      rotor,
      tailRotor,
      lights,
      lightPoints,
      lightMaterial,
      trails,
      centres: new Float32Array(TRAIL_SAMPLES * 3),
      ages: new Float32Array(TRAIL_SAMPLES),
      disposables: [
        ...planes.flatMap((p) => [p.geometry, p.glass]),
        heli.body,
        heli.rotor,
        heli.tailRotor,
        beamGeometry,
        beamMaterial,
        poolGeometry,
        poolMaterial,
        craftMaterial,
        glassMaterial,
        lightMaterial,
        trailMaterial,
        lights,
        ...trails.flat().map((t) => t.ribbon),
      ],
    };
  }, []);
  useDisposeOnRelease(assets.disposables);

  // Development only: lets the visual checks find the aircraft.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return undefined;
    const handle = window as unknown as { __drydockAircraft?: unknown };
    handle.__drydockAircraft = { planes: assets.planeObjects, helicopter: assets.heliGroup };
    return () => {
      delete handle.__drydockAircraft;
    };
  }, [assets]);

  const scratch = useMemo(
    () => ({ p: new THREE.Vector3(), d: new THREE.Vector3(), w: new THREE.Vector3() }),
    [],
  );

  useFrame(({ clock, gl, size, camera }, delta) => {
    const t = clock.elapsedTime;
    const { p, d, w } = scratch;
    const pr = gl.getPixelRatio();
    const night = daylight.night;
    updateGlowMaterial(assets.lightMaterial, pr, size.height, night, t);
    // After dark: cabin windows glow, vapour trails are only faintly moonlit,
    // and the helicopter works its searchlight.
    assets.glassMaterial.emissiveIntensity = night * 1.6;
    const trailLight = 1 - night * 0.9;
    assets.trailMaterial.uniforms.uLit!.value.copy(TRAIL_LIT).multiplyScalar(trailLight).lerp(TRAIL_NIGHT, night);
    assets.trailMaterial.uniforms.uShade!.value.copy(TRAIL_SHADE).multiplyScalar(trailLight).lerp(TRAIL_NIGHT, night * 0.8);
    assets.poolMaterial.uniforms.uStrength!.value = night;
    assets.poolMaterial.uniforms.uTime!.value = t;
    assets.beamMaterial.uniforms.uStrength!.value = night;
    let light = 0;
    const strobe = (phase: number): number => {
      const f = (t + phase) % 1.2;
      return f < 0.05 || (f > 0.16 && f < 0.21) ? 1 : 0;
    };

    FLIGHTS.forEach((flight, index) => {
      const group = assets.planeObjects[index]!;
      const lightsOf = assets.planes[index]!.lights;
      const flying = flightState(flight, t, p, d);
      group.visible = flying;
      if (flying) {
        group.position.copy(p);
        group.rotation.set(0, Math.atan2(-d.z, d.x), flight.descent ? 0.04 : 0.02, 'YZX');
        group.updateMatrixWorld();
        const lit = (local: THREE.Vector3, color: THREE.Color, size: number, alpha: number): void => {
          w.copy(local).applyMatrix4(group.matrixWorld);
          assets.lights.set(light, w, color, size, alpha);
          light += 1;
        };
        lit(lightsOf.port, COLOR.red, 2.6, 1);
        lit(lightsOf.starboard, COLOR.green, 2.6, 1);
        lit(lightsOf.tail, COLOR.white, 2.2, 0.9);
        lit(lightsOf.beacon, COLOR.red, 3.2, 0.3 + 0.7 * Math.max(0, Math.sin(t * 6 + index)));
        lit(lightsOf.port, COLOR.white, 4.5, strobe(index * 0.37));
        lit(lightsOf.starboard, COLOR.white, 4.5, strobe(index * 0.37));
        if (flight.descent) lit(lightsOf.landing, COLOR.landing, 9, 1);
      }

      // Each engine's trail is where it was over the last minute, drifted by the wind.
      for (const { engine, ribbon } of assets.trails[index]!) {
        let count = 0;
        for (let k = 0; k < TRAIL_SAMPLES; k += 1) {
          const ago = TRAIL_GAP + k * TRAIL_STEP;
          if (!flightState(flight, t - ago, p, d)) break;
          // Engine position at that time: along track, across (starboard), up.
          const sx = -d.z;
          const sz = d.x;
          assets.centres[count * 3] = p.x + d.x * engine.x + sx * engine.z + WIND.x * ago;
          assets.centres[count * 3 + 1] = p.y + engine.y + ago * 0.35;
          assets.centres[count * 3 + 2] = p.z + d.z * engine.x + sz * engine.z + WIND.z * ago;
          assets.ages[count] = ago / (TRAIL_SECONDS + TRAIL_GAP);
          count += 1;
        }
        ribbon.update(assets.centres, assets.ages, count, camera.position);
      }
    });

    // The helicopter: a lazy circle round the anchorage, banked into the turn.
    const heli = assets.heliGroup;
    const speed = 22;
    const radius = 340;
    const angle = (t * speed) / radius;
    heli.position.set(-60 + Math.cos(angle) * radius, 130 + Math.sin(t * 0.4) * 6, Math.sin(angle) * radius);
    heli.rotation.set(0.22, Math.atan2(-Math.cos(angle), -Math.sin(angle)), -0.06, 'YXZ');
    assets.rotor.rotation.y += Math.min(delta, 0.05) * 42;
    assets.tailRotor.rotation.z += Math.min(delta, 0.05) * 90;
    heli.updateMatrixWorld();
    // Where the searchlight meets the water: an ellipse stretched along the
    // beam, as wide as the cone is at that range.
    if (night > 0.01) {
      w.copy(assets.lampPosition).applyMatrix4(heli.matrixWorld);
      d.set(Math.cos(SEARCHLIGHT_PITCH), -Math.sin(SEARCHLIGHT_PITCH), 0).transformDirection(heli.matrixWorld);
      const range = d.y < -0.05 ? (w.y - seaLevel) / -d.y : 0;
      if (range > 0) {
        const radius = range * Math.tan(SEARCHLIGHT_ANGLE);
        assets.pool.visible = true;
        assets.pool.position.set(w.x + d.x * range, seaLevel + 0.35, w.z + d.z * range);
        assets.pool.rotation.set(0, Math.atan2(-d.z, d.x), 0);
        assets.pool.scale.set(radius / Math.max(-d.y, 0.2), 1, radius);
      } else {
        assets.pool.visible = false;
      }
    }
    const heliLight = (x: number, y: number, z: number, color: THREE.Color, size: number, alpha: number): void => {
      w.set(x, y, z).applyMatrix4(heli.matrixWorld);
      assets.lights.set(light, w, color, size, alpha);
      light += 1;
    };
    heliLight(0, -0.4, -1.2, COLOR.red, 1.6, 1);
    heliLight(0, -0.4, 1.2, COLOR.green, 1.6, 1);
    heliLight(-6.9, 1.1, 0, COLOR.white, 1.4, 0.9);
    heliLight(0, 1.95, 0, COLOR.red, 2.2, 0.3 + 0.7 * Math.max(0, Math.sin(t * 7)));

    assets.lights.commit(light);
  });

  return (
    <group>
      {assets.planeObjects.map((group, index) => (
        <primitive key={index} object={group} />
      ))}
      <primitive object={assets.heliGroup} />
      <primitive object={assets.pool} />
      {assets.trails.flat().map((trail, index) => (
        <primitive key={`trail-${index}`} object={trail.ribbon.mesh} />
      ))}
      <primitive object={assets.lightPoints} />
    </group>
  );
}
