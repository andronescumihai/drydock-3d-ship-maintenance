'use client';

import { useEffect, useRef, useState } from 'react';
import DitherVeil from '@/components/reactbits/DitherVeil';
import { ComponentBrowser } from './ComponentBrowser';
import { SystemLegend } from './SystemLegend';
import { ViewControls } from './ViewControls';

/**
 * The left column of HUD panels, with a React Bits DitherVeil laid over it.
 *
 * At rest the veil is invisible. Hovering any panel fades it in: a faint
 * ordered-dither of a general-arrangement blueprint, with the full-colour
 * plan revealed in a soft circle that trails the cursor (and a shockwave on
 * click). It is one WebGL canvas for the whole column, not one per panel, and
 * it only renders while the pointer is over it or its trail is fading.
 *
 * Three details keep it from getting in the way:
 *  - the veil takes no pointer events; it listens on the column wrapper, which
 *    the panels' events bubble through, so every control still works;
 *  - it is blended with `screen`, so its black ink disappears and only the
 *    light dots and lines add to the glass;
 *  - it is clipped to the panels' own rectangles, so the gaps between them
 *    (where the ship shows through) stay clean.
 */
export function LeftColumn(): React.ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const scroll = scrollRef.current;
    const veil = veilRef.current;
    if (!wrap || !scroll || !veil) return undefined;

    let frame = 0;
    const clip = (): void => {
      frame = 0;
      const base = wrap.getBoundingClientRect();
      const parts: string[] = [];
      for (const panel of Array.from(scroll.children)) {
        const rect = panel.getBoundingClientRect();
        const top = Math.max(0, rect.top - base.top);
        const bottom = Math.min(base.height, rect.bottom - base.top);
        if (bottom - top < 1) continue;
        const left = rect.left - base.left;
        parts.push(`M${left.toFixed(1)} ${top.toFixed(1)}h${rect.width.toFixed(1)}v${(bottom - top).toFixed(1)}h${(-rect.width).toFixed(1)}Z`);
      }
      veil.style.clipPath = parts.length > 0 ? `path('${parts.join(' ')}')` : 'inset(100%)';
    };
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(clip);
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(wrap);
    for (const panel of Array.from(scroll.children)) observer.observe(panel);
    scroll.addEventListener('scroll', schedule, { passive: true });
    clip();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroll.removeEventListener('scroll', schedule);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative flex max-h-full min-h-0 shrink-0 flex-col"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div ref={scrollRef} className="hud-scroll flex min-h-0 flex-col gap-3 overflow-y-auto pb-1">
        <ViewControls />
        <SystemLegend />
        <ComponentBrowser />
      </div>
      <div
        ref={veilRef}
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 z-20 mix-blend-screen transition-opacity duration-500 ${
          hovered ? 'opacity-60' : 'opacity-0'
        }`}
      >
        <DitherVeil
          src="/art/veil-blueprint.png"
          eventTarget={wrapRef}
          fit="cover"
          pattern="bayer"
          pixelSize={2}
          levels={3}
          inkColor="#000000"
          paperColor="#0f3141"
          contrast={1.3}
          revealRadius={96}
          softness={0.65}
          linger={0.9}
          rim={0.12}
          rimColor="#1d7d92"
          clickBurst
        />
      </div>
    </div>
  );
}
