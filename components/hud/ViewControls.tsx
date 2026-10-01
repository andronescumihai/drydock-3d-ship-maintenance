'use client';

import type { HullSide } from '@/lib/geometry/hullShape';
import { type RenderQuality, useVesselStore } from '@/lib/state/useVesselStore';
import { Panel } from '@/components/ui/Panel';
import JellyRadio from '@/components/reactbits/JellyRadio';
import SloshGauge from '@/components/reactbits/SloshGauge';

const CUT_OPTIONS: readonly { value: HullSide; label: string; hint: string }[] = [
  { value: 'starboard', label: 'FROM STBD', hint: 'Cut the starboard half away and look in from starboard' },
  { value: 'port', label: 'FROM PORT', hint: 'Cut the port half away and look in from port' },
  { value: 'both', label: 'WHOLE', hint: 'Close the hull up again' },
];

const QUALITY_OPTIONS: readonly { value: RenderQuality; label: string; hint: string }[] = [
  { value: 'high', label: 'HIGH', hint: 'Full effects — heaviest on video memory' },
  { value: 'balanced', label: 'BALANCED', hint: 'Full textures and shadows, no post-processing effects' },
  { value: 'performance', label: 'LIGHT', hint: 'No effects or shadows — use this if the image cuts out' },
];

/** Shared look for the React Bits JellyRadio groups: HUD chips, a gentler wobble. */
const JELLY_HUD = {
  size: 'sm',
  chipColor: '#131c2b',
  activeColor: '#38d6f2',
  textColor: '#90a5ba',
  activeTextColor: '#04141b',
  gap: 5,
  radius: 6,
  swell: 0.12,
  barge: 4,
  stagger: 18,
} as const;

/**
 * Controls for opening the model up: how far the decks are pulled apart,
 * which half of the hull is sectioned away, and how heavy the rendering is.
 */
export function ViewControls(): React.ReactElement {
  const explodeAmount = useVesselStore((state) => state.explodeAmount);
  const setExplodeAmount = useVesselStore((state) => state.setExplodeAmount);
  const toggleExplode = useVesselStore((state) => state.toggleExplode);
  const cutSide = useVesselStore((state) => state.cutSide);
  const setCutSide = useVesselStore((state) => state.setCutSide);
  const renderQuality = useVesselStore((state) => state.renderQuality);
  const setRenderQuality = useVesselStore((state) => state.setRenderQuality);

  return (
    <Panel
      title="View"
      aside={
        <button
          type="button"
          onClick={toggleExplode}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent transition-opacity hover:opacity-70"
        >
          {explodeAmount > 0.5 ? 'Close' : 'Explode'}
        </button>
      }
      className="w-72"
    >
      <div className="flex items-center gap-4 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <p className="hud-label">Deck separation</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
            Drag the tank up or down to pull the decks apart. Arrow keys work too.
          </p>
          <div className="mt-2.5 flex gap-1.5">
            {[0, 50, 100].map((stop) => (
              <button
                key={stop}
                type="button"
                onClick={() => setExplodeAmount(stop / 100)}
                className="rounded-sm border border-hairline px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em] text-ink-faint transition-colors hover:border-accent/50 hover:text-accent"
              >
                {stop}%
              </button>
            ))}
          </div>
        </div>
        {/* React Bits SloshGauge: the level is the deck separation, and it sloshes when moved. */}
        <SloshGauge
          className="dd-slosh shrink-0"
          interactive
          value={Math.round(explodeAmount * 100)}
          onChange={(value) => setExplodeAmount(value / 100)}
          liquidColor="#38d6f2"
          glassColor="#0a1220"
          width={62}
          height={104}
          radius={14}
          ticks={4}
          ariaLabel="Deck separation"
        />
      </div>

      <div className="border-t border-hairline px-4 py-3.5">
        <p className="hud-label mb-1">Render quality</p>
        <JellyRadio
          className="jelly-hud"
          ariaLabel="Render quality"
          items={QUALITY_OPTIONS.map((option) => ({
            value: option.value,
            label: <span title={option.hint}>{option.label}</span>,
          }))}
          value={renderQuality}
          onChange={(value) => setRenderQuality(value as RenderQuality)}
          {...JELLY_HUD}
        />
      </div>

      <div className="border-t border-hairline px-4 py-3.5">
        <p className="hud-label mb-1">Section</p>
        <JellyRadio
          className="jelly-hud"
          ariaLabel="Hull section"
          items={CUT_OPTIONS.map((option) => ({
            value: option.value,
            label: <span title={option.hint}>{option.label}</span>,
          }))}
          value={cutSide}
          onChange={(value) => setCutSide(value as HullSide)}
          {...JELLY_HUD}
        />
      </div>
    </Panel>
  );
}
