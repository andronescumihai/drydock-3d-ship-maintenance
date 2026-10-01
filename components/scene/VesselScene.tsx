'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { vesselModel } from '@/lib/data/loader';
import { QUALITY_PROFILES, useVesselStore } from '@/lib/state/useVesselStore';
import type { Compartment, VesselComponent } from '@/lib/engine/types';
import { CAMERA, SCENE_COLORS } from './sceneConfig';
import { REFERENCE_COLORS } from './materials';
import { SkyRenderer, createSkyDome } from './environment';
import { useDisposeOnRelease } from './disposal';
import { daylight, setDaylightImmediately, stepDaylight } from './daylight';
import { ShipLights } from './ShipLights';
import { Sea } from './Sea';
import { BANDS, DECK_TO_BAND } from './bands';
import { SunGlare } from './SunGlare';
import { NightSky } from './NightSky';
import { MarineLife } from './marine/MarineLife';
import { Coast } from './world/Coast';
import { Aircraft } from './world/Aircraft';
import { Boats } from './world/Boats';
import { AccessRoute, IncidentLinks, IncidentPulse, OverlayWarmup, ShockRing, WAVE_DELAY_MS } from './IncidentOverlays';
import { useSelectedAnalysis, useSimulation } from '@/components/hud/analysis/useAnalysis';
import { configureTextures } from './pbr/textureSets';
import { CameraRig } from './CameraRig';
import { ContextGuard } from './ContextGuard';
import { AdaptiveResolution, DepthRange, SanitizePass } from './RenderGuards';
import { DevSceneInspector } from './DevSceneInspector';
import { ComponentAssembly } from './ComponentAssembly';
import { ComponentMarker } from './ComponentMarker';
import { VesselStructure } from './VesselStructure';
import { buildWaterlineGeometry } from './hullGeometry';
import { isInsideHull } from '@/lib/geometry/interior';

const { vessel, components, componentById, compartmentById } = vesselModel;


/** Groups components by the band that carries them, so they travel with their deck. */
const COMPONENTS_BY_BAND: ReadonlyMap<string, readonly VesselComponent[]> = (() => {
  const map = new Map<string, VesselComponent[]>();
  for (const component of components) {
    const compartment = compartmentById.get(component.compartmentId);
    const band = compartment ? DECK_TO_BAND.get(compartment.deckId) : undefined;
    const key = band?.deckId ?? BANDS[0]?.deckId ?? 'unassigned';
    const bucket = map.get(key);
    if (bucket) bucket.push(component);
    else map.set(key, [component]);
  }
  return map;
})();

const COMPARTMENTS_BY_BAND: ReadonlyMap<string, readonly Compartment[]> = new Map(
  BANDS.map((band) => [
    band.deckId,
    vessel.compartments.filter((compartment) => band.containedDeckIds.includes(compartment.deckId)),
  ]),
);

const noRaycast = (): null => null;

/**
 * Installs the sky. The visible sky is a dome evaluated per pixel every frame
 * (sharp on any display, see createSkyDome); the image-based lighting and the
 * small cube the coast samples for its haze are rendered into targets made
 * once (and again if the renderer or the WebGL context changes, so Strict
 * Mode's mount/cleanup/mount cycle is harmless) and refreshed a dozen times a
 * second while the sun is moving.
 */
