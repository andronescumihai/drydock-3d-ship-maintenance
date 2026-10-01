/**
 * Machinery archetypes and the registry that resolves them.
 *
 * Geometry is produced in component-local space, centred on the origin, with
 * +x forward, +y up, +z to starboard — the same convention as the vessel.
 */

import * as THREE from 'three';
import {
  type ArchetypeBuilder,
  type ArchetypeSpec,
  type PartAssembly,
  piece,
} from './assembly';
import {
  airCompressor,
  bollard,
  bowThruster,
  deckCrane,
  funnel,
  hatchCover,
  lifeboat,
  mast,
  mooringWinch,
  propeller,
  purifier,
  rudder,
  steeringGear,
  windlass,
} from './deckGear';
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

export type { ArchetypeId, ArchetypeSpec, PartAssembly, PartPiece, PieceSurface } from './assembly';

type Builder = ArchetypeBuilder;

// ---------------------------------------------------------------------------

/** Vertical centrifugal pump: volute, bearing housing, motor, terminal box. */
const centrifugalPump: Builder = ({ height, width }) => {
  const r = width / 2;
  const h = height;
  const baseY = -h / 2;
  const casingY = baseY + 0.09 + h * 0.21;
  const lanternY = casingY + h * 0.21 + h * 0.08;
  const motorY = lanternY + h * 0.08 + h * 0.17;

  return {
    pieces: [
      piece('baseplate', 'Baseplate', 'framing', box([r * 2.6, 0.09, r * 2.3], [0, baseY + 0.045, 0])),
      piece('casing', 'Volute casing', 'bronze', cylinder(r, h * 0.42, 'y', [0, casingY, 0])),
      piece(
        'casing-bolts',
        'Casing bolts',
        'galvanised',
        boltCircle(8, r * 0.84, r * 0.07, h * 0.45, 'y', [0, casingY, 0]),
      ),
      piece(
        'suction',
        'Suction branch',
        'bronze',
        flangedStub(r * 0.42, r * 1.3, 'z', [0, casingY, -r * 1.15]),
      ),
      piece(
        'discharge',
        'Discharge branch',
        'bronze',
        flangedStub(r * 0.34, r * 1.2, 'x', [r * 1.1, casingY + h * 0.08, 0]),
      ),
      piece(
        'bearing-housing',
        'Bearing housing',
        'castIron',
        merge([
          cylinder(r * 0.36, h * 0.16, 'y', [0, lanternY, 0]),
          flange(r * 0.5, h * 0.03, 'y', [0, lanternY + h * 0.08, 0]),
        ]),
      ),
      piece('motor', 'Drive motor', 'castIron', finnedCylinder(r * 0.6, h * 0.34, 'y', [0, motorY, 0], 8, 0.05)),
      piece(
        'fan-cowl',
        'Motor fan cowl',
        'galvanised',
        cone(r * 0.58, r * 0.42, h * 0.1, 'y', [0, motorY + h * 0.22, 0]),
      ),
      piece(
        'terminal-box',
        'Motor terminal box',
        'cabinet',
        chamferedBox([r * 0.5, h * 0.12, r * 0.42], [0, motorY, r * 0.72], 0.02),
      ),
      piece(
        'nameplate',
        'System marking',
        'accent',
        cylinder(r * 1.02, h * 0.045, 'y', [0, casingY + h * 0.19, 0], 24),
      ),
    ],
  };
};

