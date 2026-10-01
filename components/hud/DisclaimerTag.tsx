'use client';

import { useEffect, useState } from 'react';
import PaperCrumple from '@/components/reactbits/PaperCrumple';
import { vesselModel } from '@/lib/data/loader';

const { vessel } = vesselModel;

/** Paper size in CSS pixels; the stage adds PaperCrumple's 24 px margin on every side. */
const TAG = { width: 304, height: 88 } as const;

/**
 * The honesty label, as a maintenance tag you can crumple (React Bits
 * PaperCrumple). Hold it to scrunch it up and drag it about; let go and it
 * smooths itself flat again, so the notice is never left unreadable.
 *
 * The tag image carries the same words as the text below it, which stays in
 * the DOM for screen readers and as the hover title; if WebGL is unavailable
 * PaperCrumple falls back to showing the flat image.
 */
export function DisclaimerTag(): React.ReactElement | null {
  // Below md the header shows a plain-text notice instead (see HudFrame), and
  // the tag is not mounted at all, so it holds no WebGL context there.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const sync = (): void => setWide(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  if (!wide) return null;

  return (
    <div className="pointer-events-auto relative -mt-4 -mr-4 w-[22rem] shrink-0" title={vessel.disclaimer}>
      <PaperCrumple
        src="/art/disclaimer-tag.png"
        alt="Modeled sample vessel, simulation. The analysis engine is real; the vessel data is a documented model."
        width={TAG.width}
        height={TAG.height}
        sceneHeight={TAG.height + 48}
        imageFit="contain"
        releaseBehavior="restore"
        crumpleAmount={0.8}
        foldCount={5}
        paperColor="#efe7d6"
        lightIntensity={1.45}
        lightAngle={-40}
        shadowOpacity={0.35}
        dragRadius={36}
        dragRotation={6}
        rotation={-1.5}
        seed={11}
      />
      <p className="sr-only">
        Modeled sample vessel, simulation. Documented model, not a real ship. The analysis engine is real; the vessel
        data is not.
      </p>
    </div>
  );
}
