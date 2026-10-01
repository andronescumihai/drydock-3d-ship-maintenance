'use client';

import { vesselModel } from '@/lib/data/loader';
import type { FailureAnalysis } from '@/lib/engine/analysis';
import type { AccessStep } from '@/lib/engine/access';
import { formatDuration } from '@/lib/engine/labels';
import { useVesselStore } from '@/lib/state/useVesselStore';
import { CountUp, Icon, SectionLabel, StatTile, rise } from './ui';

const { componentById } = vesselModel;

/** Consecutive walkways collapse into one "walk" line; obstacles stay as steps. */
type Row =
  | { kind: 'walk'; metres: number; minutes: number; to: string; key: string }
  | { kind: 'step'; step: AccessStep; number: number; key: string };

function toRows(steps: readonly AccessStep[]): Row[] {
  const rows: Row[] = [];
  let walkMinutes = 0;
  let walkMetres = 0;
  let number = 0;
  steps.forEach((step, index) => {
    walkMinutes += step.transitMinutes;
    walkMetres += step.transitMetres;
    const isWalkway = step.node.kind === 'walkway';
    if (isWalkway) return;
    if (walkMinutes > 0.05 && index > 0) {
      rows.push({ kind: 'walk', metres: walkMetres, minutes: walkMinutes, to: step.node.name, key: `walk-${step.node.id}` });
    }
    walkMinutes = 0;
    walkMetres = 0;
    number += 1;
    rows.push({ kind: 'step', step, number, key: step.node.id });
  });
  return rows;
}

const KIND_COLOR: Record<string, string> = {
  entry: '#38d6f2',
  door: '#90a5ba',
  hatch: '#ffb03a',
  ladder: '#90a5ba',
  stair: '#90a5ba',
  removal: '#ff8a3d',
  workface: '#ff4d5e',
};

/** Shortest dismantling route from the gangway, step by step. */
export function AccessTab({ analysis }: { analysis: FailureAnalysis }): React.ReactElement {
  const { access } = analysis;
  const showAccessPath = useVesselStore((state) => state.showAccessPath);
  const setShowAccessPath = useVesselStore((state) => state.setShowAccessPath);

  if (!access) {
    return <p className="text-xs text-ink-faint">No modelled route reaches this component.</p>;
  }

  const rows = toRows(access.steps);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Time to work face" index={0} tone="#38d6f2">
          {formatDuration(access.totalMinutes)}
        </StatTile>
        <StatTile label="Obstacles" index={1}>
          <CountUp value={access.obstacles.length} />
        </StatTile>
        <StatTile label="Route" index={2}>
          <CountUp value={access.distanceMetres} /> m
        </StatTile>
        <StatTile label="Refit after" index={3}>
          {formatDuration(access.reinstallMinutes)}
        </StatTile>
      </div>

      <button
        type="button"
        onClick={() => setShowAccessPath(!showAccessPath)}
        className={`dd-sheen flex w-full items-center justify-between rounded-md border px-3.5 py-2.5 text-left text-xs transition-colors ${
          showAccessPath ? 'border-accent/60 bg-accent/10 text-accent' : 'border-hairline bg-panel-raised/40 text-ink-muted hover:text-ink'
        }`}
      >
        <span className="flex items-center gap-2">
          <Icon name="access" />
          {showAccessPath ? 'Route shown in 3D' : 'Show route in 3D'}
        </span>
        <span
          aria-hidden="true"
          className={`relative h-4 w-7 rounded-full transition-colors ${showAccessPath ? 'bg-accent/70' : 'bg-hairline'}`}
        >
          <span
            className={`absolute top-0.5 size-3 rounded-full bg-ink transition-transform ${showAccessPath ? 'translate-x-3.5' : 'translate-x-0.5'}`}
          />
        </span>
      </button>

      {access.blockingComponents.length > 0 && (
        <div className="dd-rise rounded-md border border-state-high/35 bg-state-high/5 px-3.5 py-3" style={rise(4)}>
          <p className="hud-label mb-1 text-state-high">Other equipment in the way</p>
          <p className="text-xs leading-relaxed text-ink-muted">
            Partly dismantle{' '}
            {access.blockingComponents.map((id, i) => (
              <span key={id} className="text-ink">
                {i > 0 ? ', ' : ''}
                {componentById.get(id)?.name ?? id}
              </span>
            ))}{' '}
            to get through.
          </p>
        </div>
      )}

      <div>
        <SectionLabel>Route from the gangway</SectionLabel>
        <ol className="relative space-y-1.5 pl-7">
          <span aria-hidden="true" className="dd-flow-line absolute top-2 bottom-2 left-[11px] w-px text-accent/60" />
          {rows.map((row, index) =>
            row.kind === 'walk' ? (
              <li key={row.key} className="dd-rise relative py-0.5 text-[10.5px] text-ink-faint" style={rise(index + 5, 0.05)}>
                <span className="font-mono">
                  walk {Math.round(row.metres)} m · {formatDuration(row.minutes)}
                </span>
              </li>
            ) : (
              <li key={row.key} className="dd-rise relative" style={rise(index + 5, 0.05)}>
                <span
                  className="absolute top-1.5 -left-7 flex size-[22px] items-center justify-center rounded-full border bg-abyss/80"
                  style={{ color: KIND_COLOR[row.step.node.kind] ?? '#90a5ba', borderColor: `${KIND_COLOR[row.step.node.kind] ?? '#90a5ba'}66` }}
                >
                  <Icon name={row.step.node.kind} className="size-3" />
                </span>
                <div className="rounded-md border border-hairline/60 bg-panel-raised/30 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs text-ink">
                      <span className="mr-1.5 font-mono text-[10px] text-ink-faint">{String(row.number).padStart(2, '0')}</span>
                      {row.step.node.name}
                    </p>
                    <span className="shrink-0 font-mono text-[10px] text-accent">
                      {row.step.workMinutes > 0 ? `+${formatDuration(row.step.workMinutes)}` : ''}
                    </span>
                  </div>
                  {row.step.node.action ? (
                    <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">{row.step.node.action}</p>
                  ) : null}
                  <p className="mt-1 font-mono text-[9.5px] tracking-wide text-ink-faint/80">
                    T+{formatDuration(row.step.elapsedMinutes)}
                    {row.step.node.reinstall ? ' · refit after' : ''}
                  </p>
                </div>
              </li>
            ),
          )}
        </ol>
      </div>
    </div>
  );
}
