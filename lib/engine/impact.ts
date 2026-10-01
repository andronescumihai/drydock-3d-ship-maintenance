/**
 * Impact analysis: what else stops when a component fails.
 *
 * THE RULE. Every supply edge carries a resource kind (electrical, fuel,
 * cooling, …). A component needs ALL the kinds it consumes, but within one kind
 * ANY live supplier is enough. Losing the fresh-water cooling stops the main
 * engine even though its fuel is fine; losing one of two generators feeding the
 * same switchboard stops nothing, because the other still supplies that kind.
 *
 * THE ALGORITHM. For every (consumer, kind) pair we keep a count of suppliers
 * still alive. Failures propagate breadth-first: when a component is lost, the
 * count on each of its outgoing edges drops by one, and a consumer whose count
 * for some kind reaches zero is lost in turn. Each edge is visited at most
 * once, so the whole cascade is O(V + E) — the same idea as Kahn's topological
 * sort, run on the failure front. Cycles (the switchboard powers the fuel
 * separator that fuels the generators that feed the switchboard) need no
 * special handling: a component is only ever lost once.
 *
 * Breadth-first order also gives each loss a DEPTH — how many hops from the
 * original failure — which the UI uses to animate the cascade in waves, and a
 * CAUSE, the supplier and resource that finally starved it.
 *
 * MANUAL STANDBY (`backedUpBy`) is deliberately NOT redundancy: a standby pump
 * does nothing until the crew starts it, so the cascade still happens. It is
 * reported separately, and the urgency score gives credit for it.
 */

import type { ComponentId, ResourceKind, SystemId, VesselComponent } from './types';
import type { EngineModel } from './model';

export interface Cause {
  /** The supplier whose loss starved this component. */
  readonly from: ComponentId;
  readonly resource: ResourceKind;
}

export interface LostComponent {
  readonly componentId: ComponentId;
  /** 0 for the component that failed, 1 for what it fed directly, and so on. */
  readonly depth: number;
  /** Null for the initiating failure. */
  readonly cause: Cause | null;
}

export interface RedundancyHold {
  /** A consumer that lost a supplier but kept running on another. */
  readonly componentId: ComponentId;
  readonly resource: ResourceKind;
  readonly lostSupplier: ComponentId;
  readonly remainingSuppliers: readonly ComponentId[];
}

export interface StandbyOption {
  /** A lost component that has a manual standby. */
  readonly componentId: ComponentId;
  readonly standbyId: ComponentId;
  /** False if the standby is itself lost in the same cascade. */
  readonly available: boolean;
}

export interface SystemImpact {
  readonly systemId: SystemId;
  readonly lost: number;
  readonly total: number;
  /** Highest criticality among this system's lost components. */
  readonly worstCriticality: number;
}

export interface ImpactResult {
  readonly initiators: readonly ComponentId[];
  /** Every lost component, initiators included, in breadth-first order. */
  readonly lost: readonly LostComponent[];
  readonly lostById: ReadonlyMap<ComponentId, LostComponent>;
  /** Lost components grouped by depth: waves[0] are the initiators. */
  readonly waves: readonly (readonly ComponentId[])[];
  readonly holds: readonly RedundancyHold[];
  readonly standby: readonly StandbyOption[];
  readonly systems: readonly SystemImpact[];
}

export interface DependencyIndex {
  /** Outgoing edges: who each component supplies, and with what. */
  readonly consumersOf: ReadonlyMap<ComponentId, readonly { to: ComponentId; resource: ResourceKind }[]>;
  /** Incoming edges grouped by kind: who supplies each component with each resource. */
  readonly suppliersOf: ReadonlyMap<ComponentId, ReadonlyMap<ResourceKind, readonly ComponentId[]>>;
}

/** Builds the forward and reverse edge indices once; reuse it across analyses. */
export function buildDependencyIndex(components: readonly VesselComponent[]): DependencyIndex {
  const consumersOf = new Map<ComponentId, { to: ComponentId; resource: ResourceKind }[]>();
  const suppliersOf = new Map<ComponentId, Map<ResourceKind, ComponentId[]>>();

  for (const component of components) {
    for (const edge of component.feeds) {
      const out = consumersOf.get(component.id) ?? [];
      // Two edges of the same kind to the same consumer count once.
      if (!out.some((e) => e.to === edge.to && e.resource === edge.resource)) out.push({ ...edge });
      consumersOf.set(component.id, out);

      const byKind = suppliersOf.get(edge.to) ?? new Map<ResourceKind, ComponentId[]>();
      const list = byKind.get(edge.resource) ?? [];
      if (!list.includes(component.id)) list.push(component.id);
      byKind.set(edge.resource, list);
      suppliersOf.set(edge.to, byKind);
    }
  }
  return { consumersOf, suppliersOf };
}

