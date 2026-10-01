/**
 * One call that answers "what if this component fails?" — the cascade, the way
 * in, the repair, the collateral risk and the urgency — for the HUD to render.
 */

import type { ComponentId, VesselComponent } from './types';
import type { EngineModel } from './model';
import { analyzeImpact, type ImpactResult } from './impact';
import { planAccess, type AccessPlan } from './access';
import { planRepair, type RepairPlan } from './repair';
import { findAtRisk, type AtRiskComponent } from './proximity';
import { scoreUrgency, type UrgencyScore } from './urgency';

export interface FailureAnalysis {
  readonly component: VesselComponent;
  readonly impact: ImpactResult;
  readonly access: AccessPlan | null;
  readonly repair: RepairPlan;
  readonly atRisk: readonly AtRiskComponent[];
  readonly urgency: UrgencyScore;
}

export function analyzeFailure(model: EngineModel, componentId: ComponentId): FailureAnalysis | null {
  const component = model.componentById.get(componentId);
  if (!component) return null;
  const impact = analyzeImpact(model, [componentId]);
  const access = planAccess(model.access, component.accessNodeId);
  const repair = planRepair(component, access);
  const atRisk = findAtRisk(model, componentId);
  const urgency = scoreUrgency(model, component, impact, repair, atRisk);
  return { component, impact, access, repair, atRisk, urgency };
}
