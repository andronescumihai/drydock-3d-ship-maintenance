/**
 * Deck machinery and outfit.
 *
 * A hull with an empty weather deck reads as a toy however good its materials
 * are: the silhouette of a working ship is made of its crane, hatches, funnel,
 * mast and mooring gear. These builders follow the same contract as the
 * machinery archetypes — named pieces, component-local space, +x forward.
 */

import * as THREE from 'three';
import {
  boltCircle,
  box,
  chamferedBox,
  cone,
  cylinder,
  finnedCylinder,
  flange,
  flangedStub,
  machineFeet,
  merge,
  repeatAlong,
  ribbedPanel,
  sphere,
} from './primitives';
import type { PartAssembly, PartPiece, ArchetypeSpec } from './assembly';
import { piece } from './assembly';

/** Pedestal deck crane: column, slewing house, luffing jib, hook block. */
export const deckCrane = ({ length: L, height: H, width: W }: ArchetypeSpec): PartAssembly => {
  const pedestalR = W * 0.34;
  const pedestalH = H * 0.34;
  const baseY = -H / 2;
  const houseY = baseY + pedestalH + H * 0.13;
  const jibLength = L * 0.95;
  const jibAngle = -Math.PI / 5;

  // The jib is built along +x and then luffed up about z.
  const jib = merge([
    box([jibLength, H * 0.075, W * 0.16], [jibLength / 2, 0, 0]),
    repeatAlong(7, jibLength * 0.86, (_, x) =>
      box([H * 0.02, H * 0.06, W * 0.14], [x + jibLength / 2, 0, 0]),
    ),
    cylinder(H * 0.05, W * 0.3, 'z', [jibLength, 0, 0], 10),
  ]).rotateZ(-jibAngle);
  jib.translate(0, houseY + H * 0.06, 0);

  const tipX = Math.cos(jibAngle) * jibLength;
  const tipY = houseY + H * 0.06 + Math.sin(-jibAngle) * jibLength;

  return {
    pieces: [
      piece('base', 'Crane foundation', 'framing', cylinder(pedestalR * 1.35, H * 0.05, 'y', [0, baseY + H * 0.025, 0], 18)),
      piece('pedestal', 'Pedestal column', 'liveryYellow', cylinder(pedestalR, pedestalH, 'y', [0, baseY + pedestalH / 2 + H * 0.05, 0], 18)),
      piece(
        'slew-ring',
        'Slewing ring',
        'galvanised',
        merge([
          flange(pedestalR * 1.12, H * 0.035, 'y', [0, baseY + pedestalH + H * 0.06, 0]),
          boltCircle(14, pedestalR * 0.95, H * 0.01, H * 0.05, 'y', [0, baseY + pedestalH + H * 0.06, 0]),
        ]),
      ),
      piece('house', 'Machinery house', 'liveryYellow', chamferedBox([W * 1.05, H * 0.24, W * 0.85], [-W * 0.18, houseY, 0], 0.06)),
      piece('cab', 'Operator cab', 'deckhouse', chamferedBox([W * 0.5, H * 0.2, W * 0.42], [W * 0.34, houseY + H * 0.05, W * 0.5], 0.04)),
      // The glass stands a few centimetres proud of the cab on every side it shows,
      // never flush with it (coplanar faces flicker as the camera moves).
      piece('cab-glass', 'Cab glazing', 'glazing', box([W * 0.44, H * 0.1, W * 0.44], [W * 0.38, houseY + H * 0.09, W * 0.5])),
      piece('jib', 'Luffing jib', 'liveryYellow', jib),
      piece(
        'hoist-wire',
        'Hoist wire',
        'rigging',
        cylinder(W * 0.012, tipY - (baseY + H * 0.62), 'y', [tipX, (tipY + baseY + H * 0.62) / 2, 0], 6),
      ),
      piece(
        'hook-block',
        'Hook block',
        'galvanised',
        merge([
          box([W * 0.16, H * 0.06, W * 0.12], [tipX, baseY + H * 0.62, 0]),
          cylinder(W * 0.05, W * 0.14, 'z', [tipX, baseY + H * 0.59, 0], 10),
        ]),
      ),
      piece('nameplate', 'System marking', 'accent', cylinder(pedestalR * 1.04, H * 0.03, 'y', [0, baseY + pedestalH * 0.7, 0], 18)),
    ],
  };
};

