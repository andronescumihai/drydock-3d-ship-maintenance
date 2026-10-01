'use client';

import { useVesselStore } from '@/lib/state/useVesselStore';

/**
 * Render statistics, development only.
 *
 * Judging smoothness by eye across two machines is guesswork; a number in the
 * corner turns "it stutters" into something that can be compared before and
 * after a change. Compiled out of production builds.
 */
export function FrameStats(): React.ReactElement | null {
  const stats = useVesselStore((state) => state.frameStats);

  if (process.env.NODE_ENV === 'production') return null;

  const healthy = stats.fps >= 50;

  return (
    <div className="glass-panel pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-sm px-3 py-2">
      <p className="hud-label mb-1">Render</p>
      <p className="font-mono text-[11px] text-ink">
        <span className={healthy ? 'text-state-ok' : 'text-state-warn'}>{stats.fps} fps</span>
        <span className="text-ink-faint"> · {stats.ms} ms · {stats.pixels}</span>
      </p>
      {stats.contextLosses > 0 ? (
        <p className="mt-1 font-mono text-[11px] text-state-fail">
          context lost ×{stats.contextLosses}
        </p>
      ) : null}
    </div>
  );
}
