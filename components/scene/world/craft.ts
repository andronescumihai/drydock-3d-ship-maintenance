/**
 * Procedural aircraft, boats and people for the scenery around the vessel.
 *
 * Conventions match the rest of the scene: every craft is modelled along +X
 * (bow / nose forward), +Y up, +Z to starboard, in metres. Boats have their
 * origin on the design waterline, aircraft at the centre of gravity. Static
 * parts are merged into one vertex-coloured geometry per craft (plus one for
 * glass, which is shaded differently); only what animates — rotors, arms,
 * paddles, rods — is kept separate.
 *
 * Proportions follow the real types closely enough to read right from a few
 * hundred metres: lofted hulls with sheer, flare and a V bottom, a boot stripe
 * at the waterline, airliner wings with an airfoil section, sweep and
 * dihedral. This is scenery, not a model of any particular aircraft or boat,
 * and it carries no markings.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GlowSpec } from './glow';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Converts to plain, coloured triangles so any parts can be merged. */
function paint(geometry: THREE.BufferGeometry, color: string | THREE.Color): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('color')) {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('[DryDock] could not merge craft parts');
  merged.computeBoundingSphere();
  return merged;
}

/** A thin planform (fin, sail, plate) from an outline in its XY plane. */
function plate(outline: readonly (readonly [number, number])[], thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(outline[0]![0], outline[0]![1]);
  for (const [x, y] of outline.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 2 });
  geometry.translate(0, 0, -thickness / 2);
  return geometry;
}

/** A body of revolution along +X from a radius profile (t = 0 tail .. 1 nose). */
function lathe(length: number, profile: readonly (readonly [number, number])[], segments = 16): THREE.BufferGeometry {
  const points = profile.map(([t, r]) => new THREE.Vector2(Math.max(r, 0.001), (t - 0.5) * length));
  const geometry = new THREE.LatheGeometry(points, segments);
  geometry.rotateZ(-Math.PI / 2);
  return geometry;
}

/**
 * A surface lofted through rings of points (same count per ring), smooth
 * normals, optional per-vertex colours from a function of position.
 */
function loft(
  rings: readonly THREE.Vector3[][],
  closed: boolean,
  colorAt?: (p: THREE.Vector3) => THREE.Color,
): THREE.BufferGeometry {
  const n = rings[0]!.length;
  const positions: number[] = [];
  const colors: number[] = [];
  for (const ring of rings) {
    for (const p of ring) {
      positions.push(p.x, p.y, p.z);
      if (colorAt) {
        const c = colorAt(p);
        colors.push(c.r, c.g, c.b);
      }
    }
  }
  const index: number[] = [];
  const segs = closed ? n : n - 1;
  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let i = 0; i < segs; i += 1) {
      const a = r * n + i;
      const b = r * n + ((i + 1) % n);
      const c = (r + 1) * n + i;
      const d = (r + 1) * n + ((i + 1) % n);
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colorAt) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** NACA-style section, chord along +X from 0 (leading edge) to 1, thickness t. */
function airfoil(t: number, points = 10): [number, number][] {
  const half = (x: number): number =>
    5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const upper: [number, number][] = [];
  const lower: [number, number][] = [];
  for (let i = 0; i <= points; i += 1) {
    const x = (1 - Math.cos((i / points) * Math.PI)) / 2;
    upper.push([x, half(x) * 1.15]);
    lower.push([x, -half(x) * 0.75]);
  }
  // Closed loop: trailing edge → upper → leading edge → lower → trailing edge.
  return [...upper.reverse(), ...lower.slice(1, -1)];
}

/**
 * A wing-like surface: sections placed along a span direction. `station(s)`
 * gives the leading-edge position, chord and thickness at span fraction s.
 */
function lofteWing(
  steps: number,
  station: (s: number) => { le: THREE.Vector3; chord: number; thickness: number },
  plane: 'horizontal' | 'vertical',
): THREE.BufferGeometry {
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const { le, chord, thickness } = station(i / steps);
    rings.push(
      airfoil(thickness).map(([x, y]) =>
        plane === 'horizontal'
          ? new THREE.Vector3(le.x - x * chord, le.y + y * chord, le.z)
          : new THREE.Vector3(le.x - x * chord, le.y, le.z + y * chord),
      ),
    );
  }
  return loft(rings, true);
}

// ---------------------------------------------------------------------------
// Airliner
// ---------------------------------------------------------------------------

export interface AirlinerLights {
  readonly port: THREE.Vector3;
  readonly starboard: THREE.Vector3;
  readonly tail: THREE.Vector3;
  readonly beacon: THREE.Vector3;
  readonly landing: THREE.Vector3;
  /** Engine exhausts, for vapour trails. */
  readonly engines: readonly THREE.Vector3[];
}

/**
 * A generic twin-engine narrow-body jet, 38 m long with a 35 m span: round
 * fuselage with an ogive nose and an upswept tail cone, swept and tapered
 * wings with dihedral and winglets, underwing turbofans on pylons, a swept
 * fin and tailplane.
 */
