'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useDisposeOnRelease } from '../disposal';
import { addSmallHull, seaHeightAt, smallHulls } from '../seaState';
import { daylight } from '../daylight';
import {
  createGlowMaterial,
  createReflectionMaterial,
  glowGeometry,
  glowPoints,
  reflectionColumns,
  updateGlowMaterial,
  updateReflectionMaterial,
} from './glow';
import {
  PEOPLE,
  buildFishingBoat,
  buildKayak,
  buildPerson,
  buildSailboat,
  buildSpeedboat,
  type BoatModel,
  type PersonRig,
} from './craft';

/**
 * Small craft around the vessel, with people aboard: a fishing boat with an
 * angler and a crewman who waves at the ship, a speedboat running circles
 * with a foaming wake, a yacht under sail further out and two sea kayakers.
 *
 * Each hull rides the swell that is actually drawn: the sea's wave sum
 * (seaState.ts, including the fading of short waves with distance) is sampled
 * at the centre, bow, stern and both sides. A real hull does not follow every
 * ripple, so heave, pitch and roll are eased towards those samples with the
 * boat's own inertia. Hulls are modelled with their real freeboard above the
 * design waterline, so the sea never washes over the deck. All of them keep
 * well clear of the vessel and are never pickable.
 */

const noRaycast = (): void => undefined;

interface Floating {
  readonly group: THREE.Group;
  readonly model: BoatModel;
  /** Eased motion state. */
  readonly motion: { y: number; pitch: number; roll: number; ready: boolean };
  /** Response rate, 1/s: small craft answer the water faster. */
  readonly agility: number;
}

/** Places a hull on the swell at (x, z) heading along (dx, dz). */
function ride(
  boat: Floating,
  seaLevel: number,
  x: number,
  z: number,
  dx: number,
  dz: number,
  time: number,
  delta: number,
  extraPitch = 0,
  extraRoll = 0,
): void {
  const { length, beam } = boat.model;
  const half = length * 0.4;
  const side = beam * 0.45;
  const sx = -dz;
  const sz = dx;
  const centre = seaHeightAt(x, z, time);
  const bow = seaHeightAt(x + dx * half, z + dz * half, time);
  const stern = seaHeightAt(x - dx * half, z - dz * half, time);
  const stbd = seaHeightAt(x + sx * side, z + sz * side, time);
  const port = seaHeightAt(x - sx * side, z - sz * side, time);

  // Buoyancy: mostly the average of the water under the hull, but never
  // lower than the water at its middle (a hull is lifted by a crest, it does
  // not let it in).
  const targetY = seaLevel + Math.max(centre * 0.5 + (bow + stern + stbd + port) * 0.125, centre);
  const targetPitch = Math.atan2(bow - stern, half * 2) + extraPitch;
  const targetRoll = -Math.atan2(stbd - port, side * 2) + extraRoll;
  const m = boat.motion;
  if (!m.ready) {
    m.y = targetY;
    m.pitch = targetPitch;
    m.roll = targetRoll;
    m.ready = true;
  } else {
    const k = 1 - Math.exp(-boat.agility * Math.min(delta, 0.1));
    m.y += (targetY - m.y) * k;
    m.pitch += (targetPitch - m.pitch) * k;
    m.roll += (targetRoll - m.roll) * k;
  }
  boat.group.position.set(x, m.y, z);
  // Tell the sea where this hull stands, so no water is drawn inside it.
  addSmallHull(x, z, dx, dz, length * 0.47, beam * 0.45);
  boat.group.rotation.set(m.roll, Math.atan2(-dz, dx), m.pitch, 'YZX');
}

// ---------------------------------------------------------------------------
// Wake
// ---------------------------------------------------------------------------

const WAKE_VERTEX = /* glsl */ `
attribute float aAge;
attribute float aSide;
varying float vAge;
varying float vSide;
varying vec2 vWorld;
void main() {
  vAge = aAge;
  vSide = aSide;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const WAKE_FRAGMENT = /* glsl */ `
