'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { ShaderPass } from 'postprocessing';
import { useDisposeOnRelease } from './disposal';
import { daylight } from './daylight';

/**
 * Three small guards that keep the picture stable on real GPUs.
 *
 * `DepthRange` — the camera's near plane follows the zoom. The scene spans
 * half a metre (a valve) to thirty kilometres (the horizon); with a fixed near
 * plane of 0.6 m the depth buffer has metres of error out at the coast, which
 * shows as shimmering shorelines and gives screen-space effects garbage to
 * work with. Standing 400 m off, nothing closer than a few metres is on
 * screen anyway, so the near plane can move out and buy that precision back.
 *
 * `AdaptiveResolution` — if frames start taking too long (a heavy view, a busy
 * machine), the pixel ratio steps down a notch, and back up when there is
 * headroom again. Hysteresis and a cool-down keep it from oscillating.
 *
 * `SanitizePass` — a post-processing pass that replaces any NaN or infinite
 * pixel with its valid neighbours before bloom sees it. Some GPUs (Apple's
 * among them) return NaN for undefined operations where others return 0; a
 * single NaN pixel fed to a mip-chain bloom spreads into a black blotch that
 * can cover half the screen.
 */

export function DepthRange({ min = 0.6, max = 6 }: { min?: number; max?: number }): null {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as { target?: THREE.Vector3 } | null;
  useFrame(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const target = controls?.target;
    const distance = target ? camera.position.distanceTo(target) : camera.position.length();
    const near = THREE.MathUtils.clamp(distance * 0.012, min, max);
    if (Math.abs(near - camera.near) / camera.near > 0.08) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

export function AdaptiveResolution({ maxDpr }: { maxDpr: number }): null {
  const setDpr = useThree((state) => state.setDpr);
  const state = useRef({ dpr: Math.min(maxDpr, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1), frames: 0, time: 0, calm: 0, cooldown: 0 });

  useEffect(() => {
    const device = window.devicePixelRatio || 1;
    state.current.dpr = Math.min(maxDpr, device);
    setDpr(state.current.dpr);
  }, [maxDpr, setDpr]);

  useFrame((_, delta) => {
    const s = state.current;
    // Ignore hitches over a quarter second (tab switches, shader compiles),
    // and the time-of-day change, whose sky renders are temporary work: a
    // resize then would reallocate every post-processing buffer mid-transition.
    if (delta > 0.25) return;
    if (daylight.moving) {
      s.frames = 0;
      s.time = 0;
      return;
    }
    s.frames += 1;
    s.time += delta;
    s.cooldown = Math.max(0, s.cooldown - delta);
    if (s.time < 1) return;
    const ms = (s.time / s.frames) * 1000;
    s.frames = 0;
    s.time = 0;
    if (s.cooldown > 0) return;
    const device = window.devicePixelRatio || 1;
    const ceiling = Math.min(maxDpr, device);
    if (ms > 30 && s.dpr > 1) {
      s.dpr = Math.max(1, s.dpr - 0.25);
      s.calm = 0;
      s.cooldown = 2;
      setDpr(s.dpr);
    } else if (ms < 17) {
      s.calm += 1;
      if (s.calm >= 4 && s.dpr < ceiling) {
        s.dpr = Math.min(ceiling, s.dpr + 0.25);
        s.calm = 0;
        s.cooldown = 3;
        setDpr(s.dpr);
      }
    } else {
      s.calm = 0;
    }
  });
  return null;
}

const SANITIZE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

// NaN and Inf are detected from the bit pattern (all exponent bits set):
// comparisons like x != x may be optimised away by fast-math shader compilers.
const SANITIZE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D inputBuffer;
uniform vec2 texelSize;
varying vec2 vUv;

bool invalid(float x) {
  return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u;
}
bool invalid(vec4 c) {
  return invalid(c.r) || invalid(c.g) || invalid(c.b) || invalid(c.a);
}

void main() {
  vec4 c = texture2D(inputBuffer, vUv);
  if (invalid(c)) {
    vec4 sum = vec4(0.0);
    float n = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853982;
      vec4 s = texture2D(inputBuffer, vUv + vec2(cos(a), sin(a)) * texelSize * 2.0);
      if (!invalid(s)) { sum += s; n += 1.0; }
    }
    c = n > 0.0 ? sum / n : vec4(0.0, 0.0, 0.0, 1.0);
  }
  // Clamp the absurd, too: an overflowing half-float highlight is as bad for bloom.
  gl_FragColor = min(c, vec4(64.0));
}
`;

class SanitizeShaderPass extends ShaderPass {
  constructor() {
    super(
      new THREE.ShaderMaterial({
        name: 'SanitizeMaterial',
        vertexShader: SANITIZE_VERTEX,
        fragmentShader: SANITIZE_FRAGMENT,
        uniforms: { inputBuffer: { value: null }, texelSize: { value: new THREE.Vector2(1, 1) } },
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
      'inputBuffer',
    );
    this.name = 'SanitizePass';
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
    deltaTime?: number,
    stencilTest?: boolean,
  ): void {
    const material = this.fullscreenMaterial as THREE.ShaderMaterial;
    if (inputBuffer) material.uniforms.texelSize!.value.set(1 / inputBuffer.width, 1 / inputBuffer.height);
    super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest);
  }
}

export function SanitizePass(): React.ReactElement {
  const pass = useMemo(() => new SanitizeShaderPass(), []);
  const owned = useMemo(() => [pass], [pass]);
  useDisposeOnRelease(owned);
  return <primitive object={pass} />;
}