export function buildAirliner(tailColor: string): {
  geometry: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  lights: AirlinerLights;
} {
  const L = 38;
  const R = 1.98;
  const fuselage = lathe(
    L,
    [
      [0, 0.12],
      [0.02, 0.45],
      [0.06, 0.95],
      [0.12, 1.45],
      [0.2, 1.85],
      [0.26, R],
      [0.83, R],
      [0.88, 1.92],
      [0.92, 1.72],
      [0.955, 1.35],
      [0.98, 0.85],
      [0.993, 0.42],
      [1, 0.02],
    ],
    28,
  );
  // Upswept tail cone; a slightly flattened belly.
  const pos = fuselage.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const cone = Math.max(0, (-L * 0.24 - x) / (L * 0.26));
    pos.setY(i, pos.getY(i) * (pos.getY(i) < 0 ? 0.96 : 1) + cone * cone * 1.25);
  }
  fuselage.computeVertexNormals();

  const sweep = Math.tan(27 * (Math.PI / 180));
  const dihedral = Math.tan(5.5 * (Math.PI / 180));
  const wing = (side: number): THREE.BufferGeometry =>
    lofteWing(
      8,
      (s) => {
        const span = 1.6 + s * 15.6;
        const kink = Math.min(s, 0.3) / 0.3;
        return {
          le: new THREE.Vector3(3.6 - span * sweep, -1.05 + span * dihedral, side * span),
          chord: 7.4 * (1 - 0.35 * kink) * (1 - s) + 1.7 * s,
          thickness: 0.14 - 0.05 * s,
        };
      },
      'horizontal',
    );
  const winglet = (side: number): THREE.BufferGeometry =>
    lofteWing(
      3,
      (s) => ({
        le: new THREE.Vector3(3.6 - 17.2 * sweep - s * 1.3, -1.05 + 17.2 * dihedral + s * 2.2, side * (17.2 + s * 0.35)),
        chord: 1.7 - s * 0.9,
        thickness: 0.08,
      }),
      'vertical',
    );

  const tailSweep = Math.tan(32 * (Math.PI / 180));
  const tailplane = (side: number): THREE.BufferGeometry =>
    lofteWing(
      4,
      (s) => {
        const span = 0.9 + s * 5.9;
        return {
          le: new THREE.Vector3(-L * 0.36 - span * tailSweep, 1.0 + span * 0.1, side * span),
          chord: 3.9 * (1 - s) + 1.5 * s,
          thickness: 0.1,
        };
      },
      'horizontal',
    );
  const fin = lofteWing(
    5,
    (s) => {
      const h = s * 6.9;
      return {
        le: new THREE.Vector3(-L * 0.31 - h * Math.tan(38 * (Math.PI / 180)), 1.8 + h, 0),
        chord: 6.2 * (1 - s) + 2.0 * s,
        thickness: 0.11,
      };
    },
    'vertical',
  );

  const engines: THREE.Vector3[] = [];
  const nacelle = (side: number): THREE.BufferGeometry[] => {
    const z = side * 5.7;
    const x = 2.3;
    const y = -2.25;
    const body = lathe(
      4.6,
      [
        [0, 0.55],
        [0.08, 0.72],
        [0.3, 1.02],
        [0.75, 1.12],
        [0.93, 1.1],
        [1, 1.0],
      ],
      20,
    ).translate(x, y, z);
    const fan = new THREE.CircleGeometry(0.92, 20).rotateY(Math.PI / 2).translate(x + 2.28, y, z);
    const lip = new THREE.TorusGeometry(1.0, 0.07, 6, 20).rotateY(Math.PI / 2).translate(x + 2.3, y, z);
    const cone = lathe(
      0.9,
      [
        [0, 0.02],
        [1, 0.42],
      ],
      12,
    ).translate(x - 2.55, y, z);
    const pylon = plate(
      [
        [0, 0],
        [-3.2, 0],
        [-3.6, 1.2],
        [0.6, 1.2],
      ],
      0.35,
    ).translate(x + 0.6, y + 0.6, z);
    engines.push(new THREE.Vector3(x - 3.2, y, z));
    return [paint(body, '#e8ebee'), paint(fan, '#1b2026'), paint(lip, '#a4acb5'), paint(cone, '#7c848c'), paint(pylon, '#d4d9de')];
  };

  const belly = new THREE.SphereGeometry(1, 20, 12).scale(6.5, 1.1, 2.1).translate(-0.8, -1.55, 0);

  // Cabin windows and the windscreen go into the glass geometry.
  const windows: THREE.BufferGeometry[] = [];
  const pane = new THREE.BoxGeometry(0.26, 0.36, 0.05);
  for (let i = 0; i < 29; i += 1) {
    const x = 9.4 - i * 0.82;
    for (const side of [-1, 1]) windows.push(pane.clone().translate(x, 0.55, side * (R - 0.02)));
  }
  const screen = new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0.9, 0.45)
    .rotateZ(-Math.PI / 2)
    .scale(1.25, 1.02, 1.02)
    .translate(L * 0.415, 0.25, 0);

  const cheat = (side: number): THREE.BufferGeometry =>
    new THREE.BoxGeometry(L * 0.62, 0.14, 0.04).translate(-0.4, -0.02, side * (R + 0.005));

  const geometry = merge([
    paint(fuselage, '#f3f5f7'),
    paint(belly, '#d8dce1'),
    paint(wing(1), '#c9cfd6'),
    paint(wing(-1), '#c9cfd6'),
    paint(winglet(1), tailColor),
    paint(winglet(-1), tailColor),
    paint(tailplane(1), '#c9cfd6'),
    paint(tailplane(-1), '#c9cfd6'),
    paint(fin, tailColor),
    paint(cheat(1), tailColor),
    paint(cheat(-1), tailColor),
    ...nacelle(1),
    ...nacelle(-1),
  ]);
  const glass = merge([...windows.map((w) => paint(w, '#1a232c')), paint(screen, '#10171e')]);

  return {
    geometry,
    glass,
    lights: {
      port: new THREE.Vector3(3.6 - 17.2 * sweep - 0.2, -1.05 + 17.2 * dihedral, -17.3),
      starboard: new THREE.Vector3(3.6 - 17.2 * sweep - 0.2, -1.05 + 17.2 * dihedral, 17.3),
      tail: new THREE.Vector3(-L * 0.5 - 0.1, 1.3, 0),
      beacon: new THREE.Vector3(0, R + 0.15, 0),
      landing: new THREE.Vector3(L * 0.37, -1.7, 0),
      engines,
    },
  };
}

