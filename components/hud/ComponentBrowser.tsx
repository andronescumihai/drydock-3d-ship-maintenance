'use client';

import { useMemo } from 'react';
import type { IconSvgElement } from '@hugeicons/react';
import {
  AirVentIcon,
  AnchorIcon,
  AnchorPointIcon,
  AntennaIcon,
  ContainerIcon,
  CraneIcon,
  CylinderIcon,
  EngineIcon,
  Fan02Icon,
  FilterIcon,
  FlashIcon,
  GearsIcon,
  LifebuoyIcon,
  OilBarrelIcon,
  PipelineIcon,
  PowerSocket01Icon,
  ShipWheelIcon,
  SteeringIcon,
  ThermometerSnowflakeIcon,
  WaterPumpIcon,
  WavesIcon,
  WindIcon,
  WindPowerIcon,
} from '@hugeicons/core-free-icons';
import BranchedMenu, { type BranchedMenuItem } from '@/components/reactbits/BranchedMenu';
import { Panel } from '@/components/ui/Panel';
import { vesselModel } from '@/lib/data/loader';
import { useVesselStore } from '@/lib/state/useVesselStore';
import { ScrollBlur } from './ScrollBlur';

/** One icon per equipment archetype; anything unlisted falls back to a cylinder. */
const ARCHETYPE_ICON: Record<string, IconSvgElement> = {
  'centrifugal-pump': WaterPumpIcon,
  bollard: AnchorPointIcon,
  tank: OilBarrelIcon,
  'generator-set': FlashIcon,
  switchboard: PowerSocket01Icon,
  'plate-heat-exchanger': ThermometerSnowflakeIcon,
  purifier: FilterIcon,
  'air-compressor': AirVentIcon,
  'hatch-cover': ContainerIcon,
  'deck-crane': CraneIcon,
  'mooring-winch': GearsIcon,
  mast: AntennaIcon,
  lifeboat: LifebuoyIcon,
  'sea-chest': WavesIcon,
  'medium-speed-diesel': EngineIcon,
  'shaft-line': PipelineIcon,
  'steering-gear': SteeringIcon,
  rudder: ShipWheelIcon,
  propeller: Fan02Icon,
  'bow-thruster': WindPowerIcon,
  windlass: AnchorIcon,
  funnel: WindIcon,
};

/**
 * Every modeled component, grouped by system, as a branching tree (React Bits
 * BranchedMenu). Picking a leaf selects that component exactly as a click in
 * the 3D view would, and a click in the view unfolds and highlights its leaf,
 * so the two stay in step.
 */
export function ComponentBrowser(): React.ReactElement {
  const selectedId = useVesselStore((state) => state.selectedId);
  const selectPiece = useVesselStore((state) => state.selectPiece);
  const simulatedFailureId = useVesselStore((state) => state.simulatedFailureId);

  const items = useMemo<BranchedMenuItem[]>(
    () =>
      vesselModel.systems.map((system) => ({
        value: system.id,
        label: (
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="size-1.5 rotate-45" style={{ backgroundColor: system.hudColor }} />
            {system.name}
          </span>
        ),
        children: vesselModel.components
          .filter((component) => component.systemId === system.id)
          .map((component) => ({
            value: component.id,
            label: component.id === simulatedFailureId ? `${component.name} · failed` : component.name,
            icon: (component.archetype && ARCHETYPE_ICON[component.archetype]) || CylinderIcon,
          })),
      })),
    [simulatedFailureId],
  );

  return (
    <Panel title="Components" aside={<span className="font-mono text-[10px] text-ink-faint">{vesselModel.components.length}</span>} className="w-72">
      <ScrollBlur className="max-h-[17rem] px-3 py-2">
        <BranchedMenu
          className="dd-branched"
          items={items}
          defaultOpen={-1}
          active={selectedId ?? ''}
          onSelect={(id) => selectPiece(id, null)}
          color="#e9f2f9"
          accentColor="#38d6f2"
          lineColor="#2c4058"
          width={252}
          rowHeight={28}
          indent={34}
          trunk={10}
          radius={8}
          fontSize={12}
        />
      </ScrollBlur>
    </Panel>
  );
}
