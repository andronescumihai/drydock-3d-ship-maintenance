/**
 * Loads the modeled sample vessel from JSON, validates it, and exposes it as
 * an indexed, read-only model.
 *
 * Two validation passes run here:
 *   1. Shape validation (Zod) — is each record well formed?
 *   2. Referential validation — do the ids actually point at something, and do
 *      the components sit inside the compartments they claim to be in?
 *
 * Both run at import time, so a broken model fails immediately and loudly
 * rather than producing an empty graph at runtime.
 */

import type {
  AccessNetwork,
  AccessNode,
  AccessNodeId,
  Compartment,
  CompartmentId,
  ComponentId,
  Deck,
  DeckId,
  ShipSystem,
  SystemId,
  Vessel,
  VesselComponent,
} from '@/lib/engine/types';
import { accessNetworkSchema, componentsSchema, systemsSchema, vesselSchema } from './schema';

import vesselJson from './vessel.json';
import systemsJson from './systems.json';
import componentsJson from './components.json';
import accessJson from './access.json';

export class VesselDataError extends Error {
  public readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid vessel model (${issues.length} issue(s)):\n  - ${issues.join('\n  - ')}`);
    this.name = 'VesselDataError';
    this.issues = issues;
  }
}

export interface VesselModel {
  readonly vessel: Vessel;
  readonly systems: readonly ShipSystem[];
  readonly components: readonly VesselComponent[];
  readonly systemById: ReadonlyMap<SystemId, ShipSystem>;
  readonly componentById: ReadonlyMap<ComponentId, VesselComponent>;
  readonly compartmentById: ReadonlyMap<CompartmentId, Compartment>;
  readonly deckById: ReadonlyMap<DeckId, Deck>;
  /** Components grouped by the compartment they live in, for proximity queries. */
  readonly componentsByCompartment: ReadonlyMap<CompartmentId, readonly VesselComponent[]>;
  /** Doors, hatches, ladders and removable obstacles between the gangway and every work face. */
  readonly access: AccessNetwork;
  readonly accessNodeById: ReadonlyMap<AccessNodeId, AccessNode>;
}

/** Tolerance, in metres, when checking that a component sits in its compartment. */
const BOUNDS_TOLERANCE_M = 0.5;

function findDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

function crossValidate(
  vessel: Vessel,
  systems: readonly ShipSystem[],
  components: readonly VesselComponent[],
): string[] {
  const issues: string[] = [];

  for (const dup of findDuplicates(systems.map((s) => s.id))) issues.push(`duplicate system id "${dup}"`);
  for (const dup of findDuplicates(components.map((c) => c.id))) issues.push(`duplicate component id "${dup}"`);
  for (const dup of findDuplicates(vessel.decks.map((d) => d.id))) issues.push(`duplicate deck id "${dup}"`);
  for (const dup of findDuplicates(vessel.compartments.map((c) => c.id))) {
    issues.push(`duplicate compartment id "${dup}"`);
  }

  const deckIds = new Set(vessel.decks.map((d) => d.id));
  const compartmentIds = new Set(vessel.compartments.map((c) => c.id));
  const systemIds = new Set(systems.map((s) => s.id));
  const componentIds = new Set(components.map((c) => c.id));

  for (const compartment of vessel.compartments) {
    if (!deckIds.has(compartment.deckId)) {
      issues.push(`compartment "${compartment.id}" references unknown deck "${compartment.deckId}"`);
    }
  }

  const compartmentById = new Map(vessel.compartments.map((c) => [c.id, c]));

  for (const component of components) {
    if (!systemIds.has(component.systemId)) {
      issues.push(`component "${component.id}" references unknown system "${component.systemId}"`);
    }

    const compartment = compartmentById.get(component.compartmentId);
    if (!compartment) {
      issues.push(
        `component "${component.id}" references unknown compartment "${component.compartmentId}"`,
      );
    } else {
      const { min, max } = compartment.bounds;
      const { position: p } = component;
      const outside =
        p.x < min.x - BOUNDS_TOLERANCE_M ||
        p.x > max.x + BOUNDS_TOLERANCE_M ||
        p.y < min.y - BOUNDS_TOLERANCE_M ||
        p.y > max.y + BOUNDS_TOLERANCE_M ||
        p.z < min.z - BOUNDS_TOLERANCE_M ||
        p.z > max.z + BOUNDS_TOLERANCE_M;
      if (outside) {
        issues.push(
          `component "${component.id}" at (${p.x}, ${p.y}, ${p.z}) lies outside compartment "${compartment.id}"`,
        );
      }
    }

    for (const edge of component.feeds) {
      if (!componentIds.has(edge.to)) {
        issues.push(`component "${component.id}" feeds unknown component "${edge.to}"`);
      }
      if (edge.to === component.id) {
        issues.push(`component "${component.id}" feeds itself`);
      }
    }

    for (const standbyId of component.backedUpBy) {
      if (!componentIds.has(standbyId)) {
        issues.push(`component "${component.id}" names unknown standby "${standbyId}"`);
      }
      if (standbyId === component.id) {
        issues.push(`component "${component.id}" is listed as its own standby`);
      }
    }

    if (component.isSource && component.feeds.length === 0) {
      issues.push(`component "${component.id}" is marked as a source but supplies nothing`);
    }
  }

  return issues;
}

/**
 * Referential checks for the access network: every id resolves, every node
 * sits on the deck its compartment belongs to, and every component's work face
 * can actually be reached from the gangway — an unreachable work face would
 * otherwise surface as a blank access plan in the UI.
 */
function crossValidateAccess(
  vessel: Vessel,
  components: readonly VesselComponent[],
  access: AccessNetwork,
): string[] {
  const issues: string[] = [];
  for (const dup of findDuplicates(access.nodes.map((n) => n.id))) issues.push(`duplicate access node id "${dup}"`);

  const nodeIds = new Set(access.nodes.map((n) => n.id));
  const componentIds = new Set(components.map((c) => c.id));
  const compartmentById = new Map(vessel.compartments.map((c) => [c.id, c]));

  if (!nodeIds.has(access.entryNodeId)) issues.push(`access entry node "${access.entryNodeId}" does not exist`);

  for (const node of access.nodes) {
    const compartment = compartmentById.get(node.compartmentId);
    if (!compartment) {
      issues.push(`access node "${node.id}" references unknown compartment "${node.compartmentId}"`);
    } else if (compartment.deckId !== node.deckId) {
      issues.push(`access node "${node.id}" is on deck "${node.deckId}" but its compartment is on "${compartment.deckId}"`);
    }
    if (node.componentId && !componentIds.has(node.componentId)) {
      issues.push(`access node "${node.id}" references unknown component "${node.componentId}"`);
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of access.edges) {
    if (!nodeIds.has(edge.from)) issues.push(`access edge references unknown node "${edge.from}"`);
    if (!nodeIds.has(edge.to)) issues.push(`access edge references unknown node "${edge.to}"`);
    if (edge.from === edge.to) issues.push(`access edge "${edge.from}" loops onto itself`);
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge.from]);
  }

  const reached = new Set<string>([access.entryNodeId]);
  const queue = [access.entryNodeId];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    for (const next of adjacency.get(current) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }

  for (const component of components) {
    if (!nodeIds.has(component.accessNodeId)) {
      issues.push(`component "${component.id}" names unknown access node "${component.accessNodeId}"`);
    } else if (!reached.has(component.accessNodeId)) {
      issues.push(`component "${component.id}" work face "${component.accessNodeId}" cannot be reached from the gangway`);
    }
  }
  return issues;
}

/**
 * Parses and validates the raw JSON. Exported separately from the memoised
 * model so tests can feed it fixtures.
 */
export function buildVesselModel(
  rawVessel: unknown,
  rawSystems: unknown,
  rawComponents: unknown,
  rawAccess: unknown = accessJson,
): VesselModel {
  const vesselResult = vesselSchema.safeParse(rawVessel);
  const systemsResult = systemsSchema.safeParse(rawSystems);
  const componentsResult = componentsSchema.safeParse(rawComponents);
  const accessResult = accessNetworkSchema.safeParse(rawAccess);

  const shapeIssues: string[] = [];
  if (!vesselResult.success) {
    shapeIssues.push(...vesselResult.error.issues.map((i) => `vessel.json: ${i.path.join('.')} — ${i.message}`));
  }
  if (!systemsResult.success) {
    shapeIssues.push(...systemsResult.error.issues.map((i) => `systems.json: ${i.path.join('.')} — ${i.message}`));
  }
  if (!componentsResult.success) {
    shapeIssues.push(
      ...componentsResult.error.issues.map((i) => `components.json: ${i.path.join('.')} — ${i.message}`),
    );
  }
  if (!accessResult.success) {
    shapeIssues.push(...accessResult.error.issues.map((i) => `access.json: ${i.path.join('.')} — ${i.message}`));
  }
  if (shapeIssues.length > 0) throw new VesselDataError(shapeIssues);

  // Safe: every result was checked above.
  const vessel = vesselResult.data as Vessel;
  const systems = systemsResult.data as readonly ShipSystem[];
  const components = componentsResult.data as readonly VesselComponent[];
  const access = accessResult.data as AccessNetwork;

  const refIssues = [...crossValidate(vessel, systems, components), ...crossValidateAccess(vessel, components, access)];
  if (refIssues.length > 0) throw new VesselDataError(refIssues);

  const componentsByCompartment = new Map<CompartmentId, VesselComponent[]>();
  for (const component of components) {
    const bucket = componentsByCompartment.get(component.compartmentId);
    if (bucket) bucket.push(component);
    else componentsByCompartment.set(component.compartmentId, [component]);
  }

  return {
    vessel,
    systems,
    components,
    systemById: new Map(systems.map((s) => [s.id, s])),
    componentById: new Map(components.map((c) => [c.id, c])),
    compartmentById: new Map(vessel.compartments.map((c) => [c.id, c])),
    deckById: new Map(vessel.decks.map((d) => [d.id, d])),
    componentsByCompartment,
    access,
    accessNodeById: new Map(access.nodes.map((n) => [n.id, n])),
  };
}

/** The validated model for the bundled sample vessel. */
export const vesselModel: VesselModel = buildVesselModel(vesselJson, systemsJson, componentsJson);