// ---------------------------------------------------------------------------
// Helicopter
// ---------------------------------------------------------------------------

/** A light utility helicopter; the rotors are returned separately to spin. */
export function buildHelicopter(): {
  body: THREE.BufferGeometry;
  rotor: THREE.BufferGeometry;
  tailRotor: THREE.BufferGeometry;
  rotorHub: THREE.Vector3;
  tailHub: THREE.Vector3;
} {
  const cabin = lathe(
    4.4,
    [
      [0, 0.3],
      [0.2, 0.95],
      [0.55, 1.15],
      [0.85, 1.0],
      [1, 0.25],
    ],
    18,
  );
  cabin.scale(1, 1.05, 0.85);
  const glass = new THREE.SphereGeometry(0.95, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)
    .rotateZ(-Math.PI / 2)
    .scale(1.1, 0.9, 0.85)
    .translate(1.35, 0.15, 0);
  const boom = new THREE.CylinderGeometry(0.16, 0.32, 5.2, 10).rotateZ(Math.PI / 2).translate(-4.4, 0.35, 0);
  const tailFin = plate(
    [
      [0.3, 0],
      [-0.6, 0],
      [-1.0, 1.4],
      [-0.4, 1.4],
    ],
    0.08,
  ).translate(-6.7, 0.3, 0);
  const mast = new THREE.CylinderGeometry(0.12, 0.18, 0.7, 8).translate(0, 1.35, 0);
  const skidGeo = new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6).rotateZ(Math.PI / 2);
  const skidL = skidGeo.clone().translate(0.1, -1.45, -0.9);
  const skidR = skidGeo.clone().translate(0.1, -1.45, 0.9);
  const strut = new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6);
  const struts = [-0.9, 0.9].flatMap((z) => [0.9, -0.7].map((x) => strut.clone().translate(x, -1.1, z)));

  const body = merge([
    paint(cabin, '#d8412f'),
    paint(glass, '#1e2a36'),
    paint(boom, '#d8412f'),
    paint(tailFin, '#f2f2f2'),
    paint(mast, '#3a3f45'),
    paint(skidL, '#3a3f45'),
    paint(skidR, '#3a3f45'),
    ...struts.map((s) => paint(s, '#3a3f45')),
  ]);

  const blade = new THREE.BoxGeometry(9.4, 0.05, 0.28);
  const rotor = merge([paint(blade.clone(), '#2a2e33'), paint(blade.clone().rotateY(Math.PI / 2), '#2a2e33')]);
  const tailRotor = merge([
    paint(new THREE.BoxGeometry(0.12, 1.5, 0.05), '#2a2e33'),
    paint(new THREE.BoxGeometry(0.12, 0.05, 1.5).rotateX(Math.PI / 2), '#2a2e33'),
  ]);
  return {
    body,
    rotor,
    tailRotor,
    rotorHub: new THREE.Vector3(0, 1.72, 0),
    tailHub: new THREE.Vector3(-6.8, 0.9, 0.25),
  };
}

// ---------------------------------------------------------------------------
// Boats
// ---------------------------------------------------------------------------

interface HullSpec {
  readonly length: number;
  readonly beam: number;
  /** Height of the gunwale above the waterline amidships. */
  readonly freeboard: number;
  /** Extra sheer at the bow. */
  readonly bowRise: number;
  /** Depth of the keel below the waterline. */
  readonly draft: number;
  readonly topsides: string;
  readonly bottom: string;
  readonly boot: string;
  readonly deck: string;
}

interface HullBuild {
  readonly parts: THREE.BufferGeometry[];
  /** Deck height at a position along the hull (x in metres). */
  readonly deckAt: (x: number) => number;
  /** Half-breadth at the gunwale at x. */
  readonly halfBeamAt: (x: number) => number;
}

/**
 * A lofted planing/displacement hull: V bottom with a hard chine, flared
 * topsides, sheer rising to the bow, a fine entry and a flat transom — plus
 * antifouling below the waterline, a boot stripe on it and a deck on top.
 */
