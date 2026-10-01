'use client';

import { useVesselStore } from '@/lib/state/useVesselStore';
import { CountUp, Icon, LEVEL_COLOR } from './ui';
import { useSimulation } from './useAnalysis';

/** The incident strip across the top while a failure is being simulated. */
export function SimulationBanner(): React.ReactElement | null {
  const simulation = useSimulation();
  const selectPiece = useVesselStore((state) => state.selectPiece);
  const setTab = useVesselStore((state) => state.setAnalysisTab);
  const clearSimulation = useVesselStore((state) => state.clearSimulation);
  if (!simulation) return null;

  const { component, impact, urgency, repair } = simulation;
  const color = LEVEL_COLOR[urgency.level];

  return (
    <div
      key={component.id}
      className="glass-luminous dd-banner-in dd-alarm pointer-events-auto flex items-center gap-3.5 rounded-xl px-3.5 py-2.5"
      data-state="failure"
      role="status"
    >
      <span className="flex size-8 items-center justify-center rounded-full bg-state-fail/15 text-state-fail">
        <Icon name="alert" className="size-4" />
      </span>
      <div className="min-w-0 shrink">
        <p className="font-mono text-[9.5px] tracking-[0.22em] text-state-fail uppercase">Failure simulation</p>
        <p className="max-w-[12rem] truncate text-[13px] font-medium text-ink">{component.name}</p>
      </div>
      <div className="hidden items-center gap-4 border-l border-hairline/80 pl-4 font-mono text-[11px] whitespace-nowrap text-ink-muted md:flex">
        <span>
          <span className="text-state-high">
            <CountUp value={impact.lost.length - 1} />
          </span>{' '}
          lost
        </span>
        <span className="hidden 2xl:inline">
          <span className="text-ink">{impact.systems.length}</span> systems
        </span>
        <span>
          urgency{' '}
          <span style={{ color }}>
            <CountUp value={urgency.score} />
          </span>
        </span>
        <span className="hidden 2xl:inline">
          restore <span className="text-ink">{Math.round(repair.totalMinutes / 60)} h</span>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            selectPiece(component.id, null);
            setTab('impact');
          }}
          className="rounded-md border border-hairline-bright px-2.5 py-1.5 font-mono text-[10px] tracking-[0.14em] text-ink uppercase transition-colors hover:border-accent/60 hover:text-accent"
        >
          Impact
        </button>
        <button
          type="button"
          onClick={clearSimulation}
          className="flex items-center gap-1.5 rounded-md border border-state-fail/50 bg-state-fail/10 px-2.5 py-1.5 font-mono text-[10px] tracking-[0.14em] text-state-fail uppercase transition-colors hover:bg-state-fail/20"
        >
          <Icon name="reset" className="size-3.5" />
          Reset
        </button>
      </div>
    </div>
  );
}