/** Folding hatch cover sitting on its coaming. */
export const hatchCover = ({ length: L, height: H, width: W }: ArchetypeSpec): PartAssembly => {
  const coamingH = H * 0.62;
  const baseY = -H / 2;
  const panelY = baseY + coamingH + H * 0.1;

  return {
    pieces: [
      piece(
        'coaming',
        'Hatch coaming',
        'hullPlate',
        merge([
          box([L, coamingH, W * 0.06], [0, baseY + coamingH / 2, W / 2]),
          box([L, coamingH, W * 0.06], [0, baseY + coamingH / 2, -W / 2]),
          box([L * 0.06, coamingH, W], [L / 2, baseY + coamingH / 2, 0]),
          box([L * 0.06, coamingH, W], [-L / 2, baseY + coamingH / 2, 0]),
        ]),
      ),
      piece(
        'stays',
        'Coaming stays',
        'framing',
        repeatAlong(8, L * 0.86, (_, x) =>
          merge([
            box([L * 0.012, coamingH * 0.7, W * 0.08], [x, baseY + coamingH * 0.35, W / 2 + W * 0.05]),
            box([L * 0.012, coamingH * 0.7, W * 0.08], [x, baseY + coamingH * 0.35, -W / 2 - W * 0.05]),
          ]),
        ),
      ),
      piece(
        'panels',
        'Cover panels',
        'hatchPanel',
        repeatAlong(4, L * 0.75, (_, x) => box([L * 0.243, H * 0.13, W * 1.02], [x, panelY, 0])),
      ),
      piece(
        'panel-ribs',
        'Panel stiffeners',
        'framing',
        repeatAlong(4, L * 0.75, (_, x) =>
          ribbedPanel([L * 0.235, H * 0.03, W], [x, panelY + H * 0.08, 0], 5, 0.05),
        ),
      ),
      piece(
        'cleats',
        'Securing cleats',
        'safetyOrange',
        repeatAlong(10, L * 0.9, (_, x) =>
          merge([
            box([L * 0.018, H * 0.07, W * 0.05], [x, baseY + coamingH, W / 2 + W * 0.04]),
            box([L * 0.018, H * 0.07, W * 0.05], [x, baseY + coamingH, -W / 2 - W * 0.04]),
          ]),
        ),
      ),
      piece('nameplate', 'System marking', 'accent', box([L * 0.3, H * 0.05, W * 0.03], [0, baseY + coamingH * 0.6, W / 2 + W * 0.04])),
    ],
  };
};