function buildHull(spec: HullSpec): HullBuild {
  const { length: L, beam: B, freeboard, bowRise, draft } = spec;
  const halfBeam = (t: number): number => {
    const hb = t < 0.55 ? 0.9 + (0.1 * t) / 0.55 : Math.sqrt(Math.max(0, 1 - ((t - 0.55) / 0.45) ** 2));
    return Math.max(0.004, (B / 2) * hb);
  };
  const sheer = (t: number): number => freeboard + bowRise * t * t;
  const keel = (t: number): number => -draft * (t < 0.7 ? 1 : 1 - Math.pow((t - 0.7) / 0.3, 1.4) * 0.92);
  const toT = (x: number): number => THREE.MathUtils.clamp(x / L + 0.5, 0, 1);

  /** The starboard half-section at t, keel to gunwale. */
  const section = (t: number): [number, number][] => {
    const hb = halfBeam(t);
    const k = keel(t);
    const s = sheer(t);
    return [
      [0, k],
      [hb * 0.55, k * 0.62],
      [hb * 0.86, k * 0.22],
      [hb * 0.95, s * 0.35],
      [hb, s],
    ];
  };

  const steps = 26;
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = (t - 0.5) * L;
    const half = section(t);
    const ring = [
      ...half
        .slice()
        .reverse()
        .map(([z, y]) => new THREE.Vector3(x, y, -z)),
      ...half.slice(1).map(([z, y]) => new THREE.Vector3(x, y, z)),
    ];
    rings.push(ring);
  }
  const top = new THREE.Color(spec.topsides);
  const bottom = new THREE.Color(spec.bottom);
  const shell = loft(rings, false, (p) => (p.y < 0.02 ? bottom : top));

  // Boot stripe: a band just outside the shell at the waterline.
  const zAtY = (t: number, y: number): number => {
    const half = section(t);
    for (let i = 0; i < half.length - 1; i += 1) {
      const [z0, y0] = half[i]!;
      const [z1, y1] = half[i + 1]!;
      if ((y >= y0 && y <= y1) || (y <= y0 && y >= y1)) {
        const f = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
        return z0 + (z1 - z0) * f;
      }
    }
    return halfBeam(t);
  };
  const stripe = (side: number): THREE.BufferGeometry => {
    const bands: THREE.Vector3[][] = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = Math.min(i / steps, 0.985);
      const x = (t - 0.5) * L;
      bands.push([
        new THREE.Vector3(x, 0.02, side * (zAtY(t, 0.02) + 0.012)),
        new THREE.Vector3(x, 0.16, side * (zAtY(t, 0.16) + 0.012)),
      ]);
    }
    return loft(bands, false);
  };

  // Deck: a surface between the gunwales just below the sheer.
  const deckRings: THREE.Vector3[][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = (t - 0.5) * L;
    const hb = halfBeam(t) * 0.97;
    const y = sheer(t) - 0.12;
    deckRings.push([new THREE.Vector3(x, y, -hb), new THREE.Vector3(x, y + 0.03, 0), new THREE.Vector3(x, y, hb)]);
  }
  const deck = loft(deckRings, false);

  // Transom: close the stern section.
  const transomOutline = [
    ...section(0).map(([z, y]) => new THREE.Vector2(z, y)),
    ...section(0)
      .slice(1)
      .reverse()
      .map(([z, y]) => new THREE.Vector2(-z, y)),
  ];
  const transom = new THREE.ShapeGeometry(new THREE.Shape(transomOutline)).rotateY(-Math.PI / 2).translate(-L / 2, 0, 0);

  // Rubbing strake along the gunwale.
  const strake = (side: number): THREE.BufferGeometry => {
    const bands: THREE.Vector3[][] = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = Math.min(i / steps, 0.985);
      const x = (t - 0.5) * L;
      const hb = halfBeam(t) + 0.02;
      bands.push([new THREE.Vector3(x, sheer(t) - 0.09, side * hb), new THREE.Vector3(x, sheer(t) + 0.01, side * hb)]);
    }
    return loft(bands, false);
  };

  return {
    parts: [
      paint(shell, top),
      paint(stripe(1), spec.boot),
      paint(stripe(-1), spec.boot),
      paint(deck, spec.deck),
      paint(transom, spec.topsides),
      paint(strake(1), '#d9d9d6'),
      paint(strake(-1), '#d9d9d6'),
    ],
    deckAt: (x) => sheer(toT(x)) - 0.1,
    halfBeamAt: (x) => halfBeam(toT(x)),
  };
}

export interface BoatModel {
  readonly geometry: THREE.BufferGeometry;
  /** Windows, windscreens and portholes. */
  readonly glass: THREE.BufferGeometry | null;
  readonly length: number;
  readonly beam: number;
  /** Where people stand or sit (their feet / seat), in boat coordinates. */
  readonly seats: readonly THREE.Vector3[];
  /** Stern position, for a wake. */
  readonly stern: THREE.Vector3;
  /** Lights shown after dark, in boat coordinates (COLREGs practice for the craft). */
  readonly lights: readonly GlowSpec[];
}

