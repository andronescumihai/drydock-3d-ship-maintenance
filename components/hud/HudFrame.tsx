'use client';

import { useEffect, useState } from 'react';
import { vesselModel } from '@/lib/data/loader';
import { useVesselStore } from '@/lib/state/useVesselStore';
import { AnalysisPanel } from './analysis/AnalysisPanel';
import { SimulationBanner } from './analysis/SimulationBanner';
import { DisclaimerTag } from './DisclaimerTag';
import { LeftColumn } from './LeftColumn';
import { FrameStats } from './FrameStats';
import { DayNightSwitch } from './DayNightSwitch';

const { vessel } = vesselModel;

/**
 * The HUD overlay.
 *
 * The whole layer is pointer-events-none so the canvas underneath keeps every
 * drag and scroll; individual panels opt back in. Without that the ship stops
 * rotating wherever a panel happens to sit.
 */
export function HudFrame(): React.ReactElement {
  const selectedId = useVesselStore((state) => state.selectedId);
  // On a phone the controls fold away behind a button; from md up they are always shown.
  const [controlsOpen, setControlsOpen] = useState(false);
  // On a phone the analysis sheet and the controls would stack; picking a part folds the controls away.
  useEffect(() => {
    if (selectedId && window.matchMedia('(max-width: 767px)').matches) setControlsOpen(false);
  }, [selectedId]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
      <div className="pointer-events-none absolute inset-x-3 top-[5.25rem] z-20 flex justify-center md:inset-x-auto md:top-auto md:right-[26.5rem] md:bottom-[4.25rem] md:left-[19.5rem]">
        <SimulationBanner />
      </div>

      <header className="pointer-events-none flex items-start justify-between gap-4 p-4">
        <div className="flex min-w-0 items-start gap-2">
          <div className="glass-panel hud-brackets pointer-events-auto min-w-0 rounded-sm px-4 py-2.5">
            <p className="font-mono text-xs tracking-[0.2em] text-ink">
              DRY<span className="text-accent">DOCK</span>
            </p>
            <p className="mt-0.5 truncate text-[11px] text-ink-muted">
              {vessel.name}
              <span className="max-sm:hidden"> · {vessel.type}</span>
            </p>
          </div>
          <DayNightSwitch />
          <button
            type="button"
            onClick={() => setControlsOpen((open) => !open)}
            aria-expanded={controlsOpen}
            aria-controls="hud-controls"
            className="glass-panel pointer-events-auto rounded-sm px-3 py-2.5 font-mono text-[10px] tracking-[0.16em] text-accent uppercase md:hidden"
          >
            {controlsOpen ? 'Hide' : 'Controls'}
          </button>
        </div>

        <DisclaimerTag />
        {/* Below md the crumple tag would crowd the header; the notice stays, as plain text. */}
        <p
          className="glass-panel pointer-events-auto max-w-[11rem] shrink-0 rounded-sm border-warm/40 px-3 py-2 font-mono text-[9px] leading-relaxed tracking-[0.14em] text-warm md:hidden"
          title={vessel.disclaimer}
        >
          ▲ MODELED SAMPLE VESSEL · SIMULATION
        </p>
      </header>

      <div className="flex flex-1 items-start justify-between gap-4 overflow-hidden px-4 pb-4">
        <div id="hud-controls" className={`${controlsOpen ? 'flex' : 'hidden'} max-h-full min-h-0 md:flex`}>
          <LeftColumn />
        </div>
        <AnalysisPanel />
      </div>

      <FrameStats />

      <footer className="pointer-events-none flex justify-center pb-4 max-md:hidden">
        <p className="glass-panel pointer-events-auto rounded-sm px-4 py-2 font-mono text-[10px] tracking-[0.14em] text-ink-faint">
          {selectedId
            ? 'CLICK AGAIN FOR A PART · CLICK EMPTY SPACE TO DESELECT · DRAG TO ORBIT'
            : 'CLICK A COMPONENT TO INSPECT · SLIDE TO OPEN THE DECKS · DRAG TO ORBIT'}
        </p>
      </footer>
    </div>
  );
}
