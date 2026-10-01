'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { CAMERA } from './sceneConfig';
import { getFocusPiece, getFocusTarget } from './focusRegistry';

interface CameraRigProps {
  /** Selected component, or null for the overview. */
  readonly focusId: string | null;
  /** Selected part within it, for the second, closer framing. */
  readonly pieceId: string | null;
  /** Mean sea level in world space; the camera never goes below it. */
  readonly waterLevel: number;
}

/** How fast the approach eases in, per second. */
const EASE_SPEED = 3.2;
/** Breathing room around the framed object: 1 = sphere touches the frame edge. */
const FRAME_MARGIN = 1.55;
const FOCUS_MIN_DISTANCE = 2.5;
/** Elevation limits for a focus shot, in radians above the horizon. */
const MIN_ELEVATION = THREE.MathUtils.degToRad(7);
const MAX_ELEVATION = THREE.MathUtils.degToRad(62);
/** Keep the lens this far above the water. */
const CAMERA_CLEARANCE = 1.6;
/**
 * Horizontal run over which a sight line may cross the waterplane and still
 * land inside the hull, where the sea is cut away. Looking at machinery below
 * the waterline, the camera must be steep enough to see in over the sea.
 */
const HULL_REACH = 5.5;

const OVERVIEW_TARGET = new THREE.Vector3(...CAMERA.target);
const OVERVIEW_DISTANCE = new THREE.Vector3(...CAMERA.position).distanceTo(OVERVIEW_TARGET);

const box = new THREE.Box3();
const sphere = new THREE.Sphere();
const offset = new THREE.Vector3();
const spherical = new THREE.Spherical();
const goal = new THREE.Vector3();
const shift = new THREE.Vector3();

function measure(object: THREE.Object3D): THREE.Sphere | null {
  object.updateWorldMatrix(true, true);
  box.setFromObject(object);
  if (box.isEmpty()) return null;
  return box.getBoundingSphere(sphere);
}

function resolveTarget(focusId: string | null, pieceId: string | null): THREE.Object3D | undefined {
  if (!focusId) return undefined;
  return (pieceId ? getFocusPiece(focusId, pieceId) : undefined) ?? getFocusTarget(focusId);
}

/**
 * Orbit controls with a game-style focus pull.
 *
 * Clicking a component frames its LIVE world-space bounds (looked up in the
 * focus registry), not its data position, so it lands correctly on a deck that
 * has been lifted in the exploded view — and keeps following it while the decks
 * are still sliding.
 *
 * The approach keeps the direction you were already looking from and eases
 * only three things: where the camera looks, how far away it stands (so the
 * part fills the frame), and — only when it must — its elevation, so it is never
 * under the water or staring at the sea instead of into the hull. The moment
 * the user grabs the controls the approach stops, but the camera still rides
 * along with the part if the decks move afterwards.
 */
