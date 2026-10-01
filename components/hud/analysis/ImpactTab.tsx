'use client';

import { vesselModel } from '@/lib/data/loader';
import type { FailureAnalysis } from '@/lib/engine/analysis';
import { RESOURCE_LABELS } from '@/lib/engine/labels';
import { useVesselStore } from '@/lib/state/useVesselStore';
import { Bar, CountUp, Icon, Pill, SEVERITY_COLOR, SectionLabel, rise } from './ui';

const { componentById, systemById } = vesselModel;

/** The cascade, wave by wave, and what holds, what can be restored, what is in danger. */
export function ImpactTab({ analysis }: { analysis: FailureAnalysis }): React.ReactElement {
  const { impact, atRisk, component } = analysis;
  const selectPiece = useVesselStore((state) => state.selectPiece);
  const cascade = impact.lost.length - 1;
  const standby = impact.standby.filter((s) => s.componentId === component.id);

  return (
    <div className="space-y-5">
      <div className="dd-rise rounded-md border border-hairline/80 bg-panel-raised/40 px-3.5 py-3">
        {cascade > 0 ? (
          <p className="text-[13px] leading-snug text-ink">
            <span className="font-mono text-state-high">
              <CountUp value={cascade} />
            </span>{' '}
            more component{cascade === 1 ? '' : 's'} stop across{' '}
            <span className="font-mono text-state-high">{impact.systems.length}</span> system
            {impact.systems.length === 1 ? '' : 's'}, in {impact.waves.length - 1} wave
            {impact.waves.length === 2 ? '' : 's'}.
          </p>
        ) : (
          <p className="flex items-center gap-2 text-[13px] leading-snug text-ink">
            <span className="text-state-ok">
              <Icon name="shield" className="size-4" />
            </span>
            {impact.holds.length > 0 ? 'Nothing else stops — redundancy holds.' : 'Nothing else depends on it.'}
          </p>
        )}
      </div>

      {impact.systems.length > 0 && (
        <div>
          <SectionLabel>Systems affected</SectionLabel>
          <ul className="space-y-2.5">
            {impact.systems.map((entry, index) => {
              const system = systemById.get(entry.systemId);
              return (
                <li key={entry.systemId} className="dd-rise" style={rise(index + 1, 0.06)}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-2 text-ink-muted">
                      <span aria-hidden="true" className="size-2 rotate-45" style={{ backgroundColor: system?.hudColor }} />
                      {system?.name ?? entry.systemId}
                    </span>
                    <span className="font-mono text-[10px] text-ink-faint">
                      {entry.lost}/{entry.total} down
                    </span>
                  </div>
                  <Bar fraction={entry.lost / entry.total} color={system?.hudColor ?? '#ff8a3d'} delay={0.1 + index * 0.06} />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <SectionLabel>Failure cascade</SectionLabel>
        <ol className="relative space-y-3 pl-5">
          <span aria-hidden="true" className="dd-flow-line absolute top-1 bottom-1 left-[5px] w-px text-state-fail/70" />
          {impact.waves.map((wave, depth) => (
            <li key={depth} className="dd-rise relative" style={rise(depth + 2, 0.12)}>
              <span
                aria-hidden="true"
                className="absolute top-1 -left-5 size-[11px] rounded-full border-2"
                style={{
                  borderColor: depth === 0 ? '#ff4d5e' : '#ff8a3d',
                  backgroundColor: depth === 0 ? '#ff4d5e55' : '#ff8a3d33',
                }}
              />
              <p className="hud-label mb-1.5">{depth === 0 ? 'Failure' : `Wave ${depth}`}</p>
              <ul className="space-y-1">
                {wave.map((id) => {
                  const lost = impact.lostById.get(id);
                  const item = componentById.get(id);
                  const cause = lost?.cause;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => selectPiece(id, null)}
                        className="group flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-hairline/50"
                      >
                        <span className="flex-1 truncate text-ink group-hover:text-accent">{item?.name ?? id}</span>
                        {cause ? (
                          <span className="shrink-0 font-mono text-[9.5px] text-ink-faint">
                            no {RESOURCE_LABELS[cause.resource].toLowerCase()}
                          </span>
                        ) : (
                          <Pill color="#ff4d5e">failed</Pill>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      </div>

      {standby.length > 0 && (
        <div className="dd-rise rounded-md border border-state-ok/30 bg-state-ok/5 px-3.5 py-3" style={rise(4)}>
          <p className="hud-label mb-1 text-state-ok">Recovery option</p>
          {standby.map((option) => (
            <p key={option.standbyId} className="text-xs leading-relaxed text-ink-muted">
              {option.available ? 'Start the standby ' : 'Standby unavailable: '}
              <span className="text-ink">{componentById.get(option.standbyId)?.name ?? option.standbyId}</span>
              {option.available ? ' to restore the supply — the cascade above is what happens until the crew does.' : ' is lost too.'}
            </p>
          ))}
        </div>
      )}

      {impact.holds.length > 0 && (
        <div>
          <SectionLabel>Kept running by redundancy</SectionLabel>
          <ul className="space-y-1.5">
            {impact.holds.map((hold, index) => (
              <li key={`${hold.componentId}-${hold.resource}`} className="dd-rise flex items-baseline gap-2 text-xs" style={rise(index + 3)}>
                <span className="text-state-ok">
                  <Icon name="shield" className="size-3" />
                </span>
                <span className="flex-1 truncate text-ink-muted">{componentById.get(hold.componentId)?.name}</span>
                <span className="font-mono text-[9.5px] text-ink-faint">
                  via {hold.remainingSuppliers.map((id) => componentById.get(id)?.name ?? id).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <SectionLabel aside={<span className="font-mono text-[10px] text-ink-faint">within 6 m</span>}>At risk nearby</SectionLabel>
        {atRisk.length === 0 ? (
          <p className="text-xs text-ink-faint">No neighbouring equipment is exposed.</p>
        ) : (
          <ul className="space-y-2">
            {atRisk.slice(0, 6).map((risk, index) => (
              <li
                key={risk.componentId}
                className="dd-rise rounded-md border border-hairline/70 bg-panel-raised/30 px-3 py-2"
                style={rise(index + 4)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-ink">{componentById.get(risk.componentId)?.name}</span>
                  <Pill color={SEVERITY_COLOR[risk.severity]}>{risk.severity}</Pill>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                  {risk.reasons.join(' · ')} · {risk.distance.toFixed(1)} m
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
