/**
 * Urgency score, 0–100, with its working shown.
 *
 * A maintenance planner will not act on a number they cannot argue with, so the
 * score is a plain sum of six factors, each with a stated maximum and a
 * sentence saying why it scored what it did — and one explicit credit for a
 * standby the crew can start. The weights are a documented modelling choice
 * for this sample vessel, not an industry standard.
 *
 *   Criticality of the failed component       25
 *   Cascade: what else stops                   25
 *   Vital functions lost (propulsion, …)       20
 *   Time to restore                            12
 *   Logistics (spares, permits, shutdown)      10
 *   Hazards and collateral risk                 8
 *                                             ---
 *                                             100   − standby credit (15)
 */

import type { VesselComponent } from './types';
import type { EngineModel } from './model';
import type { ImpactResult } from './impact';
import type { RepairPlan } from './repair';
import type { AtRiskComponent } from './proximity';

export type UrgencyLevel = 'critical' | 'high' | 'moderate' | 'low';

export interface UrgencyFactor {
  readonly id: string;
  readonly label: string;
  readonly points: number;
  readonly max: number;
  readonly detail: string;
}

export interface UrgencyScore {
  readonly score: number;
  readonly level: UrgencyLevel;
  readonly headline: string;
  readonly factors: readonly UrgencyFactor[];
  /** Deductions, shown as negative points. */
  readonly credits: readonly UrgencyFactor[];
}

export const URGENCY_LEVELS: Readonly<Record<UrgencyLevel, { min: number; headline: string }>> = {
  critical: { min: 75, headline: 'Immediate action — restore before anything else' },
  high: { min: 50, headline: 'Repair this watch' },
  moderate: { min: 25, headline: 'Plan the repair within 24 h' },
  low: { min: 0, headline: 'Schedule with routine maintenance' },
};

export const STANDBY_CREDIT = 15;

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function levelFor(score: number): UrgencyLevel {
  if (score >= URGENCY_LEVELS.critical.min) return 'critical';
  if (score >= URGENCY_LEVELS.high.min) return 'high';
  if (score >= URGENCY_LEVELS.moderate.min) return 'moderate';
  return 'low';
}

/** Vital ship functions and what losing one is worth. */
function vitalLosses(model: EngineModel, impact: ImpactResult): { label: string; points: number }[] {
  const lost = impact.lost.map((entry) => model.componentById.get(entry.componentId)).filter(
    (c): c is VesselComponent => Boolean(c),
  );
  const kindOf = (c: VesselComponent): string | undefined => model.systemById.get(c.systemId)?.kind;
  const losses: { label: string; points: number }[] = [];

  if (lost.some((c) => kindOf(c) === 'propulsion')) losses.push({ label: 'propulsion', points: 12 });
  if (lost.some((c) => kindOf(c) === 'steering' && c.criticality >= 5)) losses.push({ label: 'steering', points: 12 });
  else if (lost.some((c) => kindOf(c) === 'steering')) losses.push({ label: 'manoeuvring aid', points: 5 });
  // A lost bus that feeds many consumers is a blackout, not just a lost machine.
  if (lost.some((c) => kindOf(c) === 'electrical' && c.feeds.length >= 5)) losses.push({ label: 'main power (blackout)', points: 10 });
  if (lost.some((c) => kindOf(c) === 'bilge')) losses.push({ label: 'bilge / fire pumping', points: 6 });
  return losses;
}

export function scoreUrgency(
  model: EngineModel,
  component: VesselComponent,
  impact: ImpactResult,
  repair: RepairPlan,
  atRisk: readonly AtRiskComponent[],
): UrgencyScore {
  const factors: UrgencyFactor[] = [];

  factors.push({
    id: 'criticality',
    label: 'Component criticality',
    points: round1((component.criticality / 5) * 25),
    max: 25,
    detail: `Rated ${component.criticality}/5 in the model`,
  });

  const cascade = impact.lost.filter((entry) => entry.depth > 0);
  const weight = cascade.reduce((sum, entry) => sum + (model.componentById.get(entry.componentId)?.criticality ?? 0), 0);
  factors.push({
    id: 'cascade',
    label: 'Cascade',
    points: round1(25 * (1 - Math.exp(-weight / 18))),
    max: 25,
    detail:
      cascade.length === 0
        ? impact.holds.length > 0
          ? 'Nothing else stops — redundancy holds'
          : 'Nothing else depends on it'
        : `${cascade.length} more component${cascade.length === 1 ? '' : 's'} stop, over ${impact.waves.length - 1} wave${impact.waves.length === 2 ? '' : 's'}`,
  });

  const vital = vitalLosses(model, impact);
  factors.push({
    id: 'vital',
    label: 'Vital functions',
    points: Math.min(20, vital.reduce((sum, v) => sum + v.points, 0)),
    max: 20,
    detail: vital.length > 0 ? `Loss of ${vital.map((v) => v.label).join(', ')}` : 'No vital ship function lost',
  });

  const hours = repair.totalMinutes / 60;
  factors.push({
    id: 'time',
    label: 'Time to restore',
    points: round1(12 * Math.min(1, hours / 24)),
    max: 12,
    detail: `About ${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h from gangway to handover`,
  });

  const logisticsReasons: string[] = [];
  let logistics = 0;
  if (!repair.spareOnboard) {
    logistics += 6;
    logisticsReasons.push('no spare on board');
  }
  if (repair.hotWork) {
    logistics += 2;
    logisticsReasons.push('hot-work permit');
  }
  if (repair.shutdown) {
    logistics += 2;
    logisticsReasons.push('system shutdown');
  }
  factors.push({
    id: 'logistics',
    label: 'Logistics',
    points: logistics,
    max: 10,
    detail: logisticsReasons.length > 0 ? `Needs ${logisticsReasons.join(', ')}` : 'Spares on board, no permits beyond isolation',
  });

  const highRisk = atRisk.filter((risk) => risk.severity === 'high').length;
  factors.push({
    id: 'hazard',
    label: 'Hazards & collateral risk',
    points: round1(8 * Math.min(1, (component.hazards.length * 1.5 + highRisk * 2) / 8)),
    max: 8,
    detail:
      highRisk > 0
        ? `${highRisk} neighbour${highRisk === 1 ? '' : 's'} at high risk`
        : component.hazards.length > 0
          ? `${component.hazards.length} hazard${component.hazards.length === 1 ? '' : 's'} at the work face`
          : 'No specific hazards',
  });

  const credits: UrgencyFactor[] = [];
  const standby = impact.standby.find((option) => option.componentId === component.id && option.available);
  if (standby) {
    const name = model.componentById.get(standby.standbyId)?.name ?? standby.standbyId;
    credits.push({
      id: 'standby',
      label: 'Standby available',
      points: -STANDBY_CREDIT,
      max: STANDBY_CREDIT,
      detail: `Crew can start ${name} and restore the supply`,
    });
  }

  const gross = factors.reduce((sum, factor) => sum + factor.points, 0);
  const net = gross + credits.reduce((sum, credit) => sum + credit.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(net)));
  const level = levelFor(score);
  return { score, level, headline: URGENCY_LEVELS[level].headline, factors, credits };
}