/** Anchor windlass: gypsies, warping ends, brake wheels, drive. */
export const windlass = ({ length: L, height: H, width: W }: ArchetypeSpec): PartAssembly => {
  const baseY = -H / 2;
  const shaftY = baseY + H * 0.45;

  return {
    pieces: [
      piece('bedplate', 'Bedplate', 'framing', box([L, H * 0.14, W], [0, baseY + H * 0.07, 0])),
      piece(
        'gypsies',
        'Cable lifters',
        'castIron',
        merge([
          cylinder(H * 0.3, W * 0.2, 'z', [0, shaftY, W * 0.3], 12),
          cylinder(H * 0.3, W * 0.2, 'z', [0, shaftY, -W * 0.3], 12),
        ]),
      ),
      piece(
        'brake-wheels',
        'Brake wheels',
        'safetyOrange',
        merge([
          cylinder(H * 0.2, W * 0.05, 'z', [0, shaftY, W * 0.46], 14),
          cylinder(H * 0.2, W * 0.05, 'z', [0, shaftY, -W * 0.46], 14),
        ]),
      ),
      piece('shaft', 'Main shaft', 'galvanised', cylinder(H * 0.07, W * 1.1, 'z', [0, shaftY, 0], 10)),
      piece('gearbox', 'Reduction gearbox', 'castIron', chamferedBox([L * 0.4, H * 0.4, W * 0.28], [-L * 0.26, shaftY, 0], 0.04)),
      piece('motor', 'Drive motor', 'castIron', finnedCylinder(H * 0.2, L * 0.34, 'x', [-L * 0.62, shaftY, 0], 8, 0.04)),
      piece(
        'warping-ends',
        'Warping ends',
        'castIron',
        merge([
          cone(H * 0.2, H * 0.13, W * 0.16, 'z', [0, shaftY, W * 0.62], 12),
          cone(H * 0.13, H * 0.2, W * 0.16, 'z', [0, shaftY, -W * 0.62], 12),
        ]),
      ),
      piece('nameplate', 'System marking', 'accent', box([L * 0.3, H * 0.06, W * 0.03], [0, baseY + H * 0.2, W * 0.5])),
    ],
  };
};

/** Mooring winch: split drum, warping end, motor. */
export const mooringWinch = ({ length: L, height: H, width: W }: ArchetypeSpec): PartAssembly => {
  const baseY = -H / 2;
  const drumY = baseY + H * 0.48;

  return {
    pieces: [
      piece('bedplate', 'Bedplate', 'framing', box([L, H * 0.13, W], [0, baseY + H * 0.065, 0])),
      piece('drum', 'Rope drum', 'castIron', cylinder(H * 0.3, W * 0.56, 'z', [0, drumY, 0], 14)),
      piece(
        'flanges',
        'Drum flanges',
        'galvanised',
        merge([
          cylinder(H * 0.4, W * 0.04, 'z', [0, drumY, W * 0.29], 16),
          cylinder(H * 0.4, W * 0.04, 'z', [0, drumY, -W * 0.29], 16),
          cylinder(H * 0.38, W * 0.03, 'z', [0, drumY, 0], 16),
        ]),
      ),
      piece('rope', 'Mooring rope', 'rigging', cylinder(H * 0.36, W * 0.24, 'z', [0, drumY, W * 0.15], 14)),
      piece('warping-end', 'Warping end', 'castIron', cone(H * 0.22, H * 0.15, W * 0.18, 'z', [0, drumY, -W * 0.44], 12)),
      piece('motor', 'Hydraulic motor', 'castIron', finnedCylinder(H * 0.16, L * 0.32, 'x', [-L * 0.56, drumY, 0], 8, 0.03)),
      piece('stands', 'Bearing stands', 'framing', machineFeet(L * 0.5, W * 0.7, baseY + H * 0.1, 0.2, H * 0.3)),
      piece('nameplate', 'System marking', 'accent', box([L * 0.26, H * 0.06, W * 0.03], [0, baseY + H * 0.2, W * 0.5])),
    ],
  };
};

/** Double bitt mooring bollard. */
export const bollard = ({ height: H, width: W }: ArchetypeSpec): PartAssembly => {
  const r = W * 0.22;
  const baseY = -H / 2;

  return {
    pieces: [
      piece('base', 'Base plate', 'framing', box([W * 1.4, H * 0.1, W * 0.7], [0, baseY + H * 0.05, 0])),
      piece(
        'posts',
        'Bitts',
        'safetyOrange',
        merge([
          cylinder(r, H * 0.8, 'y', [W * 0.35, baseY + H * 0.5, 0], 14),
          cylinder(r, H * 0.8, 'y', [-W * 0.35, baseY + H * 0.5, 0], 14),
        ]),
      ),
      piece(
        'caps',
        'Bitt caps',
        'castIron',
        merge([
          cylinder(r * 1.3, H * 0.08, 'y', [W * 0.35, baseY + H * 0.92, 0], 14),
          cylinder(r * 1.3, H * 0.08, 'y', [-W * 0.35, baseY + H * 0.92, 0], 14),
        ]),
      ),
    ],
  };
};

