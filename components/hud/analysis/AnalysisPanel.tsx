'use client';

import { useEffect, useRef } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { FlashIcon } from '@hugeicons/core-free-icons';
import SlingButton from '@/components/reactbits/SlingButton';
import { vesselModel } from '@/lib/data/loader';
import { isInsideHull } from '@/lib/geometry/interior';
import { useVesselStore, type AnalysisTab } from '@/lib/state/useVesselStore';
import { AccessTab } from './AccessTab';
import { ImpactTab } from './ImpactTab';
import { OverviewTab } from './OverviewTab';
import { RepairTab } from './RepairTab';
import { UrgencyTab } from './UrgencyTab';
import { ScrollBlur } from '../ScrollBlur';
import { Icon, LEVEL_COLOR, Pill } from './ui';
import { useSelectedAnalysis, useSimulation } from './useAnalysis';

const { systemById } = vesselModel;

/** Just long enough for the sling's launch burst to show before the panel swaps its footer. */
const LAUNCH_DELAY_MS = 220;

const TABS: readonly { id: AnalysisTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'impact', label: 'Impact' },
  { id: 'access', label: 'Access' },
  { id: 'repair', label: 'Repair' },
  { id: 'urgency', label: 'Urgency' },
];

/**
 * The analysis side panel: one component, five views of what its failure
 * means. Everything shown is computed live by the graph engine in `lib/engine`
 * from the modeled vessel data.
 */
