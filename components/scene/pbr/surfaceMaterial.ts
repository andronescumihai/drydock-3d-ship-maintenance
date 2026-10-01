/**
 * The surface shader used by every hull, deck and machinery material.
 *
 * It is three.js's own MeshStandardMaterial — same lighting, shadows, fog and
 * tone mapping as everything else — with four additions spliced in through
 * `onBeforeCompile`:
 *
 *  1. TRIPLANAR MAPPING in object space. Textures are projected along the three
 *     axes and blended by the surface normal, in metres. No geometry needs UVs,
 *     every part gets the same texel density whatever its size, and because the
 *     projection uses object coordinates the texture travels with a deck as it
 *     explodes instead of swimming across it.
 *  2. A PER-PIXEL NORMAL from the baked normal map (weld beads, plate dishing,
 *     non-skid grit, cast texture), reoriented per projection.
 *  3. WEAR: rust, grime and chipped paint from baked masks, scaled per surface,
 *     modulated by a large non-repeating noise so the 9.6 m hull tile never
 *     reads as a tile, and with rust favouring vertical faces where it runs.
 *  4. Baked cavity AO on indirect light.
 *
 * All materials share ONE shader program (same code, same cache key); what
 * differs between them is uniforms only.
 */

import * as THREE from 'three';
import { ACCENT_SURFACE, SURFACES, WEAR_COLORS, type SurfaceName, type SurfaceSpec } from '../materials';
import { getTextureSet } from './textureSets';
import type { Livery } from '../livery';

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vTriPos;
varying vec3 vTriNormal;
`;

const VERTEX_ASSIGN = /* glsl */ `
vTriPos = position;
vTriNormal = objectNormal;
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
varying vec3 vTriPos;
varying vec3 vTriNormal;
uniform mat3 normalMatrix;

uniform sampler2D uTriNormal;
uniform sampler2D uTriOrm;
uniform sampler2D uTriWear;
uniform float uTriScale;
uniform float uTriNormalStrength;
uniform float uTriEnabled;
uniform vec3 uWear;
uniform vec3 uRustColor;
uniform vec3 uChipColor;
uniform vec3 uGrimeColor;
uniform float uChipMetal;
uniform float uGrimeRough;
uniform float uMacro;
uniform float uWaterline;
uniform float uPaintScheme;
uniform vec3 uPaintLow;
uniform vec3 uPaintMid;
uniform vec3 uPaintTop;
uniform vec2 uPaintHeights;
uniform vec3 uPaintRough;

float ddHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// Value noise: cheap, smooth, and — unlike a texture — it never repeats.
float ddNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(ddHash(i), ddHash(i + vec3(1, 0, 0)), f.x),
        mix(ddHash(i + vec3(0, 1, 0)), ddHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(ddHash(i + vec3(0, 0, 1)), ddHash(i + vec3(1, 0, 1)), f.x),
        mix(ddHash(i + vec3(0, 1, 1)), ddHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
`;

/**
 * Runs right after vertex colours are applied. Computes the projection, reads
 * every map once, and paints the albedo; roughness, metalness, normal and AO
 * reuse the same samples further down.
 */
const FRAGMENT_SURFACE = /* glsl */ `
#ifdef DOUBLE_SIDED
  float ddFace = gl_FrontFacing ? 1.0 : -1.0;
#else
  float ddFace = 1.0;
#endif
  // Degenerate triangles (where the shell pinches to the stem) leave zero-length
  // normals; normalising those gives NaN, which the post chain spreads into
  // black specks. Fall back to "up" instead.
  float ddLen = length(vTriNormal);
  vec3 ddN = (ddLen > 1e-6 ? vTriNormal / ddLen : vec3(0.0, 1.0, 0.0)) * ddFace;
  vec3 ddW = pow(abs(ddN), vec3(6.0));
  ddW /= max(ddW.x + ddW.y + ddW.z, 1e-5);
  vec3 ddS = vec3(ddN.x < 0.0 ? -1.0 : 1.0, ddN.y < 0.0 ? -1.0 : 1.0, ddN.z < 0.0 ? -1.0 : 1.0);
  vec3 ddQ = vTriPos * uTriScale;
  // Each projection is laid out as it would be seen facing that side, so no
  // face shows a mirror image of the texture.
  vec2 ddUvX = vec2(-ddS.x * ddQ.z, ddQ.y);
  vec2 ddUvY = vec2(ddQ.x, -ddS.y * ddQ.z) + vec2(0.37, 0.61);
  vec2 ddUvZ = vec2(ddS.z * ddQ.x, ddQ.y);

  vec3 ddOrm = texture2D(uTriOrm, ddUvX).rgb * ddW.x
             + texture2D(uTriOrm, ddUvY).rgb * ddW.y
             + texture2D(uTriOrm, ddUvZ).rgb * ddW.z;
  vec3 ddWearTex = texture2D(uTriWear, ddUvX).rgb * ddW.x
                 + texture2D(uTriWear, ddUvY).rgb * ddW.y
                 + texture2D(uTriWear, ddUvZ).rgb * ddW.z;
  vec3 ddTnX = texture2D(uTriNormal, ddUvX).xyz * 2.0 - 1.0;
  vec3 ddTnY = texture2D(uTriNormal, ddUvY).xyz * 2.0 - 1.0;
  vec3 ddTnZ = texture2D(uTriNormal, ddUvZ).xyz * 2.0 - 1.0;

  ddOrm = mix(vec3(1.0, 0.5, 1.0), ddOrm, uTriEnabled);

  // Hull paint scheme by height, anti-aliased to the pixel. Only outboard
  // plating (white vertex colour) is painted; the inboard face keeps its own.
  float ddPaintRough = 1.0;
#ifdef USE_COLOR
  if (uPaintScheme > 0.5) {
    float ddOut = step(0.985, min(vColor.r, min(vColor.g, vColor.b)));
    float ddAA = fwidth(vTriPos.y) * 0.75 + 0.004;
    float ddM = smoothstep(-ddAA, ddAA, vTriPos.y - uPaintHeights.x);
    float ddT = smoothstep(-ddAA, ddAA, vTriPos.y - uPaintHeights.y);
    vec3 ddPaint = mix(mix(uPaintLow, uPaintMid, ddM), uPaintTop, ddT);
    diffuseColor.rgb = mix(diffuseColor.rgb, ddPaint, ddOut);
    ddPaintRough = mix(1.0, mix(mix(uPaintRough.x, uPaintRough.y, ddM), uPaintRough.z, ddT), ddOut);
  }
#endif
  ddWearTex *= uTriEnabled;

  // Two octaves of world-scale variation: patches metres across where the
  // paint is a shade different, dirtier, or more weathered.
  float ddMacro = ddNoise(vTriPos * 0.09) * 0.62 + ddNoise(vTriPos * 0.31 + 7.1) * 0.38;
  float ddMacroC = ddMacro - 0.5;

  float ddVertical = 1.0 - abs(ddN.y);
  float ddRust = clamp(ddWearTex.r * uWear.x * (0.35 + 1.3 * ddMacro) * mix(0.3, 1.0, ddVertical), 0.0, 1.0);
  float ddGrime = clamp(ddWearTex.g * uWear.y * (0.45 + 1.1 * ddMacro), 0.0, 1.0);
  float ddChip = clamp(ddWearTex.b * uWear.z * (0.5 + ddMacro) * 1.6, 0.0, 1.0);

  // Scum line: a hull at sea is stained in a band either side of the waterline.
  float ddWlD = (vTriPos.y - uWaterline) / 0.32;
  float ddWl = exp(-ddWlD * ddWlD) * ddVertical;
  ddGrime = max(ddGrime, ddWl * uWear.y * (0.55 + 0.6 * ddMacro));

  diffuseColor.rgb *= ddOrm.b * (1.0 + ddMacroC * uMacro);
  diffuseColor.rgb = mix(diffuseColor.rgb, uChipColor, ddChip);
  diffuseColor.rgb = mix(diffuseColor.rgb, uRustColor * (0.7 + 0.6 * ddWearTex.r), ddRust);
  diffuseColor.rgb *= mix(vec3(1.0), uGrimeColor, ddGrime * 0.85);
`;

const FRAGMENT_ROUGHNESS = /* glsl */ `
  roughnessFactor *= ddPaintRough * (0.45 + 1.1 * ddOrm.g) * (1.0 + ddMacroC * 0.35);
  roughnessFactor = mix(roughnessFactor, 0.9, ddRust);
  roughnessFactor = mix(roughnessFactor, 0.62, ddChip * (1.0 - uChipMetal));
  roughnessFactor = clamp(roughnessFactor + uGrimeRough * ddGrime, 0.03, 1.0);
`;

const FRAGMENT_METALNESS = /* glsl */ `
  metalnessFactor = mix(metalnessFactor, uChipMetal, ddChip);
  metalnessFactor = mix(metalnessFactor, 0.0, ddRust);
`;

/**
 * Replaces the stock normal-map chunk. Each projection's tangent-space normal is
 * rebuilt on that projection's own axes around the geometric normal, blended,
 * and moved into view space.
 */
const FRAGMENT_NORMAL = /* glsl */ `
  {
    vec2 ddK = vec2(uTriNormalStrength * uTriEnabled);
    ddTnX.xy *= ddK; ddTnY.xy *= ddK; ddTnZ.xy *= ddK;
    vec3 ddNx = ddTnX.x * vec3(0.0, 0.0, -ddS.x) + ddTnX.y * vec3(0.0, 1.0, 0.0) + ddTnX.z * ddN;
    vec3 ddNy = ddTnY.x * vec3(1.0, 0.0, 0.0) + ddTnY.y * vec3(0.0, 0.0, -ddS.y) + ddTnY.z * ddN;
    vec3 ddNz = ddTnZ.x * vec3(ddS.z, 0.0, 0.0) + ddTnZ.y * vec3(0.0, 1.0, 0.0) + ddTnZ.z * ddN;
    vec3 ddObj = normalize(normalize(ddNx) * ddW.x + normalize(ddNy) * ddW.y + normalize(ddNz) * ddW.z);
    normal = normalize(normalMatrix * ddObj);
  }
`;

const FRAGMENT_AO = /* glsl */ `
  {
    float ddAo = mix(1.0, ddOrm.r, uTriEnabled);
    reflectedLight.indirectDiffuse *= ddAo;
    reflectedLight.indirectSpecular *= mix(1.0, ddAo, 0.6);
    reflectedLight.directDiffuse *= mix(1.0, ddAo, 0.35);
  }
`;

function inject(source: string, anchor: string, code: string, where: 'before' | 'after' | 'replace'): string {
  if (!source.includes(anchor)) {
    throw new Error(`[DryDock] shader anchor not found: ${anchor} — three.js chunk layout changed`);
  }
  const replacement =
    where === 'replace' ? code : where === 'after' ? `${anchor}\n${code}` : `${code}\n${anchor}`;
  return source.replace(anchor, replacement);
}

export interface SurfaceMaterialOptions {
  readonly side?: THREE.Side;
  /** Multiply the base colour by the geometry's vertex colours (hull paint scheme). */
  readonly vertexColors?: boolean;
  /** Overrides the surface colour (system accent). */
  readonly color?: string;
  /** Height of the waterline scum band; omit to disable. */
  readonly waterline?: number;
  /** Paint the outboard shell by height: antifouling, boot top, topsides. */
  readonly paintScheme?: {
    readonly heights: readonly [number, number];
    readonly colors: readonly [string, string, string];
    /** Roughness multipliers per band. */
    readonly roughness: readonly [number, number, number];
  };
}

const NO_WATERLINE = -1e4;

/**
 * Builds a physically based material for a catalogue surface.
 *
 * Materials are cheap to create (they share a program) but each one owns its
 * uniforms, so callers should cache rather than create per frame.
 */
export function createSurfaceMaterial(
  spec: SurfaceSpec,
  options: SurfaceMaterialOptions = {},
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: options.vertexColors ? '#ffffff' : options.color ?? spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness,
    side: options.side ?? THREE.FrontSide,
    vertexColors: options.vertexColors ?? false,
  });
  if (spec.envMapIntensity !== undefined) material.envMapIntensity = spec.envMapIntensity;
  if (!spec.set) return material;

  const set = getTextureSet(spec.set);
  const wear = spec.wear ?? [0, 0, 0];
  const uniforms: Record<string, THREE.IUniform> = {
    uTriNormal: set.normal,
    uTriOrm: set.orm,
    uTriWear: set.wear,
    uTriScale: set.scale,
    uTriNormalStrength: { value: spec.normalStrength ?? 1 },
    uTriEnabled: { value: 1 },
    uWear: { value: new THREE.Vector3(wear[0], wear[1], wear[2]) },
    uRustColor: { value: new THREE.Color(spec.rustColor ?? WEAR_COLORS.rust) },
    uChipColor: { value: new THREE.Color(spec.chipColor ?? spec.color) },
    uGrimeColor: { value: new THREE.Color(WEAR_COLORS.grime) },
    uChipMetal: { value: spec.chipMetalness ?? 0 },
    uGrimeRough: { value: spec.grimeRoughness ?? 0.12 },
    uMacro: { value: spec.macro ?? 0.1 },
    uWaterline: { value: options.waterline ?? NO_WATERLINE },
    uPaintScheme: { value: options.paintScheme ? 1 : 0 },
    uPaintLow: { value: new THREE.Color(options.paintScheme?.colors[0] ?? '#ffffff') },
    uPaintMid: { value: new THREE.Color(options.paintScheme?.colors[1] ?? '#ffffff') },
    uPaintTop: { value: new THREE.Color(options.paintScheme?.colors[2] ?? '#ffffff') },
    uPaintHeights: {
      value: new THREE.Vector2(...(options.paintScheme?.heights ?? [NO_WATERLINE, NO_WATERLINE])),
    },
    uPaintRough: { value: new THREE.Vector3(...(options.paintScheme?.roughness ?? [1, 1, 1])) },
  };
  material.userData.surfaceUniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    let vertex = shader.vertexShader;
    vertex = inject(vertex, '#include <common>', VERTEX_DECLARATIONS, 'after');
    vertex = inject(vertex, '#include <begin_vertex>', VERTEX_ASSIGN, 'after');
    shader.vertexShader = vertex;

    let fragment = shader.fragmentShader;
    fragment = inject(fragment, '#include <common>', FRAGMENT_DECLARATIONS, 'after');
    fragment = inject(fragment, '#include <color_fragment>', FRAGMENT_SURFACE, 'after');
    fragment = inject(fragment, '#include <roughnessmap_fragment>', FRAGMENT_ROUGHNESS, 'after');
    fragment = inject(fragment, '#include <metalnessmap_fragment>', FRAGMENT_METALNESS, 'after');
    fragment = inject(fragment, '#include <normal_fragment_maps>', FRAGMENT_NORMAL, 'replace');
    fragment = inject(fragment, '#include <aomap_fragment>', FRAGMENT_AO, 'after');
    shader.fragmentShader = fragment;
  };
  // Identical source for every surface material, so they all share a program.
  material.customProgramCacheKey = () => 'drydock-surface-v1';
  return material;
}

/** Visual state of a machinery part, for the material cache below. */
export type PieceState = 'idle' | 'hover' | 'selected' | 'piece' | 'dimmed' | 'failed' | 'lost';

const pieceCache = new Map<string, THREE.MeshStandardMaterial>();

const HIGHLIGHT = {
  hover: { color: '#eaf6fb', intensity: 0.08 },
  selected: { color: '#eaf6fb', intensity: 0.12 },
  piece: { color: '#38d6f2', intensity: 0.85 },
  failed: { color: '#ff2a3d', intensity: 0.9 },
  lost: { color: '#ff8a1d', intensity: 0.45 },
} as const;

/** Incident materials whose glow breathes; animated by `pulseIncidentMaterials`. */
const pulsing = { failed: new Set<THREE.MeshStandardMaterial>(), lost: new Set<THREE.MeshStandardMaterial>() };

/**
 * Breathes the glow on failed (fast, strong) and lost (slow, soft) parts.
 * Called once per frame from the scene; cheap, since the materials are shared.
 */
export function pulseIncidentMaterials(time: number): void {
  const fast = 0.55 + 0.55 * (0.5 + 0.5 * Math.sin(time * 5.2));
  const slow = 0.22 + 0.3 * (0.5 + 0.5 * Math.sin(time * 2.6));
  for (const material of pulsing.failed) material.emissiveIntensity = fast;
  for (const material of pulsing.lost) material.emissiveIntensity = slow;
}

/**
 * Shared material for a machinery part in a given state.
 *
 * A few hundred meshes resolve to a few dozen materials this way. The cache is
 * bounded (surfaces × system colours × states) and lives as long as the page;
 * materials are never disposed, which keeps React Strict Mode's double mount
 * from ever handing a mesh a disposed material.
 */
export function getPieceMaterial(
  surface: SurfaceName | 'accent',
  accentColor: string,
  state: PieceState,
  livery: Livery = {},
): THREE.MeshStandardMaterial {
  // Castings take the machine's paint, pipework its ISO 14726 colour.
  const machine = surface === 'castIron' ? livery.machine : undefined;
  const pipe = surface === 'copper' ? livery.pipe : undefined;
  const key = `${surface}|${surface === 'accent' ? accentColor : ''}|${machine ?? ''}|${pipe ?? ''}|${state}`;
  const cached = pieceCache.get(key);
  if (cached) return cached;

  let spec: SurfaceSpec;
  if (surface === 'accent') spec = { ...ACCENT_SURFACE, color: accentColor };
  else if (machine) spec = { ...SURFACES.castIron, color: machine };
  else if (pipe) spec = { ...SURFACES.paintedPipe, color: pipe };
  else spec = SURFACES[surface];
  const material = createSurfaceMaterial(spec, { side: THREE.FrontSide });

  if (state === 'dimmed') {
    material.color.set('#8a97a5');
    material.transparent = true;
    material.opacity = 0.16;
    material.depthWrite = false;
  } else if (state !== 'idle') {
    material.emissive.set(HIGHLIGHT[state].color);
    material.emissiveIntensity = HIGHLIGHT[state].intensity;
    if (state === 'failed' || state === 'lost') pulsing[state].add(material);
  }

  pieceCache.set(key, material);
  return material;
}
