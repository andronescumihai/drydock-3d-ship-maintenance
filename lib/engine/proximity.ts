/**
 * Collateral risk: what is physically in danger around a failed component.
 *
 * The dependency graph says what stops working; this says what might get
 * DAMAGED. It is a linear scan over the components near the failure (the ship
 * has dozens, not millions — an index would be ceremony), scoring each by
 * distance and by how the failure's hazards interact with the neighbour's:
 * sea water reaching electrical gear below a flooding leak, fuel spray landing
 * on a hot surface, the blast radius of an arc flash.
 */

import type { ComponentId, Hazard, VesselComponent } from './types';
import type { EngineModel } from './model';

export type RiskSeverity = 'high' | 'medium' | 'low';

export interface AtRiskComponent {
  readonly componentId: ComponentId;
  /** Centre-to-centre distance, metres. */
  readonly distance: number;
  readonly severity: RiskSeverity;
  readonly reasons: readonly string[];
}

/** Neighbours further than this are not considered at all. */
export const PROXIMITY_RADIUS = 6;

const RANK: Record<RiskSeverity, number> = { high: 3, medium: 2, low: 1 };

function dist(a: VesselComponent, b: VesselComponent): number {
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  const dz = a.position.z - b.position.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function has(component: VesselComponent, hazard: Hazard): boolean {
  return component.hazards.includes(hazard);
}

export function findAtRisk(model: EngineModel, failedId: ComponentId): readonly AtRiskComponent[] {
  const failed = model.componentById.get(failedId);
  if (!failed) return [];
  const failedDeck = model.compartmentById.get(failed.compartmentId)?.deckId;
  const electrical = (c: VesselComponent): boolean =>
    model.systemById.get(c.systemId)?.kind === 'electrical' || has(c, 'arc-flash');

  const results: AtRiskComponent[] = [];
  for (const other of model.components) {
    if (other.id === failed.id) continue;
    const d = dist(failed, other);
    if (d > PROXIMITY_RADIUS) continue;
    // Same deck, or directly below a leak: plating in between stops the rest.
    const otherDeck = model.compartmentById.get(other.compartmentId)?.deckId;
    const below = other.position.y < failed.position.y;
    if (otherDeck !== failedDeck && !(has(failed, 'flooding') && below)) continue;

    const reasons: string[] = [];
    let severity: RiskSeverity = 'low';
    const raise = (level: RiskSeverity, reason: string): void => {
      reasons.push(reason);
      if (RANK[level] > RANK[severity]) severity = level;
    };

    if (has(failed, 'flooding') && other.position.y <= failed.position.y + 0.5) {
      if (electrical(other)) raise('high', 'Sea water can reach live electrical equipment');
      else raise('medium', 'In the flood path of the leak');
    }
    if (has(failed, 'fuel-spill') && has(other, 'hot-surface')) {
      raise('high', 'Fire risk: fuel spray onto a hot surface');
    }
    if (has(failed, 'hot-surface') && has(other, 'fuel-spill') && d < 4) {
      raise('high', 'Fire risk: fuel equipment next to a hot surface');
    }
    if (has(failed, 'arc-flash') && d < 3) raise('medium', 'Inside the arc-flash boundary');
    if (has(failed, 'pressurised') && d < 3) raise('medium', 'Burst or projectile risk from a pressurised failure');
    if (d < 2.5 && reasons.length === 0) raise('low', 'Close enough to be disturbed by the repair');

    if (reasons.length > 0) {
      results.push({ componentId: other.id, distance: Number(d.toFixed(2)), severity, reasons });
    }
  }

  return results.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.distance - b.distance);
}