function SkyEnvironment({ epoch, interval }: { epoch: number; interval: number }): React.ReactElement {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const skyRef = useRef<SkyRenderer | null>(null);
  const rendered = useRef({ revision: -1, at: 0 });
  const dome = useMemo(() => createSkyDome(), []);
  const ownedDome = useMemo(() => [dome], [dome]);
  useDisposeOnRelease(ownedDome);

  useEffect(() => {
    const sky = new SkyRenderer(gl);
    sky.update(daylight);
    rendered.current = { revision: daylight.revision, at: performance.now() };
    scene.environment = sky.environment;
    scene.environmentIntensity = daylight.environment;
    scene.background = null;
    scene.userData.skyCube = sky.cube;
    skyRef.current = sky;

    return () => {
      skyRef.current = null;
      scene.environment = null;
      delete scene.userData.skyCube;
      sky.dispose();
    };
    // `epoch` re-renders the sky after the WebGL context has been restored.
  }, [gl, scene, epoch]);

  useFrame(({ camera }) => {
    dome.update(daylight, camera);
    const sky = skyRef.current;
    if (!sky) return;
    scene.environmentIntensity = daylight.environment;
    const done = rendered.current;
    if (done.revision === daylight.revision) return;
    const now = performance.now();
    if (daylight.moving && now - done.at < interval) return;
    sky.update(daylight);
    scene.environment = sky.environment;
    rendered.current = { revision: daylight.revision, at: now };
  }, -1);

  return <primitive object={dome.mesh} />;
}

/**
 * Carries the time of day towards the store's choice, one small step per
 * frame, and applies the exposure. Runs before everything that reads it.
 */
function DaylightDriver(): null {
  const timeOfDay = useVesselStore((state) => state.timeOfDay);
  const gl = useThree((state) => state.gl);
  const first = useRef(true);

  useEffect(() => {
    const target = timeOfDay === 'night' ? 1 : 0;
    if (first.current) {
      // Whatever the scene opens on, it opens there: no sunset on page load.
      first.current = false;
      setDaylightImmediately(target);
    } else {
      daylight.target = target;
    }
  }, [timeOfDay]);

  useFrame((_, delta) => {
    stepDaylight(delta);
    gl.toneMappingExposure = daylight.exposure;
  }, -2);

  return null;
}

/** Tells the texture system the renderer's limits and the profile's budget. */
function TextureBudget({ resolution }: { resolution: 'full' | 'reduced' }): null {
  const gl = useThree((state) => state.gl);
  useEffect(() => configureTextures(gl, resolution), [gl, resolution]);
  return null;
}

/**
 * Orthographic shadow frustum fitted to the vessel as seen from the key light.
 *
 * Only casters need to be inside it: a shadow lands exactly behind its caster
 * along the light direction, so it projects to the same point in light space.
 * The box allows for the fully exploded, lifted model.
 */
const SHADOW_DISTANCE = 260;
const SHADOW_CORNERS = (() => {
  const corners: THREE.Vector3[] = [];
  for (const x of [-49, 47]) for (const y of [-1, 52]) for (const z of [-8, 8]) corners.push(new THREE.Vector3(x, y, z));
  return corners;
})();
const shadowView = new THREE.Matrix4();
const shadowRight = new THREE.Vector3();
const shadowUp = new THREE.Vector3();
const ORIGIN = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function fitShadow(light: THREE.DirectionalLight, direction: THREE.Vector3): void {
  light.position.copy(direction).multiplyScalar(SHADOW_DISTANCE);
  shadowView.lookAt(light.position, ORIGIN, WORLD_UP);
  shadowRight.setFromMatrixColumn(shadowView, 0);
  shadowUp.setFromMatrixColumn(shadowView, 1);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of SHADOW_CORNERS) {
    minX = Math.min(minX, p.dot(shadowRight));
    maxX = Math.max(maxX, p.dot(shadowRight));
    minY = Math.min(minY, p.dot(shadowUp));
    maxY = Math.max(maxY, p.dot(shadowUp));
  }
  const camera = light.shadow.camera;
  camera.left = minX - 2;
  camera.right = maxX + 2;
  camera.bottom = minY - 2;
  camera.top = maxY + 2;
  camera.near = SHADOW_DISTANCE - 140;
  camera.far = SHADOW_DISTANCE + 220;
  camera.updateProjectionMatrix();
}

/**
 * The one shadow-casting light: the sun by day, the moon by night (see
 * daylight.ts). The environment map carries the sky's own light, so no
 * ambient or rim lights are faked on top of it.
 */
