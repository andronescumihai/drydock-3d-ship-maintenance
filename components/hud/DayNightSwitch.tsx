'use client';

import { useVesselStore } from '@/lib/state/useVesselStore';

/**
 * Day / night, as a switch in the manner of a phone's appearance toggle: the
 * track is a sky (blue with a sun by day, deep blue and starry by night) and
 * the knob rolls across, turning from sun to moon on the way.
 *
 * The scene does not cut: the sun really sets (or rises) over a few seconds,
 * see components/scene/daylight.ts. The switch reflects the choice at once.
 */

const STARS: readonly [number, number, number][] = [
  [14, 9, 1.2],
  [22, 20, 0.9],
  [30, 7, 0.8],
  [9, 22, 0.7],
  [36, 17, 1],
  [26, 13, 0.6],
];

export function DayNightSwitch(): React.ReactElement {
  const timeOfDay = useVesselStore((state) => state.timeOfDay);
  const setTimeOfDay = useVesselStore((state) => state.setTimeOfDay);
  const night = timeOfDay === 'night';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={night}
      aria-label={night ? 'Night — switch to day' : 'Day — switch to night'}
      title={night ? 'Switch to day' : 'Switch to night'}
      onClick={() => setTimeOfDay(night ? 'day' : 'night')}
      className="glass-panel pointer-events-auto flex shrink-0 items-center gap-2.5 rounded-sm px-2.5 py-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
    >
      <span
        className="relative block h-[26px] w-[50px] overflow-hidden rounded-full border transition-[background,border-color,box-shadow] duration-700 ease-out motion-reduce:transition-none"
        style={{
          background: night
            ? 'linear-gradient(160deg, #0b1330 0%, #16224a 60%, #2a2346 100%)'
            : 'linear-gradient(160deg, #5fb4f0 0%, #8fd0f7 55%, #ffd9a0 100%)',
          borderColor: night ? 'rgba(140,160,220,0.35)' : 'rgba(255,255,255,0.55)',
          boxShadow: night ? 'inset 0 1px 4px rgba(0,0,0,0.6)' : 'inset 0 1px 3px rgba(20,60,110,0.35)',
        }}
      >
        {/* Stars fade in on the night track, where the knob is not. */}
        {STARS.map(([left, top, size]) => (
          <span
            key={`${left}-${top}`}
            className="absolute rounded-full bg-white transition-opacity duration-700 motion-reduce:transition-none"
            style={{ left, top, width: size * 1.6, height: size * 1.6, opacity: night ? 0.85 : 0 }}
          />
        ))}
        {/* A small cloud on the day track. */}
        <span
          className="absolute rounded-full bg-white/85 transition-opacity duration-500 motion-reduce:transition-none"
          style={{ left: 27, top: 14, width: 16, height: 6, opacity: night ? 0 : 0.9, boxShadow: '4px -3px 0 1px rgba(255,255,255,0.85)' }}
        />
        {/* The knob: a sun that rolls across and becomes the moon. */}
        <span
          className="absolute top-[2px] left-[2px] block h-5 w-5 rounded-full transition-[transform,background,box-shadow] duration-500 motion-reduce:transition-none"
          style={{
            transform: night ? 'translateX(24px) rotate(200deg)' : 'translateX(0) rotate(0deg)',
            transitionTimingFunction: 'cubic-bezier(0.34, 1.45, 0.64, 1)',
            background: night
              ? 'radial-gradient(circle at 35% 35%, #f4f1e6 0%, #d9d4c4 60%, #b9b3a2 100%)'
              : 'radial-gradient(circle at 40% 38%, #fff6c9 0%, #ffd34d 55%, #ffae2b 100%)',
            boxShadow: night
              ? '0 0 6px 1px rgba(200,210,255,0.35), inset -2px -2px 3px rgba(0,0,0,0.18)'
              : '0 0 10px 3px rgba(255,200,80,0.65)',
          }}
        >
          {/* Craters, only on the moon. */}
          {[
            [5, 5, 4],
            [11, 10, 3],
            [6, 12, 2.5],
          ].map(([left, top, size]) => (
            <span
              key={`${left}-${top}`}
              className="absolute rounded-full transition-opacity duration-500 motion-reduce:transition-none"
              style={{
                left,
                top,
                width: size,
                height: size,
                background: 'rgba(120,112,95,0.45)',
                opacity: night ? 1 : 0,
              }}
            />
          ))}
        </span>
      </span>
      <span className="w-9 text-left font-mono text-[10px] tracking-[0.16em] text-ink-muted uppercase">
        {night ? 'Night' : 'Day'}
      </span>
    </button>
  );
}
