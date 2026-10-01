import * as THREE from 'three';

/**
 * Lit windows after dark, for the deckhouse glazing.
 *
 * The window bands are single boxes of dark glass; at night each window-sized
 * cell of them (about 1.4 m wide, one per deck in height) is lit or not by a
 * hash of its position, in a few shades of warm white — cabins with the light
 * on, cabins without, the odd brighter mess room. Object-space positions are
 * used, so the pattern stays put when the decks slide apart.
 *
 * `WINDOW_GLOW` is shared by every patched material and set once per frame
 * from the time of day (ShipLights.tsx).
 */

export const WINDOW_GLOW = { value: 0 };

const DECLARATIONS = /* glsl */ `
uniform float uWindowGlow;
varying vec3 vWindowPos;
varying vec3 vWindowNormal;
float windowHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
`;

const EMISSIVE = /* glsl */ `
if (uWindowGlow > 0.0) {
  // Cells are laid out in the plane of each face — along the face and up it —
  // never across it: a face lying on a cell boundary would flicker between two
  // cells as the camera moves. Roofs and sills of the glazing band stay dark.
  vec3 an = abs(vWindowNormal);
  float facing = step(0.5, max(an.x, an.z));
  float across = an.z > an.x ? floor(vWindowPos.x / 1.4) : floor(vWindowPos.z / 1.4);
  float side = an.z > an.x ? sign(vWindowNormal.z) * 3.0 : sign(vWindowNormal.x) * 5.0;
  vec3 cell = vec3(across, floor(vWindowPos.y / 2.1), side);
  float h = windowHash(cell + 17.0);
  float lit = step(h, 0.64);
  vec3 warm = mix(vec3(1.0, 0.74, 0.44), vec3(1.0, 0.9, 0.76), fract(h * 7.31));
  totalEmissiveRadiance += warm * lit * facing * uWindowGlow * (0.55 + 0.45 * fract(h * 13.17));
}
`;

function patch(source: string, anchor: string, code: string): string {
  if (!source.includes(anchor)) throw new Error(`[DryDock] window shader anchor missing: ${anchor}`);
  return source.replace(anchor, `${anchor}\n${code}`);
}

/** Adds the night-time window pattern to a (glazing) material. Returns it. */
export function withNightWindows<T extends THREE.MeshStandardMaterial>(material: T): T {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uWindowGlow = WINDOW_GLOW;
    shader.vertexShader = patch(shader.vertexShader, '#include <common>', 'varying vec3 vWindowPos;\nvarying vec3 vWindowNormal;');
    shader.vertexShader = patch(shader.vertexShader, '#include <begin_vertex>', 'vWindowPos = position;\nvWindowNormal = normal;');
    shader.fragmentShader = patch(shader.fragmentShader, '#include <common>', DECLARATIONS);
    shader.fragmentShader = patch(shader.fragmentShader, '#include <emissivemap_fragment>', EMISSIVE);
  };
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${previousKey()}|night-windows-2`;
  return material;
}
