import { describe, expect, it } from 'vitest';
import { formatDuration } from '@/lib/engine/labels';
import { planAccess } from '@/lib/engine/access';
import { vesselModel } from '@/lib/data/loader';

describe('formatDuration', () => {
  it('never prints 60 minutes', () => {
    expect(formatDuration(59.6)).toBe('1 h');
    expect(formatDuration(119.7)).toBe('2 h');
    expect(formatDuration(1439.8)).toBe('1 d');
  });

  it('keeps ordinary values unchanged', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(0.2)).toBe('1 min');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(298)).toBe('4 h 58 min');
  });
});

describe('access steps', () => {
  it('carry the metres of each leg, adding up to the route length', () => {
    for (const node of vesselModel.access.nodes.filter((n) => n.kind === 'workface')) {
      const plan = planAccess(vesselModel.access, node.id);
      if (!plan) throw new Error(`no route to ${node.id}`);
      const sum = plan.steps.reduce((total, step) => total + step.transitMetres, 0);
      expect(sum).toBeCloseTo(plan.distanceMetres, 6);
    }
  });
});
