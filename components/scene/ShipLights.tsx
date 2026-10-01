'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useFrame, useThree } from '@react-three/fiber';
import { daylight } from './daylight';
import { bandKey } from './bands';
import { getFocusTarget } from './focusRegistry';
import { useDisposeOnRelease } from './disposal';
import { WINDOW_GLOW } from './nightWindows';
import {
  createGlowMaterial,
  glowGeometry,
  glowPoints,
  updateGlowMaterial,
  type GlowSpec,
} from './world/glow';

/**
 * The ship after dark, lit the way a cargo ship at anchor is.
 *
 * Every light comes out of a fitting you can see: floodlight heads on wall
 * brackets on the deckhouse front, on the crane houses, on a lighting pole by
 * the forward hatch and on the foremast, throwing pools of light over the
 * hatch covers and the forecastle; a floodlight on a pedestal on the monkey
 * island for the funnel's company colours; a gangway light on the deckhouse
 * side; caged bulkhead lamps over the doors; and the COLREGs anchor lights —
 * all-round white lanterns, the forward one on the foremast higher than the
 * aft one on its pole at the stern. The lamps' lenses glow, the floodlights
 * light the deck with real spotlights (casting shadows where the quality
 * profile has them). The light stays on the ship: no reflections are drawn
 * for these lamps — seen from the deck, columns of light hanging under the
 * hull read as anything but light on water.
 *
 * The lights are always in the scene and only their intensity follows the
 * time of day: adding or removing a light would make three.js recompile every
 * lit material, a visible stall at the moment of switching.
 *
 * Everything sits on the weather-deck band and follows it in the exploded view.
 * Positions are ship coordinates (+X bow, +Y up from the baseline, +Z starboard).
 */

type Mount = 'bracket' | 'pole' | 'pedestal' | 'crane';

interface Flood {
  /** Centre of the lamp's lens. */
  readonly at: readonly [number, number, number];
  readonly aim: readonly [number, number, number];
  readonly mount: Mount;
  /** For brackets: the point on the structure the arm comes out of. */
  readonly wall?: readonly [number, number, number];
  /** Candela at full night. */
  readonly intensity: number;
  /** Half-angle of the beam, radians. */
  readonly angle: number;
  /** Lights the deck with shadows (on profiles that have shadows). */
  readonly shadow: boolean;
}

/** Top of the weather deck at the side, roughly; poles stand on it. */
const DECK_Y = 6.55;

const FLOODS: readonly Flood[] = [
  // Deckhouse front, on brackets either side, over the after hatch.
  { at: [-21.7, 11.25, -4.6], wall: [-22.3, 11.25, -4.6], aim: [-3, 8.5, -1.5], mount: 'bracket', intensity: 3000, angle: 0.62, shadow: true },
  { at: [-21.7, 11.25, 4.6], wall: [-22.3, 11.25, 4.6], aim: [-3, 8.5, 1.5], mount: 'bracket', intensity: 3000, angle: 0.62, shadow: true },
  // On the roofs of the two crane houses, looking aft over each hatch.
  // (Machinery house roof at y 10.63, centred 0.6 m aft of the crane post.)
  { at: [7.1, 11.35, 4.0], aim: [-1, 8.5, -0.5], mount: 'crane', intensity: 2400, angle: 0.62, shadow: true },
  { at: [24.1, 11.35, 4.0], aim: [17, 8.5, -0.5], mount: 'crane', intensity: 2200, angle: 0.62, shadow: true },
  // A lighting pole on the port side between the hatches.
  { at: [10, 12.6, -6.3], aim: [19, 8.5, 1], mount: 'pole', intensity: 2000, angle: 0.58, shadow: true },
  // Foremast, back over the windlass and the forecastle.
  { at: [41.55, 11.6, 0], wall: [41.75, 11.6, 0], aim: [32, 7, 0], mount: 'bracket', intensity: 1300, angle: 0.75, shadow: false },
  // Aft face of the deckhouse, over the mooring deck.
  { at: [-36.75, 10.45, 0], wall: [-36.36, 10.45, 0], aim: [-43, 6.8, 0], mount: 'bracket', intensity: 1100, angle: 0.8, shadow: false },
  // Funnel floodlight on a pedestal on the monkey island.
  { at: [-23.6, 14.0, 0], aim: [-29, 17.4, 0], mount: 'pedestal', intensity: 900, angle: 0.36, shadow: false },
  // Gangway light on the starboard side of the deckhouse, down the side deck.
  { at: [-24.5, 9.3, 6.55], wall: [-24.5, 9.3, 6.0], aim: [-12, 6.6, 6.2], mount: 'bracket', intensity: 900, angle: 0.65, shadow: false },
];

