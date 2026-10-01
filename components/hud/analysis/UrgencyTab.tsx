'use client';

import { useEffect, useState } from 'react';
import type { FailureAnalysis } from '@/lib/engine/analysis';
import { Bar, CountUp, LEVEL_COLOR, LEVEL_LABEL, SectionLabel, rise } from './ui';

const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** The gauge is a 270° arc, open at the bottom. */
const ARC = 0.75;

function Gauge({ score, color }: { score: number; color: string }): React.ReactElement {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(score));
    return () => cancelAnimationFrame(id);
  }, [score]);

  const track = CIRCUMFERENCE * ARC;
  const filled = track * (shown / 100);

  return (
    <div className="relative mx-auto size-40">
      <svg viewBox="0 0 140 140" className="size-full rotate-[135deg]" aria-hidden="true">
        <defs>
          <linearGradient id="dd-gauge" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.55" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
          <filter id="dd-gauge-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
        </defs>
        <circle cx="70" cy="70" r={RADIUS} fill="none" stroke="#1f2d40" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${track} ${CIRCUMFERENCE}`} />
        <circle
          cx="70"
          cy="70"
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
          filter="url(#dd-gauge-glow)"
          opacity="0.6"
          style={{ transition: 'stroke-dasharray 1.3s cubic-bezier(0.2, 0.8, 0.2, 1)' }}
        />
        <circle
          cx="70"
          cy="70"
          r={RADIUS}
          fill="none"
          stroke="url(#dd-gauge)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
          style={{ transition: 'stroke-dasharray 1.3s cubic-bezier(0.2, 0.8, 0.2, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="font-mono text-4xl font-medium tracking-tight" style={{ color, textShadow: `0 0 24px ${color}66` }}>
          <CountUp value={score} duration={1300} />
        </p>
        <p className="hud-label mt-0.5">of 100</p>
      </div>
    </div>
  );
}

/** The score, and every point of it accounted for. */
export function UrgencyTab({ analysis }: { analysis: FailureAnalysis }): React.ReactElement {
  const { urgency } = analysis;
  const color = LEVEL_COLOR[urgency.level];

  return (
    <div className="space-y-5">
      <div className="dd-rise text-center">
        <Gauge score={urgency.score} color={color} />
        <p className="mt-1 font-mono text-[11px] tracking-[0.22em] uppercase" style={{ color }}>
          {LEVEL_LABEL[urgency.level]}
        </p>
        <p className="mt-1 text-[13px] text-ink">{urgency.headline}</p>
      </div>

      <div>
        <SectionLabel aside={<span className="font-mono text-[10px] text-ink-faint">points</span>}>How it adds up</SectionLabel>
        <ul className="space-y-3">
          {urgency.factors.map((factor, index) => (
            <li key={factor.id} className="dd-rise" style={rise(index + 1, 0.07)}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-xs text-ink">{factor.label}</span>
                <span className="font-mono text-[10.5px] text-ink-muted">
                  <span className="text-ink">{factor.points.toFixed(factor.points % 1 === 0 ? 0 : 1)}</span> / {factor.max}
                </span>
              </div>
              <Bar fraction={factor.points / factor.max} color={color} delay={0.2 + index * 0.07} />
              <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">{factor.detail}</p>
            </li>
          ))}
          {urgency.credits.map((credit, index) => (
            <li key={credit.id} className="dd-rise rounded-md border border-state-ok/30 bg-state-ok/5 px-3 py-2" style={rise(index + 8)}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-state-ok">{credit.label}</span>
                <span className="font-mono text-[10.5px] text-state-ok">{credit.points}</span>
              </div>
              <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-faint">{credit.detail}</p>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[10.5px] leading-relaxed text-ink-faint">
        Weights are a documented modelling choice for this sample vessel, not an industry standard. See the README for
        the formula.
      </p>
    </div>
  );
}
