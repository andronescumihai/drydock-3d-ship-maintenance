'use client';

import { vesselModel } from '@/lib/data/loader';
import { useVesselStore } from '@/lib/state/useVesselStore';
import { Panel } from '@/components/ui/Panel';

/**
 * Systems legend and visibility filter.
 *
 * Colour identifies a system, never a condition — condition is carried by the
 * status label and icon in the component card, so the interface stays readable
 * without relying on colour vision.
 */
export function SystemLegend(): React.ReactElement {
  const visibleSystemIds = useVesselStore((state) => state.visibleSystemIds);
  const toggleSystem = useVesselStore((state) => state.toggleSystem);
  const showAllSystems = useVesselStore((state) => state.showAllSystems);
  const showCompartments = useVesselStore((state) => state.showCompartments);
  const setShowCompartments = useVesselStore((state) => state.setShowCompartments);
  const showStructure = useVesselStore((state) => state.showStructure);
  const setShowStructure = useVesselStore((state) => state.setShowStructure);

  const allVisible = visibleSystemIds.size === vesselModel.systems.length;

  return (
    <Panel
      title="Systems"
      aside={
        <button
          type="button"
          onClick={showAllSystems}
          disabled={allVisible}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent transition-opacity hover:opacity-70 disabled:opacity-25"
        >
          Show all
        </button>
      }
      className="w-72"
    >
      <ul className="p-2">
        {vesselModel.systems.map((system) => {
          const visible = visibleSystemIds.has(system.id);
          const count = vesselModel.components.filter((c) => c.systemId === system.id).length;

          return (
            <li key={system.id}>
              <button
                type="button"
                onClick={() => toggleSystem(system.id)}
                aria-pressed={visible}
                className="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left transition-colors hover:bg-panel-raised focus-visible:outline-1 focus-visible:outline-accent"
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rotate-45 border transition-opacity"
                  style={{
                    borderColor: system.hudColor,
                    backgroundColor: visible ? system.hudColor : 'transparent',
                    opacity: visible ? 1 : 0.45,
                  }}
                />
                <span
                  className={`flex-1 truncate text-xs ${visible ? 'text-ink' : 'text-ink-faint line-through decoration-ink-faint/50'}`}
                >
                  {system.name}
                </span>
                <span className="font-mono text-[10px] text-ink-faint">{count}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-hairline p-3">
        <p className="hud-label mb-2">Structure</p>
        <div className="flex flex-col gap-1.5">
          <ToggleRow label="Compartments" checked={showCompartments} onChange={setShowCompartments} />
          <ToggleRow label="Hull framing" checked={showStructure} onChange={setShowStructure} />
        </div>
      </div>
    </Panel>
  );
}

interface ToggleRowProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
}

function ToggleRow({ label, checked, onChange }: ToggleRowProps): React.ReactElement {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-xs text-ink-muted">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 cursor-pointer appearance-none rounded-[2px] border border-hairline-bright bg-transparent checked:border-accent checked:bg-accent/70 focus-visible:outline-1 focus-visible:outline-accent"
      />
    </label>
  );
}