/** All-round anchor lanterns: forward on the foremast top, aft on a pole at the stern. */
const ANCHOR_LIGHTS: readonly (readonly [number, number, number])[] = [
  [42, 13.75, 0],
  [-44.2, 9.1, 0],
];

/** Caged bulkhead lamps over the deckhouse doors (aft face of each tier). */
const BULKHEAD_LAMPS: readonly (readonly [number, number, number])[] = [
  [-37.08, 8.55, 1.2],
  [-36.44, 10.7, 1.2],
  [-34.2, 12.85, 1.2],
];

const FLOOD_COLOR = '#ffe9c8';
const LENS_COLOR = '#fff1dc';

// ---------------------------------------------------------------------------
// Fittings
// ---------------------------------------------------------------------------

/** A floodlight head with its lens on +Z, origin at the lens centre. */
function floodHead(): { housing: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const body = new THREE.BoxGeometry(0.52, 0.38, 0.3).translate(0, 0, -0.16);
  // Cooling fins on the back, a visor over the glass, a trunnion yoke.
  const fins = [-0.15, -0.05, 0.05, 0.15].map((x) => new THREE.BoxGeometry(0.025, 0.32, 0.08).translate(x, 0, -0.35));
  const visor = new THREE.BoxGeometry(0.56, 0.025, 0.12).translate(0, 0.2, 0.04);
  const yoke = [-0.29, 0.29].map((x) => new THREE.BoxGeometry(0.03, 0.34, 0.08).translate(x, -0.08, -0.16));
  const yokeBase = new THREE.BoxGeometry(0.62, 0.04, 0.08).translate(0, -0.26, -0.16);
  const housing = mergeGeometries([body, ...fins, visor, ...yoke, yokeBase].map((g) => g.toNonIndexed()));
  const lens = new THREE.PlaneGeometry(0.44, 0.3).translate(0, 0, 0.002);
  return { housing, lens };
}

/** An all-round lantern: base, glass, cap, origin at the centre of the glass. */
function lantern(): { housing: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const base = new THREE.CylinderGeometry(0.14, 0.16, 0.08, 12).translate(0, -0.2, 0);
  const cap = new THREE.CylinderGeometry(0.05, 0.15, 0.1, 12).translate(0, 0.21, 0);
  const posts = [0, 1, 2, 3].map((i) => {
    const a = (i / 4) * Math.PI * 2;
    return new THREE.BoxGeometry(0.02, 0.32, 0.02).translate(Math.cos(a) * 0.13, 0, Math.sin(a) * 0.13);
  });
  const housing = mergeGeometries([base, cap, ...posts].map((g) => g.toNonIndexed()));
  const lens = new THREE.CylinderGeometry(0.11, 0.11, 0.3, 14);
  return { housing, lens };
}

/** A caged bulkhead lamp, lens facing +Z (out from the wall). */
function bulkheadLamp(): { housing: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const back = new THREE.BoxGeometry(0.26, 0.18, 0.04).translate(0, 0, -0.06);
  const cage = [-0.08, 0, 0.08].map((x) => new THREE.BoxGeometry(0.012, 0.15, 0.1).translate(x, 0, 0.0));
  const housing = mergeGeometries([back, ...cage].map((g) => g.toNonIndexed()));
  const lens = new THREE.CylinderGeometry(0.06, 0.06, 0.18, 10).rotateZ(Math.PI / 2).translate(0, 0, -0.01);
  return { housing, lens };
}

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

/** Places a fitting at `at`, its +Z towards `aim`, keeping it upright. */
function orient(object: THREE.Object3D, at: readonly number[], aim: readonly number[]): void {
  object.position.set(at[0]!, at[1]!, at[2]!);
  const direction = new THREE.Vector3(aim[0]! - at[0]!, aim[1]! - at[1]!, aim[2]! - at[2]!).normalize();
  // Look along the beam with the visor on top: build a basis rather than
  // using lookAt, which works in world space.
  const right = new THREE.Vector3().crossVectors(UP, direction);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(direction, right);
  object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, direction));
}