/** A small inshore fishing boat: blue hull, wheelhouse forward, working deck aft. */
export function buildFishingBoat(): BoatModel {
  const length = 9;
  const beam = 3.0;
  const hull = buildHull({
    length,
    beam,
    freeboard: 1.05,
    bowRise: 0.6,
    draft: 0.8,
    topsides: '#2d6f93',
    bottom: '#6e2c24',
    boot: '#f0ede6',
    deck: '#b9ab8e',
  });
  const deck = hull.deckAt(0.9);
  const house = new THREE.BoxGeometry(2.5, 1.85, 2.1).translate(1.0, deck + 0.92, 0);
  const roof = new THREE.BoxGeometry(2.9, 0.1, 2.5).translate(0.95, deck + 1.9, 0);
  const mast = new THREE.CylinderGeometry(0.05, 0.07, 2.6, 8).translate(0.6, deck + 3.2, 0);
  const yard = new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6).rotateX(Math.PI / 2).translate(0.6, deck + 3.8, 0);
  const aftDeck = hull.deckAt(-2.8);
  const hatch = new THREE.BoxGeometry(1.4, 0.35, 1.3).translate(-2.4, aftDeck + 0.17, 0);
  const bin = new THREE.BoxGeometry(0.7, 0.5, 0.9).translate(-3.5, aftDeck + 0.25, 0.7);
  const floats = [-0.9, -0.4].map((z) => new THREE.SphereGeometry(0.18, 10, 8).translate(-3.3, aftDeck + 0.18, z));
  const bulwark = (side: number): THREE.BufferGeometry =>
    new THREE.BoxGeometry(length * 0.55, 0.32, 0.05).translate(-1.6, hull.deckAt(-1.6) + 0.26, side * (hull.halfBeamAt(-1.6) - 0.04));
  const outrigger = (side: number): THREE.BufferGeometry =>
    new THREE.CylinderGeometry(0.03, 0.04, 4.2, 6)
      .rotateX(side * 0.95)
      .translate(-0.2, deck + 2.3, side * 1.6);

  const glass = merge(
    [
      new THREE.BoxGeometry(0.05, 0.62, 1.8).translate(2.26, deck + 1.35, 0),
      new THREE.BoxGeometry(1.6, 0.55, 0.05).translate(1.05, deck + 1.35, 1.06),
      new THREE.BoxGeometry(1.6, 0.55, 0.05).translate(1.05, deck + 1.35, -1.06),
    ].map((g) => paint(g, '#18222b')),
  );

  return {
    geometry: merge([
      ...hull.parts,
      paint(house, '#f2efe7'),
      paint(roof, '#2d6f93'),
      paint(mast, '#d9d6cd'),
      paint(yard, '#d9d6cd'),
      paint(hatch, '#8a8272'),
      paint(bin, '#e39a2e'),
      ...floats.map((f) => paint(f, '#ff6a1a')),
      paint(bulwark(1), '#2d6f93'),
      paint(bulwark(-1), '#2d6f93'),
      paint(outrigger(1), '#c8c4b8'),
      paint(outrigger(-1), '#c8c4b8'),
    ]),
    glass,
    length,
    beam,
    seats: [new THREE.Vector3(-3.4, aftDeck, -0.5), new THREE.Vector3(-1.2, hull.deckAt(-1.2), 0.8)],
    stern: new THREE.Vector3(-length / 2, 0, 0),
    // Fishing (not trawling): all-round red over white on the mast, a deck
    // work light on the wheelhouse roof.
    lights: [
      { position: [0.6, deck + 4.35, 0], color: '#ff3b2e', size: 0.34 },
      { position: [0.6, deck + 3.75, 0], color: '#fff6e8', size: 0.34 },
      { position: [-0.45, deck + 2.0, 0], color: '#f4f7ff', size: 0.9 },
      { position: [2.1, deck + 1.35, 1.06], color: '#ffd9a0', size: 0.28 },
    ],
  };
}

/** A bowrider speedboat with an outboard. */
export function buildSpeedboat(): BoatModel {
  const length = 7.4;
  const beam = 2.5;
  const hull = buildHull({
    length,
    beam,
    freeboard: 0.9,
    bowRise: 0.32,
    draft: 0.5,
    topsides: '#f5f5f3',
    bottom: '#1f2d3a',
    boot: '#1f5fa8',
    deck: '#d8cdb8',
  });
  const deck = hull.deckAt(0);
  const console_ = new THREE.BoxGeometry(0.8, 0.8, 0.85).translate(0.6, deck + 0.4, 0.45);
  const bench = new THREE.BoxGeometry(1.1, 0.42, beam * 0.8).translate(-2.3, deck + 0.21, 0);
  const backrest = new THREE.BoxGeometry(0.22, 0.5, beam * 0.8).translate(-2.9, deck + 0.55, 0);
  const helmSeat = new THREE.BoxGeometry(0.6, 0.45, 0.6).translate(-0.3, deck + 0.22, 0.45);
  const sunpad = new THREE.BoxGeometry(1.4, 0.12, beam * 0.6).translate(2.2, hull.deckAt(2.2) + 0.06, 0);
  const cowling = lathe(
    0.95,
    [
      [0, 0.25],
      [0.4, 0.34],
      [1, 0.28],
    ],
    12,
  )
    .rotateZ(Math.PI / 2)
    .scale(1, 1, 0.8)
    .translate(-length / 2 - 0.35, 0.95, 0);
  const leg = new THREE.BoxGeometry(0.16, 1.0, 0.14).translate(-length / 2 - 0.35, 0.1, 0);
  const rail = (side: number): THREE.BufferGeometry => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.9, hull.deckAt(0.9) + 0.32, side * (hull.halfBeamAt(0.9) - 0.06)),
      new THREE.Vector3(2.4, hull.deckAt(2.4) + 0.32, side * (hull.halfBeamAt(2.4) - 0.06)),
      new THREE.Vector3(3.45, hull.deckAt(3.45) + 0.3, side * 0.05),
    ]);
    return new THREE.TubeGeometry(curve, 16, 0.02, 5, false);
  };
  const windscreen = new THREE.CylinderGeometry(1.25, 1.25, 0.5, 20, 1, true, -1.15, 2.3)
    .rotateZ(-0.35)
    .scale(0.6, 1, 1)
    .translate(0.4, deck + 0.95, 0);

  return {
    geometry: merge([
      ...hull.parts,
      paint(console_, '#ebe6da'),
      paint(bench, '#f3efe6'),
      paint(backrest, '#f3efe6'),
      paint(helmSeat, '#f3efe6'),
      paint(sunpad, '#f3efe6'),
      paint(cowling, '#202428'),
      paint(leg, '#2a2e33'),
      paint(rail(1), '#c9ced3'),
      paint(rail(-1), '#c9ced3'),
    ]),
    glass: merge([paint(windscreen, '#2a3a46')]),
    length,
    beam,
    seats: [
      new THREE.Vector3(-0.3, deck + 0.45, 0.45),
      new THREE.Vector3(-2.3, deck + 0.42, -0.55),
      new THREE.Vector3(-2.3, deck + 0.42, 0.55),
    ],
    stern: new THREE.Vector3(-length / 2 - 0.35, 0, 0),
    // Power-driven, under way: sidelights at the bow, all-round white aft.
    lights: [
      { position: [2.95, hull.deckAt(2.95) + 0.36, -0.2], color: '#ff2a22', size: 0.24 },
      { position: [2.95, hull.deckAt(2.95) + 0.36, 0.2], color: '#1eff6e', size: 0.24 },
      { position: [-length / 2 + 0.25, deck + 1.25, 0], color: '#fff6e8', size: 0.28 },
    ],
  };
}

