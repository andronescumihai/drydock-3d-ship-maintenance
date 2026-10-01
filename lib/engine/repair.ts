/**
 * Repair planning: what kind of job it is, and how long it really takes.
 *
 * The component's own repair time is only the middle of the job. Before it:
 * getting there and opening up (from the access plan), then isolation and
 * permits. After it: putting back everything removed on the way, then testing
 * before the system is handed back. Those phases are often longer than the
 * repair itself, which is the point of showing them.
 */

import type { Material, VesselComponent } from './types';
import type { AccessPlan } from './access';

export type RepairPhaseId = 'access' | 'isolation' | 'repair' | 'reassembly' | 'testing';

export interface RepairPhase {
  readonly id: RepairPhaseId;
  readonly label: string;
  readonly minutes: number;
  readonly detail: string;
}

export type RepairMethodId = 'in-situ-spares' | 'in-situ-no-spare' | 'shore-support';

export interface RepairMethod {
  readonly id: RepairMethodId;
  readonly label: string;
  readonly summary: string;
}

export interface MaterialGuidance {
  /** What can realistically be done with this material on board. */
  readonly technique: string;
  readonly weldable: boolean;
}

export interface RepairPlan {
  readonly method: RepairMethod;
  readonly material: MaterialGuidance;
  readonly phases: readonly RepairPhase[];
  readonly totalMinutes: number;
  readonly crew: number;
  readonly hotWork: boolean;
  readonly shutdown: boolean;
  readonly spareOnboard: boolean;
  /** Full replacement, for comparison (excluding access and testing). */
  readonly replaceMinutes: number;
  /** Permits the job needs before anyone lifts a spanner. */
  readonly permits: readonly string[];
}

export const MATERIAL_GUIDANCE: Readonly<Record<Material, MaterialGuidance>> = {
  'steel-a36': {
    technique: 'Weld repair in situ is possible: hot-work permit, fire watch and gas-free surroundings.',
    weldable: true,
  },
  'stainless-316l': {
    technique: 'TIG weld repair possible; keep carbon-steel tools off it to avoid contamination.',
    weldable: true,
  },
  'cast-iron-gg25': {
    technique: 'Not weldable on board. Cold metal-stitching of cracks, or replacement of the casting.',
    weldable: false,
  },
  'bronze-b62': {
    technique: 'Replace worn parts (impeller, wear rings) or braze; bronze resists sea-water corrosion.',
    weldable: false,
  },
  'copper-nickel-9010': {
    technique: 'Cut out and replace the pipe section with brazed fittings; no hot work near fuel lines.',
    weldable: false,
  },
  'titanium-gr1': {
    technique: 'Plates are replaced, not repaired: titanium cannot be welded on board.',
    weldable: false,
  },
  'aluminium-5083': {
    technique: 'MIG weld with a fire watch; isolate from steel to prevent galvanic corrosion.',
    weldable: true,
  },
  'rubber-epdm': { technique: 'Replace the element; elastomers are not repaired.', weldable: false },
  'grp-composite': { technique: 'Laminate repair with a resin kit; allow cure time before loading.', weldable: false },
};

/** Jobs longer than this without a spare are treated as needing shore support. */
const SHORE_SUPPORT_MINUTES = 3 * 24 * 60;

export function planRepair(component: VesselComponent, access: AccessPlan | null): RepairPlan {
  const { repair, hazards } = component;
  const permits: string[] = [];
  if (repair.requiresHotWork) permits.push('Hot-work permit');
  if (hazards.includes('confined-space')) permits.push('Enclosed-space entry permit');
  if (hazards.includes('arc-flash')) permits.push('Electrical isolation (LOTO) certificate');
  if (repair.requiresSystemShutdown) permits.push('System shutdown approved by the chief engineer');
  if (hazards.includes('flooding')) permits.push('Sea-valve isolation confirmed tight');

  let isolation = 10;
  if (repair.requiresSystemShutdown) isolation += 20;
  if (repair.requiresHotWork) isolation += 30;
  if (hazards.includes('confined-space')) isolation += 20;
  if (hazards.includes('arc-flash')) isolation += 10;

  const accessMinutes = access?.totalMinutes ?? 0;
  const reassembly = access?.reinstallMinutes ?? 0;
  const testing = 15 + component.criticality * 5;

  const phases: RepairPhase[] = [
    {
      id: 'access',
      label: 'Access & opening up',
      minutes: accessMinutes,
      detail: access
        ? `${access.obstacles.length} obstacles on a ${Math.round(access.distanceMetres)} m route`
        : 'No modelled route',
    },
    { id: 'isolation', label: 'Isolation & permits', minutes: isolation, detail: permits.join(' · ') || 'Local isolation only' },
    {
      id: 'repair',
      label: repair.sparePartOnboard ? 'Repair with onboard spares' : 'Repair of the existing part',
      minutes: repair.meanRepairMinutes,
      detail: `${repair.crewRequired} crew`,
    },
    { id: 'reassembly', label: 'Reassembly', minutes: reassembly, detail: 'Refit everything removed on the way in' },
    { id: 'testing', label: 'Testing & recommissioning', minutes: testing, detail: 'Run-up, leak and load tests' },
  ];

  const total = phases.reduce((sum, phase) => sum + phase.minutes, 0);

  let method: RepairMethod;
  if (repair.sparePartOnboard) {
    method = {
      id: 'in-situ-spares',
      label: 'In-situ repair with onboard spares',
      summary: 'The crew can complete the job at sea with parts carried on board.',
    };
  } else if (repair.replaceMinutes >= SHORE_SUPPORT_MINUTES) {
    method = {
      id: 'shore-support',
      label: 'Temporary repair, then shore support',
      summary: 'No spare on board and a replacement takes days: repair to get by, plan the replacement for the next port or dry-dock.',
    };
  } else {
    method = {
      id: 'in-situ-no-spare',
      label: 'In-situ repair, no spare on board',
      summary: 'The existing part has to be repaired; order a spare at the next port.',
    };
  }

  return {
    method,
    material: MATERIAL_GUIDANCE[component.material],
    phases,
    totalMinutes: total,
    crew: repair.crewRequired,
    hotWork: repair.requiresHotWork,
    shutdown: repair.requiresSystemShutdown,
    spareOnboard: repair.sparePartOnboard,
    replaceMinutes: repair.replaceMinutes,
    permits,
  };
}
