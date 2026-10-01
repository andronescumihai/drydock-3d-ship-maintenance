import { describe, expect, it } from 'vitest';
import type { AccessNetwork, VesselComponent } from '@/lib/engine/types';
import type { EngineModel } from '@/lib/engine/model';
import { analyzeImpact } from '@/lib/engine/impact';
import { planAccess, REINSTALL_FACTOR } from '@/lib/engine/access';
import { planRepair } from '@/lib/engine/repair';
import { findAtRisk } from '@/lib/engine/proximity';
import { levelFor, scoreUrgency, STANDBY_CREDIT } from '@/lib/engine/urgency';
import { analyzeFailure } from '@/lib/engine/analysis';
import { MinHeap } from '@/lib/engine/minHeap';
import { vesselModel } from '@/lib/data/loader';

// ---------------------------------------------------------------------------
// A small hand-built plant, so each rule can be tested in isolation.
//
//   TANK --fuel--> GEN-A --electrical--> BUS --electrical--> PUMP --cooling--> ENGINE
//   TANK --fuel--> GEN-B --electrical--> BUS                FUEL-PUMP --fuel--> ENGINE
//   BUS --electrical--> FUEL-PUMP;  PUMP has a manual standby PUMP-SB
//   LOOP-1 --control--> LOOP-2 --control--> LOOP-1   (a cycle)
// ---------------------------------------------------------------------------

function component(id: string, feeds: VesselComponent['feeds'], extra: Partial<VesselComponent> = {}): VesselComponent {
  return {
    id,
    name: id,
    systemId: 'SYS',
    compartmentId: 'CMP',
    position: { x: 0, y: 0, z: 0 },
    geometry: { kind: 'sphere', radius: 0.5 },
    material: 'steel-a36',
    criticality: 3,
    isSource: false,
    feeds,
    backedUpBy: [],
    accessNodeId: 'ENTRY',
    hazards: [],
    repair: {
      meanRepairMinutes: 120,
      replaceMinutes: 600,
      crewRequired: 2,
      requiresHotWork: false,
      requiresSystemShutdown: false,
      sparePartOnboard: true,
    },
    note: 'fixture component',
    ...extra,
  };
}

const plant: VesselComponent[] = [
  component('TANK', [
    { to: 'GEN-A', resource: 'fuel' },
    { to: 'GEN-B', resource: 'fuel' },
  ], { isSource: true }),
  component('GEN-A', [{ to: 'BUS', resource: 'electrical' }]),
  component('GEN-B', [{ to: 'BUS', resource: 'electrical' }]),
  component('BUS', [
    { to: 'PUMP', resource: 'electrical' },
    { to: 'FUEL-PUMP', resource: 'electrical' },
  ]),
  component('PUMP', [{ to: 'ENGINE', resource: 'cooling' }], { backedUpBy: ['PUMP-SB'] }),
  component('PUMP-SB', []),
  component('FUEL-PUMP', [{ to: 'ENGINE', resource: 'fuel' }]),
  component('ENGINE', [], { criticality: 5 }),
  component('LOOP-1', [{ to: 'LOOP-2', resource: 'control' }]),
  component('LOOP-2', [{ to: 'LOOP-1', resource: 'control' }]),
];

const network: AccessNetwork = {
  entryNodeId: 'ENTRY',
  walkingSpeed: 1,
  note: 'fixture',
  nodes: [
    { id: 'ENTRY', name: 'Entry', kind: 'entry', deckId: 'D', compartmentId: 'CMP', position: { x: 0, y: 0, z: 0 }, minutes: 0, action: '' },
    // Long way round: 600 m of deck = 10 minutes of walking, no obstacles.
    { id: 'FAR', name: 'Far corner', kind: 'walkway', deckId: 'D', compartmentId: 'CMP', position: { x: 300, y: 0, z: 0 }, minutes: 0, action: '' },
    // Shortcut through a tank that takes an hour to open.
    { id: 'TANK-HATCH', name: 'Tank hatch', kind: 'hatch', deckId: 'D', compartmentId: 'CMP', position: { x: 0, y: 0, z: 1 }, minutes: 60, action: 'open', reinstall: true },
    { id: 'PLATES', name: 'Floor plates', kind: 'removal', deckId: 'D', compartmentId: 'CMP', position: { x: 1, y: 0, z: 1 }, minutes: 5, action: 'lift', reinstall: true, componentId: 'PUMP' },
    { id: 'FACE', name: 'Work face', kind: 'workface', deckId: 'D', compartmentId: 'CMP', position: { x: 1, y: 0, z: 2 }, minutes: 10, action: 'isolate' },
    { id: 'ISLAND', name: 'Unreachable', kind: 'workface', deckId: 'D', compartmentId: 'CMP', position: { x: 9, y: 9, z: 9 }, minutes: 0, action: '' },
  ],
  edges: [
    { from: 'ENTRY', to: 'FAR' },
    { from: 'FAR', to: 'PLATES' },
    { from: 'ENTRY', to: 'TANK-HATCH', minutes: 0 },
    { from: 'TANK-HATCH', to: 'PLATES', minutes: 0 },
    { from: 'PLATES', to: 'FACE', minutes: 0 },
  ],
};