/** Bracket arm, pole or pedestal under a lamp, in ship coordinates. */
function mountGeometry(flood: Flood): THREE.BufferGeometry | null {
  const [x, y, z] = flood.at;
  switch (flood.mount) {
    case 'bracket': {
      const wall = flood.wall ?? flood.at;
      const length = Math.hypot(x - wall[0], z - wall[2]);
      const arm = new THREE.BoxGeometry(0.06, 0.06, Math.max(length, 0.1));
      const plate = new THREE.BoxGeometry(0.22, 0.3, 0.03);
      const angle = Math.atan2(x - wall[0], z - wall[2]);
      arm.rotateY(angle).translate((x + wall[0]) / 2, y - 0.3, (z + wall[2]) / 2);
      plate.rotateY(angle).translate(wall[0], y - 0.3, wall[2]);
      const drop = new THREE.BoxGeometry(0.05, 0.3, 0.05).translate(x, y - 0.17, z);
      return mergeGeometries([arm, plate, drop].map((g) => g.toNonIndexed()));
    }
    case 'pole': {
      const height = y - 0.3 - DECK_Y;
      const pole = new THREE.CylinderGeometry(0.07, 0.1, height, 10).translate(x, DECK_Y + height / 2, z);
      const foot = new THREE.CylinderGeometry(0.2, 0.22, 0.06, 12).translate(x, DECK_Y + 0.03, z);
      const ladder = [0.3, 0.9, 1.5, 2.1, 2.7, 3.3, 3.9, 4.5].map((h) =>
        new THREE.BoxGeometry(0.22, 0.02, 0.02).translate(x, DECK_Y + h, z + 0.1),
      );
      const crosshead = new THREE.BoxGeometry(0.5, 0.06, 0.12).translate(x, y - 0.3, z);
      return mergeGeometries([pole, foot, ...ladder, crosshead].map((g) => g.toNonIndexed()));
    }
    case 'pedestal':
    case 'crane': {
      const base = flood.mount === 'crane' ? 0.45 : 0.75;
      return new THREE.CylinderGeometry(0.06, 0.09, base, 8).translate(x, y - 0.26 - base / 2, z);
    }
  }
}

