import { describe, expect, it } from 'vitest';
import { buildDeckBands, buildDeckToBandIndex, bulkheadStationsForBand } from '@/lib/geometry/deckBands';
import { keepSideFor, sectionStripAt, sideSign } from '@/lib/geometry/hullShape';
import { vesselModel } from '@/lib/data/loader';

const { vessel } = vesselModel;

describe('buildDeckBands', () => {
  const bands = buildDeckBands(vessel);

  it('produces one band per deck inside the hull plus the deckhouse', () => {
    expect(bands.length).toBeGreaterThanOrEqual(3);
    expect(bands.filter((band) => band.isDeckhouse)).toHaveLength(1);
  });

  it('stacks without gaps or overlaps', () => {
    for (let i = 0; i < bands.length - 1; i += 1) {
      const current = bands[i];
      const next = bands[i + 1];
      if (!current || !next) throw new Error('unexpected sparse band list');
      expect(current.yTop).toBeCloseTo(next.yBottom, 9);
      expect(current.index).toBe(i);
    }
  });

  it('starts at the baseline and never inverts a band', () => {
    expect(bands[0]?.yBottom).toBeCloseTo(0, 9);
    for (const band of bands) expect(band.yTop).toBeGreaterThan(band.yBottom);
  });

  it('assigns every deck to exactly one band', () => {
    const index = buildDeckToBandIndex(bands);
    for (const deck of vessel.decks) expect(index.get(deck.id)).toBeDefined();

    const seen = new Set<string>();
    for (const band of bands) {
      for (const deckId of band.containedDeckIds) {
        expect(seen.has(deckId)).toBe(false);
        seen.add(deckId);
      }
    }
    expect(seen.size).toBe(vessel.decks.length);
  });
});

describe('bulkheadStationsForBand', () => {
  const bands = buildDeckBands(vessel);

  it('derives walls from compartment ends, sorted and de-duplicated', () => {
    const band = bands[0];
    if (!band) throw new Error('no bands');
    const stations = bulkheadStationsForBand(vessel, band);

    expect(stations.length).toBeGreaterThan(0);
    for (let i = 1; i < stations.length; i += 1) {
      const previous = stations[i - 1];
      const current = stations[i];
      if (previous === undefined || current === undefined) throw new Error('sparse');
      expect(current).toBeGreaterThan(previous);
    }
  });

  it('never places a wall where the hull has already closed up', () => {
    const halfLength = vessel.hull.lengthOverall / 2;
    for (const band of bands) {
      for (const x of bulkheadStationsForBand(vessel, band)) {
        expect(Math.abs(x)).toBeLessThan(halfLength);
      }
    }
  });
});

describe('cut side bookkeeping', () => {
  it('keeps the half opposite the one cut away', () => {
    expect(keepSideFor('starboard')).toBe('port');
    expect(keepSideFor('port')).toBe('starboard');
    expect(keepSideFor('both')).toBe('both');
  });

  it('maps port to negative z and starboard to positive z', () => {
    expect(sideSign('port')).toBe(-1);
    expect(sideSign('starboard')).toBe(1);
  });
});

describe('sectionStripAt', () => {
  it('spans exactly the requested height range', () => {
    const strip = sectionStripAt(vessel.hull, 0, 3.2, 6.5, 8);
    expect(strip).toHaveLength(9);
    expect(strip[0]?.y).toBeCloseTo(3.2, 9);
    expect(strip[strip.length - 1]?.y).toBeCloseTo(6.5, 9);
  });

  it('never returns a negative half-width', () => {
    for (const t of [-1, -0.5, 0, 0.5, 1]) {
      for (const point of sectionStripAt(vessel.hull, t, 0, 6.5, 12)) {
        expect(point.z).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