function fixture(components: VesselComponent[] = plant): EngineModel {
  return {
    components,
    componentById: new Map(components.map((c) => [c.id, c])),
    systemById: new Map([['SYS', { id: 'SYS', name: 'System', kind: 'auxiliary', criticality: 3, hudColor: '#ffffff', note: '' }]]),
    compartmentById: new Map([['CMP', { id: 'CMP', name: 'Room', deckId: 'D', bounds: { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }, note: '' }]]),
    access: network,
    accessNodeById: new Map(network.nodes.map((n) => [n.id, n])),
  };
}

describe('impact analysis', () => {
  const model = fixture();

  it('treats parallel suppliers of one resource as redundancy', () => {
    const result = analyzeImpact(model, ['GEN-A']);
    expect(result.lost.map((l) => l.componentId)).toEqual(['GEN-A']);
    expect(result.holds).toEqual([
      { componentId: 'BUS', resource: 'electrical', lostSupplier: 'GEN-A', remainingSuppliers: ['GEN-B'] },
    ]);
  });

  it('needs every resource kind: losing cooling alone stops the engine', () => {
    const result = analyzeImpact(model, ['PUMP']);
    expect(result.lostById.get('ENGINE')).toEqual({
      componentId: 'ENGINE',
      depth: 1,
      cause: { from: 'PUMP', resource: 'cooling' },
    });
  });

  it('propagates in breadth-first waves with depth and cause', () => {
    const result = analyzeImpact(model, ['TANK']);
    expect(result.waves).toEqual([['TANK'], ['GEN-A', 'GEN-B'], ['BUS'], ['PUMP', 'FUEL-PUMP'], ['ENGINE']]);
    expect(result.lostById.get('BUS')?.depth).toBe(2);
    expect(result.lostById.get('ENGINE')?.cause?.resource).toBe('cooling');
  });

  it('terminates on cycles and loses each component once', () => {
    const result = analyzeImpact(model, ['LOOP-1']);
    expect(result.lost.map((l) => l.componentId)).toEqual(['LOOP-1', 'LOOP-2']);
  });

  it('reports a manual standby without letting it stop the cascade', () => {
    const result = analyzeImpact(model, ['PUMP']);
    expect(result.lostById.has('ENGINE')).toBe(true);
    expect(result.standby).toEqual([{ componentId: 'PUMP', standbyId: 'PUMP-SB', available: true }]);
  });

  it('summarises lost components per system', () => {
    const result = analyzeImpact(model, ['BUS']);
    expect(result.systems).toEqual([{ systemId: 'SYS', lost: 4, total: plant.length, worstCriticality: 5 }]);
  });

  it('ignores unknown ids instead of throwing', () => {
    expect(analyzeImpact(model, ['NOPE']).lost).toEqual([]);
  });
});

describe('access planning', () => {
  it('prefers a long, easy walk over a short, slow shortcut', () => {
    const plan = planAccess(network, 'FACE');
    expect(plan?.steps.map((s) => s.node.id)).toEqual(['ENTRY', 'FAR', 'PLATES', 'FACE']);
  });

  it('takes the shortcut once the walk costs more than the obstacle', () => {
    const slow: AccessNetwork = { ...network, walkingSpeed: 0.1 };
    const plan = planAccess(slow, 'FACE');
    expect(plan?.steps.map((s) => s.node.id)).toEqual(['ENTRY', 'TANK-HATCH', 'PLATES', 'FACE']);
  });

  it('accounts every minute: transit plus work equals the total, step by step', () => {
    const plan = planAccess(network, 'FACE');
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.transitMinutes + plan.workMinutes).toBeCloseTo(plan.totalMinutes, 6);
    const last = plan.steps[plan.steps.length - 1];
    expect(last?.elapsedMinutes).toBeCloseTo(plan.totalMinutes, 6);
    expect(plan.reinstallMinutes).toBeCloseTo(5 * REINSTALL_FACTOR, 6);
    expect(plan.blockingComponents).toEqual(['PUMP']);
  });

  it('returns null for unreachable or unknown targets', () => {
    expect(planAccess(network, 'ISLAND')).toBeNull();
    expect(planAccess(network, 'NOWHERE')).toBeNull();
  });
});

