'use client';

import { useEffect, useRef, useState } from 'react';
import type { AccessNodeKind } from '@/lib/engine/types';
import type { UrgencyLevel } from '@/lib/engine/urgency';
import type { RiskSeverity } from '@/lib/engine/proximity';

/** Colours shared by every urgency and risk indicator (tokens in globals.css). */
export const LEVEL_COLOR: Readonly<Record<UrgencyLevel, string>> = {
  critical: '#ff4d5e',
  high: '#ff8a3d',
  moderate: '#ffb03a',
  low: '#3fe08f',
};

export const LEVEL_LABEL: Readonly<Record<UrgencyLevel, string>> = {
  critical: 'Critical',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
};

export const SEVERITY_COLOR: Readonly<Record<RiskSeverity, string>> = {
  high: '#ff4d5e',
  medium: '#ffb03a',
  low: '#90a5ba',
};

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Counts up to `target` with an ease-out, restarting whenever the target changes. */
export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0);
  const frame = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return undefined;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, duration]);

  return value;
}

export function CountUp({
  value,
  format = (v) => Math.round(v).toString(),
  duration,
}: {
  value: number;
  format?: (value: number) => string;
  duration?: number;
}): React.ReactElement {
  const shown = useCountUp(value, duration);
  return <span className="tabular-nums">{format(shown)}</span>;
}

/** Staggered entrance for list items: pass the item index. */
export function rise(index: number, base = 0.04): React.CSSProperties {
  return { animationDelay: `${index * base}s` };
}

export function SectionLabel({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }): React.ReactElement {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3">
      <p className="hud-label">{children}</p>
      {aside}
    </div>
  );
}

export function StatTile({
  label,
  children,
  tone,
  index = 0,
}: {
  label: string;
  children: React.ReactNode;
  tone?: string;
  index?: number;
}): React.ReactElement {
  return (
    <div
      className="dd-rise rounded-md border border-hairline/80 bg-panel-raised/50 px-3 py-2.5"
      style={rise(index, 0.06)}
    >
      <p className="hud-label">{label}</p>
      <p className="mt-1 font-mono text-sm font-medium text-ink" style={tone ? { color: tone } : undefined}>
        {children}
      </p>
    </div>
  );
}

/** A thin progress bar that grows in on mount. */
export function Bar({ fraction, color, delay = 0 }: { fraction: number; color: string; delay?: number }): React.ReactElement {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-hairline/70">
      <div
        className="dd-grow h-full rounded-full"
        style={{
          width: `${Math.max(0, Math.min(1, fraction)) * 100}%`,
          background: `linear-gradient(90deg, ${color}99, ${color})`,
          boxShadow: `0 0 12px -2px ${color}`,
          animationDelay: `${delay}s`,
        }}
      />
    </div>
  );
}

export function Pill({ color, children, pulse = false }: { color: string; children: React.ReactNode; pulse?: boolean }): React.ReactElement {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[9.5px] tracking-[0.14em] uppercase"
      style={{ color, borderColor: `${color}55`, backgroundColor: `${color}14` }}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${pulse ? 'dd-pulse' : ''}`} style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

/** Small line icons for access-step kinds and tab headers. */
export function Icon({ name, className = 'size-3.5' }: { name: IconName; className?: string }): React.ReactElement {
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'overview':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M8 9h8M8 13h8M8 17h5" />
        </svg>
      );
    case 'impact':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.2" />
          <circle cx="18" cy="10" r="2.2" />
          <circle cx="10" cy="18" r="2.2" />
          <path d="M8 7l8 2.5M17 12l-5.5 4.8M6.8 8.1l2.6 7.7" />
        </svg>
      );
    case 'access':
      return (
        <svg {...common}>
          <path d="M4 20h4v-4h4v-4h4V8h4" />
          <path d="M18 4l2 2-2 2" />
        </svg>
      );
    case 'repair':
      return (
        <svg {...common}>
          <path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-3-3z" />
        </svg>
      );
    case 'urgency':
      return (
        <svg {...common}>
          <path d="M4 16a8 8 0 1 1 16 0" />
          <path d="M12 16l4-5" />
          <circle cx="12" cy="16" r="1.2" />
        </svg>
      );
    case 'entry':
      return (
        <svg {...common}>
          <path d="M3 12h11M10 8l4 4-4 4M14 4h6v16h-6" />
        </svg>
      );
    case 'walkway':
      return (
        <svg {...common}>
          <path d="M5 19l4-14M15 5l4 14M12 7v2M12 12v2M12 17v2" />
        </svg>
      );
    case 'door':
      return (
        <svg {...common}>
          <rect x="6" y="3" width="12" height="18" rx="1.5" />
          <path d="M14.5 12h.01" />
        </svg>
      );
    case 'hatch':
      return (
        <svg {...common}>
          <rect x="4" y="9" width="16" height="10" rx="1.5" />
          <path d="M4 9l3-5h10l3 5" />
        </svg>
      );
    case 'ladder':
    case 'stair':
      return (
        <svg {...common}>
          <path d="M8 3v18M16 3v18M8 7h8M8 12h8M8 17h8" />
        </svg>
      );
    case 'removal':
      return (
        <svg {...common}>
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
        </svg>
      );
    case 'workface':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...common}>
          <path d="M12 3l9.5 17h-19z" />
          <path d="M12 10v4M12 17.5h.01" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'bolt':
      return (
        <svg {...common}>
          <path d="M13 3L5 14h6l-1 7 8-11h-6z" />
        </svg>
      );
    case 'reset':
      return (
        <svg {...common}>
          <path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4" />
        </svg>
      );
    default:
      return <svg {...common} />;
  }
}

export type IconName =
  | 'overview'
  | 'impact'
  | 'access'
  | 'repair'
  | 'urgency'
  | 'alert'
  | 'shield'
  | 'bolt'
  | 'reset'
  | AccessNodeKind;
