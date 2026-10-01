import * as THREE from 'three';

/**
 * "X-ray" materials: a Fresnel glow drawn over everything (no depth test), so a
 * machine inside the closed hull can be seen through the plating without the
 * app cutting the hull open by itself. The section stays the user's choice.
 *
 * Three shared materials, one per meaning, created once for the page's life
 * (see the note on disposal in IncidentOverlays).
 */

export type XRayKind = 'selected' | 'failed' | 'lost';

const SETTINGS: Record<XRayKind, { color: string; base: number; rim: number; pulse: number }> = {
  selected: { color: '#38d6f2', base: 0.05, rim: 0.75, pulse: 0 },
  failed: { color: '#ff3b4d', base: 0.1, rim: 0.95, pulse: 0.35 },
  lost: { color: '#ff9a2e', base: 0.03, rim: 0.5, pulse: 0.2 },
};

const VERTEX = /* glsl */ `
varying vec3 vNormalView;
varying vec3 vToCamera;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalView = normalize(normalMatrix * normal);
  vToCamera = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uBase;
uniform float uRim;
uniform float uPulse;
uniform float uTime;
varying vec3 vNormalView;
varying vec3 vToCamera;
void main() {
  float facing = abs(dot(normalize(vNormalView), normalize(vToCamera)));
  float rim = pow(clamp(1.0 - facing, 0.0, 1.0), 2.2);
  float breathe = 1.0 - uPulse + uPulse * (0.5 + 0.5 * sin(uTime * 5.0));
  float alpha = (uBase + uRim * rim) * breathe;
  gl_FragColor = vec4(uColor, clamp(alpha, 0.0, 1.0));
}
`;

const time = { value: 0 };
const cache = new Map<XRayKind, THREE.ShaderMaterial>();

export function getXRayMaterial(kind: XRayKind): THREE.ShaderMaterial {
  const cached = cache.get(kind);
  if (cached) return cached;
  const s = SETTINGS[kind];
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uColor: { value: new THREE.Color(s.color) },
      uBase: { value: s.base },
      uRim: { value: s.rim },
      uPulse: { value: s.pulse },
      uTime: time,
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  cache.set(kind, material);
  return material;
}

/** Advances the shared pulse clock; called once per frame. */
export function tickXRay(elapsed: number): void {
  time.value = elapsed;
}