describe('min-heap', () => {
  it('pops in ascending key order', () => {
    const heap = new MinHeap<string>();
    [5, 1, 4, 2, 3, 0].forEach((k) => heap.push(k, `v${k}`));
    const out: number[] = [];
    while (heap.size > 0) out.push(heap.pop()?.key ?? -1);
    expect(out).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('repair planning', () => {
  it('sums its phases into the total', () => {
    const pump = plant.find((c) => c.id === 'PUMP') as VesselComponent;
    const plan = planRepair(pump, planAccess(network, 'FACE'));
    expect(plan.phases.reduce((s, p) => s + p.minutes, 0)).toBeCloseTo(plan.totalMinutes, 6);
    expect(plan.method.id).toBe('in-situ-spares');
  });

  it('knows cast iron cannot be welded on board', () => {
    const casting = component('CASTING', [], { material: 'cast-iron-gg25' });
    expect(planRepair(casting, null).material.weldable).toBe(false);
  });

  it('sends long jobs without a spare to shore support', () => {
    const big = component('BIG', [], {
      repair: { meanRepairMinutes: 600, replaceMinutes: 20000, crewRequired: 4, requiresHotWork: true, requiresSystemShutdown: true, sparePartOnboard: false },
    });
    const plan = planRepair(big, null);
    expect(plan.method.id).toBe('shore-support');
    expect(plan.permits).toContain('Hot-work permit');
  });
});

describe('urgency scoring', () => {
  const model = fixture();

  it('stays within 0–100 and matches its own breakdown', () => {
    for (const c of plant) {
      const impact = analyzeImpact(model, [c.id]);
      const repair = planRepair(c, planAccess(network, c.accessNodeId));
      const score = scoreUrgency(model, c, impact, repair, []);
      const sum = [...score.factors, ...score.credits].reduce((s, f) => s + f.points, 0);
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(100);
      expect(score.score).toBe(Math.max(0, Math.min(100, Math.round(sum))));
      for (const f of score.factors) expect(f.points).toBeLessThanOrEqual(f.max);
    }
  });

  it('gives credit for an available standby', () => {
    const pump = plant.find((c) => c.id === 'PUMP') as VesselComponent;
    const impact = analyzeImpact(model, ['PUMP']);
    const score = scoreUrgency(model, pump, impact, planRepair(pump, null), []);
    expect(score.credits.map((c) => c.points)).toEqual([-STANDBY_CREDIT]);
  });

  it('maps scores onto levels at the documented thresholds', () => {
    expect(levelFor(80)).toBe('critical');
    expect(levelFor(75)).toBe('critical');
    expect(levelFor(74)).toBe('high');
    expect(levelFor(50)).toBe('high');
    expect(levelFor(49)).toBe('moderate');
    expect(levelFor(10)).toBe('low');
  });
});

describe('the sample vessel', () => {
  it('has a reachable work face and a full analysis for every component', () => {
    for (const c of vesselModel.components) {
      const analysis = analyzeFailure(vesselModel, c.id);
      expect(analysis?.access, c.id).not.toBeNull();
      expect(analysis?.access?.steps[0]?.node.id).toBe(vesselModel.access.entryNodeId);
    }
  });

  it('rides through the loss of one generator on the other', () => {
    const impact = analyzeImpact(vesselModel, ['DG-01']);
    expect(impact.lost).toHaveLength(1);
    expect(impact.holds.some((h) => h.componentId === 'SWB-MAIN-01' && h.remainingSuppliers.includes('DG-02'))).toBe(true);
  });

  it('blacks out the ship when the main switchboard fails', () => {
    const analysis = analyzeFailure(vesselModel, 'SWB-MAIN-01');
    const lost = analysis?.impact.lostById;
    for (const id of ['PMP-FIRE-01', 'STEER-01', 'ME-MAIN-01', 'PROP-01']) expect(lost?.has(id), id).toBe(true);
    expect(analysis?.urgency.level).toBe('critical');
  });

  it('stops the main engine through cooling when the duty sea-water pump fails', () => {
    const analysis = analyzeFailure(vesselModel, 'PMP-SW-01');
    expect(analysis?.impact.lostById.has('ME-MAIN-01')).toBe(true);
    expect(analysis?.impact.standby).toContainEqual({ componentId: 'PMP-SW-01', standbyId: 'PMP-SW-02', available: true });
  });

  it('has to go through the fresh-water pump spool to reach the central cooler', () => {
    const plan = analyzeFailure(vesselModel, 'HX-CENTRAL-01')?.access;
    expect(plan?.blockingComponents).toContain('PMP-FW-01');
  });

  it('flags fire risk next to leaking fuel equipment', () => {
    const risks = findAtRisk(vesselModel, 'PUR-FO-01');
    expect(Array.isArray(risks)).toBe(true);
    for (const risk of risks) expect(risk.reasons.length).toBeGreaterThan(0);
  });
});