export function AnalysisPanel(): React.ReactElement | null {
  const analysis = useSelectedAnalysis();
  const simulation = useSimulation();
  const tab = useVesselStore((state) => state.analysisTab);
  const setTab = useVesselStore((state) => state.setAnalysisTab);
  const select = useVesselStore((state) => state.select);
  const simulatedFailureId = useVesselStore((state) => state.simulatedFailureId);
  const simulateFailure = useVesselStore((state) => state.simulateFailure);
  const clearSimulation = useVesselStore((state) => state.clearSimulation);
  const cutSide = useVesselStore((state) => state.cutSide);
  const setCutSide = useVesselStore((state) => state.setCutSide);
  const scrollRef = useRef<HTMLDivElement>(null);
  const launchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const asideRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownId = analysis?.component.id ?? null;

  // A launch pending for one component must not fire after the user has moved
  // on to another (or closed the panel, which only renders null here).
  useEffect(() => () => clearTimeout(launchTimer.current), [shownId]);

  // When the shown component changes from inside the panel (Enter on a cascade
  // row), the focused row disappears; keep keyboard focus in the panel.
  useEffect(() => {
    const active = document.activeElement;
    if (shownId && (active === document.body || (active && asideRef.current?.contains(active) && !active.isConnected))) {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [shownId]);

  if (!analysis) return null;
  const { component, urgency } = analysis;
  const system = systemById.get(component.systemId);
  const isFailed = simulatedFailureId === component.id;
  const lostInSimulation = !isFailed && Boolean(simulation?.impact.lostById.has(component.id));
  const state = isFailed ? 'failure' : lostInSimulation ? 'lost' : 'normal';
  const tabIndex = Math.max(0, TABS.findIndex((t) => t.id === tab));

  const changeTab = (next: AnalysisTab): void => {
    setTab(next);
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <aside
      ref={asideRef}
      data-state={state}
      className="glass-luminous dd-panel-in pointer-events-auto flex max-h-full w-[24rem] flex-col rounded-xl max-md:fixed! max-md:inset-x-3 max-md:top-auto max-md:bottom-3 max-md:max-h-[58dvh] max-md:w-auto"
    >
      {/* Header */}
      <header className="relative border-b border-hairline/80 px-5 pt-4 pb-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.18em] text-accent">{component.id}</p>
            <h2
              ref={headingRef}
              tabIndex={-1}
              key={component.id}
              className="dd-rise mt-1 text-[15px] leading-snug font-semibold text-ink outline-none"
            >
              {component.name}
            </h2>
            {system ? (
              <p className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-muted">
                <span aria-hidden="true" className="size-2 rotate-45" style={{ backgroundColor: system.hudColor }} />
                {system.name}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => select(null)}
              aria-label="Close panel"
              className="rounded-md p-1 text-ink-faint transition-colors hover:bg-hairline/60 hover:text-ink"
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            {isFailed ? (
              <Pill color="#ff4d5e" pulse>
                Failed
              </Pill>
            ) : lostInSimulation ? (
              <Pill color="#ffb03a" pulse>
                Lost in cascade
              </Pill>
            ) : (
              <Pill color="#3fe08f">Operational</Pill>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-muted">
          <span className="hud-label">Urgency if it fails</span>
          <span className="font-mono text-xs" style={{ color: LEVEL_COLOR[urgency.level] }}>
            {urgency.score}
          </span>
          <span
            aria-hidden="true"
            className="h-1 flex-1 overflow-hidden rounded-full bg-hairline/70"
          >
            <span
              className="dd-grow block h-full rounded-full"
              style={{ width: `${urgency.score}%`, backgroundColor: LEVEL_COLOR[urgency.level] }}
            />
          </span>
        </div>
      </header>

      {/* The hull is never opened automatically; offer it when it hides the part. */}
      {cutSide === 'both' && isInsideHull(component, vesselModel.vessel.hull) ? (
        <div className="flex items-center gap-2 border-b border-hairline/80 px-5 py-2 text-[10.5px] text-ink-muted">
          <span className="size-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" aria-hidden="true" />
          <span className="min-w-0 flex-1">Inside the hull, shown in x-ray.</span>
          <span className="font-mono text-[9px] tracking-[0.12em] text-ink-faint uppercase">Open</span>
          {(['starboard', 'port'] as const).map((side) => (
            <button
              key={side}
              type="button"
              onClick={() => setCutSide(side)}
              className="rounded-sm border border-hairline-bright px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-ink uppercase transition-colors hover:border-accent/60 hover:text-accent"
            >
              {side === 'starboard' ? 'Stbd' : 'Port'}
            </button>
          ))}
        </div>
      ) : null}

      {/* Tabs */}
      <nav className="relative border-b border-hairline/80 px-2 py-1.5" aria-label="Analysis views">
        <div className="relative grid grid-cols-5">
          <span
            aria-hidden="true"
            className="dd-tab-indicator absolute inset-y-0 left-0 w-1/5 rounded-md border border-accent/40 bg-accent/10 shadow-[0_0_18px_-6px_var(--color-accent)]"
            style={{ transform: `translateX(${tabIndex * 100}%)` }}
          />
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => changeTab(t.id)}
              aria-pressed={tab === t.id}
              className={`relative z-10 flex flex-col items-center gap-1 rounded-md px-1 py-1.5 font-mono text-[9.5px] tracking-[0.12em] uppercase transition-colors ${
                tab === t.id ? 'text-accent' : 'text-ink-faint hover:text-ink'
              }`}
            >
              <Icon name={t.id} className="size-4" />
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <ScrollBlur ref={scrollRef} wrapperClassName="flex-1" className="px-5 py-4">
        <div key={tab} className="dd-rise">
          {tab === 'overview' && <OverviewTab analysis={analysis} />}
          {tab === 'impact' && <ImpactTab analysis={analysis} />}
          {tab === 'access' && <AccessTab analysis={analysis} />}
          {tab === 'repair' && <RepairTab analysis={analysis} />}
          {tab === 'urgency' && <UrgencyTab analysis={analysis} />}
        </div>
      </ScrollBlur>

      {/* Action */}
      <footer className="border-t border-hairline/80 p-3">
        {isFailed ? (
          <button
            type="button"
            onClick={clearSimulation}
            className="dd-sheen flex w-full items-center justify-center gap-2 rounded-lg border border-hairline-bright bg-panel-raised/70 px-4 py-2.5 font-mono text-[11px] tracking-[0.16em] text-ink uppercase transition-colors hover:border-accent/60 hover:text-accent"
          >
            <Icon name="reset" className="size-4" />
            Restore component
          </button>
        ) : (
          // React Bits SlingButton: pull the pad back and let go to fire the
          // failure, or just press it (click, Enter or Space).
          <div className="flex items-center gap-4 rounded-lg border border-state-fail/25 bg-state-fail/[0.06] py-2.5 pr-4 pl-3.5">
            <SlingButton
              ariaLabel={`Simulate failure of ${component.name}`}
              onSend={() => {
                clearTimeout(launchTimer.current);
                launchTimer.current = setTimeout(() => simulateFailure(component.id), LAUNCH_DELAY_MS);
              }}
              size={42}
              strokeWidth={2.5}
              padColor="#ff4d5e"
              iconColor="#ffffff"
              accentColor="#ff8a3d"
              wellColor="#2a1520"
              bandColor="#6b3040"
              armAt={34}
              maxPull={84}
              flight={96}
              particles={12}
            >
              <HugeiconsIcon icon={FlashIcon} size={18} strokeWidth={2.2} />
            </SlingButton>
            <div className="min-w-0">
              <p className="font-mono text-[11px] font-medium tracking-[0.16em] text-ink uppercase">Simulate failure</p>
              <p className="mt-0.5 text-[10.5px] leading-snug text-ink-faint">Pull back and release the pad, or just press it.</p>
            </div>
          </div>
        )}
      </footer>
    </aside>
  );
}
