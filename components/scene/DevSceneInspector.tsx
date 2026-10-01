'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { daylight, setDaylightImmediately } from './daylight';
import { useVesselStore } from '@/lib/state/useVesselStore';

/**
 * Development-only hook that exposes the live scene on `window.__drydock`.
 *
 * A 3D scene fails silently more often than it throws: a camera pointing the
 * wrong way, an empty scene graph and a black frame all look identical from the
 * outside. Having the renderer, camera and scene reachable from the console
 * turns those into questions that can be answered in one line. Compiled out of
 * production builds.
 */
export function DevSceneInspector(): null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const getR3F = useThree((state) => state.get);
  const reportFrameStats = useVesselStore((state) => state.reportFrameStats);

  const frames = useRef(0);
  const elapsed = useRef(0);
  const contextLosses = useRef(0);

  /**
   * Losses are only counted here; recovering from them is ContextGuard's job.
   */
  useEffect(() => {
    const canvas = gl.domElement;
    const count = (): void => {
      contextLosses.current += 1;
    };
    canvas.addEventListener('webglcontextlost', count);
    return () => canvas.removeEventListener('webglcontextlost', count);
  }, [gl]);

  // Sampled over half a second rather than per frame: publishing every frame
  // would make the readout itself a source of re-renders.
  useFrame((_, delta) => {
    if (process.env.NODE_ENV === 'production') return;
    frames.current += 1;
    elapsed.current += delta;
    if (elapsed.current < 0.5) return;

    reportFrameStats({
      fps: Math.round(frames.current / elapsed.current),
      ms: Number(((elapsed.current / frames.current) * 1000).toFixed(1)),
      // Draw calls are meaningless behind a post-processing chain — the counter
      // only sees the final pass. The rendered pixel count is what actually
      // predicts cost, and it is the first thing worth turning down.
      pixels: `${gl.domElement.width}×${gl.domElement.height}`,
      contextLosses: contextLosses.current,
    });
    frames.current = 0;
    elapsed.current = 0;
  });

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;

    const summary = () => {
      const bounds = new THREE.Box3();
      let meshes = 0;
      let visible = 0;
      scene.traverse((object) => {
        if (!(object as THREE.Mesh).isMesh) return;
        meshes += 1;
        if (object.visible) visible += 1;
        bounds.expandByObject(object);
      });
      const centre = bounds.isEmpty() ? null : bounds.getCenter(new THREE.Vector3());
      return {
        meshes,
        visible,
        sceneChildren: scene.children.length,
        bounds: bounds.isEmpty()
          ? null
          : { min: bounds.min.toArray(), max: bounds.max.toArray() },
        cameraPosition: camera.position.toArray(),
        distanceToCentre: centre ? camera.position.distanceTo(centre) : null,
        drawCalls: gl.info.render.calls,
        trianglesDrawn: gl.info.render.triangles,
        environment: scene.environment ? 'set' : 'none',
      };
    };

    (window as unknown as Record<string, unknown>).__drydock = {
      gl,
      scene,
      camera,
      summary,
      THREE,
      // The UI store, so scripted checks can select components like a click would.
      store: useVesselStore,
      // Orbit controls, so a scripted check can aim the camera and have it stick.
      getControls: () => getR3F().controls,
      // Freeze or resume rendering, so scripted HUD checks are not starved by a software GPU.
      setFrameloop: (mode: 'always' | 'never') => getR3F().setFrameloop(mode),
      // Time of day, readable and settable without the few seconds of transition.
      daylight,
      setDaylight: (phase: number) => {
        if (phase === 0 || phase === 1) useVesselStore.setState({ timeOfDay: phase === 1 ? 'night' : 'day' });
        setDaylightImmediately(phase);
      },
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__drydock;
    };
  }, [gl, scene, camera, getR3F]);

  return null;
}
