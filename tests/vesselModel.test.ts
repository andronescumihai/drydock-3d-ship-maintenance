import { describe, expect, it } from 'vitest';
import { VesselDataError, buildVesselModel, vesselModel } from '@/lib/data/loader';
import vesselJson from '@/lib/data/vessel.json';
import systemsJson from '@/lib/data/systems.json';
import componentsJson from '@/lib/data/components.json';

/** Deep clone so a mutation in one test cannot leak into the next. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('bundled sample vessel', () => {
  it('loads and indexes without errors', () => {
    expect(vesselModel.components.length).toBeGreaterThan(0);
    expect(vesselModel.systems.length).toBeGreaterThan(0);
    expect(vesselModel.componentById.size).toBe(vesselModel.components.length);
    expect(vesselModel.systemById.size).toBe(vesselModel.systems.length);
  });

  it('carries an explicit simulation disclaimer', () => {
    expect(vesselModel.vessel.disclaimer.toLowerCase()).toContain('modeled sample vessel');
  });

  it('gives every component a modeling note, for the honesty section', () => {
    for (const component of vesselModel.components) {
      expect(component.note.length).toBeGreaterThan(10);
    }
  });

  it('has no dangling dependency or standby references', () => {
    const ids = new Set(vesselModel.components.map((c) => c.id));
    for (const component of vesselModel.components) {
      for (const edge of component.feeds) expect(ids.has(edge.to)).toBe(true);
      for (const standby of component.backedUpBy) expect(ids.has(standby)).toBe(true);
    }
  });

  it('buckets every component into the compartment it claims', () => {
    let bucketed = 0;
    for (const [, bucket] of vesselModel.componentsByCompartment) bucketed += bucket.length;
    expect(bucketed).toBe(vesselModel.components.length);
  });
});

describe('referential validation', () => {
  it('rejects a component pointing at an unknown system', () => {
    const components = clone(componentsJson);
    const first = components[0];
    if (!first) throw new Error('fixture is empty');
    first.systemId = 'SYS-DOES-NOT-EXIST';

    expect(() => buildVesselModel(vesselJson, systemsJson, components)).toThrow(VesselDataError);
  });

  it('rejects a dependency edge pointing at an unknown component', () => {
    const components = clone(componentsJson);
    const first = components[0];
    if (!first) throw new Error('fixture is empty');
    first.feeds = [{ to: 'GHOST-01', resource: 'electrical' }];

    expect(() => buildVesselModel(vesselJson, systemsJson, components)).toThrow(/unknown component/);
  });

  it('rejects a component sitting outside its own compartment', () => {
    const components = clone(componentsJson);
    const first = components[0];
    if (!first) throw new Error('fixture is empty');
    first.position = { x: 999, y: 999, z: 999 };

    expect(() => buildVesselModel(vesselJson, systemsJson, components)).toThrow(/outside compartment/);
  });

  it('rejects duplicate component ids', () => {
    const components = clone(componentsJson);
    const first = components[0];
    if (!first) throw new Error('fixture is empty');
    components.push(clone(first));

    expect(() => buildVesselModel(vesselJson, systemsJson, components)).toThrow(/duplicate component id/);
  });

  it('rejects a source that supplies nothing', () => {
    const components = clone(componentsJson);
    const source = components.find((c) => c.isSource);
    if (!source) throw new Error('fixture has no source component');
    source.feeds = [];

    expect(() => buildVesselModel(vesselJson, systemsJson, components)).toThrow(/supplies nothing/);
  });

  it('rejects a self-referencing dependency', () => {
    const components = clone(componentsJson);
    const first = components[0];
    if (!first) throw new Error('fixture is empty');
    first.feeds = [{ to: first.id, resource: 'control' }];

    expect(() => buildVesselModel(vesselJson, systemsJson, components)).toThrow(/feeds itself/);
  });
});

describe('shape validation', () => {
  it('rejects a malformed colour', () => {
    const systems = clone(systemsJson);
    const first = systems[0];
    if (!first) throw new Error('fixture is empty');
    first.hudColor = 'cyan';

    expect(() => buildVesselModel(vesselJson, systems, componentsJson)).toThrow(/hudColor/);
  });

  it('rejects inverted compartment bounds', () => {
    const vessel = clone(vesselJson);
    const first = vessel.compartments[0];
    if (!first) throw new Error('fixture is empty');
    first.bounds = { min: { x: 10, y: 10, z: 10 }, max: { x: 0, y: 0, z: 0 } };

    expect(() => buildVesselModel(vessel, systemsJson, componentsJson)).toThrow(VesselDataError);
  });

  it('reports every issue at once rather than stopping at the first', () => {
    const components = clone(componentsJson);
    const [first, second] = components;
    if (!first || !second) throw new Error('fixture too small');
    first.systemId = 'SYS-NOPE';
    second.compartmentId = 'CMP-NOPE';

    try {
      buildVesselModel(vesselJson, systemsJson, components);
      throw new Error('expected the model to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(VesselDataError);
      expect((error as VesselDataError).issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});