/** A 10 m sloop: cabin trunk with portholes, cockpit, fin keel, curved sails. */
export function buildSailboat(): BoatModel & { sails: THREE.BufferGeometry; rigging: THREE.BufferGeometry } {
  const length = 10.5;
  const beam = 3.3;
  const hull = buildHull({
    length,
    beam,
    freeboard: 1.05,
    bowRise: 0.28,
    draft: 0.55,
    topsides: '#f4f2ec',
    bottom: '#223044',
    boot: '#223044',
    deck: '#b89468',
  });
  const deck = hull.deckAt(0);
  const trunk = new THREE.BoxGeometry(3.4, 0.55, 2.1).translate(0.6, deck + 0.27, 0);
  const trunkRoof = new THREE.BoxGeometry(3.3, 0.06, 2.0).translate(0.6, deck + 0.57, 0);
  const cockpitSole = new THREE.BoxGeometry(2.4, 0.05, 1.7).translate(-2.8, deck - 0.35, 0);
  const keel = plate(
    [
      [0.9, 0],
      [-0.5, 0],
      [-0.2, -1.4],
      [0.5, -1.4],
    ],
    0.18,
  ).translate(0.4, -0.45, 0);
  const bulb = new THREE.SphereGeometry(0.22, 10, 8).scale(3.2, 1, 1).translate(0.55, -1.85, 0);
  const rudder = plate(
    [
      [0, 0],
      [-0.5, 0],
      [-0.45, -1.1],
      [-0.05, -1.1],
    ],
    0.08,
  ).translate(-4.3, -0.2, 0);
  const mastX = 1.3;
  const mast = new THREE.CylinderGeometry(0.07, 0.1, 14, 10).translate(mastX, deck + 7, 0);
  const boom = new THREE.CylinderGeometry(0.06, 0.06, 4.1, 8).rotateZ(Math.PI / 2).translate(mastX - 2.05, deck + 1.4, 0);

  // Sails with camber: each is a triangle subdivided and pushed out along a curve.
  const sail = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, camber: number, colour: string): THREE.BufferGeometry => {
    const rows: THREE.Vector3[][] = [];
    const n = 8;
    for (let i = 0; i <= n; i += 1) {
      const v = i / n;
      const lo = new THREE.Vector3().lerpVectors(a, c, v);
      const hi = new THREE.Vector3().lerpVectors(b, c, v);
      const row: THREE.Vector3[] = [];
      for (let j = 0; j <= 6; j += 1) {
        const u = j / 6;
        const p = new THREE.Vector3().lerpVectors(lo, hi, u);
        p.z += Math.sin(u * Math.PI) * camber * (1 - v * 0.8);
        row.push(p);
      }
      rows.push(row);
    }
    return paint(loft(rows, false), colour);
  };
  const main = sail(
    new THREE.Vector3(mastX - 0.05, deck + 1.45, 0),
    new THREE.Vector3(mastX - 4.0, deck + 1.5, 0),
    new THREE.Vector3(mastX - 0.05, deck + 13.6, 0),
    0.55,
    '#fbf9f3',
  );
  const jib = sail(
    new THREE.Vector3(length / 2 - 0.3, hull.deckAt(length / 2 - 0.3) + 0.3, 0),
    new THREE.Vector3(mastX - 0.6, deck + 0.6, 0),
    new THREE.Vector3(mastX + 0.1, deck + 12.2, 0),
    0.45,
    '#f3efe5',
  );

  const riggingPoints = [
    [new THREE.Vector3(mastX, deck + 13.9, 0), new THREE.Vector3(length / 2 - 0.2, hull.deckAt(length / 2 - 0.2) + 0.1, 0)],
    [new THREE.Vector3(mastX, deck + 13.9, 0), new THREE.Vector3(-length / 2 + 0.2, hull.deckAt(-length / 2 + 0.2) + 0.1, 0)],
    [new THREE.Vector3(mastX, deck + 11, 0), new THREE.Vector3(mastX - 0.3, deck, beam / 2 - 0.15)],
    [new THREE.Vector3(mastX, deck + 11, 0), new THREE.Vector3(mastX - 0.3, deck, -beam / 2 + 0.15)],
  ].flat();
  const rigging = new THREE.BufferGeometry().setFromPoints(riggingPoints);

  const portholes: THREE.BufferGeometry[] = [];
  for (const x of [-0.4, 0.4, 1.2, 1.9]) {
    for (const side of [-1, 1]) {
      portholes.push(new THREE.BoxGeometry(0.4, 0.14, 0.04).translate(x, deck + 0.33, side * 1.06));
    }
  }

  return {
    geometry: merge([
      ...hull.parts,
      paint(trunk, '#efece4'),
      paint(trunkRoof, '#e5dfd2'),
      paint(cockpitSole, '#a88458'),
      paint(keel, '#223044'),
      paint(bulb, '#223044'),
      paint(rudder, '#223044'),
      paint(mast, '#c9cdd1'),
      paint(boom, '#c9cdd1'),
    ]),
    glass: merge(portholes.map((p) => paint(p, '#141c24'))),
    sails: merge([main, jib]),
    rigging,
    length,
    beam,
    seats: [new THREE.Vector3(-3.3, deck - 0.05, 0.6), new THREE.Vector3(-2.3, deck - 0.05, -0.7)],
    stern: new THREE.Vector3(-length / 2, 0, 0),
    // Sailing: sidelights on the pulpit, sternlight on the pushpit, and the
    // cabin lit through its portholes.
    lights: [
      { position: [length / 2 - 0.35, hull.deckAt(length / 2 - 0.35) + 0.55, -0.22], color: '#ff2a22', size: 0.26 },
      { position: [length / 2 - 0.35, hull.deckAt(length / 2 - 0.35) + 0.55, 0.22], color: '#1eff6e', size: 0.26 },
      { position: [-length / 2 + 0.2, hull.deckAt(-length / 2 + 0.2) + 0.75, 0], color: '#fff6e8', size: 0.26 },
      { position: [mastX, deck + 14.05, 0], color: '#fff6e8', size: 0.3 },
    ],
  };
}

