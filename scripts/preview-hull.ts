/**
 * Renders profile, plan and body-plan views of the modeled vessel to an SVG.
 *
 * A sanity check for the hull maths and the compartment layout that does not
 * need a browser: it draws from exactly the same functions the 3D scene uses,
 * so if the picture looks wrong, the scene is wrong too.
 *
 * Usage: npx vite-node scripts/preview-hull.ts
 */

import { writeFileSync } from 'node:fs';
import { vesselModel } from '@/lib/data/loader';
import {
  deckEdgeYAt,
  fullSectionAt,
  keelRiseAt,
  outlineAtHeight,
} from '@/lib/geometry/hullShape';

const { vessel, components, systemById, compartmentById } = vesselModel;
const hull = vessel.hull;

const SCALE = 9; // px per metre
const PAD = 40;
const HALF_LENGTH = hull.lengthOverall / 2;

const profileHeight = 16;
const planHeight = hull.beam + 2;
const sectionHeight = 16;

const width = hull.lengthOverall * SCALE + PAD * 2;
const profileTop = PAD;
const planTop = profileTop + profileHeight * SCALE + 46;
const sectionTop = planTop + planHeight * SCALE + 46;
const height = sectionTop + sectionHeight * SCALE + PAD;

/** Vessel x -> svg x (bow to the right). */
const sx = (x: number): number => PAD + (x + HALF_LENGTH) * SCALE;
/** Vessel y -> svg y within the profile panel (up is up). */
const sy = (y: number): number => profileTop + (profileHeight - y) * SCALE;
/** Vessel z -> svg y within the plan panel. */
const pz = (z: number): number => planTop + (planHeight / 2 + z) * SCALE;

const parts: string[] = [];
const fmt = (n: number): string => n.toFixed(2);

parts.push(
  `<rect width="${width}" height="${height}" fill="#070a11"/>`,
  `<style>
     text { font-family: ui-monospace, monospace; fill: #5e7288; }
     .t { font-size: 11px; letter-spacing: 1.4px; fill: #38d6f2; }
     .s { font-size: 8px; }
   </style>`,
);

// ---------------------------------------------------------------- profile ---
parts.push(`<text class="t" x="${PAD}" y="${profileTop - 12}">PROFILE — LOOKING TO PORT</text>`);

const keelPath: string[] = [];
const sheerPath: string[] = [];
for (let i = 0; i <= 180; i += 1) {
  const t = -1 + (2 * i) / 180;
  const x = t * HALF_LENGTH;
  keelPath.push(`${i === 0 ? 'M' : 'L'}${fmt(sx(x))},${fmt(sy(keelRiseAt(hull, t)))}`);
  sheerPath.push(`${i === 0 ? 'M' : 'L'}${fmt(sx(x))},${fmt(sy(deckEdgeYAt(hull, t)))}`);
}
parts.push(
  `<path d="${keelPath.join(' ')}" fill="none" stroke="#5f8fb0" stroke-width="1.6"/>`,
  `<path d="${sheerPath.join(' ')}" fill="none" stroke="#5f8fb0" stroke-width="1.6"/>`,
  `<line x1="${sx(-HALF_LENGTH)}" y1="${sy(hull.draught)}" x2="${sx(HALF_LENGTH)}" y2="${sy(hull.draught)}" stroke="#2fa8c8" stroke-dasharray="6 4" stroke-width="1"/>`,
  `<text class="s" x="${sx(HALF_LENGTH) - 60}" y="${sy(hull.draught) - 4}">DWL ${hull.draught} m</text>`,
);

for (const deck of vessel.decks) {
  if (deck.level > hull.depth) continue;
  parts.push(
    `<line x1="${sx(-HALF_LENGTH)}" y1="${sy(deck.level)}" x2="${sx(HALF_LENGTH)}" y2="${sy(deck.level)}" stroke="#1f2d40" stroke-width="1"/>`,
    `<text class="s" x="${PAD + 4}" y="${sy(deck.level) - 3}">${deck.name}</text>`,
  );
}

const house = vessel.superstructure.bounds;
parts.push(
  `<rect x="${sx(house.min.x)}" y="${sy(house.max.y)}" width="${(house.max.x - house.min.x) * SCALE}" height="${(house.max.y - house.min.y) * SCALE}" fill="#415d78" fill-opacity="0.18" stroke="#5f8fb0" stroke-width="1"/>`,
);