function KeyLight({ shadows, mapSize }: { shadows: boolean; mapSize: number }): React.ReactElement {
  const ref = useRef<THREE.DirectionalLight>(null);
  const gl = useThree((state) => state.gl);
  const aimed = useRef(new THREE.Vector3());
  const lastAimedAt = useRef(0);

  useFrame(() => {
    const light = ref.current;
    if (!light) return;
    light.color.copy(daylight.keyColor);
    light.intensity = daylight.keyIntensity;
    // The light and its shadow map move together, a dozen times a second at
    // most while the sun is moving: the map is the most expensive pass to redo.
    const now = performance.now();
    const due = !daylight.moving || now - lastAimedAt.current > 80;
    if (due && aimed.current.distanceToSquared(daylight.keyDirection) > 1e-9) {
      lastAimedAt.current = now;
      aimed.current.copy(daylight.keyDirection);
      fitShadow(light, daylight.keyDirection);
      gl.shadowMap.needsUpdate = true;
    }
  }, -1);

  return (
    <directionalLight
      ref={ref}
      castShadow={shadows}
      shadow-mapSize={[mapSize, mapSize]}
      shadow-bias={-0.0003}
      shadow-normalBias={0.05}
    />
  );
}

/**
 * Keeps the shadow map out of the per-frame budget.
 *
 * Nothing in this scene casts a moving shadow: the vessel is static and only
 * the decks slide apart. Re-rendering a full depth pass over 350 casters sixty
 * times a second buys nothing and is felt as stutter while orbiting, so the map
 * is rendered once and refreshed only while the model is actually changing.
 */
function StaticShadows({ signature }: { signature: string }): null {
  const gl = useThree((state) => state.gl);
  const refreshUntil = useRef(0);
  const refreshFrames = useRef(0);

  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
  }, [gl]);

  useEffect(() => {
    // Keep refreshing until the explode animation has settled — measured both
    // in time and in frames, so a slow first frame (shader compilation) cannot
    // freeze a shadow map rendered before the vessel was on screen.
    refreshUntil.current = performance.now() + 1400;
    refreshFrames.current = 45;
    gl.shadowMap.needsUpdate = true;
  }, [gl, signature]);

  useFrame(() => {
    if (refreshFrames.current > 0 || performance.now() < refreshUntil.current) {
      refreshFrames.current -= 1;
      gl.shadowMap.needsUpdate = true;
    }
  });

  return null;
}

/** Beyond this distance from the orbit target, ambient occlusion is switched off. */
const AO_FAR = 170;
const AO_NEAR = 150;

/**
 * The post-processing chain (HIGH quality): ambient occlusion, a sanitising
 * pass, bloom, tone mapping and vignette.
 *
 * Ambient occlusion is what seats machinery in its surroundings, which is
 * only visible from close up. Zoomed out, the effect has nothing to add and
 * its screen-space normal reconstruction becomes numerically fragile on the
 * far sea — so it switches itself off past a distance (with some hysteresis),
 * without rebuilding the chain.
 */