/** A 4.8 m sea kayak, pointed at both ends, with a cockpit coaming. */
export function buildKayak(deckColor: string, hullColor = '#f4f1ea'): BoatModel {
  const length = 4.8;
  const beam = 0.62;
  const rings: THREE.Vector3[][] = [];
  const steps = 24;
  const around = 14;
  const deckC = new THREE.Color(deckColor);
  const hullC = new THREE.Color(hullColor);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = (t - 0.5) * length;
    const w = Math.max(0.005, (beam / 2) * Math.pow(Math.sin(Math.PI * t), 0.75));
    const rise = 0.08 * Math.pow(Math.abs(t - 0.5) * 2, 3); // ends sweep up
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < around; j += 1) {
      const a = (j / around) * Math.PI * 2;
      const top = Math.sin(a) > 0;
      const y = Math.sin(a) * (top ? 0.2 : 0.16) * Math.pow(Math.sin(Math.PI * t), 0.35) + rise;
      ring.push(new THREE.Vector3(x, y + 0.04, Math.cos(a) * w));
    }
    rings.push(ring);
  }
  const body = loft(rings, true, (p) => (p.y > 0.08 ? deckC : hullC));
  const coaming = new THREE.TorusGeometry(0.34, 0.035, 6, 16).rotateX(Math.PI / 2).scale(1.5, 1, 0.75).translate(-0.1, 0.24, 0);
  const well = new THREE.CircleGeometry(0.33, 16).rotateX(-Math.PI / 2).scale(1.5, 1, 0.75).translate(-0.1, 0.22, 0);
  return {
    geometry: merge([paint(body, deckC), paint(coaming, '#1e242b'), paint(well, '#111418')]),
    glass: null,
    length,
    beam,
    // Low in the hull: the paddler's legs run forward under the deck.
    seats: [new THREE.Vector3(-0.1, 0.02, 0)],
    stern: new THREE.Vector3(-length / 2, 0, 0),
    // A small craft's all-round white torch, clipped to the rear deck.
    lights: [{ position: [-1.5, 0.36, 0], color: '#f2f6ff', size: 0.24 }],
  };
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface PersonStyle {
  readonly skin: string;
  readonly top: string;
  readonly bottom: string;
  readonly hair: string;
  /** Life jacket over the top. */
  readonly vest?: boolean;
  readonly hat?: string;
  /** Long sleeves (top colour down to the wrist) rather than short. */
  readonly sleeves?: boolean;
}

export interface PersonRig {
  readonly root: THREE.Group;
  /** Shoulder pivots: rotation.z swings the arm forward, rotation.x raises it to the side. */
  readonly leftArm: THREE.Group;
  readonly rightArm: THREE.Group;
  /** Elbow pivots (rotation.z bends the forearm forward and up). */
  readonly leftForearm: THREE.Group;
  readonly rightForearm: THREE.Group;
}

const personMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });

/** The shared material of every figure (vertex-coloured). */
export function getPersonMaterial(): THREE.MeshStandardMaterial {
  return personMaterial;
}

const capsule = (radius: number, length: number): THREE.BufferGeometry => new THREE.CapsuleGeometry(radius, length, 3, 10);

/**
 * A figure about 1.75 m tall, standing on its feet at the origin or (with
 * `seated`) sitting with the seat at the origin, knees bent. Body, head and
 * legs are one geometry; each arm is an upper arm with a forearm on an elbow
 * pivot, so the scenery can wave, paddle and hold a rod.
 */
