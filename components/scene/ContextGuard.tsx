'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useVesselStore } from '@/lib/state/useVesselStore';

/**
 * Survives the browser taking the WebGL context away.
 *
 * A page may only hold so many live contexts and so much video memory. Past
 * that, the browser reclaims the context: the canvas goes blank, then comes
 * back a moment later — the flicker people describe as the image cutting out.
 *
 * Two things matter here. Calling `preventDefault` on the loss event is what
 * permits a restore at all; without it the context is gone for good. And
 * stepping the render quality down means the scene stops asking for a budget
 * the GPU has already refused, so the second attempt has a chance of holding.
 *
 * This runs in production as well as development — it is recovery, not
 * instrumentation.
 */
export function ContextGuard(): null {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const degradeRenderQuality = useVesselStore((state) => state.degradeRenderQuality);
  const markContextRestored = useVesselStore((state) => state.markContextRestored);

  useEffect(() => {
    const canvas = gl.domElement;

    const onLost = (event: Event): void => {
      event.preventDefault();
      console.warn('[drydock] WebGL context lost — stepping render quality down');
      degradeRenderQuality();
    };

    const onRestored = (): void => {
      console.warn('[drydock] WebGL context restored');
      // The restored context is empty: the sky, the environment light and the
      // shadow map were each rendered once, so ask for them again.
      markContextRestored();
      invalidate();
    };

    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    };
  }, [gl, invalidate, degradeRenderQuality, markContextRestored]);

  return null;
}