/** Funnel casing with exhaust uptakes. */
export const funnel = ({ length: L, height: H, width: W }: ArchetypeSpec): PartAssembly => {
  const baseY = -H / 2;

  return {
    pieces: [
      piece('casing', 'Funnel casing', 'deckhouse', cone(W * 0.5, W * 0.4, H * 0.86, 'y', [0, baseY + H * 0.43, 0], 4).rotateY(Math.PI / 4)),
      piece('band', 'Company band', 'liveryBlue', cylinder(W * 0.44, H * 0.14, 'y', [0, baseY + H * 0.64, 0], 4).rotateY(Math.PI / 4)),
      piece('nameplate', 'System marking', 'accent', box([W * 0.5, H * 0.06, 0.06], [0, baseY + H * 0.3, W * 0.46])),
      piece('rim', 'Funnel top rim', 'framing', cylinder(W * 0.43, H * 0.05, 'y', [0, baseY + H * 0.88, 0], 4).rotateY(Math.PI / 4)),
      piece(
        'uptakes',
        'Exhaust uptakes',
        'castIron',
        merge([
          cylinder(W * 0.11, H * 0.24, 'y', [L * 0.12, baseY + H * 0.95, W * 0.12], 12),
          cylinder(W * 0.08, H * 0.2, 'y', [-L * 0.12, baseY + H * 0.93, -W * 0.1], 12),
          cylinder(W * 0.06, H * 0.16, 'y', [0, baseY + H * 0.92, W * 0.16], 10),
        ]),
      ),
      piece(
        'ladder',
        'Access ladder',
        'galvanised',
        merge([
          cylinder(0.03, H * 0.8, 'y', [-W * 0.36, baseY + H * 0.44, W * 0.2], 6),
          cylinder(0.03, H * 0.8, 'y', [-W * 0.36, baseY + H * 0.44, W * 0.34], 6),
          repeatAlong(9, H * 0.7, (_, offset) =>
            cylinder(0.02, W * 0.15, 'z', [-W * 0.36, baseY + H * 0.44 + offset, W * 0.27], 5),
          ),
        ]),
      ),
    ],
  };
};

/** Signal mast with radar scanner, platform and navigation lights. */
export const mast = ({ height: H, width: W }: ArchetypeSpec): PartAssembly => {
  const baseY = -H / 2;
  const poleR = W * 0.07;

  return {
    pieces: [
      piece('pole', 'Mast pole', 'deckhouse', cone(poleR * 1.5, poleR * 0.7, H, 'y', [0, baseY + H / 2, 0], 12)),
      piece('platform', 'Radar platform', 'galvanised', box([W * 0.9, H * 0.02, W * 0.9], [0, baseY + H * 0.56, 0])),
      piece(
        'platform-rail',
        'Platform rail',
        'safetyOrange',
        merge([
          box([W * 0.9, H * 0.015, 0.04], [0, baseY + H * 0.62, W * 0.44]),
          box([W * 0.9, H * 0.015, 0.04], [0, baseY + H * 0.62, -W * 0.44]),
          box([0.04, H * 0.015, W * 0.9], [W * 0.44, baseY + H * 0.62, 0]),
          box([0.04, H * 0.015, W * 0.9], [-W * 0.44, baseY + H * 0.62, 0]),
        ]),
      ),
      piece(
        'radar',
        'Radar scanner',
        'deckhouse',
        merge([
          cylinder(W * 0.16, H * 0.06, 'y', [0, baseY + H * 0.62, 0], 12),
          box([W * 1.9, H * 0.022, W * 0.11], [0, baseY + H * 0.66, 0]),
        ]),
      ),
      piece(
        'yard',
        'Signal yard',
        'deckhouse',
        cylinder(poleR * 0.5, W * 2.2, 'z', [0, baseY + H * 0.8, 0], 8),
      ),
      piece(
        'nav-lights',
        'Navigation lights',
        'safetyOrange',
        merge([
          sphere(W * 0.09, [0, baseY + H * 1.0, 0], 10),
          sphere(W * 0.07, [0, baseY + H * 0.8, W * 1.05], 8),
          sphere(W * 0.07, [0, baseY + H * 0.8, -W * 1.05], 8),
        ]),
      ),
    ],
  };
};