for (const compartment of vessel.compartments) {
  const { min, max } = compartment.bounds;
  parts.push(
    `<rect x="${sx(min.x)}" y="${sy(max.y)}" width="${(max.x - min.x) * SCALE}" height="${(max.y - min.y) * SCALE}" fill="#2f4a66" fill-opacity="0.12" stroke="#2f4a66" stroke-width="0.8"/>`,
  );
}

// ------------------------------------------------------------------- plan ---
parts.push(`<text class="t" x="${PAD}" y="${planTop - 12}">PLAN — MAIN DECK OUTLINE &amp; DESIGN WATERLINE</text>`);

for (const [level, color, dash] of [
  [hull.depth, '#5f8fb0', ''],
  [hull.draught, '#2fa8c8', 'stroke-dasharray="6 4"'],
] as const) {
  const outline = outlineAtHeight(hull, level, 180).filter((p) => p.halfWidth > 0.01);
  const top = outline.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(sx(p.x))},${fmt(pz(p.halfWidth))}`);
  const bottom = [...outline]
    .reverse()
    .map((p) => `L${fmt(sx(p.x))},${fmt(pz(-p.halfWidth))}`);
  parts.push(
    `<path d="${top.join(' ')} ${bottom.join(' ')} Z" fill="none" stroke="${color}" stroke-width="1.4" ${dash}/>`,
  );
}
parts.push(
  `<line x1="${sx(-HALF_LENGTH)}" y1="${pz(0)}" x2="${sx(HALF_LENGTH)}" y2="${pz(0)}" stroke="#1f2d40" stroke-width="1" stroke-dasharray="3 5"/>`,
);

for (const compartment of vessel.compartments) {
  const { min, max } = compartment.bounds;
  parts.push(
    `<rect x="${sx(min.x)}" y="${pz(min.z)}" width="${(max.x - min.x) * SCALE}" height="${(max.z - min.z) * SCALE}" fill="#2f4a66" fill-opacity="0.1" stroke="#2f4a66" stroke-width="0.8"/>`,
  );
}

for (const component of components) {
  const color = systemById.get(component.systemId)?.hudColor ?? '#9fb4c8';
  parts.push(
    `<circle cx="${fmt(sx(component.position.x))}" cy="${fmt(pz(component.position.z))}" r="3.2" fill="${color}" fill-opacity="0.9"/>`,
    `<circle cx="${fmt(sx(component.position.x))}" cy="${fmt(sy(component.position.y))}" r="3.2" fill="${color}" fill-opacity="0.9"/>`,
  );
}

// -------------------------------------------------------------- body plan ---
parts.push(`<text class="t" x="${PAD}" y="${sectionTop - 12}">BODY PLAN — SECTIONS AT 0.25L, MIDSHIP, 0.75L</text>`);

const sectionStations: readonly [number, string][] = [
  [-0.7, 'AFT 0.25L'],
  [0, 'MIDSHIP'],
  [0.7, 'FWD 0.75L'],
];

sectionStations.forEach(([t, label], index) => {
  const originX = PAD + 120 + index * 240;
  const originY = sectionTop + sectionHeight * SCALE - 20;
  // One continuous path, port deck edge -> keel -> starboard deck edge. Drawing
  // the two halves separately needs a pen-up move that SVG renders as a chord.
  const section = fullSectionAt(hull, t, 40);
  const outline = section.map(
    (p, i) => `${i === 0 ? 'M' : 'L'}${fmt(originX + p.z * SCALE)},${fmt(originY - p.y * SCALE)}`,
  );
  parts.push(
    `<path d="${outline.join(' ')}" fill="none" stroke="#5f8fb0" stroke-width="1.6"/>`,
    `<line x1="${originX}" y1="${originY + 6}" x2="${originX}" y2="${originY - hull.depth * SCALE - 14}" stroke="#1f2d40" stroke-dasharray="3 5"/>`,
    `<text class="s" x="${originX - 30}" y="${originY + 20}">${label}</text>`,
  );
});

parts.push(
  `<text class="s" x="${PAD}" y="${height - 12}">MODELED SAMPLE VESSEL — ${vessel.name} — ${components.length} components in ${compartmentById.size} compartments — NOT A REAL SHIP</text>`,
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('\n')}</svg>`;
writeFileSync('docs/vessel-plan.svg', svg);
console.log(`wrote docs/vessel-plan.svg (${width}x${height})`);
