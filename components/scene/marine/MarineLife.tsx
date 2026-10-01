'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { buildDolphin, buildFish, buildGull, buildWhale } from './creatures';
import { SplashSystem } from './SplashSystem';
import { SUN_DIRECTION } from '../environment';

/**
 * Life around the vessel: a pod of dolphins porpoising past, a humpback that
 * blows, shows its flukes as it dives and now and then breaches, a bait ball of
 * small fish breaking the surface, and gulls wheeling over it.
 *
 * Everything is scripted with closed-form motion — ballistic arcs for leaps,
 * eased keyframes for the whale — evaluated from the clock every frame, so the
 * animals never drift, pile up or depend on frame rate. Water contact is
 * detected by comparing heights between frames and turned into spray.
 *
 * All of it is scenery: none of it is part of the vessel model or the engine.
 */

const G = 9.81;
const noRaycast = (): void => undefined;

/**
 * Development hook: scripted visual checks can drive the animals' clock
 * (`window.__drydockMarineClock = () => seconds`) to land on a leap or a
 * breach deterministically. Compiled out of production builds.
 */
function debugClock(): number | undefined {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return undefined;
  const hook = (window as unknown as { __drydockMarineClock?: () => number }).__drydockMarineClock;
  return typeof hook === 'function' ? hook() : undefined;
}

/** Deterministic pseudo-random in [0, 1) from an integer seed. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Orients a body modelled along +X: heading about Y, then pitch, then roll. */
function orient(object: THREE.Object3D, direction: THREE.Vector3, pitch: number, roll = 0): void {
  object.rotation.order = 'YZX';
  object.rotation.set(roll, Math.atan2(-direction.z, direction.x), pitch);
}

// ---------------------------------------------------------------------------
// Dolphins
// ---------------------------------------------------------------------------

/** The pod swims an ellipse around the ship, clear of the hull. */
const POD = { cx: 6, cz: 14, a: 96, b: 50, speed: 6.5 } as const;
const DOLPHINS = [
  { lateral: 0, behind: 0, period: 3.6, phase: 0 },
  { lateral: 2.3, behind: 2.8, period: 4.1, phase: 0.8 },
  { lateral: -2.1, behind: 1.6, period: 3.9, phase: 1.9 },
  { lateral: 0.9, behind: 5.2, period: 4.5, phase: 2.6 },
  { lateral: -1.2, behind: 7.0, period: 5.2, phase: 0.4 },
] as const;
/** Launch speed that carries the body's centre 1.8 m up. */
const LEAP_VY = Math.sqrt(2 * G * 1.8);
const LEAP_START = -0.35;
/** A 40 s cycle with a 12 s pause, so the pod is not always on show. */
const POD_CYCLE = 40;
const POD_ACTIVE = 28;

function podPoint(angle: number, target: THREE.Vector3, tangent: THREE.Vector3): void {
  target.set(POD.cx + POD.a * Math.cos(angle), 0, POD.cz + POD.b * Math.sin(angle));
  tangent.set(-POD.a * Math.sin(angle), 0, POD.b * Math.cos(angle)).normalize();
}

// ---------------------------------------------------------------------------
// Whale
// ---------------------------------------------------------------------------

/** Out towards the setting sun, so the blows and the breach are backlit. */
const WHALE_CENTRE = new THREE.Vector3(SUN_DIRECTION.x, 0, SUN_DIRECTION.z).normalize().multiplyScalar(290);
const WHALE_RADIUS = 70;
const WHALE_SPEED = 1.7;
const WHALE_LENGTH = 13;
const WHALE_CYCLE = 50;

// ---------------------------------------------------------------------------
// Bait ball and gulls
// ---------------------------------------------------------------------------

const FISH_COUNT = 28;
const BAIT_CYCLE = 14;
const BAIT_WINDOW = 7;
const FISH_AIRTIME = 0.7;
const GULLS = [
  { radius: 14, height: 16, speed: 0.42, phase: 0 },
  { radius: 19, height: 21, speed: -0.33, phase: 1.7 },
  { radius: 11, height: 13, speed: 0.51, phase: 3.1 },
  { radius: 24, height: 26, speed: 0.28, phase: 4.4 },
  { radius: 16, height: 18.5, speed: -0.46, phase: 5.6 },
] as const;