function PostEffects({
  ambientOcclusion,
  bloom,
  multisampling,
}: {
  ambientOcclusion: boolean;
  bloom: boolean;
  multisampling: number;
}): React.ReactElement {
  const aoRef = useRef<{ enabled: boolean } | null>(null);
  // The last pass writes 8-bit colour: dither it, or the long gradients of the
  // night sky and the sea show as bands.
  const composerRef = useRef<{ passes: { dithering?: boolean }[] } | null>(null);
  useEffect(() => {
    const id = window.setTimeout(() => {
      for (const pass of composerRef.current?.passes ?? []) {
        if ('dithering' in pass) pass.dithering = true;
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [ambientOcclusion, bloom, multisampling]);
  const controls = useThree((state) => state.controls) as unknown as { target?: THREE.Vector3 } | null;
  useFrame(({ camera }) => {
    const ao = aoRef.current;
    if (!ao) return;
    const distance = controls?.target ? camera.position.distanceTo(controls.target) : camera.position.length();
    const wanted = ambientOcclusion && (ao.enabled ? distance < AO_FAR : distance < AO_NEAR);
    if (ao.enabled !== wanted) ao.enabled = wanted;
  });

  return (
    <EffectComposer ref={composerRef as never} multisampling={multisampling}>
      <N8AO
        ref={aoRef as never}
        aoRadius={2.6}
        intensity={ambientOcclusion ? 2.3 : 0}
        distanceFalloff={1.2}
        quality="performance"
        halfRes
        color="#070d14"
      />
      {/* Nothing invalid may reach the bloom's mip chain (see RenderGuards). */}
      <SanitizePass />
      <Bloom intensity={bloom ? 0.22 : 0} luminanceThreshold={0.85} luminanceSmoothing={0.3} mipmapBlur />
      {/* The composer owns tone mapping while it exists; the renderer's own
          AgX takes over when the chain is switched off. */}
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Vignette offset={0.32} darkness={0.42} />
    </EffectComposer>
  );
}

function SceneContents(): React.ReactElement {
  const selectedId = useVesselStore((state) => state.selectedId);
  const selectedPieceId = useVesselStore((state) => state.selectedPieceId);
  const selectPiece = useVesselStore((state) => state.selectPiece);
  const hoveredId = useVesselStore((state) => state.hoveredId);
  const visibleSystemIds = useVesselStore((state) => state.visibleSystemIds);
  const showCompartments = useVesselStore((state) => state.showCompartments);
  const showStructure = useVesselStore((state) => state.showStructure);
  const explodeAmount = useVesselStore((state) => state.explodeAmount);
  const cutSide = useVesselStore((state) => state.cutSide);
  const select = useVesselStore((state) => state.select);
  const hover = useVesselStore((state) => state.hover);
  const contextEpoch = useVesselStore((state) => state.contextEpoch);
  // Hiding a system changes which parts cast shadows, so the static map must follow.
  const visibleKey = useMemo(() => [...visibleSystemIds].sort().join(','), [visibleSystemIds]);

  const renderQuality = useVesselStore((state) => state.renderQuality);
  const profile = QUALITY_PROFILES[renderQuality];
  const showAccessPath = useVesselStore((state) => state.showAccessPath);
  const simulationStartedAt = useVesselStore((state) => state.simulationStartedAt);
  const simulation = useSimulation();
  const selectedAnalysis = useSelectedAnalysis();

  const selected = selectedId ? componentById.get(selectedId) ?? null : null;
  const systemColors = useMemo(
    () => new Map(vesselModel.systems.map((system) => [system.id, system.hudColor])),
    [],
  );
  const waterline = useMemo(() => buildWaterlineGeometry(vessel.hull), []);

  return (
    <>
      <ContextGuard />
      <DaylightDriver />
      <DevSceneInspector />
      <StaticShadows signature={`${explodeAmount}|${cutSide}|${visibleKey}|${contextEpoch}`} />
      <SkyEnvironment epoch={contextEpoch} interval={profile.skySize >= 1024 ? 70 : profile.skySize >= 768 ? 90 : 140} />
      <OverlayWarmup />
      <TextureBudget resolution={profile.textureResolution} />

      <Sea hull={vessel.hull} explodeAmount={explodeAmount} />
      <SunGlare />
      <NightSky />
      <MarineLife waterLevel={vessel.hull.draught} />
      <Coast seaLevel={vessel.hull.draught} />
      <Boats seaLevel={vessel.hull.draught} />
      <Aircraft seaLevel={vessel.hull.draught} />

      <KeyLight shadows={profile.shadows} mapSize={profile.shadowMapSize} />
      <ShipLights seaLevel={vessel.hull.draught} shadows={profile.shadows} />

      {/* Warm practicals inside the machinery space: below decks there is
          no sky, only the lighting fixtures. */}
      <pointLight position={[-22, 3.0, 0]} intensity={260} distance={40} decay={2} color="#ffd9a8" />
      <pointLight position={[-32, 4.6, -2]} intensity={160} distance={28} decay={2} color="#ffd9a8" />

      <VesselStructure
        vessel={vessel}
        cutSide={cutSide}
        explodeAmount={explodeAmount}
        showCompartments={showCompartments}
        showEdges={showStructure}
        activeCompartmentId={selected?.compartmentId ?? null}
        componentsByBand={COMPONENTS_BY_BAND}
        compartmentsByBand={COMPARTMENTS_BY_BAND}
        bands={BANDS}
        renderComponent={(component) => {
          const color = systemColors.get(component.systemId) ?? SCENE_COLORS.markerIdle;
          const shared = {
            selected: component.id === selectedId,
            hovered: component.id === hoveredId,
            dimmed: !visibleSystemIds.has(component.systemId),
          };
          const lost = simulation?.impact.lostById.get(component.id);
          const incident = lost ? (lost.depth === 0 ? ('failed' as const) : ('lost' as const)) : null;

          // Components with an archetype are drawn as real machines; the rest
          // fall back to their raw primitive until an archetype exists for them.
          return component.archetype ? (
            <ComponentAssembly
              key={component.id}
              component={component}
              accentColor={color}
              selectedPieceId={selectedPieceId}
              onSelectPiece={selectPiece}
              onHover={hover}
              incident={incident}
              incidentDelayMs={(lost?.depth ?? 0) * WAVE_DELAY_MS}
              xray={cutSide === 'both' && isInsideHull(component, vessel.hull)}
              {...shared}
            />
          ) : (
            <ComponentMarker
              key={component.id}
              component={component}
              color={color}
              onSelect={select}
              onHover={hover}
              {...shared}
            />
          );
        }}
      />

      <lineSegments geometry={waterline} raycast={noRaycast} renderOrder={3}>
        <lineBasicMaterial
          color={REFERENCE_COLORS.waterline}
          transparent
          opacity={0.55}
          depthWrite={false}
        />
      </lineSegments>

      <IncidentPulse />
      {simulation ? (
        <>
          <IncidentLinks analysis={simulation} startedAt={simulationStartedAt} />
          <ShockRing componentId={simulation.component.id} />
        </>
      ) : null}
      {showAccessPath && selectedAnalysis?.access ? <AccessRoute plan={selectedAnalysis.access} /> : null}

      <CameraRig focusId={selectedId} pieceId={selectedPieceId} waterLevel={vessel.hull.draught} />

      {/* Ambient occlusion is what makes machinery sit in its surroundings
          instead of floating, but it and the rest of the chain are the largest
          consumers of video memory here — so the whole stack steps aside at the
          performance setting rather than risking the context. */}
      {profile.ambientOcclusion || profile.bloom ? (
        <PostEffects ambientOcclusion={profile.ambientOcclusion} bloom={profile.bloom} multisampling={profile.multisampling} />
      ) : null}
      <DepthRange />
      <AdaptiveResolution maxDpr={profile.devicePixelRatioCap} />
    </>
  );
}

export function VesselScene(): React.ReactElement {
  const select = useVesselStore((state) => state.select);
  const renderQuality = useVesselStore((state) => state.renderQuality);
  const profile = QUALITY_PROFILES[renderQuality];

  return (
    <Canvas
      className="absolute inset-0"
      shadows={profile.shadows ? 'percentage' : false}
      dpr={[1, profile.devicePixelRatioCap]}
      camera={{
        fov: CAMERA.fov,
        near: CAMERA.near,
        far: CAMERA.far,
        position: [...CAMERA.position],
      }}
      gl={{
        antialias: true,
        toneMapping: THREE.AgXToneMapping,
        toneMappingExposure: daylight.exposure,
        powerPreference: 'high-performance',
      }}
      onPointerMissed={() => select(null)}
    >
      <Suspense fallback={null}>
        <SceneContents />
      </Suspense>
    </Canvas>
  );
}
