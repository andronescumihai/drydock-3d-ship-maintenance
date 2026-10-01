'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { FailureAnalysis } from '@/lib/engine/analysis';
import type { AccessPlan } from '@/lib/engine/access';
import { getFocusTarget } from './focusRegistry';
import { bandWorldPoint } from './bands';
import { pulseIncidentMaterials } from './pbr/surfaceMaterial';
import { DynamicLine } from './dynamicLine';
import { useDisposeOnRelease } from './disposal';
import { getXRayMaterial, tickXRay } from './xray';

/**
 * Overlays that make the engine's answers visible in the ship:
 *
 *  - the failed part breathes red and throws a shock ring;
 *  - glowing arcs run from each lost component's starving supplier to it,
 *    appearing wave by wave, with dashes flowing in the direction of the loss;
 *  - the access route draws itself from the gangway to the work face, with a
 *    marker on every door, hatch, ladder and removal along the way.
 *
 * All of it is positioned from live world transforms every frame, so it stays
 * attached to the ship while the decks explode or the hull is sectioned. The
 * lines ignore depth: they are annotations, meant to be read through plating.
 *
 * Every line, geometry and material here belongs to one overlay instance and
 * is freed when that overlay goes away (`useDisposeOnRelease`, which is safe
 * under Strict Mode). Line points are rewritten in place (`DynamicLine`), never
 * reallocated per frame.
 */

/** Stagger between cascade waves, shared with the component highlight. */
export const WAVE_DELAY_MS = 320;
/** How long one cascade link takes to draw itself. */
const LINK_DRAW_MS = 260;

const noRaycast = (): void => undefined;
const box = new THREE.Box3();

function worldCentre(id: string, out: THREE.Vector3): boolean {
  const object = getFocusTarget(id);
  if (!object) return false;
  object.updateWorldMatrix(true, true);
  box.setFromObject(object);
  if (box.isEmpty()) return false;
  box.getCenter(out);
  return true;
}

/** Breathes the glow of every failed and lost part, and the x-ray outlines. */
export function IncidentPulse(): null {
  useFrame(({ clock }) => {
    pulseIncidentMaterials(clock.elapsedTime);
    tickXRay(clock.elapsedTime);
  });
  return null;
}

/**
 * Compiles the overlay shaders once, shortly after the scene appears, so the
 * first "simulate failure" does not stall while the GPU driver compiles them —
 * on some machines that took long enough to make the cascade feel late.
 */
export function OverlayWarmup(): null {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    const warm = new THREE.Scene();
    const dashed = new DynamicLine({ color: '#ff3b4d', width: 2, dashed: true, maxPoints: 2 });
    const solid = new DynamicLine({ color: '#38d6f2', width: 9, maxPoints: 2 });
    const probe = new THREE.SphereGeometry(0.1, 4, 3);
    const markerMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, toneMapped: false });
    const ringMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    warm.add(dashed.line, solid.line, new THREE.Mesh(probe, markerMaterial), new THREE.Mesh(probe, ringMaterial));
    for (const kind of ['selected', 'failed', 'lost'] as const) warm.add(new THREE.Mesh(probe, getXRayMaterial(kind)));

    let cancelled = false;
    const timer = window.setTimeout(() => {
      gl.compileAsync(warm, camera, scene)
        .catch(() => undefined)
        .finally(() => {
          if (cancelled) return;
          dashed.dispose();
          solid.dispose();
          probe.dispose();
          markerMaterial.dispose();
          ringMaterial.dispose();
        });
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [gl, camera, scene]);

  return null;
}

// ---------------------------------------------------------------------------
// Cascade links
// ---------------------------------------------------------------------------

const ARC_SEGMENTS = 18;