export function CameraRig({ focusId, pieceId, waterLevel }: CameraRigProps): React.ReactElement {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const { camera } = useThree();

  /** An eased move is in progress. */
  const approaching = useRef(false);
  const goalRadius = useRef(OVERVIEW_DISTANCE);
  const goalPolar = useRef(0);
  /** Last point followed, to carry the camera along when the part moves. */
  const followed = useRef<THREE.Vector3 | null>(null);

  // A new focus (or a return to the overview) starts a fresh approach.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    offset.copy(camera.position).sub(controls.target);
    spherical.setFromVector3(offset);

    if (!focusId) {
      followed.current = null;
      goalRadius.current = OVERVIEW_DISTANCE;
      goalPolar.current = THREE.MathUtils.clamp(spherical.phi, CAMERA.minPolarAngle, Math.PI / 2 - MIN_ELEVATION);
      controls.enablePan = true;
      controls.minDistance = CAMERA.minDistance;
      approaching.current = true;
      return;
    }

    const object = resolveTarget(focusId, pieceId);
    const bounds = object ? measure(object) : null;
    if (!bounds) return;

    controls.enablePan = false;
    controls.minDistance = FOCUS_MIN_DISTANCE;
    followed.current = null;

    // Distance at which the bounding sphere fills the frame, with margin.
    const halfFov = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2);
    const fit = (bounds.radius / Math.sin(halfFov)) * FRAME_MARGIN;
    goalRadius.current = THREE.MathUtils.clamp(fit, FOCUS_MIN_DISTANCE + 1, CAMERA.maxDistance);

    // Keep the current viewing angle; correct the elevation only if needed.
    let elevation = THREE.MathUtils.clamp(Math.PI / 2 - spherical.phi, MIN_ELEVATION, MAX_ELEVATION);
    const depthBelow = waterLevel + 0.6 - bounds.center.y;
    if (depthBelow > 0) {
      // Below the waterline: steep enough to look in over the sea.
      elevation = Math.max(elevation, Math.atan2(depthBelow, HULL_REACH));
    }
    const heightNeeded = waterLevel + CAMERA_CLEARANCE - bounds.center.y;
    if (heightNeeded > 0) {
      // And never with the lens in the water.
      elevation = Math.max(elevation, Math.asin(Math.min(1, heightNeeded / goalRadius.current)));
    }
    goalPolar.current = Math.PI / 2 - Math.min(elevation, MAX_ELEVATION + 0.25);
    approaching.current = true;
  }, [focusId, pieceId, waterLevel, camera]);

  useFrame((state, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const alpha = 1 - Math.exp(-EASE_SPEED * Math.min(delta, 0.1));
    let moved = false;

    // Where the camera should be looking right now.
    if (!focusId) {
      goal.copy(OVERVIEW_TARGET);
    } else {
      const object = resolveTarget(focusId, pieceId);
      const bounds = object ? measure(object) : null;
      if (!bounds) return;
      goal.copy(bounds.center);

      // Ride along: if the part moved (decks sliding), move the camera with it
      // so the framing holds even after the user has taken over.
      if (followed.current && !approaching.current) {
        shift.copy(goal).sub(followed.current);
        if (shift.lengthSq() > 1e-8) {
          camera.position.add(shift);
          controls.target.add(shift);
          moved = true;
        }
      }
      followed.current = (followed.current ?? new THREE.Vector3()).copy(goal);
    }

    if (approaching.current) {
      controls.target.lerp(goal, alpha);
      offset.copy(camera.position).sub(controls.target);
      spherical.setFromVector3(offset);
      spherical.radius += (goalRadius.current - spherical.radius) * alpha;
      spherical.phi += (goalPolar.current - spherical.phi) * alpha;
      spherical.makeSafe();
      camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
      moved = true;

      if (
        controls.target.distanceTo(goal) < 0.02 &&
        Math.abs(spherical.radius - goalRadius.current) < 0.03 &&
        Math.abs(spherical.phi - goalPolar.current) < 0.002
      ) {
        approaching.current = false;
      }
    }

    // Hard floor: whatever the user does, the lens stays above the sea.
    const floor = waterLevel + CAMERA_CLEARANCE;
    if (camera.position.y < floor) {
      camera.position.y = floor;
      moved = true;
    }

    if (moved) {
      controls.update();
      state.invalidate();
    }
  });

  useEffect(() => {
    camera.position.set(...CAMERA.position);
    controlsRef.current?.target.copy(OVERVIEW_TARGET);
    controlsRef.current?.update();
  }, [camera]);

  // Grabbing the controls ends any programmatic move — the user always wins.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return undefined;
    const stop = (): void => {
      approaching.current = false;
    };
    controls.addEventListener('start', stop);
    return () => controls.removeEventListener('start', stop);
  }, []);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.55}
      zoomSpeed={1.1}
      panSpeed={0.7}
      minDistance={CAMERA.minDistance}
      maxDistance={CAMERA.maxDistance}
      minPolarAngle={CAMERA.minPolarAngle}
      maxPolarAngle={CAMERA.maxPolarAngle}
    />
  );
}
