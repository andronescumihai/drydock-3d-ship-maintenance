'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { daylight } from './daylight';

/**
 * The sun as a camera sees it: a hot core, a wide atmospheric halo, and a
 * chain of lens ghosts that slide across the frame as you orbit.
 *
 * The sky model already contains a physically sized sun (half a degree — tiny
 * on screen). What makes a low sun read as blinding is what the lens and the
 * air do around it, so that is drawn here with additive sprites.
 *
 * The core and halo are real objects far out along the sun direction and are
 * depth-tested, so the ship eclipses them. The ghosts live in screen space and
 * fade out when the hull stands between the camera and the sun, or when the
 * sun leaves the frame.
 *
 * Built from canvas-drawn radial gradients — no image assets.
 */

const SUN_DISTANCE = 9000;
/** A box around the vessel (exploded included) used as the occluder for the ghosts. */
const VESSEL_BOUNDS = new THREE.Box3(new THREE.Vector3(-50, -2, -9), new THREE.Vector3(48, 52, 9));

interface Ghost {
  /** Position along the sun→centre line: 1 = the sun, 0 = centre, -1 = mirrored. */
  readonly t: number;
  /** Size as a fraction of the viewport height. */
  readonly size: number;
  readonly color: string;
  readonly opacity: number;
  readonly ring?: boolean;
}

const GHOSTS: readonly Ghost[] = [
  { t: 0.62, size: 0.05, color: '#ffc27a', opacity: 0.22 },
  { t: 0.34, size: 0.11, color: '#9fe0ff', opacity: 0.1, ring: true },
  { t: 0.08, size: 0.035, color: '#ffe3a8', opacity: 0.2 },
  { t: -0.24, size: 0.08, color: '#b8ffcf', opacity: 0.1 },
  { t: -0.5, size: 0.17, color: '#ffb36b', opacity: 0.08, ring: true },
  { t: -0.82, size: 0.06, color: '#c9b3ff', opacity: 0.12 },
];

function radialTexture(stops: readonly [number, string][], size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot draw the sun');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function additive(map: THREE.Texture, color: string, opacity: number, depthTest: boolean): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({
    map,
    color,
    opacity,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest,
    fog: false,
  });
}

export function SunGlare({ intensity = 1 }: { intensity?: number }): React.ReactElement {
  const camera = useThree((state) => state.camera);
  const ghostRefs = useRef<(THREE.Sprite | null)[]>([]);
  const visibility = useRef(0);

  const assets = useMemo(() => {
    const core = radialTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.18, 'rgba(255,250,235,1)'],
      [0.32, 'rgba(255,210,150,0.55)'],
      [1, 'rgba(255,160,80,0)'],
    ]);
    const halo = radialTexture([
      [0, 'rgba(255,220,170,0.9)'],
      [0.12, 'rgba(255,190,120,0.45)'],
      [0.4, 'rgba(255,150,80,0.12)'],
      [1, 'rgba(255,120,60,0)'],
    ]);
    const disc = radialTexture([
      [0, 'rgba(255,255,255,0.9)'],
      [0.7, 'rgba(255,255,255,0.55)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    const ring = radialTexture([
      [0, 'rgba(255,255,255,0)'],
      [0.72, 'rgba(255,255,255,0.05)'],
      [0.86, 'rgba(255,255,255,0.7)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    return {
      core: (() => {
        const material = additive(core, '#ffffff', 1, true);
        // The core should clip to white, not be compressed by tone mapping.
        material.toneMapped = false;
        return material;
      })(),
      halo: additive(halo, '#ffb877', 0.85, true),
      ghosts: GHOSTS.map((ghost) => additive(ghost.ring ? ring : disc, ghost.color, ghost.opacity, false)),
    };
  }, []);

  const sunPosition = useMemo(() => daylight.sunDirection.clone().multiplyScalar(SUN_DISTANCE), []);
  const haloRef = useRef<THREE.Sprite>(null);
  const coreRef = useRef<THREE.Sprite>(null);
  const projected = useMemo(() => new THREE.Vector3(), []);
  const ray = useMemo(() => new THREE.Ray(), []);
  const scratch = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const perspective = camera as THREE.PerspectiveCamera;

    // Follow the time of day: a low sun wears a wide, warm halo; a high one
    // a tighter, whiter glare. Below the horizon there is nothing to draw.
    const sun = daylight.sunDirection;
    sunPosition.copy(sun).multiplyScalar(SUN_DISTANCE);
    const up = daylight.sunVisible;
    const high = THREE.MathUtils.smoothstep(daylight.sunElevation, 5, 25);
    const halo = haloRef.current;
    const core = coreRef.current;
    if (halo && core) {
      const haloMaterial = halo.material as THREE.SpriteMaterial;
      haloMaterial.color.copy(daylight.sunColor);
      haloMaterial.opacity = 0.85 * up * (1 - 0.35 * high);
      halo.scale.setScalar(3400 * intensity * (1 - 0.45 * high));
      (core.material as THREE.SpriteMaterial).opacity = up;
      halo.visible = up > 0.005;
      core.visible = up > 0.005;
    }

    // The sun must be in front of the lens, inside the frame and not behind the ship.
    projected.copy(sunPosition).add(camera.position).project(camera);
    const inFront = projected.z < 1;
    const onScreen = inFront && Math.abs(projected.x) < 1.15 && Math.abs(projected.y) < 1.15;
    ray.set(camera.position, sun);
    const blocked = ray.intersectsBox(VESSEL_BOUNDS);
    const target = onScreen && !blocked ? up : 0;
    visibility.current += (target - visibility.current) * (1 - Math.exp(-8 * Math.min(delta, 0.1)));

    // Ghosts sit a fixed distance in front of the camera, along the line from
    // the sun through the centre of the frame.
    const depth = 10;
    const viewHeight = 2 * depth * Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2));
    GHOSTS.forEach((ghost, index) => {
      const sprite = ghostRefs.current[index];
      if (!sprite) return;
      scratch.set(projected.x * ghost.t, projected.y * ghost.t, 0.5).unproject(camera);
      scratch.sub(camera.position).normalize().multiplyScalar(depth).add(camera.position);
      sprite.position.copy(scratch);
      sprite.scale.setScalar(ghost.size * viewHeight * 2);
      const material = sprite.material as THREE.SpriteMaterial;
      material.opacity = ghost.opacity * visibility.current * intensity;
      sprite.visible = material.opacity > 0.002;
    });
  });

  return (
    <group>
      {/* Core and halo ride with the camera so they stay at "infinity". */}
      <SunAtInfinity position={sunPosition}>
        <sprite ref={haloRef} material={assets.halo} scale={[3400 * intensity, 3400 * intensity, 1]} raycast={() => null} />
        <sprite ref={coreRef} material={assets.core} scale={[420, 420, 1]} raycast={() => null} />
      </SunAtInfinity>
      {GHOSTS.map((ghost, index) => (
        <sprite
          key={`${ghost.t}`}
          ref={(sprite) => {
            ghostRefs.current[index] = sprite;
          }}
          material={assets.ghosts[index]}
          renderOrder={10}
          raycast={() => null}
        />
      ))}
    </group>
  );
}

/** Keeps its children at a fixed offset from the camera: an object at infinity. */
function SunAtInfinity({
  position,
  children,
}: {
  position: THREE.Vector3;
  children: React.ReactNode;
}): React.ReactElement {
  const ref = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);
  useFrame(() => {
    ref.current?.position.copy(camera.position).add(position);
  });
  return (
    <group ref={ref}>
      {children}
    </group>
  );
}