/** Lifeboat in its davit. */
export const lifeboat = ({ length: L, height: H, width: W }: ArchetypeSpec): PartAssembly => {
  const baseY = -H / 2;
  const boatY = baseY + H * 0.4;

  const hull = merge([
    cone(W * 0.44, W * 0.2, L * 0.9, 'x', [0, boatY, 0], 10),
    box([L * 0.5, H * 0.24, W * 0.8], [0, boatY, 0]),
  ]);

  return {
    pieces: [
      piece('boat-hull', 'Lifeboat hull', 'safetyOrange', hull),
      piece('canopy', 'Boat canopy', 'safetyOrange', cone(W * 0.4, W * 0.16, L * 0.8, 'x', [0, boatY + H * 0.2, 0], 10)),
      piece(
        'davits',
        'Davit arms',
        'framing',
        merge([
          cylinder(W * 0.05, H * 0.8, 'y', [L * 0.36, baseY + H * 0.4, -W * 0.7], 8),
          cylinder(W * 0.05, H * 0.8, 'y', [-L * 0.36, baseY + H * 0.4, -W * 0.7], 8),
          cylinder(W * 0.045, W * 0.8, 'z', [L * 0.36, baseY + H * 0.78, -W * 0.3], 8),
          cylinder(W * 0.045, W * 0.8, 'z', [-L * 0.36, baseY + H * 0.78, -W * 0.3], 8),
        ]),
      ),
      piece(
        'falls',
        'Boat falls',
        'rigging',
        merge([
          cylinder(0.02, H * 0.36, 'y', [L * 0.36, baseY + H * 0.6, W * 0.08], 5),
          cylinder(0.02, H * 0.36, 'y', [-L * 0.36, baseY + H * 0.6, W * 0.08], 5),
        ]),
      ),
      piece('cradle', 'Stowage cradle', 'framing', machineFeet(L * 0.6, W * 0.6, baseY + H * 0.12, 0.16, H * 0.24)),
    ],
  };
};

/** Fixed pitch propeller on its boss. */
export const propeller = ({ height: H }: ArchetypeSpec): PartAssembly => {
  const r = H / 2;
  const blades: THREE.BufferGeometry[] = [];

  for (let i = 0; i < 4; i += 1) {
    const blade = box([r * 0.18, r * 1.5, r * 0.5], [0, r * 0.78, 0]);
    blade.rotateX(0.32);
    blade.rotateZ((i / 4) * Math.PI * 2);
    blades.push(blade);
  }

  return {
    pieces: [
      piece('boss', 'Propeller boss', 'bronze', cone(r * 0.42, r * 0.3, r * 0.7, 'x', [0, 0, 0], 14)),
      piece('blades', 'Blades', 'bronze', merge(blades).rotateY(Math.PI / 2)),
      piece('cone', 'Fairwater cone', 'bronze', cone(r * 0.3, r * 0.02, r * 0.5, 'x', [-r * 0.6, 0, 0], 14)),
    ],
  };
};

