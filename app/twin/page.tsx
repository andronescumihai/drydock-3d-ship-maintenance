'use client';

import dynamic from 'next/dynamic';
import { HudFrame } from '@/components/hud/HudFrame';

/**
 * The 3D canvas touches WebGL and `window`, so it is loaded on the client only.
 * Everything around it — the HUD, the data model — renders normally.
 */
const VesselScene = dynamic(
  () => import('@/components/scene/VesselScene').then((mod) => mod.VesselScene),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 grid place-items-center">
        <p className="hud-label animate-pulse">Building vessel model…</p>
      </div>
    ),
  },
);

export default function TwinPage(): React.ReactElement {
  return (
    <main className="hud-backdrop relative h-dvh w-full overflow-hidden">
      <VesselScene />
      <HudFrame />
    </main>
  );
}