/** Medium-speed diesel: bedplate, crankcase, six heads, manifold, turbo. */
const mediumSpeedDiesel: Builder = ({ length: L, height: H, width: W }) => {
  const bedY = -H / 2 + H * 0.08;
  const crankY = -H / 2 + H * 0.16 + H * 0.15;
  const blockY = crankY + H * 0.15 + H * 0.11;
  const headY = blockY + H * 0.11 + H * 0.07;
  const cylinders = 6;

  return {
    pieces: [
      piece('bedplate', 'Bedplate', 'castIron', box([L, H * 0.16, W], [0, bedY, 0])),
      piece('crankcase', 'Crankcase', 'castIron', chamferedBox([L * 0.94, H * 0.3, W * 0.82], [0, crankY, 0], 0.05)),
      piece('block', 'Cylinder block', 'castIron', box([L * 0.86, H * 0.22, W * 0.52], [0, blockY, 0])),
      piece(
        'heads',
        'Cylinder heads',
        'castIron',
        repeatAlong(cylinders, L * 0.7, (_, x) =>
          chamferedBox([L * 0.09, H * 0.14, W * 0.46], [x, headY, 0], 0.02),
        ),
      ),
      piece(
        'rocker-covers',
        'Rocker covers',
        'galvanised',
        repeatAlong(cylinders, L * 0.7, (_, x) =>
          box([L * 0.075, H * 0.05, W * 0.3], [x, headY + H * 0.095, 0]),
        ),
      ),
      piece(
        'exhaust-manifold',
        'Exhaust manifold',
        'castIron',
        merge([
          cylinder(W * 0.09, L * 0.76, 'x', [0, headY + H * 0.02, W * 0.3]),
          repeatAlong(cylinders, L * 0.7, (_, x) =>
            cylinder(W * 0.05, W * 0.14, 'z', [x, headY + H * 0.02, W * 0.22]),
          ),
        ]),
      ),
      piece(
        'turbocharger',
        'Turbocharger',
        'galvanised',
        merge([
          cylinder(W * 0.17, W * 0.3, 'x', [L * 0.44, headY + H * 0.08, W * 0.3]),
          cone(W * 0.2, W * 0.1, W * 0.22, 'x', [L * 0.62, headY + H * 0.08, W * 0.3]),
          sphere(W * 0.15, [L * 0.44, headY + H * 0.08, W * 0.12]),
        ]),
      ),
      piece(
        'charge-cooler',
        'Charge air cooler',
        'copper',
        box([L * 0.34, H * 0.16, W * 0.18], [L * 0.1, crankY + H * 0.06, -W * 0.44]),
      ),
      piece(
        'flywheel-housing',
        'Flywheel housing',
        'castIron',
        merge([
          cylinder(H * 0.3, W * 0.16, 'x', [-L * 0.48, crankY + H * 0.02, 0]),
          flange(H * 0.33, W * 0.05, 'x', [-L * 0.55, crankY + H * 0.02, 0]),
        ]),
      ),
      piece('sump', 'Oil sump', 'castIron', box([L * 0.7, H * 0.1, W * 0.6], [0, bedY - H * 0.05, 0])),
      piece('feet', 'Holding-down feet', 'framing', machineFeet(L * 0.82, W * 0.86, -H / 2 - 0.02, 0.24, 0.14)),
      piece(
        'nameplate',
        'System marking',
        'accent',
        box([L * 0.5, H * 0.05, W * 0.03], [0, crankY, -W * 0.42]),
      ),
    ],
  };
};

/** Generator set: engine and alternator on a common raft. */
const generatorSet: Builder = ({ length: L, height: H, width: W }) => {
  const frameY = -H / 2 + H * 0.06;
  const bodyY = frameY + H * 0.3;

  return {
    pieces: [
      piece('raft', 'Common bedframe', 'framing', box([L, H * 0.12, W], [0, frameY, 0])),
      piece('engine', 'Diesel engine', 'castIron', chamferedBox([L * 0.46, H * 0.44, W * 0.7], [-L * 0.22, bodyY, 0], 0.04)),
      piece(
        'heads',
        'Cylinder heads',
        'castIron',
        repeatAlong(4, L * 0.32, (_, x) =>
          box([L * 0.055, H * 0.12, W * 0.46], [x - L * 0.22, bodyY + H * 0.28, 0]),
        ),
      ),
      piece(
        'alternator',
        'Alternator',
        'galvanised',
        finnedCylinder(H * 0.28, L * 0.34, 'x', [L * 0.28, bodyY, 0], 10, 0.04),
      ),
      piece(
        'coupling-housing',
        'Coupling housing',
        'castIron',
        cylinder(H * 0.24, L * 0.1, 'x', [L * 0.05, bodyY, 0]),
      ),
      piece(
        'terminal-box',
        'Alternator terminal box',
        'cabinet',
        chamferedBox([L * 0.16, H * 0.16, W * 0.3], [L * 0.28, bodyY + H * 0.3, 0], 0.02),
      ),
      piece(
        'exhaust',
        'Exhaust outlet',
        'galvanised',
        cylinder(W * 0.07, H * 0.34, 'y', [-L * 0.35, bodyY + H * 0.36, W * 0.2]),
      ),
      piece('mounts', 'Anti-vibration mounts', 'safetyYellow', machineFeet(L * 0.84, W * 0.7, -H / 2 - 0.01, 0.18, 0.1)),
      piece('nameplate', 'System marking', 'accent', box([L * 0.4, H * 0.045, W * 0.03], [0, frameY + H * 0.1, -W * 0.5])),
    ],
  };
};