/** Semi-balanced rudder with its stock. */
export const rudder = ({ length: L, height: H, width: W }: ArchetypeSpec): PartAssembly => ({
  pieces: [
    piece('blade', 'Rudder blade', 'hullPlate', ribbedPanel([L, H * 0.82, W], [0, -H * 0.06, 0], 4, 0.06)),
    piece('stock', 'Rudder stock', 'galvanised', cylinder(W * 0.55, H * 0.4, 'y', [L * 0.22, H * 0.42, 0], 14)),
    piece('pintle', 'Bottom pintle', 'bronze', cylinder(W * 0.4, H * 0.1, 'y', [L * 0.22, -H * 0.5, 0], 12)),
  ],
});

/** Bow thruster: tunnel, impeller and drive. */
export const bowThruster = ({ height: H, width: W }: ArchetypeSpec): PartAssembly => {
  const r = H * 0.44;

  return {
    pieces: [
      piece('tunnel', 'Thruster tunnel', 'hullPlate', cylinder(r, W * 1.9, 'z', [0, 0, 0], 18)),
      piece(
        'grids',
        'Tunnel grids',
        'galvanised',
        merge([
          repeatAlong(4, r * 1.4, (_, offset) => cylinder(0.03, r * 2, 'y', [offset, 0, W * 0.94], 5)),
          repeatAlong(4, r * 1.4, (_, offset) => cylinder(0.03, r * 2, 'y', [offset, 0, -W * 0.94], 5)),
        ]),
      ),
      piece('impeller', 'Impeller', 'bronze', merge([
        cylinder(r * 0.28, W * 0.2, 'z', [0, 0, 0], 12),
        repeatAlong(1, 0, () => box([r * 1.3, r * 0.12, W * 0.12], [0, 0, 0])),
        repeatAlong(1, 0, () => box([r * 0.12, r * 1.3, W * 0.12], [0, 0, 0])),
      ])),
      piece('drive', 'Drive unit', 'castIron', merge([
        cylinder(r * 0.22, H * 0.7, 'y', [0, r + H * 0.3, 0], 12),
        chamferedBox([H * 0.5, H * 0.34, W * 0.5], [0, r + H * 0.8, 0], 0.04),
      ])),
      piece('nameplate', 'System marking', 'accent', cylinder(r * 1.03, H * 0.06, 'z', [0, 0, W * 0.5], 18)),
    ],
  };
};

/** Electro-hydraulic steering gear: rams, tiller, power packs. */
export const steeringGear = ({ length: L, height: H, width: W }: ArchetypeSpec): PartAssembly => {
  const baseY = -H / 2;
  const ramY = baseY + H * 0.42;

  return {
    pieces: [
      piece('foundation', 'Foundation', 'framing', box([L, H * 0.1, W], [0, baseY + H * 0.05, 0])),
      piece('stock', 'Rudder stock head', 'galvanised', cylinder(W * 0.16, H * 0.6, 'y', [0, baseY + H * 0.35, 0], 14)),
      piece('tiller', 'Tiller arm', 'castIron', box([L * 0.5, H * 0.16, W * 0.2], [0, ramY + H * 0.18, 0])),
      piece(
        'rams',
        'Hydraulic rams',
        'galvanised',
        merge([
          cylinder(H * 0.12, L * 0.42, 'x', [-L * 0.26, ramY, W * 0.26], 12),
          cylinder(H * 0.12, L * 0.42, 'x', [L * 0.26, ramY, W * 0.26], 12),
          cylinder(H * 0.12, L * 0.42, 'x', [-L * 0.26, ramY, -W * 0.26], 12),
          cylinder(H * 0.12, L * 0.42, 'x', [L * 0.26, ramY, -W * 0.26], 12),
        ]),
      ),
      piece(
        'power-packs',
        'Hydraulic power packs',
        'cabinet',
        merge([
          chamferedBox([L * 0.24, H * 0.3, W * 0.2], [-L * 0.36, baseY + H * 0.25, -W * 0.38], 0.03),
          chamferedBox([L * 0.24, H * 0.3, W * 0.2], [L * 0.36, baseY + H * 0.25, -W * 0.38], 0.03),
        ]),
      ),
      piece('piping', 'Hydraulic piping', 'copper', flangedStub(W * 0.045, L * 0.6, 'x', [0, baseY + H * 0.16, W * 0.42])),
      piece('nameplate', 'System marking', 'accent', box([L * 0.3, H * 0.05, W * 0.03], [0, baseY + H * 0.16, W * 0.5])),
    ],
  };
};