/**
 * A person. `seated` bends the knees as on a bench; `legs: 'forward'` stretches
 * them out level in front, as a kayaker sits — inside the hull, under the deck.
 */
export function buildPerson(style: PersonStyle, seated = false, legs: 'bent' | 'forward' = 'bent'): PersonRig {
  const hip = seated ? 0.12 : 0.9;
  const parts: THREE.BufferGeometry[] = [];

  // Pelvis and torso, a little wider at the shoulders than deep.
  parts.push(paint(capsule(0.15, 0.12).rotateX(Math.PI / 2).scale(1, 1, 1.15).translate(0, hip + 0.02, 0), style.bottom));
  parts.push(paint(capsule(0.17, 0.34).scale(0.85, 1, 1.18).translate(0, hip + 0.33, 0), style.top));
  if (style.vest) {
    parts.push(paint(capsule(0.19, 0.22).scale(0.95, 1, 1.2).translate(0.01, hip + 0.4, 0), '#ff6f14'));
  }
  // Neck and head.
  parts.push(paint(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8).translate(0, hip + 0.66, 0), style.skin));
  parts.push(paint(new THREE.SphereGeometry(0.105, 14, 10).scale(1.05, 1.18, 0.95).translate(0.01, hip + 0.8, 0), style.skin));
  parts.push(
    paint(
      new THREE.SphereGeometry(0.112, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52)
        .scale(1.08, 1.15, 1)
        .translate(-0.01, hip + 0.82, 0),
      style.hair,
    ),
  );
  if (style.hat) {
    parts.push(paint(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 16).translate(0, hip + 0.9, 0), style.hat));
    parts.push(paint(new THREE.CylinderGeometry(0.1, 0.115, 0.09, 12).translate(0, hip + 0.95, 0), style.hat));
  }

  // Legs: thigh and shin, knees bent when seated.
  for (const z of [-0.09, 0.09]) {
    if (seated && legs === 'forward') {
      parts.push(paint(capsule(0.072, 0.34).rotateZ(Math.PI / 2).translate(0.24, hip - 0.03, z), style.bottom));
      parts.push(paint(capsule(0.058, 0.34).rotateZ(Math.PI / 2).translate(0.62, hip - 0.05, z * 0.8), style.skin));
      parts.push(paint(new THREE.BoxGeometry(0.08, 0.16, 0.09).translate(0.84, hip - 0.02, z * 0.8), '#2b2b2b'));
    } else if (seated) {
      parts.push(paint(capsule(0.075, 0.34).rotateZ(Math.PI / 2).translate(0.24, hip - 0.02, z), style.bottom));
      parts.push(paint(capsule(0.06, 0.34).translate(0.46, hip - 0.25, z), style.skin));
      parts.push(paint(new THREE.BoxGeometry(0.22, 0.07, 0.1).translate(0.5, hip - 0.47, z), '#2b2b2b'));
    } else {
      parts.push(paint(capsule(0.078, 0.34).translate(0, hip - 0.24, z), style.bottom));
      parts.push(paint(capsule(0.062, 0.34).translate(0, hip - 0.66, z), style.skin));
      parts.push(paint(new THREE.BoxGeometry(0.22, 0.07, 0.1).translate(0.05, 0.035, z), '#2b2b2b'));
    }
  }

  const root = new THREE.Group();
  const body = new THREE.Mesh(merge(parts), personMaterial);
  root.add(body);

  const arm = (side: number): { shoulder: THREE.Group; elbow: THREE.Group } => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0, hip + 0.5, side * 0.2);
    const upper = new THREE.Mesh(paint(capsule(0.05, 0.22).translate(0, -0.15, 0), style.top), personMaterial);
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    const forearm = new THREE.Mesh(
      merge([
        paint(capsule(0.042, 0.2).translate(0, -0.14, 0), style.sleeves ? style.top : style.skin),
        paint(new THREE.SphereGeometry(0.045, 8, 6).scale(1, 1.3, 0.7).translate(0, -0.3, 0), style.skin),
      ]),
      personMaterial,
    );
    elbow.add(forearm);
    shoulder.add(upper, elbow);
    root.add(shoulder);
    return { shoulder, elbow };
  };
  const left = arm(-1);
  const right = arm(1);

  // Scenery: never in the way of a click on the ship.
  root.traverse((child) => {
    child.raycast = () => undefined;
  });
  return { root, leftArm: left.shoulder, rightArm: right.shoulder, leftForearm: left.elbow, rightForearm: right.elbow };
}

export const PEOPLE: readonly PersonStyle[] = [
  { skin: '#b97e55', top: '#f2f2f2', bottom: '#2e4a6b', hair: '#1c1410', hat: '#e9d9a8', sleeves: true },
  { skin: '#7d4f33', top: '#e8453c', bottom: '#2b2b2b', hair: '#120c09', vest: true },
  { skin: '#e2b391', top: '#2fa4c9', bottom: '#d7c7a1', hair: '#6b4a2b' },
  { skin: '#a06a45', top: '#ffd23f', bottom: '#1f3b57', hair: '#1a1411', vest: true },
  { skin: '#efc3a0', top: '#3d9a57', bottom: '#f4f4f4', hair: '#c9a15a', hat: '#2a2a2a' },
  { skin: '#6a432d', top: '#ffffff', bottom: '#3a5f8a', hair: '#0f0b08' },
  { skin: '#cf9670', top: '#ff8fa3', bottom: '#2c2c34', hair: '#3a2416', vest: true },
];