varying float vAge;
varying float vSide;
varying vec2 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float edge = abs(vSide);
  // Bright churned water at the stern, two crisp arms, a fading lace between.
  float arms = smoothstep(0.62, 0.95, edge) * (1.0 - smoothstep(0.95, 1.0, edge));
  float churn = (1.0 - smoothstep(0.0, 0.45, edge)) * (1.0 - smoothstep(0.0, 0.35, vAge));
  float lace = noise(vWorld * 1.3) * noise(vWorld * 0.37 + 4.0);
  float foam = max(arms * (0.55 + 0.45 * lace), churn) + lace * 0.25 * (1.0 - edge);
  float alpha = foam * pow(clamp(1.0 - vAge, 0.0, 1.0), 1.4) * 0.6;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(vec3(0.9, 0.95, 0.97), alpha);
}
`;

const WAKE_SAMPLES = 72;
const WAKE_STEP = 0.09;

class Wake {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly positions = new Float32Array(WAKE_SAMPLES * 2 * 3);
  private readonly ages = new Float32Array(WAKE_SAMPLES * 2);
  private readonly pose = { x: 0, z: 0, dx: 1, dz: 0 };

  constructor() {
    const sides = new Float32Array(WAKE_SAMPLES * 2);
    for (let i = 0; i < WAKE_SAMPLES; i += 1) {
      sides[i * 2] = -1;
      sides[i * 2 + 1] = 1;
    }
    const index: number[] = [];
    for (let i = 0; i < WAKE_SAMPLES - 1; i += 1) {
      const a = i * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAge', new THREE.BufferAttribute(this.ages, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
    this.geometry.setIndex(index);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2000);
    this.material = new THREE.ShaderMaterial({
      vertexShader: WAKE_VERTEX,
      fragmentShader: WAKE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.raycast = noRaycast;
    this.mesh.renderOrder = 1;
  }

  /**
   * Rebuilds the wake from the boat's own path: sample k is where the stern
   * was k steps ago. Because the path is a function of time, this is exact at
   * any frame rate — a history of per-frame positions would turn into a few
   * long straight streaks whenever frames are slow.
   */
  update(sternAt: (time: number, out: { x: number; z: number; dx: number; dz: number }) => void, time: number, seaLevel: number): void {
    const span = WAKE_SAMPLES * WAKE_STEP;
    let count = 0;
    for (let i = 0; i < WAKE_SAMPLES; i += 1) {
      const ago = i * WAKE_STEP;
      const s = this.pose;
      sternAt(time - ago, s);
      const age = Math.min(1, ago / span);
      // The arms spread at the Kelvin angle, roughly 19.5° either side.
      const width = 0.9 + ago * 10.5 * 0.36;
      const sx = -s.dz;
      const sz = s.dx;
      for (const side of [-1, 1]) {
        const vx = s.x + sx * side * width;
        const vz = s.z + sz * side * width;
        const o = (i * 2 + (side > 0 ? 1 : 0)) * 3;
        this.positions[o] = vx;
        this.positions[o + 1] = seaLevel + seaHeightAt(vx, vz, time) + 0.1;
        this.positions[o + 2] = vz;
        this.ages[i * 2 + (side > 0 ? 1 : 0)] = age;
      }
      count = i + 1;
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aAge') as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, Math.max(0, count - 1) * 6);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/** The speedboat's circuit: a wide circle round the vessel at about 20 knots. */
const SPEEDBOAT = { centreX: 15, radius: 205, speed: 10.5 } as const;

function speedboatPose(time: number, out: { x: number; z: number; dx: number; dz: number }): void {
  const a = (time * SPEEDBOAT.speed) / SPEEDBOAT.radius;
  out.x = SPEEDBOAT.centreX + Math.cos(a) * SPEEDBOAT.radius;
  out.z = Math.sin(a) * SPEEDBOAT.radius;
  out.dx = -Math.sin(a);
  out.dz = Math.cos(a);
}

function seat(boat: Floating, rig: PersonRig, index: number, facing = 0): void {
  const spot = boat.model.seats[index];
  if (spot) rig.root.position.copy(spot);
  rig.root.rotation.y = facing;
  boat.group.add(rig.root);
}

export function Boats({ seaLevel }: { seaLevel: number }): React.ReactElement {
  const scene = useMemo(() => {
    // Gelcoat: glossy enough to pick up the low sun along the topsides.
    const hullMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.32,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const glassMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.06,
      metalness: 0.4,
      side: THREE.DoubleSide,
      // Cabin lights behind the glass after dark.
      emissive: '#ffcf8f',
      emissiveIntensity: 0,
    });
    const glowMaterial = createGlowMaterial(1.4);
    const reflectionMaterial = createReflectionMaterial(seaLevel, 1.0);
    const lightGeometries: THREE.BufferGeometry[] = [];
    const sailMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const rodMaterial = new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.5 });
    const paddleMaterial = new THREE.MeshStandardMaterial({ color: '#e8e2d2', roughness: 0.6 });
    const wireMaterial = new THREE.LineBasicMaterial({ color: '#6b7075', transparent: true, opacity: 0.8 });

    const make = (model: BoatModel, agility: number): Floating => {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(model.geometry, hullMaterial);
      mesh.raycast = noRaycast;
      group.add(mesh);
      if (model.glass) {
        const glass = new THREE.Mesh(model.glass, glassMaterial);
        glass.raycast = noRaycast;
        group.add(glass);
      }
      if (model.lights.length > 0) {
        const lights = glowGeometry(model.lights);
        lightGeometries.push(lights);
        const reflection = reflectionColumns(model.lights, reflectionMaterial);
        lightGeometries.push(reflection.geometry);
        group.add(glowPoints(lights, glowMaterial), reflection);
      }
      return { group, model, agility, motion: { y: 0, pitch: 0, roll: 0, ready: false } };
    };

    // Fishing boat, lying to the swell: an angler aft, a crewman who waves.
    const fishing = make(buildFishingBoat(), 1.6);
    const angler = buildPerson(PEOPLE[0]!);
    seat(fishing, angler, 0, Math.PI * 0.55);
    const rodGeometry = new THREE.CylinderGeometry(0.01, 0.022, 2.8, 5).translate(0, 1.4, 0);
    const rod = new THREE.Mesh(rodGeometry, rodMaterial);
    rod.position.y = -0.3;
    rod.rotation.z = -1.1;
    rod.raycast = noRaycast;
    angler.rightForearm.add(rod);
    const waver = buildPerson(PEOPLE[1]!);
    seat(fishing, waver, 1, -Math.PI * 0.4);

    // Speedboat: helmsman and two passengers.
    const speed = make(buildSpeedboat(), 3.5);
    const helm = buildPerson(PEOPLE[2]!, true);
    seat(speed, helm, 0, 0);
    const passengerA = buildPerson(PEOPLE[3]!, true);
    seat(speed, passengerA, 1, 0);
    const passengerB = buildPerson(PEOPLE[4]!, true);
    seat(speed, passengerB, 2, 0);
    const wake = new Wake();

    // A yacht on a reach, heeled a little.
    const sailboatModel = buildSailboat();
    const sail = make(sailboatModel, 0.9);
    const sails = new THREE.Mesh(sailboatModel.sails, sailMaterial);
    sails.raycast = noRaycast;
    const rigging = new THREE.LineSegments(sailboatModel.rigging, wireMaterial);
    rigging.raycast = noRaycast;
    sail.group.add(sails, rigging);
    const skipper = buildPerson(PEOPLE[5]!, true);
    seat(sail, skipper, 0, Math.PI / 2);
    const crew = buildPerson(PEOPLE[6]!, true);
    seat(sail, crew, 1, -Math.PI / 2);

    // Two sea kayakers, paddling in company.
    const paddleGeometry = new THREE.CylinderGeometry(0.018, 0.018, 2.2, 6).rotateX(Math.PI / 2);
    const bladeGeometry = new THREE.BoxGeometry(0.015, 0.16, 0.46);
    const kayakModels = [buildKayak('#f2b33d'), buildKayak('#d8432f')];
    const kayaks = kayakModels.map((model, i) => {
      const boat = make(model, 4);
      const paddler = buildPerson(PEOPLE[(i + 2) % PEOPLE.length]!, true, 'forward');
      seat(boat, paddler, 0, 0);
      const paddle = new THREE.Group();
      const shaft = new THREE.Mesh(paddleGeometry, paddleMaterial);
      const bladeA = new THREE.Mesh(bladeGeometry, paddleMaterial);
      bladeA.position.z = 1.1;
      const bladeB = new THREE.Mesh(bladeGeometry, paddleMaterial);
      bladeB.position.z = -1.1;
      paddle.add(shaft, bladeA, bladeB);
      paddle.position.set(0.45, 0.62, 0);
      paddle.traverse((child) => {
        child.raycast = noRaycast;
      });
      boat.group.add(paddle);
      return { boat, paddler, paddle, phase: i * 1.3 };
    });

    const root = new THREE.Group();
    root.add(fishing.group, speed.group, sail.group, wake.mesh, ...kayaks.map((k) => k.boat.group));

    const models = [fishing.model, speed.model, sailboatModel, ...kayakModels];
    return {
      root,
      pose: { x: 0, z: 0, dx: 1, dz: 0 },
      fishing,
      angler,
      waver,
      speed,
      helm,
      passengerA,
      passengerB,
      wake,
      sail,
      kayaks,
      glassMaterial,
      glowMaterial,
      reflectionMaterial,
      disposables: [
        hullMaterial,
        glassMaterial,
        glowMaterial,
        reflectionMaterial,
        ...lightGeometries,
        sailMaterial,
        rodMaterial,
        paddleMaterial,
        wireMaterial,
        rodGeometry,
        paddleGeometry,
        bladeGeometry,
        wake,
        sailboatModel.sails,
        sailboatModel.rigging,
        ...models.map((m) => m.geometry),
        ...models.flatMap((m) => (m.glass ? [m.glass] : [])),
      ],
    };
  }, [seaLevel]);
  useDisposeOnRelease(scene.disposables);

  useFrame(({ clock, gl, size, camera }, delta) => {
    const t = clock.elapsedTime;
    smallHulls.count = 0;
    const night = daylight.night;
    const pixelRatio = gl.getPixelRatio();
    updateGlowMaterial(scene.glowMaterial, pixelRatio, size.height, night, t);
    updateReflectionMaterial(scene.reflectionMaterial, camera, pixelRatio, size, night, t);
    scene.glassMaterial.emissiveIntensity = night * 0.9;

    // Fishing boat: drifting slowly on a short circle, head to the swell.
    {
      const a = t * 0.012;
      const x = 30 + Math.cos(a) * 8;
      const z = -140 + Math.sin(a) * 8;
      const heading = 2.3 + Math.sin(t * 0.05) * 0.25;
      ride(scene.fishing, seaLevel, x, z, Math.cos(heading), Math.sin(heading), t, delta);
      // The angler holds the rod out over the side; its tip twitches.
      scene.angler.rightArm.rotation.z = 0.9;
      scene.angler.rightForearm.rotation.z = 0.6 + Math.sin(t * 1.7) * 0.05;
      scene.angler.leftArm.rotation.z = 0.7;
      scene.angler.leftForearm.rotation.z = 0.9;
      // The crewman waves at the ship now and then.
      const waving = Math.sin(t * 0.21) > 0.35;
      scene.waver.rightArm.rotation.x = waving ? -2.6 : -0.08;
      scene.waver.rightForearm.rotation.x = waving ? Math.sin(t * 7) * 0.5 : 0;
      scene.waver.rightForearm.rotation.z = waving ? 0.3 : 0.15;
    }

    // Speedboat: planing (bow up) and banked into its turn.
    {
      const pose = scene.pose;
      speedboatPose(t, pose);
      ride(scene.speed, seaLevel, pose.x, pose.z, pose.dx, pose.dz, t, delta, 0.08, -0.07);
      const sternOffset = scene.speed.model.stern.x;
      scene.wake.update(
        (time, out) => {
          speedboatPose(time, out);
          out.x += out.dx * sternOffset;
          out.z += out.dz * sternOffset;
        },
        t,
        seaLevel,
      );
      const waving = Math.sin(t * 0.3 + 1) > 0.5;
      scene.passengerA.rightArm.rotation.x = waving ? -2.7 : -0.1;
      scene.passengerA.rightForearm.rotation.x = waving ? Math.sin(t * 6) * 0.45 : 0;
      for (const arm of [scene.helm.rightArm, scene.helm.leftArm]) arm.rotation.z = 0.95;
      for (const arm of [scene.helm.rightForearm, scene.helm.leftForearm]) arm.rotation.z = 0.5;
    }

    // Yacht: a long, slow ellipse offshore, heeled to the breeze.
    {
      const a = t * 0.009 + 2;
      const x = -260 + Math.cos(a) * 120;
      const z = -470 + Math.sin(a) * 50;
      const dx = -Math.sin(a) * 120;
      const dz = Math.cos(a) * 50;
      const n = Math.hypot(dx, dz);
      ride(scene.sail, seaLevel, x, z, dx / n, dz / n, t, delta, 0, 0.14);
    }

    // Kayaks: paddling in company, blades alternating.
    scene.kayaks.forEach((kayak, i) => {
      // In company but not in line: the second paddler a length or two
      // behind and a little outside the first.
      const a = t * 0.07 - i * 0.55;
      const rx = 15 + i * 2.5;
      const rz = 12 + i * 2;
      const x = 62 + Math.cos(a) * rx;
      const z = 55 + Math.sin(a) * rz;
      const dx = -Math.sin(a) * rx;
      const dz = Math.cos(a) * rz;
      const n = Math.hypot(dx, dz);
      ride(kayak.boat, seaLevel, x, z, dx / n, dz / n, t, delta);
      const stroke = Math.sin(t * 2.4 + kayak.phase);
      kayak.paddle.rotation.x = stroke * 0.5;
      kayak.paddle.rotation.y = stroke * 0.25;
      for (const arm of [kayak.paddler.leftArm, kayak.paddler.rightArm]) arm.rotation.z = 1.05;
      kayak.paddler.leftArm.rotation.x = stroke * 0.3;
      kayak.paddler.rightArm.rotation.x = stroke * 0.3;
      kayak.paddler.leftForearm.rotation.z = 0.5 - stroke * 0.25;
      kayak.paddler.rightForearm.rotation.z = 0.5 + stroke * 0.25;
    });
  });

  return <primitive object={scene.root} />;
}
