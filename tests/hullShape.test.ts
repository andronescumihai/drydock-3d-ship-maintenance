import { describe, expect, it } from 'vitest';
import type { HullSpec } from '@/lib/engine/types';
import {
  deckEdgeYAt,
  fullSectionAt,
  halfBeamAt,
  halfSectionAt,
  halfWidthAt,
  keelRiseAt,
  outlineAtHeight,
} from '@/lib/geometry/hullShape';

const hull: HullSpec = {
  lengthOverall: 90,
  beam: 14,
  depth: 6.5,
  draught: 4.2,
  parallelMidBody: 0.34,
  midshipFullness: 4.2,
  bowFullness: 2.1,
  sternFullness: 2.9,
  transomWidthRatio: 0.46,
  sheerForward: 0.85,
  sheerAft: 0.35,
};

const MAX_HALF_BEAM = hull.beam / 2;

describe('halfBeamAt', () => {
  it('keeps full beam across the parallel mid-body', () => {
    for (const t of [-0.34, -0.2, 0, 0.2, 0.34]) {
      expect(halfBeamAt(hull, t)).toBeCloseTo(MAX_HALF_BEAM, 10);
    }
  });

  it('narrows monotonically towards the bow', () => {
    let previous = MAX_HALF_BEAM + 1;
    for (let t = 0.34; t <= 1; t += 0.02) {
      const width = halfBeamAt(hull, t);
      expect(width).toBeLessThanOrEqual(previous + 1e-9);
      previous = width;
    }
  });

  it('ends at a transom of the configured width, not a point', () => {
    expect(halfBeamAt(hull, -1)).toBeCloseTo(MAX_HALF_BEAM * hull.transomWidthRatio, 6);
    expect(halfBeamAt(hull, -1)).toBeGreaterThan(halfBeamAt(hull, 1));
  });

  it('never goes negative anywhere along the length', () => {
    for (let t = -1; t <= 1; t += 0.01) {
      expect(halfBeamAt(hull, t)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('halfSectionAt', () => {
  it('runs from the keel to the deck edge', () => {
    const section = halfSectionAt(hull, 0, 12);
    const first = section[0];
    const last = section[section.length - 1];

    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(first?.z).toBeCloseTo(0, 10);
    expect(first?.y).toBeCloseTo(keelRiseAt(hull, 0), 10);
    // cos(PI/2) is 6.1e-17 rather than 0 in floating point, and raising that to
    // 2/n amplifies it to roughly 1e-7 m. Sub-micron on a 90 m hull; the
    // tolerance reflects the arithmetic, not a modelling error.
    expect(last?.z).toBeCloseTo(halfBeamAt(hull, 0), 5);
    expect(last?.y).toBeCloseTo(deckEdgeYAt(hull, 0), 5);
  });

  it('rises monotonically from keel to deck edge', () => {
    const section = halfSectionAt(hull, 0.5, 20);
    for (let i = 1; i < section.length; i += 1) {
      const previous = section[i - 1];
      const current = section[i];
      if (!previous || !current) throw new Error('unexpected sparse section');
      expect(current.y).toBeGreaterThanOrEqual(previous.y - 1e-9);
      expect(current.z).toBeGreaterThanOrEqual(previous.z - 1e-9);
    }
  });
});

describe('fullSectionAt', () => {
  it('is symmetric about the centreline', () => {
    const samples = 10;
    const section = fullSectionAt(hull, -0.5, samples);
    expect(section).toHaveLength(2 * samples + 1);

    for (let i = 0; i < section.length; i += 1) {
      const left = section[i];
      const right = section[section.length - 1 - i];
      if (!left || !right) throw new Error('unexpected sparse section');
      expect(left.z).toBeCloseTo(-right.z, 10);
      expect(left.y).toBeCloseTo(right.y, 10);
    }
  });
});

describe('halfWidthAt', () => {
  it('agrees with the section it was derived from', () => {
    const samples = 24;
    for (const t of [-0.8, -0.3, 0, 0.4, 0.9]) {
      for (const point of halfSectionAt(hull, t, samples)) {
        expect(halfWidthAt(hull, t, point.y)).toBeCloseTo(point.z, 6);
      }
    }
  });

  it('is zero at or below the keel and full beam at the deck edge', () => {
    expect(halfWidthAt(hull, 0, -1)).toBe(0);
    expect(halfWidthAt(hull, 0, 0)).toBe(0);
    expect(halfWidthAt(hull, 0, deckEdgeYAt(hull, 0))).toBeCloseTo(halfBeamAt(hull, 0), 8);
    expect(halfWidthAt(hull, 0, 99)).toBeCloseTo(halfBeamAt(hull, 0), 8);
  });

  it('widens with height at every station', () => {
    for (const t of [-0.9, -0.4, 0, 0.5, 0.95]) {
      let previous = -1;
      for (let y = 0; y <= hull.depth; y += 0.1) {
        const width = halfWidthAt(hull, t, y);
        expect(width).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = width;
      }
    }
  });
});

describe('outlineAtHeight', () => {
  it('samples the requested number of stations across the full length', () => {
    const outline = outlineAtHeight(hull, hull.draught, 40);
    expect(outline).toHaveLength(41);
    expect(outline[0]?.x).toBeCloseTo(-hull.lengthOverall / 2, 10);
    expect(outline[outline.length - 1]?.x).toBeCloseTo(hull.lengthOverall / 2, 10);
  });

  it('is widest amidships', () => {
    const outline = outlineAtHeight(hull, hull.depth, 60);
    const widest = outline.reduce((a, b) => (b.halfWidth > a.halfWidth ? b : a));
    expect(Math.abs(widest.x)).toBeLessThan(hull.lengthOverall * 0.2);
    expect(widest.halfWidth).toBeCloseTo(MAX_HALF_BEAM, 6);
  });

  it('produces a narrower waterline than deck line at the ends', () => {
    const atDraught = outlineAtHeight(hull, hull.draught, 60);
    const atDeck = outlineAtHeight(hull, hull.depth, 60);
    for (let i = 0; i < atDraught.length; i += 1) {
      const low = atDraught[i];
      const high = atDeck[i];
      if (!low || !high) throw new Error('outline length mismatch');
      expect(low.halfWidth).toBeLessThanOrEqual(high.halfWidth + 1e-9);
    }
  });
});