export function IncidentLinks({ analysis, startedAt }: { analysis: FailureAnalysis; startedAt: number }): React.ReactElement {
  const size = useThree((state) => state.size);
  const links = useMemo(
    () =>
      analysis.impact.lost
        .filter((entry) => entry.cause)
        .map((entry) => ({
          from: entry.cause?.from ?? '',
          to: entry.componentId,
          depth: entry.depth,
          line: new DynamicLine({
            color: entry.depth === 1 ? '#ff3b4d' : '#ff9a2e',
            width: entry.depth === 1 ? 2.6 : 2.1,
            dashed: true,
            maxPoints: ARC_SEGMENTS + 1,
          }),
        })),
    [analysis],
  );
  const owned = useMemo(() => links.map((link) => link.line), [links]);
  useDisposeOnRelease(owned);

  const scratch = useMemo(
    () => ({
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      c: new THREE.Vector3(),
      p: new THREE.Vector3(),
      points: new Float32Array((ARC_SEGMENTS + 1) * 3),
    }),
    [],
  );

  useFrame((_, delta) => {
    const elapsed = performance.now() - startedAt;
    for (const link of links) {
      const { a, b, c, p, points } = scratch;
      const { line } = link;
      line.setResolution(size.width, size.height);
      if (!worldCentre(link.from, a) || !worldCentre(link.to, b)) {
        line.line.visible = false;
        continue;
      }
      // The first wave draws at once; each later one follows a beat behind.
      const t = THREE.MathUtils.clamp((elapsed - (link.depth - 1) * WAVE_DELAY_MS) / LINK_DRAW_MS, 0, 1);
      line.line.visible = t > 0;
      if (t <= 0) continue;
      line.material.opacity = 0.92 * Math.min(1, t * 1.6);
      line.material.dashOffset -= Math.min(delta, 0.1) * 2.2;

      // An arc over the top, so links between neighbours do not vanish into them.
      const span = a.distanceTo(b);
      c.copy(a).add(b).multiplyScalar(0.5);
      c.y += 1.5 + Math.min(span * 0.3, 5);
      for (let i = 0; i <= ARC_SEGMENTS; i += 1) {
        const s = (i / ARC_SEGMENTS) * t;
        const u = 1 - s;
        p.set(0, 0, 0).addScaledVector(a, u * u).addScaledVector(c, 2 * u * s).addScaledVector(b, s * s);
        points[i * 3] = p.x;
        points[i * 3 + 1] = p.y;
        points[i * 3 + 2] = p.z;
      }
      line.setPoints(points, ARC_SEGMENTS + 1);
    }
  });

  return (
    <group>
      {links.map((link) => (
        <primitive key={`${link.from}-${link.to}`} object={link.line.line} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Shock ring at the failed component
// ---------------------------------------------------------------------------

export function ShockRing({ componentId }: { componentId: string }): React.ReactElement {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const geometry = useMemo(() => new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2), []);
  const materials = useMemo(
    () =>
      [0, 1, 2].map(
        () =>
          new THREE.MeshBasicMaterial({
            color: '#ff3b4d',
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
            toneMapped: false,
          }),
      ),
    [],
  );
  const owned = useMemo(() => [geometry, ...materials], [geometry, materials]);
  useDisposeOnRelease(owned);
  const centre = useMemo(() => new THREE.Vector3(), []);
  const extent = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    const object = getFocusTarget(componentId);
    if (!object) return;
    object.updateWorldMatrix(true, true);
    box.setFromObject(object);
    if (box.isEmpty()) return;
    box.getCenter(centre);
    const radius = box.getSize(extent).length() / 2;
    centre.y = box.min.y + 0.05;
    refs.current.forEach((mesh, index) => {
      if (!mesh) return;
      const phase = (clock.elapsedTime / 1.8 + index / 3) % 1;
      mesh.position.copy(centre);
      mesh.scale.setScalar(radius * (0.8 + phase * 3.2));
      (mesh.material as THREE.MeshBasicMaterial).opacity = (1 - phase) * 0.55;
    });
  });

  return (
    <group>
      {materials.map((ringMaterial, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            refs.current[index] = mesh;
          }}
          geometry={geometry}
          material={ringMaterial}
          renderOrder={19}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Access route
// ---------------------------------------------------------------------------

const KIND_COLOR: Record<string, string> = {
  entry: '#38d6f2',
  door: '#b9d4e6',
  hatch: '#ffb03a',
  ladder: '#b9d4e6',
  stair: '#b9d4e6',
  removal: '#ff8a3d',
  workface: '#ff4d5e',
};

export function AccessRoute({ plan }: { plan: AccessPlan }): React.ReactElement {
  const size = useThree((state) => state.size);
  const capacity = plan.steps.length + 2;
  const line = useMemo(
    () => new DynamicLine({ color: '#38d6f2', width: 3.4, dashed: true, dashSize: 1.4, gapSize: 0.6, maxPoints: capacity }),
    [capacity],
  );
  const glow = useMemo(() => {
    const halo = new DynamicLine({ color: '#38d6f2', width: 9, maxPoints: capacity });
    halo.line.renderOrder = 19;
    return halo;
  }, [capacity]);

  const markers = useMemo(() => plan.steps.filter((step) => step.node.kind !== 'walkway'), [plan]);
  const markerRefs = useRef<(THREE.Mesh | null)[]>([]);
  const markerGeometry = useMemo(() => new THREE.SphereGeometry(0.22, 16, 12), []);
  const markerMaterials = useMemo(
    () =>
      markers.map(
        (step) =>
          new THREE.MeshBasicMaterial({
            color: KIND_COLOR[step.node.kind] ?? '#b9d4e6',
            transparent: true,
            opacity: 0,
            depthTest: false,
            toneMapped: false,
          }),
      ),
    [markers],
  );
  const ownedLines = useMemo(() => [line, glow], [line, glow]);
  const ownedGeometry = useMemo(() => [markerGeometry], [markerGeometry]);
  useDisposeOnRelease(ownedLines);
  useDisposeOnRelease(ownedGeometry);
  useDisposeOnRelease(markerMaterials);

  const startedAt = useRef(performance.now());
  useEffect(() => {
    startedAt.current = performance.now();
  }, [plan]);

  const points = useMemo(() => plan.steps.map(() => new THREE.Vector3()), [plan]);
  const packed = useMemo(() => new Float32Array(capacity * 3), [capacity]);
  const p = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }, delta) => {
    line.setResolution(size.width, size.height);
    glow.setResolution(size.width, size.height);
    let ok = points.length > 0;
    plan.steps.forEach((step, index) => {
      const target = points[index];
      if (!target) return;
      const lifted = { ...step.node.position, y: step.node.position.y + 0.35 };
      if (!bandWorldPoint(step.node.deckId, lifted, target)) ok = false;
    });
    line.line.visible = ok;
    glow.line.visible = ok;
    if (!ok) return;

    // Draw on over 1.4 s, measured along the route.
    const t = THREE.MathUtils.clamp((performance.now() - startedAt.current) / 1400, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    let total = 0;
    for (let i = 1; i < points.length; i += 1) total += points[i - 1]!.distanceTo(points[i]!);
    let remaining = total * eased;
    let count = 0;
    const push = (v: THREE.Vector3): void => {
      packed[count * 3] = v.x;
      packed[count * 3 + 1] = v.y;
      packed[count * 3 + 2] = v.z;
      count += 1;
    };
    push(points[0]!);
    for (let i = 1; i < points.length && remaining > 0; i += 1) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const segment = a.distanceTo(b);
      const f = segment > 0 ? Math.min(1, remaining / segment) : 1;
      push(p.copy(a).lerp(b, f));
      remaining -= segment;
    }
    if (count < 2) push(points[0]!);
    line.setPoints(packed, count);
    glow.setPoints(packed, count);
    line.material.opacity = 0.95;
    glow.material.opacity = 0.16;
    line.material.dashOffset -= Math.min(delta, 0.1) * 2.6;

    // Markers pop in as the line reaches them; the work face pulses.
    let travelled = 0;
    let markerIndex = 0;
    plan.steps.forEach((step, index) => {
      if (index > 0) travelled += points[index - 1]!.distanceTo(points[index]!);
      if (step.node.kind === 'walkway') return;
      const mesh = markerRefs.current[markerIndex];
      const material = markerMaterials[markerIndex];
      markerIndex += 1;
      if (!mesh || !material) return;
      const reached = total === 0 || travelled <= total * eased + 0.01;
      mesh.position.copy(points[index]!);
      const isFace = step.node.kind === 'workface';
      const pulse = isFace ? 1 + 0.35 * Math.sin(clock.elapsedTime * 5) : 1;
      mesh.scale.setScalar((isFace ? 1.8 : 1) * pulse * (reached ? 1 : 0.001));
      material.opacity = reached ? 0.95 : 0;
    });
  });

  return (
    <group>
      <primitive object={glow.line} />
      <primitive object={line.line} />
      {markers.map((step, index) => (
        <mesh
          key={step.node.id}
          ref={(mesh) => {
            markerRefs.current[index] = mesh;
          }}
          geometry={markerGeometry}
          material={markerMaterials[index]}
          renderOrder={21}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
}