export function ShipLights({ seaLevel, shadows }: { seaLevel: number; shadows: boolean }): React.ReactElement {
  const groupRef = useRef<THREE.Group>(null);
  const gl = useThree((state) => state.gl);

  const assets = useMemo(() => {
    const metal = new THREE.MeshStandardMaterial({ color: '#4b5157', roughness: 0.5, metalness: 0.6 });
    const lensMaterial = new THREE.MeshStandardMaterial({
      color: '#2a2a28',
      roughness: 0.15,
      emissive: LENS_COLOR,
      emissiveIntensity: 0,
    });
    const flood = floodHead();
    const lanternParts = lantern();
    const bulkhead = bulkheadLamp();
    const fittings = new THREE.Group();

    const floods = FLOODS.map((spec) => {
      const head = new THREE.Group();
      head.add(new THREE.Mesh(flood.housing, metal), new THREE.Mesh(flood.lens, lensMaterial));
      orient(head, spec.at, spec.aim);
      fittings.add(head);
      const mount = mountGeometry(spec);
      if (mount) fittings.add(new THREE.Mesh(mount, metal));

      // The light leaves the glass, a little in front of it, so the head's own
      // housing never shadows its beam.
      const direction = new THREE.Vector3(spec.aim[0] - spec.at[0], spec.aim[1] - spec.at[1], spec.aim[2] - spec.at[2]).normalize();
      const light = new THREE.SpotLight(FLOOD_COLOR, 0, 0, spec.angle, 0.6, 2);
      light.position.set(...spec.at).addScaledVector(direction, 0.12);
      light.target.position.set(...spec.aim);
      light.castShadow = spec.shadow && shadows;
      // Generous biases: a perspective shadow map seen at a grazing angle
      // otherwise streaks the walls it lights with acne.
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.0025;
      light.shadow.normalBias = 0.12;
      light.shadow.radius = 2;
      light.shadow.camera.near = 0.3;
      light.shadow.camera.far = 70;
      return { light, spec };
    });

    for (const at of ANCHOR_LIGHTS) {
      const unit = new THREE.Group();
      unit.add(new THREE.Mesh(lanternParts.housing, metal), new THREE.Mesh(lanternParts.lens, lensMaterial));
      unit.position.set(...at);
      fittings.add(unit);
    }
    // The aft anchor light's pole.
    const aft = ANCHOR_LIGHTS[1]!;
    fittings.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, aft[1] - 0.25 - DECK_Y - 0.3, 8).translate(aft[0], (aft[1] - 0.25 + DECK_Y + 0.3) / 2, aft[2]), metal));

    for (const at of BULKHEAD_LAMPS) {
      const unit = new THREE.Group();
      unit.add(new THREE.Mesh(bulkhead.housing, metal), new THREE.Mesh(bulkhead.lens, lensMaterial));
      unit.position.set(...at);
      // Facing aft, out of the wall.
      unit.rotation.y = -Math.PI / 2;
      fittings.add(unit);
    }

    fittings.traverse((child) => {
      child.raycast = () => undefined;
      if (child instanceof THREE.Mesh) {
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });

    // Small glows at the lenses: the lamp seen through a little sea air.
    const glows: GlowSpec[] = [
      ...FLOODS.map((spec) => {
        const d = new THREE.Vector3(spec.aim[0] - spec.at[0], spec.aim[1] - spec.at[1], spec.aim[2] - spec.at[2]).normalize();
        return { position: [spec.at[0] + d.x * 0.05, spec.at[1] + d.y * 0.05, spec.at[2] + d.z * 0.05] as const, color: '#fff3e0', size: 0.55 };
      }),
      ...ANCHOR_LIGHTS.map((at) => ({ position: at, color: '#ffffff', size: 0.6 })),
      ...BULKHEAD_LAMPS.map((at) => ({ position: [at[0] - 0.08, at[1], at[2]] as const, color: '#ffe2b4', size: 0.25 })),
    ];
    const geometry = glowGeometry(glows);
    const glowMaterial = createGlowMaterial(1.3);

    const owned: { dispose(): void }[] = [metal, lensMaterial, geometry, glowMaterial];
    for (const parts of [flood, lanternParts, bulkhead]) owned.push(parts.housing, parts.lens);
    fittings.traverse((child) => {
      if (child instanceof THREE.Mesh && ![flood, lanternParts, bulkhead].some((p) => p.housing === child.geometry || p.lens === child.geometry)) {
        owned.push(child.geometry);
      }
    });

    return {
      fittings,
      floods,
      lensMaterial,
      glowMaterial,
      glow: glowPoints(geometry, glowMaterial),
      disposables: owned,
    };
  }, [seaLevel, shadows]);
  useDisposeOnRelease(assets.disposables);

  // New shadow-casting lights need their maps drawn once.
  useEffect(() => {
    gl.shadowMap.needsUpdate = true;
  }, [gl, assets]);

  useFrame(({ size, clock }) => {
    const group = groupRef.current;
    if (!group) return;
    // Ride on the weather-deck band, wherever the exploded view has put it.
    const band = getFocusTarget(bandKey('DECK-MAIN'));
    if (band) {
      band.updateWorldMatrix(true, false);
      group.matrix.copy(band.matrixWorld);
      group.matrixWorldNeedsUpdate = true;
    }
    const night = daylight.night;
    for (const { light, spec } of assets.floods) light.intensity = spec.intensity * night;
    assets.lensMaterial.emissiveIntensity = night * 5;
    WINDOW_GLOW.value = night * 1.3;
    const pixelRatio = gl.getPixelRatio();
    updateGlowMaterial(assets.glowMaterial, pixelRatio, size.height, night, clock.elapsedTime);
  });

  return (
    <group ref={groupRef} matrixAutoUpdate={false}>
      <primitive object={assets.fittings} />
      {assets.floods.map(({ light }, index) => (
        <group key={index}>
          <primitive object={light} />
          <primitive object={light.target} />
        </group>
      ))}
      <primitive object={assets.glow} />
    </group>
  );
}