/** Main switchboard: sections, doors, instruments. */
const switchboard: Builder = ({ length: L, height: H, width: W }) => {
  const sections = 3;
  const bodyY = -H / 2 + H * 0.06 + H * 0.47;

  return {
    pieces: [
      piece('plinth', 'Plinth', 'framing', box([L, H * 0.06, W], [0, -H / 2 + H * 0.03, 0])),
      piece(
        'sections',
        'Cabinet sections',
        'cabinet',
        repeatAlong(sections, L * 0.66, (_, x) =>
          chamferedBox([L * 0.31, H * 0.94, W], [x, bodyY, 0], 0.03),
        ),
      ),
      piece(
        'doors',
        'Access doors',
        'cabinet',
        repeatAlong(sections, L * 0.66, (_, x) =>
          box([L * 0.28, H * 0.86, W * 0.08], [x, bodyY, W * 0.5]),
        ),
      ),
      piece(
        'instruments',
        'Instruments',
        'galvanised',
        repeatAlong(sections, L * 0.66, (_, x) =>
          merge([
            cylinder(H * 0.07, W * 0.06, 'z', [x - L * 0.06, bodyY + H * 0.28, W * 0.56], 16),
            cylinder(H * 0.07, W * 0.06, 'z', [x + L * 0.06, bodyY + H * 0.28, W * 0.56], 16),
            box([L * 0.18, H * 0.08, W * 0.05], [x, bodyY + H * 0.08, W * 0.56]),
          ]),
        ),
      ),
      piece(
        'handles',
        'Door handles',
        'galvanised',
        repeatAlong(sections, L * 0.66, (_, x) =>
          cylinder(H * 0.012, H * 0.18, 'y', [x + L * 0.12, bodyY - H * 0.1, W * 0.57], 8),
        ),
      ),
      piece('hood', 'Cable hood', 'cabinet', box([L, H * 0.08, W * 0.7], [0, bodyY + H * 0.51, 0])),
      piece('nameplate', 'System marking', 'accent', box([L * 0.9, H * 0.05, W * 0.04], [0, bodyY + H * 0.44, W * 0.5])),
    ],
  };
};

/** Plate heat exchanger: frame plate, plate pack, tie bolts, four nozzles. */
const plateHeatExchanger: Builder = ({ length: L, height: H, width: W }) => {
  const plates = 10;

  return {
    pieces: [
      piece('frame-plate', 'Frame plate', 'castIron', box([L * 0.13, H, W], [-L * 0.43, 0, 0])),
      piece('pressure-plate', 'Pressure plate', 'castIron', box([L * 0.11, H * 0.94, W * 0.94], [L * 0.43, 0, 0])),
      piece(
        'plate-pack',
        'Plate pack',
        'galvanised',
        repeatAlong(plates, L * 0.62, (_, x) => box([L * 0.016, H * 0.86, W * 0.9], [x, 0, 0])),
      ),
      piece(
        'tie-bolts',
        'Tie bolts',
        'framing',
        merge([
          cylinder(W * 0.035, L * 0.94, 'x', [0, H * 0.4, W * 0.42], 10),
          cylinder(W * 0.035, L * 0.94, 'x', [0, H * 0.4, -W * 0.42], 10),
          cylinder(W * 0.035, L * 0.94, 'x', [0, -H * 0.4, W * 0.42], 10),
          cylinder(W * 0.035, L * 0.94, 'x', [0, -H * 0.4, -W * 0.42], 10),
        ]),
      ),
      piece(
        'sw-nozzles',
        'Sea water nozzles',
        'bronze',
        merge([
          flangedStub(W * 0.12, L * 0.24, 'x', [-L * 0.58, H * 0.3, W * 0.26]),
          flangedStub(W * 0.12, L * 0.24, 'x', [-L * 0.58, -H * 0.3, W * 0.26]),
        ]),
      ),
      piece(
        'fw-nozzles',
        'Fresh water nozzles',
        'copper',
        merge([
          flangedStub(W * 0.12, L * 0.24, 'x', [-L * 0.58, H * 0.3, -W * 0.26]),
          flangedStub(W * 0.12, L * 0.24, 'x', [-L * 0.58, -H * 0.3, -W * 0.26]),
        ]),
      ),
      piece('feet', 'Support feet', 'framing', machineFeet(L * 0.8, W * 0.7, -H / 2 - 0.01, 0.16, 0.1)),
      piece('nameplate', 'System marking', 'accent', box([L * 0.1, H * 0.06, W * 0.04], [-L * 0.43, H * 0.42, W * 0.5])),
    ],
  };
};

/** Shaft line: shaft, plummer blocks, coupling, stern gland. */
const shaftLine: Builder = ({ length: L, height: H }) => {
  const r = H / 2;

  return {
    pieces: [
      piece('shaft', 'Shaft', 'galvanised', cylinder(r, L, 'x', [0, 0, 0], 20)),
      piece(
        'bearings',
        'Plummer blocks',
        'castIron',
        repeatAlong(3, L * 0.66, (_, x) =>
          merge([
            cylinder(r * 2.1, r * 1.5, 'x', [x, 0, 0], 18),
            box([r * 1.6, r * 1.4, r * 5.2], [x, -r * 1.6, 0]),
            boltCircle(6, r * 1.7, r * 0.18, r * 1.7, 'x', [x, 0, 0]),
          ]),
        ),
      ),
      piece(
        'coupling',
        'Coupling flange',
        'framing',
        merge([
          flange(r * 2.4, r * 0.7, 'x', [L * 0.48, 0, 0]),
          boltCircle(8, r * 1.9, r * 0.2, r * 0.9, 'x', [L * 0.48, 0, 0]),
        ]),
      ),
      piece(
        'stern-gland',
        'Stern tube gland',
        'bronze',
        merge([
          cylinder(r * 2.2, r * 2.4, 'x', [-L * 0.46, 0, 0], 18),
          boltCircle(8, r * 1.8, r * 0.16, r * 2.6, 'x', [-L * 0.46, 0, 0]),
        ]),
      ),
      piece('nameplate', 'System marking', 'accent', cylinder(r * 1.25, r * 0.5, 'x', [L * 0.2, 0, 0], 18)),
    ],
  };
};

