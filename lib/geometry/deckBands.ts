/**
 * Slicing the vessel into deck bands.
 *
 * A band is one horizontal slab of the ship: a floor, the shell plating around
 * it, and everything that lives on that level. Bands are what the explode view
 * pulls apart, so deriving them from the deck list — rather than hard-coding
 * heights — keeps the model and the view in step.
 *
 * Pure data: no Three.js, no React.
 */

import type { Deck, DeckId, Vessel } from '@/lib/engine/types';

export interface DeckBand {
  /** The deck that forms this band's floor. */
  readonly deckId: DeckId;
  readonly name: string;
  /** Floor height above baseline. */
  readonly yBottom: number;
  /** Ceiling height — the next deck up, or the top of the deckhouse. */
  readonly yTop: number;
  /** Position in the stack, 0 at the keel. Drives the explode offset. */
  readonly index: number;
  /** True for the deckhouse, which is a block rather than a slice of the hull. */
  readonly isDeckhouse: boolean;
  /** Decks drawn inside this band, including the floor itself. */
  readonly containedDeckIds: readonly DeckId[];
}

/**
 * Builds the band stack from the vessel definition.
 *
 * Decks at or below the moulded depth each open a band that runs up to the next
 * deck. Everything above the moulded depth belongs to the deckhouse band, which
 * carries its own internal decks (the bridge) rather than opening new slices of
 * hull.
 */
export function buildDeckBands(vessel: Vessel): DeckBand[] {
  const sorted = [...vessel.decks].sort((a, b) => a.level - b.level);
  const depth = vessel.hull.depth;
  const houseTop = vessel.superstructure.bounds.max.y;

  const inHull: Deck[] = sorted.filter((deck) => deck.level < depth - 1e-6);
  const weatherDeck = sorted.find((deck) => Math.abs(deck.level - depth) < 1e-6);
  const aboveDeck: Deck[] = sorted.filter((deck) => deck.level > depth + 1e-6);

  const bands: DeckBand[] = inHull.map((deck, i) => {
    const next = inHull[i + 1];
    return {
      deckId: deck.id,
      name: deck.name,
      yBottom: deck.level,
      yTop: next ? next.level : depth,
      index: i,
      isDeckhouse: false,
      containedDeckIds: [deck.id],
    };
  });

  if (weatherDeck) {
    bands.push({
      deckId: weatherDeck.id,
      name: weatherDeck.name,
      yBottom: weatherDeck.level,
      yTop: houseTop,
      index: bands.length,
      isDeckhouse: true,
      containedDeckIds: [weatherDeck.id, ...aboveDeck.map((deck) => deck.id)],
    });
  }

  return bands;
}

/** Maps every deck id to the band that draws it. */
export function buildDeckToBandIndex(bands: readonly DeckBand[]): ReadonlyMap<DeckId, DeckBand> {
  const map = new Map<DeckId, DeckBand>();
  for (const band of bands) {
    for (const deckId of band.containedDeckIds) map.set(deckId, band);
  }
  return map;
}

/**
 * Unique transverse bulkhead positions inside a band, taken from the ends of
 * the compartments that live there. Deriving them from the compartment bounds
 * means the interior walls always agree with the data model.
 */
export function bulkheadStationsForBand(
  vessel: Vessel,
  band: DeckBand,
  tolerance = 0.25,
): number[] {
  const positions: number[] = [];

  for (const compartment of vessel.compartments) {
    if (!band.containedDeckIds.includes(compartment.deckId)) continue;
    positions.push(compartment.bounds.min.x, compartment.bounds.max.x);
  }

  positions.sort((a, b) => a - b);
  const unique: number[] = [];
  for (const position of positions) {
    const last = unique[unique.length - 1];
    if (last === undefined || Math.abs(position - last) > tolerance) unique.push(position);
  }

  // Drop anything that lands on the very ends, where the hull has pinched shut.
  const halfLength = vessel.hull.lengthOverall / 2;
  return unique.filter((x) => Math.abs(x) < halfLength - 1.5);
}