/** Starting air compressor with its receiver. */
export const airCompressor = ({ length: L, height: H, width: W }: ArchetypeSpec): PartAssembly => {
  const baseY = -H / 2;

  return {
    pieces: [
      piece('skid', 'Skid', 'framing', box([L, H * 0.1, W], [0, baseY + H * 0.05, 0])),
      piece('block', 'Compressor block', 'castIron', chamferedBox([L * 0.4, H * 0.4, W * 0.7], [-L * 0.24, baseY + H * 0.32, 0], 0.04)),
      piece(
        'cylinders',
        'Compression stages',
        'castIron',
        merge([
          finnedCylinder(W * 0.16, H * 0.3, 'y', [-L * 0.3, baseY + H * 0.66, 0], 8, 0.03),
          finnedCylinder(W * 0.12, H * 0.24, 'y', [-L * 0.12, baseY + H * 0.63, 0], 8, 0.03),
        ]),
      ),
      piece('motor', 'Drive motor', 'castIron', finnedCylinder(H * 0.18, L * 0.3, 'x', [L * 0.14, baseY + H * 0.3, 0], 8, 0.03)),
      piece('receiver', 'Air receiver', 'galvanised', cylinder(W * 0.3, H * 0.86, 'y', [L * 0.42, baseY + H * 0.5, 0], 14)),
      piece('piping', 'Air piping', 'copper', flangedStub(W * 0.05, L * 0.34, 'x', [L * 0.14, baseY + H * 0.82, 0])),
      piece('nameplate', 'System marking', 'accent', box([L * 0.26, H * 0.05, W * 0.03], [0, baseY + H * 0.18, W * 0.5])),
    ],
  };
};

/** Centrifugal separator (purifier) on its stand. */
export const purifier = ({ height: H, width: W }: ArchetypeSpec): PartAssembly => {
  const baseY = -H / 2;
  const r = W * 0.36;

  return {
    pieces: [
      piece('frame', 'Separator frame', 'castIron', cone(r * 1.15, r * 0.95, H * 0.5, 'y', [0, baseY + H * 0.25, 0], 14)),
      piece('bowl-hood', 'Bowl hood', 'galvanised', cone(r * 0.95, r * 0.55, H * 0.3, 'y', [0, baseY + H * 0.64, 0], 14)),
      piece('inlet', 'Inlet and outlets', 'bronze', merge([
        flangedStub(W * 0.07, H * 0.24, 'y', [0, baseY + H * 0.88, 0]),
        flangedStub(W * 0.05, W * 0.3, 'x', [r * 0.9, baseY + H * 0.62, 0]),
      ])),
      piece('motor', 'Drive motor', 'castIron', finnedCylinder(W * 0.17, H * 0.26, 'y', [r * 0.75, baseY + H * 0.28, -r * 0.6], 8, 0.03)),
      piece('control', 'Control unit', 'cabinet', chamferedBox([W * 0.3, H * 0.3, W * 0.18], [-r * 1.05, baseY + H * 0.4, 0], 0.03)),
      piece('feet', 'Mounting feet', 'framing', machineFeet(W * 0.9, W * 0.9, baseY + H * 0.02, 0.14, 0.1)),
      piece('nameplate', 'System marking', 'accent', cylinder(r * 1.18, H * 0.04, 'y', [0, baseY + H * 0.42, 0], 14)),
    ],
  };
};
