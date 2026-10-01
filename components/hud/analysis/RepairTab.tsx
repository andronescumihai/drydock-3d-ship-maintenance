'use client';

import type { FailureAnalysis } from '@/lib/engine/analysis';
import type { RepairPhaseId } from '@/lib/engine/repair';
import { MATERIAL_LABELS, formatDuration } from '@/lib/engine/labels';
import { Icon, Pill, SectionLabel, StatTile, rise } from './ui';

const PHASE_COLOR: Record<RepairPhaseId, string> = {
  access: '#38d6f2',
  isolation: '#a98bff',
  repair: '#ff8a3d',
  reassembly: '#5b8cff',
  testing: '#3fe08f',
};

/** Material, repair method and the whole job laid out end to end. */
export function RepairTab({ analysis }: { analysis: FailureAnalysis }): React.ReactElement {
  const { repair, component } = analysis;
  const total = Math.max(repair.totalMinutes, 1);

  return (
    <div className="space-y-5">
      <div className="dd-rise rounded-md border border-hairline/80 bg-panel-raised/40 px-3.5 py-3">
        <p className="hud-label mb-1">Repair method</p>
        <p className="text-[13px] font-medium text-ink">{repair.method.label}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{repair.method.summary}</p>
      </div>

      <div className="dd-rise rounded-md border border-hairline/80 bg-panel-raised/40 px-3.5 py-3" style={rise(1)}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="hud-label">Material</p>
          <Pill color={repair.material.weldable ? '#3fe08f' : '#ffb03a'}>
            {repair.material.weldable ? 'weldable' : 'no welding'}
          </Pill>
        </div>
        <p className="text-[13px] font-medium text-ink">{MATERIAL_LABELS[component.material]}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{repair.material.technique}</p>
      </div>

      <div>
        <SectionLabel aside={<span className="font-mono text-[11px] text-ink">{formatDuration(repair.totalMinutes)}</span>}>
          Gangway to handover
        </SectionLabel>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-hairline/60">
          {repair.phases.map((phase, index) =>
            phase.minutes > 0 ? (
              <span
                key={phase.id}
                className="dd-grow h-full first:rounded-l-full last:rounded-r-full"
                style={{
                  width: `${(phase.minutes / total) * 100}%`,
                  backgroundColor: PHASE_COLOR[phase.id],
                  boxShadow: `0 0 10px -2px ${PHASE_COLOR[phase.id]}`,
                  animationDelay: `${0.15 + index * 0.12}s`,
                }}
                title={`${phase.label}: ${formatDuration(phase.minutes)}`}
              />
            ) : null,
          )}
        </div>
        <ul className="mt-3 space-y-2">
          {repair.phases.map((phase, index) => (
            <li key={phase.id} className="dd-rise flex items-start gap-2.5" style={rise(index + 2, 0.06)}>
              <span aria-hidden="true" className="mt-1 size-2 shrink-0 rounded-sm" style={{ backgroundColor: PHASE_COLOR[phase.id] }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs text-ink">{phase.label}</p>
                  <span className="shrink-0 font-mono text-[10.5px] text-ink-muted">{formatDuration(phase.minutes)}</span>
                </div>
                <p className="text-[10.5px] leading-relaxed text-ink-faint">{phase.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Crew" index={8}>
          {repair.crew}
        </StatTile>
        <StatTile label="Spare" index={9} tone={repair.spareOnboard ? '#3fe08f' : '#ffb03a'}>
          {repair.spareOnboard ? 'Onboard' : 'None'}
        </StatTile>
        <StatTile label="Replace" index={10}>
          {formatDuration(repair.replaceMinutes)}
        </StatTile>
      </div>

      {repair.permits.length > 0 && (
        <div className="dd-rise" style={rise(11)}>
          <SectionLabel>Permits & isolation</SectionLabel>
          <ul className="space-y-1.5">
            {repair.permits.map((permit) => (
              <li key={permit} className="flex items-center gap-2 text-xs text-ink-muted">
                <span className="text-accent">
                  <Icon name="shield" className="size-3" />
                </span>
                {permit}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