/** Sea chest: box, strainer basket, bolted cover, outlet and vent. */
const seaChest: Builder = ({ height: H, width: W }) => {
  const r = W / 2;

  return {
    pieces: [
      piece('chest', 'Sea chest box', 'bulkhead', ribbedPanel([r * 2.6, H * 0.6, r * 2.2], [0, -H * 0.15, 0], 3, 0.05)),
      piece('strainer', 'Strainer basket', 'galvanised', cylinder(r * 0.78, H * 0.38, 'y', [0, H * 0.06, 0], 18)),
      piece(
        'cover',
        'Bolted cover',
        'bronze',
        merge([
          cylinder(r * 1.05, H * 0.08, 'y', [0, H * 0.3, 0], 20),
          boltCircle(8, r * 0.88, r * 0.09, H * 0.12, 'y', [0, H * 0.3, 0]),
        ]),
      ),
      piece('outlet', 'Outlet branch', 'bronze', flangedStub(r * 0.4, H * 0.5, 'y', [0, H * 0.62, 0])),
      piece('vent', 'Vent pipe', 'copper', cylinder(r * 0.12, H * 0.7, 'y', [r * 0.8, H * 0.5, 0], 10)),
      piece('nameplate', 'System marking', 'accent', cylinder(r * 1.12, H * 0.05, 'y', [0, H * 0.36, 0], 20)),
    ],
  };
};

/** Structural tank: stiffened shell, manhole, sounding pipe, vent head. */
const tank: Builder = ({ length: L, height: H, width: W }) => ({
  pieces: [
    piece('shell', 'Tank shell', 'bulkhead', ribbedPanel([L, H, W], [0, 0, 0], 8, 0.07)),
    piece(
      'manhole',
      'Manhole cover',
      'framing',
      merge([
        cylinder(Math.min(W, H) * 0.3, H * 0.06, 'y', [L * 0.3, H * 0.52, 0], 20),
        boltCircle(8, Math.min(W, H) * 0.24, 0.035, H * 0.09, 'y', [L * 0.3, H * 0.52, 0]),
      ]),
    ),
    piece(
      'sounding-pipe',
      'Sounding pipe',
      'galvanised',
      cylinder(0.055, H * 0.55, 'y', [-L * 0.3, H * 0.75, 0], 10),
    ),
    piece(
      'vent-head',
      'Air vent head',
      'galvanised',
      merge([
        cylinder(0.075, H * 0.5, 'y', [-L * 0.36, H * 0.72, 0], 10),
        sphere(0.14, [-L * 0.36, H * 0.99, 0], 14),
      ]),
    ),
    piece('suction', 'Suction branch', 'bronze', flangedStub(0.09, H * 0.3, 'x', [L * 0.56, -H * 0.3, 0])),
    piece('nameplate', 'System marking', 'accent', box([L * 0.28, H * 0.12, 0.05], [0, 0, W * 0.5])),
  ],
});

export const ARCHETYPES: Readonly<Record<string, Builder>> = {
  // Machinery spaces
  'centrifugal-pump': centrifugalPump,
  'medium-speed-diesel': mediumSpeedDiesel,
  'generator-set': generatorSet,
  switchboard,
  'plate-heat-exchanger': plateHeatExchanger,
  'shaft-line': shaftLine,
  'sea-chest': seaChest,
  tank,
  'air-compressor': airCompressor,
  purifier,
  'steering-gear': steeringGear,
  'bow-thruster': bowThruster,
  // Weather deck and outfit
  'deck-crane': deckCrane,
  'hatch-cover': hatchCover,
  windlass,
  'mooring-winch': mooringWinch,
  bollard,
  funnel,
  mast,
  lifeboat,
  // Underwater
  propeller,
  rudder,
};

export function isArchetypeId(value: string): boolean {
  return value in ARCHETYPES;
}

/** Builds an assembly, or null if the archetype is unknown. */
export function buildAssembly(id: string, spec: ArchetypeSpec): PartAssembly | null {
  const builder = ARCHETYPES[id];
  return builder ? builder(spec) : null;
}