function baitCentre(cycle: number, target: THREE.Vector3): THREE.Vector3 {
  // Somewhere off the ship's starboard side, where the opening shot looks.
  const angle = -0.4 + hash(cycle * 3 + 1) * 1.9;
  const radius = 45 + hash(cycle * 3 + 2) * 45;
  return target.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
}

export function MarineLife({ waterLevel }: { waterLevel: number }): React.ReactElement {
  const size = useThree((state) => state.size);
  const dolphinRefs = useRef<(THREE.Mesh | null)[]>([]);
  const whaleRef = useRef<THREE.Mesh>(null);
  const fishRef = useRef<THREE.InstancedMesh>(null);
  const gullRefs = useRef<(THREE.Group | null)[]>([]);
  const wingRefs = useRef<(THREE.Mesh | null)[]>([]);

  const assets = useMemo(() => {
    const skin = (roughness: number): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 });
    const gull = buildGull();
    return {
      dolphin: buildDolphin(),
      whale: buildWhale(WHALE_LENGTH),
      fish: buildFish(),
      gullBody: gull.body,
      gullWing: gull.wing,
      // Wet skin: glossy enough to catch the low sun on every leap.
      dolphinSkin: skin(0.26),
      whaleSkin: skin(0.42),
      fishScales: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.35 }),
      feathers: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
    };
  }, []);

  // Lives as long as the page, like the other shared scene resources: under
  // Strict Mode an effect cleanup would dispose what the second mount reuses.
  const splashes = useMemo(() => new SplashSystem(1600, waterLevel), [waterLevel]);

  // Per-frame scratch and memory of last heights, for surface crossings.
  const state = useMemo(
    () => ({
      p: new THREE.Vector3(),
      t: new THREE.Vector3(),
      n: new THREE.Vector3(),
      q: new THREE.Vector3(),
      carry: new THREE.Vector3(),
      matrix: new THREE.Matrix4(),
      quat: new THREE.Quaternion(),
      euler: new THREE.Euler(0, 0, 0, 'YZX'),
      scale: new THREE.Vector3(),
      bait: new THREE.Vector3(),
      gullCentre: new THREE.Vector3(),
      dolphinY: DOLPHINS.map(() => -99),
      fishY: new Array<number>(FISH_COUNT).fill(-99),
      whaleEvents: new Set<string>(),
    }),
    [],
  );

  useFrame(({ clock, camera }, delta) => {
    const time = debugClock() ?? clock.elapsedTime;
    const W = waterLevel;
    const { p, t, n, q, carry } = state;

    // ---- Dolphins -------------------------------------------------------
    const podAngle = (time * POD.speed) / ((POD.a + POD.b) / 2);
    const podActive = time % POD_CYCLE < POD_ACTIVE;
    DOLPHINS.forEach((dolphin, index) => {
      const mesh = dolphinRefs.current[index];
      if (!mesh) return;
      podPoint(podAngle - dolphin.behind / ((POD.a + POD.b) / 2), p, t);
      n.set(-t.z, 0, t.x);
      p.addScaledVector(n, dolphin.lateral);

      const u = ((time + dolphin.phase) % dolphin.period) + LEAP_START;
      const y = W - 0.45 + LEAP_VY * u - 0.5 * G * u * u;
      const airborne = podActive && y > W - 1.2;
      const height = airborne ? y : W - 3;
      mesh.visible = airborne;
      mesh.position.set(p.x, height, p.z);
      orient(mesh, t, Math.atan2(LEAP_VY - G * u, POD.speed) * 0.9);

      const previous = state.dolphinY[index] ?? -99;
      if (airborne && previous > -90) {
        carry.copy(t).multiplyScalar(POD.speed * 0.35);
        if (previous < W && height >= W) {
          splashes.emit(q.set(p.x, W, p.z), {
            count: 16, radius: 0.3, up: [1.5, 3.4], out: [0.3, 1.2], size: 0.13, life: [0.5, 1], carry,
          });
        } else if (previous >= W && height < W) {
          splashes.emit(q.set(p.x, W, p.z), {
            count: 26, radius: 0.4, up: [1.8, 4.2], out: [0.5, 1.6], size: 0.15, life: [0.6, 1.2], carry,
          });
        }
      }
      state.dolphinY[index] = airborne ? height : -99;
    });

    // ---- Whale ----------------------------------------------------------
    const whale = whaleRef.current;
    if (whale) {
      const angle = (time * WHALE_SPEED) / WHALE_RADIUS;
      p.set(WHALE_CENTRE.x + Math.cos(angle) * WHALE_RADIUS, 0, WHALE_CENTRE.z + Math.sin(angle) * WHALE_RADIUS);
      t.set(-Math.sin(angle), 0, Math.cos(angle));
      const cycle = Math.floor(time / WHALE_CYCLE);
      const tau = time % WHALE_CYCLE;
      const breachCycle = cycle % 2 === 1;
      let visible = false;
      let y = W - 12;
      let pitch = 0;
      let roll = 0;
      const once = (key: string, action: () => void): void => {
        const id = `${cycle}:${key}`;
        if (!state.whaleEvents.has(id)) {
          state.whaleEvents.add(id);
          action();
        }
      };
      const head = (forward: number, up: number): THREE.Vector3 =>
        q.copy(p).addScaledVector(t, forward).setY(up);

      // Three breaths: the back rolls out, the blow goes up.
      const breaths = [0.5, 4.9, 9.3];
      breaths.forEach((start, i) => {
        const b = (tau - start) / 3.8;
        if (b < 0 || b > 1) return;
        visible = true;
        // Only the back breaks the surface: the centre stays a metre and a half down.
        y = W - 2.8 + 1.5 * Math.sin(Math.PI * b);
        pitch = 0.1 - 0.28 * b;
        if (b > 0.12) {
          once(`blow${i}`, () => {
            splashes.emit(head(WHALE_LENGTH * 0.28, W + 0.6), {
              count: 170, radius: 0.25, up: [5, 9], out: [0.15, 0.9], size: 0.38, life: [1.6, 3.2], mist: true,
            });
          });
        }
      });

      // Terminal dive: the flukes come up and slide under.
      const d = (tau - 13.6) / 6.5;
      if (d >= 0 && d <= 1) {
        visible = true;
        pitch = -1.3 * THREE.MathUtils.smoothstep(d, 0, 0.55);
        y = W - 1.3 - 8.2 * d * d;
        if (d > 0.82) {
          once('fluke', () => {
            splashes.emit(head(-WHALE_LENGTH * 0.25, W), {
              count: 40, radius: 1.2, up: [1.5, 3.5], out: [0.3, 1.2], size: 0.22, life: [0.7, 1.4],
            });
          });
        }
      }

      // Every other cycle, a breach: two-thirds out, over onto its back.
      const s = (tau - 36) * 1.0;
      if (breachCycle && s >= 0 && s <= 3.2) {
        visible = true;
        y = W - 6.5 + 9 * s - 3 * s * s;
        pitch = 1.15 - 0.95 * (s / 3.2);
        roll = 2.3 * THREE.MathUtils.smoothstep(s, 0.4, 2.6);
        if (s > 0.35) {
          once('breach-out', () => {
            splashes.emit(head(WHALE_LENGTH * 0.2, W), {
              count: 90, radius: 1.8, up: [2.5, 6.5], out: [0.6, 2.2], size: 0.3, life: [0.9, 1.8],
            });
          });
        }
        if (s > 2.35) {
          once('breach-in', () => {
            splashes.emit(head(0, W), {
              count: 320, radius: 5, up: [3, 10], out: [1, 4.5], size: 0.4, life: [1, 2.4],
            });
            splashes.emit(head(0, W + 1), {
              count: 60, radius: 4, up: [1.5, 4], out: [0.5, 2], size: 1.4, life: [2, 3.5], mist: true,
            });
          });
        }
      }

      whale.visible = visible;
      whale.position.set(p.x, y, p.z);
      orient(whale, t, pitch, roll);
      if (tau < 0.2) state.whaleEvents.clear();
    }

    // ---- Bait ball --------------------------------------------------------
    const fish = fishRef.current;
    const baitCycle = Math.floor(time / BAIT_CYCLE);
    const baitTau = time % BAIT_CYCLE;
    baitCentre(baitCycle, state.bait);
    if (fish) {
      for (let i = 0; i < FISH_COUNT; i += 1) {
        const seed = baitCycle * 101 + i * 7;
        const start = hash(seed) * (BAIT_WINDOW - FISH_AIRTIME);
        const u = baitTau - start;
        const jumping = u >= 0 && u <= FISH_AIRTIME;
        const heading = hash(seed + 1) * Math.PI * 2;
        t.set(Math.cos(heading), 0, Math.sin(heading));
        const spread = 3.5 * Math.sqrt(hash(seed + 2));
        const offsetAngle = hash(seed + 3) * Math.PI * 2;
        const vy = (G * FISH_AIRTIME) / 2;
        const y = W + vy * u - 0.5 * G * u * u;
        p.set(
          state.bait.x + Math.cos(offsetAngle) * spread + t.x * 1.6 * u,
          jumping ? y : W - 2,
          state.bait.z + Math.sin(offsetAngle) * spread + t.z * 1.6 * u,
        );
        state.euler.set(0, Math.atan2(-t.z, t.x), Math.atan2(vy - G * u, 1.6));
        state.quat.setFromEuler(state.euler);
        state.scale.setScalar(jumping ? 1 : 0.0001);
        state.matrix.compose(p, state.quat, state.scale);
        fish.setMatrixAt(i, state.matrix);

        const previous = state.fishY[i] ?? -99;
        if (jumping && previous > -90 && ((previous < W && y >= W) || (previous >= W && y < W))) {
          splashes.emit(q.set(p.x, W, p.z), { count: 4, radius: 0.05, up: [0.8, 1.8], out: [0.1, 0.4], size: 0.05, life: [0.3, 0.6] });
        }
        state.fishY[i] = jumping ? y : -99;
      }
      fish.instanceMatrix.needsUpdate = true;
    }

    // ---- Gulls ------------------------------------------------------------
    state.gullCentre.lerp(state.bait, 1 - Math.exp(-0.15 * Math.min(delta, 0.1)));
    GULLS.forEach((gull, index) => {
      const group = gullRefs.current[index];
      if (!group) return;
      const a = gull.phase + time * gull.speed;
      const dir = Math.sign(gull.speed);
      group.position.set(
        state.gullCentre.x + Math.cos(a) * gull.radius,
        W + gull.height + Math.sin(time * 0.7 + gull.phase) * 1.2,
        state.gullCentre.z + Math.sin(a) * gull.radius,
      );
      t.set(-Math.sin(a) * dir, 0, Math.cos(a) * dir);
      // Bank into the turn.
      orient(group, t, 0.05, -0.38 * dir);

      const flapping = Math.sin(time * 0.45 + gull.phase * 2) > -0.1;
      const flap = flapping ? Math.sin(time * 8.5 + gull.phase) * 0.62 : 0.08;
      const right = wingRefs.current[index * 2];
      const left = wingRefs.current[index * 2 + 1];
      if (right) right.rotation.x = -flap;
      if (left) left.rotation.x = flap;
    });

    splashes.update(delta, camera as THREE.PerspectiveCamera, size.height * (window.devicePixelRatio || 1));
  });

  return (
    <group>
      {DOLPHINS.map((_, index) => (
        <mesh
          key={`dolphin-${index}`}
          ref={(mesh) => {
            dolphinRefs.current[index] = mesh;
          }}
          geometry={assets.dolphin}
          material={assets.dolphinSkin}
          raycast={noRaycast}
          visible={false}
        />
      ))}
      <mesh ref={whaleRef} geometry={assets.whale} material={assets.whaleSkin} raycast={noRaycast} visible={false} />
      <instancedMesh
        ref={fishRef}
        args={[assets.fish, assets.fishScales, FISH_COUNT]}
        raycast={noRaycast}
        frustumCulled={false}
      />
      {GULLS.map((_, index) => (
        <group
          key={`gull-${index}`}
          ref={(group) => {
            gullRefs.current[index] = group;
          }}
        >
          <mesh geometry={assets.gullBody} material={assets.feathers} raycast={noRaycast} />
          <mesh
            ref={(mesh) => {
              wingRefs.current[index * 2] = mesh;
            }}
            geometry={assets.gullWing}
            material={assets.feathers}
            position={[0.02, 0.03, 0.05]}
            raycast={noRaycast}
          />
          <mesh
            ref={(mesh) => {
              wingRefs.current[index * 2 + 1] = mesh;
            }}
            geometry={assets.gullWing}
            material={assets.feathers}
            position={[0.02, 0.03, -0.05]}
            scale={[1, 1, -1]}
            raycast={noRaycast}
          />
        </group>
      ))}
      <primitive object={splashes.points} />
    </group>
  );
}
