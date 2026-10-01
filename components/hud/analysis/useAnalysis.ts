'use client';

import { useMemo } from 'react';
import { vesselModel } from '@/lib/data/loader';
import { analyzeFailure, type FailureAnalysis } from '@/lib/engine/analysis';
import { useVesselStore } from '@/lib/state/useVesselStore';

/**
 * The engine is pure and the model is static, so an analysis never changes for
 * a given component: compute it once and keep it.
 */
const cache = new Map<string, FailureAnalysis | null>();

export function getAnalysis(componentId: string | null): FailureAnalysis | null {
  if (!componentId) return null;
  if (!cache.has(componentId)) cache.set(componentId, analyzeFailure(vesselModel, componentId));
  return cache.get(componentId) ?? null;
}

/** "What if this fails?" for the component in the panel. */
export function useSelectedAnalysis(): FailureAnalysis | null {
  const selectedId = useVesselStore((state) => state.selectedId);
  return useMemo(() => getAnalysis(selectedId), [selectedId]);
}

/** The incident being simulated, if any. */
export function useSimulation(): FailureAnalysis | null {
  const failedId = useVesselStore((state) => state.simulatedFailureId);
  return useMemo(() => getAnalysis(failedId), [failedId]);
}
