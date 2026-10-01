'use client';

import { vesselModel } from '@/lib/data/loader';
import type { FailureAnalysis } from '@/lib/engine/analysis';
import {
  CRITICALITY_LABELS,
  HAZARD_LABELS,
  MATERIAL_LABELS,
  RESOURCE_LABELS,
  formatDuration,
  formatPosition,
} from '@/lib/engine/labels';
import { CountUp, LEVEL_COLOR, SectionLabel, StatTile, rise } from './ui';

const { componentById, compartmentById, deckById } = vesselModel;

/** What the model knows about the part, plus a one-glance verdict from the engine. */
export function OverviewTab({ analysis }: { analysis: FailureAnalysis }): React.ReactElement {
  const { component, impact, access, repair, urgency } = analysis;
  const compartment = compartmentById.get(component.compartmentId);
  const deck = compartment ? deckById.get(compartment.deckId) : undefined;
  const suppliers = vesselModel.components.filter((c) => c.feeds.some((edge) => edge.to === component.id));
  const cascade = impact.lost.length - 1;

  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>If it fails</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Urgency" tone={LEVEL_COLOR[urgency.level]} index={0}>
            <CountUp value={urgency.score} /> <span className="text-[10px] text-ink-faint">/ 100</span>
          </StatTile>
          <StatTile label="Also stops" tone={cascade > 0 ? '#ff8a3d' : '#3fe08f'} index={1}>
            <CountUp value={cascade} /> <span className="text-[10px] text-ink-faint">components</span>
          </StatTile>
          <StatTile label="Reach it" index={2}>
            {access ? formatDuration(access.totalMinutes) : '—'}
          </StatTile>
          <StatTile label="Back in service" index={3}>
            {formatDuration(repair.totalMinutes)}
          </StatTile>
        </div>
      </div>

      <dl className="dd-rise grid grid-cols-2 gap-px overflow-hidden rounded-md border border-hairline/80 bg-hairline/70" style={rise(4)}>
        <Field label="Material" value={MATERIAL_LABELS[component.material]} />
        <Field label="Criticality" value={`${CRITICALITY_LABELS[component.criticality]} (${component.criticality}/5)`} />
        <Field label="Repair (in situ)" value={formatDuration(component.repair.meanRepairMinutes)} />
        <Field label="Replace" value={formatDuration(component.repair.replaceMinutes)} />
        <Field label="Crew" value={`${component.repair.crewRequired}`} />
        <Field label="Spare onboard" value={component.repair.sparePartOnboard ? 'Yes' : 'No'} />
      </dl>

      <div className="dd-rise" style={rise(5)}>
        <SectionLabel>Location</SectionLabel>
        <p className="text-xs leading-relaxed text-ink-muted">
          {compartment?.name ?? 'Unknown compartment'}
          {deck ? ` · ${deck.name}` : ''}
        </p>
        <p className="mt-1 font-mono text-[11px] text-ink-faint">
          {formatPosition(component.position.x, component.position.y, component.position.z)}
        </p>
      </div>

      {(suppliers.length > 0 || component.feeds.length > 0) && (
        <div className="dd-rise" style={rise(6)}>
          <SectionLabel>Dependencies</SectionLabel>
          <ul className="space-y-1.5 text-xs">
            {suppliers.map((source) => (
              <li key={`in-${source.id}`} className="flex items-baseline gap-2 text-ink-muted">
                <span aria-hidden="true" className="text-accent">&larr;</span>
                <span className="flex-1 truncate">{source.name}</span>
                <span className="font-mono text-[10px] text-ink-faint">
                  {RESOURCE_LABELS[source.feeds.find((e) => e.to === component.id)?.resource ?? 'control']}
                </span>
              </li>
            ))}
            {component.feeds.map((edge) => (
              <li key={`out-${edge.to}`} className="flex items-baseline gap-2 text-ink-muted">
                <span aria-hidden="true" className="text-warm">&rarr;</span>
                <span className="flex-1 truncate">{componentById.get(edge.to)?.name ?? edge.to}</span>
                <span className="font-mono text-[10px] text-ink-faint">{RESOURCE_LABELS[edge.resource]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {component.hazards.length > 0 && (
        <div className="dd-rise" style={rise(7)}>
          <SectionLabel>Hazards</SectionLabel>
          <ul className="flex flex-wrap gap-1.5">
            {component.hazards.map((hazard) => (
              <li
                key={hazard}
                className="rounded-full border border-warm/40 bg-warm/10 px-2.5 py-0.5 font-mono text-[10px] tracking-wide text-warm"
              >
                {HAZARD_LABELS[hazard]}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="dd-rise" style={rise(8)}>
        <SectionLabel>Modeling note</SectionLabel>
        <p className="text-[11px] leading-relaxed text-ink-faint">{component.note}</p>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="bg-panel/90 px-3.5 py-2.5">
      <dt className="hud-label">{label}</dt>
      <dd className="mt-0.5 font-mono text-[11px] text-ink">{value}</dd>
    </div>
  );
}