const indexCache = new WeakMap<readonly VesselComponent[], DependencyIndex>();

function indexFor(components: readonly VesselComponent[]): DependencyIndex {
  let index = indexCache.get(components);
  if (!index) {
    index = buildDependencyIndex(components);
    indexCache.set(components, index);
  }
  return index;
}

/**
 * Propagates the failure of `failedIds` through the dependency graph.
 * Unknown ids are ignored rather than thrown on, so a stale selection in the UI
 * can never crash the analysis.
 */
export function analyzeImpact(model: EngineModel, failedIds: readonly ComponentId[]): ImpactResult {
  const { consumersOf, suppliersOf } = indexFor(model.components);

  // Live supplier counts per (consumer, kind).
  const alive = new Map<ComponentId, Map<ResourceKind, number>>();
  for (const [consumer, byKind] of suppliersOf) {
    alive.set(consumer, new Map([...byKind].map(([kind, list]) => [kind, list.length])));
  }

  const lostById = new Map<ComponentId, LostComponent>();
  const order: LostComponent[] = [];
  const queue: LostComponent[] = [];
  const initiators = [...new Set(failedIds)].filter((id) => model.componentById.has(id));

  for (const id of initiators) {
    const entry: LostComponent = { componentId: id, depth: 0, cause: null };
    lostById.set(id, entry);
    order.push(entry);
    queue.push(entry);
  }

  const holdsByKey = new Map<string, RedundancyHold>();

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (!current) break;
    for (const edge of consumersOf.get(current.componentId) ?? []) {
      if (lostById.has(edge.to)) continue;
      const counts = alive.get(edge.to);
      const remaining = (counts?.get(edge.resource) ?? 1) - 1;
      counts?.set(edge.resource, remaining);

      if (remaining <= 0) {
        const entry: LostComponent = {
          componentId: edge.to,
          depth: current.depth + 1,
          cause: { from: current.componentId, resource: edge.resource },
        };
        lostById.set(edge.to, entry);
        order.push(entry);
        queue.push(entry);
        holdsByKey.delete(`${edge.to}|${edge.resource}`);
      } else {
        const suppliers = suppliersOf.get(edge.to)?.get(edge.resource) ?? [];
        holdsByKey.set(`${edge.to}|${edge.resource}`, {
          componentId: edge.to,
          resource: edge.resource,
          lostSupplier: current.componentId,
          remainingSuppliers: suppliers.filter((id) => !lostById.has(id)),
        });
      }
    }
  }

  // A hold recorded early may have been overtaken by a later loss of the same
  // consumer through another kind; keep only consumers that really survived.
  const holds = [...holdsByKey.values()].filter((hold) => !lostById.has(hold.componentId));

  const waves: ComponentId[][] = [];
  for (const entry of order) {
    (waves[entry.depth] ??= []).push(entry.componentId);
  }

  const standby: StandbyOption[] = [];
  for (const entry of order) {
    const component = model.componentById.get(entry.componentId);
    for (const standbyId of component?.backedUpBy ?? []) {
      standby.push({ componentId: entry.componentId, standbyId, available: !lostById.has(standbyId) });
    }
  }

  const bySystem = new Map<SystemId, { lost: number; total: number; worst: number }>();
  for (const component of model.components) {
    const stats = bySystem.get(component.systemId) ?? { lost: 0, total: 0, worst: 0 };
    stats.total += 1;
    if (lostById.has(component.id)) {
      stats.lost += 1;
      stats.worst = Math.max(stats.worst, component.criticality);
    }
    bySystem.set(component.systemId, stats);
  }
  const systems: SystemImpact[] = [...bySystem]
    .filter(([, stats]) => stats.lost > 0)
    .map(([systemId, stats]) => ({ systemId, lost: stats.lost, total: stats.total, worstCriticality: stats.worst }))
    .sort((a, b) => b.worstCriticality - a.worstCriticality || b.lost - a.lost);

  return { initiators, lost: order, lostById, waves, holds, standby, systems };
}
