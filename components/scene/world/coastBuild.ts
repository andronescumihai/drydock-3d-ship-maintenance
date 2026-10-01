import * as THREE from 'three';
import { fbm, noise2, ridged, rng, smoothstep } from './noise';

/**
 * The Rio de Janeiro waterfront as seen from the sea at sunset — a stylised
 * reconstruction for the backdrop, not survey data.
 *
 * The layout follows the real skyline from west to east (left to right in the
 * opening view): the flat-topped monolith of Pedra da Gávea, the twin peaks of
 * Dois Irmãos over the end of the Leblon–Ipanema beach, the Arpoador rocks,
 * the long crescent of Copacabana lined with a wall of apartment blocks, the
 * Babilônia hill, and at the mouth of the bay the Morro da Urca and the Pão de
 * Açúcar, standing next to the setting sun with the cable car running up to
 * them. Behind the city rise the forested Tijuca massif and the spire of
 * Corcovado; the lagoon sits behind Ipanema; favelas climb the hillsides; the
 * Cagarras islets lie offshore. Across the bay mouth, to the right of the sun,
 * is the lower Niterói shore. Heights are the real ones in metres; distances
 * are compressed so it all fits the view.
 *
 * Everything is generated here from those landmarks and seeded noise. The
 * build is a generator that yields every few milliseconds, so the scene can
 * run it a slice per frame without a stall (and without a web worker, which
 * not every bundler setup handles the same way).
 *
 * Coordinates: azimuth in degrees from +X towards +Z, as everywhere in the
 * scene; heights above mean sea level (the caller's `seaLevel` is added).
 */

const DEG = Math.PI / 180;

const bump = (u: number): number => Math.exp(-u * u);

function azimuthOf(x: number, z: number): number {
  const a = Math.atan2(z, x) / DEG;
  return a < 0 ? a + 360 : a;
}

function polar(azDeg: number, r: number): [number, number] {
  return [Math.cos(azDeg * DEG) * r, Math.sin(azDeg * DEG) * r];
}

/** Polynomial smooth maximum: joins a landform to the ground under it without a crease. */
function smax(a: number, b: number, k: number): number {
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (b - a)) / k));
  return a * (1 - h) + b * h + k * h * (1 - h);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** 1 in the stretch of open sea left under the setting sun (azimuth 241°). */
function sunGap(az: number): number {
  return smoothstep(229.5, 232.5, az) * (1 - smoothstep(249, 253, az));
}

/** Distance from the vessel to the shoreline along an azimuth, metres. */
export function shoreRadius(az: number): number {
  let r: number;
  if (az < 170) {
    // Barra da Tijuca: a long, nearly straight beach running away west.
    r = 7600 + (170 - az) * 55;
  } else {
    r = 5600;
    r += 700 * bump((az - 210.5) / 6.2); // Copacabana crescent
    r += 520 * bump((az - 190.5) / 5.2); // Ipanema–Leblon
    r -= 520 * bump((az - 199.2) / 1.2); // Arpoador point
    r -= 380 * bump((az - 181.2) / 1.6); // foot of Dois Irmãos
    r += 900 * smoothstep(176, 170, az); // round the headland towards Barra
    r -= 700 * bump((az - 222.5) / 2.2); // Leme / Babilônia point
    r += 650 * bump((az - 225.6) / 0.9); // Praia Vermelha cove under the domes
    r -= 900 * bump((az - 227.5) / 1.6); // the Urca peninsula
  }
  // Niterói, across the bay mouth.
  const east = smoothstep(249, 256, az);
  r = r * (1 - east) + (8300 + 700 * Math.sin((az - 256) * 0.1) + 500 * bump((az - 266) / 3)) * east;
  r += 60 * (fbm(az * 0.9, 1.3, 3, 5) - 0.5) * 2;
  const gap = sunGap(az);
  return r * (1 - gap) + 40000 * gap;
}

type Shape = 'dome' | 'round' | 'peak' | 'table' | 'massif';

interface Landform {
  readonly name: string;
  readonly az: number;
  readonly r: number;
  readonly height: number;
  /** Half-width across the line of sight and along it, metres. */
  readonly across: number;
  readonly along: number;
  readonly shape: Shape;
  /** Bare granite (true) or forest to the top. */
  readonly rock: boolean;
  /** A sharp summit pinnacle, as a fraction of the height (peaks only). */
  readonly spire?: number;
}

const LANDFORMS: readonly Landform[] = [
  { name: 'Pão de Açúcar', az: 227.3, r: 3950, height: 396, across: 185, along: 360, shape: 'dome', rock: true },
  { name: 'Morro da Urca', az: 224.9, r: 4300, height: 220, across: 300, along: 380, shape: 'round', rock: false },
  { name: 'Cotunduba', az: 231.2, r: 3700, height: 58, across: 150, along: 120, shape: 'round', rock: true },
  { name: 'Babilônia', az: 221.4, r: 5250, height: 240, across: 420, along: 520, shape: 'round', rock: false },
  { name: 'São João', az: 218.6, r: 6600, height: 210, across: 420, along: 500, shape: 'round', rock: false },
  { name: 'Cabritos', az: 203.8, r: 6950, height: 250, across: 460, along: 520, shape: 'round', rock: false },
  { name: 'Cantagalo', az: 200.3, r: 6250, height: 150, across: 300, along: 380, shape: 'round', rock: false },
  { name: 'Arpoador', az: 199.2, r: 5150, height: 34, across: 90, along: 120, shape: 'round', rock: true },
  { name: 'Corcovado', az: 208.5, r: 8300, height: 710, across: 700, along: 900, shape: 'peak', rock: true, spire: 0.3 },
  { name: 'Sumaré', az: 202.5, r: 9300, height: 705, across: 900, along: 900, shape: 'massif', rock: false },
  { name: 'Dois Irmãos (east)', az: 181.9, r: 6480, height: 533, across: 380, along: 440, shape: 'peak', rock: true, spire: 0.12 },
  { name: 'Dois Irmãos (west)', az: 180.5, r: 6700, height: 468, across: 360, along: 420, shape: 'peak', rock: true, spire: 0.08 },
  { name: 'Pedra da Gávea', az: 173.2, r: 7200, height: 844, across: 700, along: 780, shape: 'table', rock: true },
  { name: 'Pedra Bonita', az: 170.1, r: 8200, height: 693, across: 700, along: 800, shape: 'round', rock: false },
  { name: 'Tijuca', az: 188.5, r: 10600, height: 1021, across: 1700, along: 1600, shape: 'massif', rock: false },
  { name: 'Cagarras', az: 192.2, r: 4050, height: 82, across: 190, along: 150, shape: 'round', rock: true },
  { name: 'Palmas', az: 194.4, r: 4150, height: 46, across: 110, along: 100, shape: 'round', rock: true },
  { name: 'Comprida', az: 189.6, r: 4250, height: 38, across: 140, along: 90, shape: 'round', rock: true },
  { name: 'Pedra Branca', az: 150, r: 13500, height: 1020, across: 3200, along: 2600, shape: 'massif', rock: false },
  { name: 'Niterói ridge', az: 262, r: 10200, height: 330, across: 1600, along: 1300, shape: 'massif', rock: false },
  { name: 'Morro do Morcego', az: 254.5, r: 8600, height: 215, across: 420, along: 400, shape: 'round', rock: true },
  { name: 'Pedra do Índio', az: 270.5, r: 9200, height: 260, across: 520, along: 520, shape: 'round', rock: true },
];

interface Placed {
  readonly form: Landform;
  readonly cx: number;
  readonly cz: number;
  readonly tx: number;
  readonly tz: number;
  readonly nx: number;
  readonly nz: number;
}

const PLACED: readonly Placed[] = LANDFORMS.map((form) => {
  const [cx, cz] = polar(form.az, form.r);
  const a = form.az * DEG;
  return { form, cx, cz, tx: -Math.sin(a), tz: Math.cos(a), nx: Math.cos(a), nz: Math.sin(a) };
});

/** Height of a landform at a point, metres (0 outside it), and how rocky that spot is. */
function landform(p: Placed, x: number, z: number): { h: number; rock: number } {
  const dx = x - p.cx;
  const dz = z - p.cz;
  const across = (dx * p.tx + dz * p.tz) / p.form.across;
  const along = (dx * p.nx + dz * p.nz) / p.form.along;
  const d = Math.hypot(across, along);
  const H = p.form.height;
  switch (p.form.shape) {
    case 'dome': {
      if (d >= 1) return { h: 0, rock: 0 };
      // Sheer granite flanks, a rounded summit, and a slight lean to the sea.
      const f = Math.pow(1 - Math.pow(d, 2.7), 0.4) * (1 + 0.08 * across);
      const striae = (noise2(across * 14, (z + x) / 55, 71) - 0.5) * 6;
      return { h: H * f + striae * f, rock: smoothstep(0.25, 0.6, d) };
    }
    case 'round': {
      if (d >= 1.4) return { h: 0, rock: 0 };
      const f = d < 1 ? Math.pow(1 - d * d, 0.8) : 0;
      return { h: H * f * (0.9 + 0.2 * noise2(x / 140, z / 140, 73)), rock: p.form.rock ? smoothstep(0.1, 0.5, d) : 0 };
    }
    case 'peak': {
      if (d > 4) return { h: 0, rock: 0 };
      // Warp the outline so no peak is a cone, make the face towards the
      // sea steeper than the back, and carve the flanks into ridges.
      const wx = (noise2(x / 420, z / 420, 83) - 0.5) * 0.55;
      const wz = (noise2(x / 420 + 7.3, z / 420, 85) - 0.5) * 0.55;
      const a2 = across + wx;
      const l2 = (along + wz) * (along < 0 ? 1.45 : 0.8);
      const dw = Math.hypot(a2, l2);
      // Soft at the very top (no cone tip), steepening below it.
      const body = Math.exp(-2.5 * (Math.pow(dw * dw + 0.03, 0.675) - Math.pow(0.03, 0.675)));
      const ridges = 0.7 + 0.45 * ridged(x / (p.form.across * 0.55), z / (p.form.across * 0.55), 4, 75);
      // The summit rock: steep sides, a rounded crown.
      const spire = (p.form.spire ?? 0) * Math.pow(Math.max(0, 1 - (dw / 0.34) ** 2), 0.55);
      const h = H * (body * ridges * (1 - (p.form.spire ?? 0)) + spire) / 0.95;
      return { h, rock: p.form.rock ? smoothstep(0.6, 0.2, dw) : 0 };
    }
    case 'table': {
      if (d >= 1.4) return { h: 0, rock: 0 };
      // Pedra da Gávea: a great block with a gently tilted, rounded cap on
      // steep (not vertical) walls, over a forested base.
      const wx = (noise2(x / 300, z / 300, 87) - 0.5) * 0.3;
      const dw = Math.hypot(across + wx, along * (along < 0 ? 1.15 : 0.9));
      const wall = smoothstep(1.1, 0.3, dw);
      const cap = 0.9 + 0.1 * (1 - dw * dw) + 0.05 * across;
      const base = Math.max(0, 1 - dw / 1.4) * 0.4;
      const f = Math.max(wall * cap, base);
      return { h: H * f * (0.97 + 0.06 * noise2(x / 120, z / 120, 89)), rock: smoothstep(0.35, 0.8, dw) * smoothstep(1.1, 0.9, dw) };
    }
    case 'massif': {
      if (d > 3) return { h: 0, rock: 0 };
      const wx = (noise2(x / 900, z / 900, 91) - 0.5) * 0.5;
      const dw = Math.hypot(across + wx, along);
      const f = Math.exp(-dw * dw * 1.5) * (0.6 + 0.6 * ridged(x / 1100, z / 1100, 5, 77));
      return { h: H * f, rock: 0 };
    }
  }
}

const LAGOON = (() => {
  const [x, z] = polar(191.8, 7250);
  return { x, z, across: 620, along: 430, az: 191.8 };
})();

/** Built-up districts: the beach neighbourhoods and the far shores. */
const DISTRICTS = [
  { from: 200.8, to: 221.3, depth: 1100 }, // Copacabana – Leme
  { from: 182.8, to: 198.6, depth: 1500 }, // Ipanema – Leblon, up to the lagoon
  { from: 223.4, to: 226.2, depth: 1400 }, // Urca / Botafogo behind the domes
  { from: 121, to: 168, depth: 900 }, // Barra da Tijuca
  { from: 256, to: 300, depth: 1200 }, // Niterói
] as const;

/** Favelas: dense small houses on the hillsides. */
const FAVELAS = [
  { az: 176.8, r: 7650, radius: 650 }, // Rocinha, between Dois Irmãos and Gávea
  { az: 180.6, r: 6300, radius: 300 }, // Vidigal, on the flank of Dois Irmãos
  { az: 200.9, r: 6500, radius: 330 }, // Cantagalo – Pavão-Pavãozinho
  { az: 220.4, r: 5750, radius: 300 }, // Babilônia – Chapéu Mangueira
  { az: 206, r: 7250, radius: 420 }, // Tabajaras
  { az: 263, r: 9000, radius: 700 }, // Niterói hills
].map((f) => {
  const [x, z] = polar(f.az, f.r);
  return { ...f, x, z };
});

export interface CoastSample {
  readonly height: number;
  readonly inland: number;
  readonly urban: number;
  readonly favela: number;
  readonly rock: number;
  readonly lagoon: number;
}

function districtWeight(az: number, inland: number): number {
  let w = 0;
  for (const d of DISTRICTS) {
    const across = smoothstep(d.from - 0.6, d.from + 0.3, az) * (1 - smoothstep(d.to - 0.3, d.to + 0.6, az));
    const depth = smoothstep(70, 110, inland) * (1 - smoothstep(d.depth * 0.8, d.depth, inland));
    w = Math.max(w, across * depth);
  }
  return w;
}

export function sampleCoast(x: number, z: number): CoastSample {
  const r = Math.hypot(x, z);
  const az = azimuthOf(x, z);
  const shore = shoreRadius(az);
  const s = r - shore;
  const gap = sunGap(az);

  let h: number;
  if (s < 0) {
    h = Math.max(-45, -7 + s * 0.06);
  } else {
    // Beach, promenade, then the city plain rising gently to the hills.
    h = 3 * smoothstep(0, 28, s) + 3 * smoothstep(70, 140, s) + s * 0.004;
    h += (fbm(x / 420, z / 420, 3, 7) - 0.5) * 10 * smoothstep(200, 900, s);
    const hills = smoothstep(900, 2600, s) * (70 + 380 * Math.pow(ridged(x / 1900, z / 1900, 5, 3), 1.3));
    h += hills * (az < 250 ? 1 : 0.45);
  }

  // The far ranges fading into the haze behind everything.
  const far = smoothstep(11500, 15500, r) * (1 - gap);
  const massif = smoothstep(0.3, 0.72, fbm(az * 0.08, r / 6000, 3, 17));
  h += far * (120 + 720 * massif * ridged(x / 3000, z / 3000, 5, 11)) * (az > 250 ? 0.5 : 1);

  let rock = 0;
  for (const placed of PLACED) {
    const f = landform(placed, x, z);
    if (f.h <= 0) continue;
    if (placed.form.shape === 'peak' || placed.form.shape === 'massif') {
      // Ranges add to the ground; free-standing rocks rise out of whatever is there.
      h = smax(h, h * 0.35 + f.h, 40);
    } else {
      h = smax(h, f.h, 12);
    }
    if (f.h > 0.2 * placed.form.height) rock = Math.max(rock, f.rock);
  }

  // Erosion: spurs and gullies a few hundred metres across on every hillside.
  // The large forms above are smooth at that scale; real slopes never are,
  // and it is these folds, lit on one side and shaded on the other, that make
  // a forested mountain read as a mountain. Kept off the bare granite domes,
  // which are smooth for real.
  const hill = smoothstep(30, 260, h) * (1 - rock * 0.8);
  if (hill > 0) {
    const warp = (noise2(x / 700, z / 700, 103) - 0.5) * 260;
    const folds = ridged((x + warp) / 330, (z - warp) / 330, 3, 101) - 0.42;
    const fine = ridged((x - warp) / 120, (z + warp) / 120, 2, 107) - 0.42;
    h += hill * (folds * (42 + h * 0.15) + fine * (12 + h * 0.04));
  }

  // The ends of the modelled arc slope away under the sea instead of stopping
  // at a cliff where the grid ends.
  const ends = smoothstep(116, 126, az) * (1 - smoothstep(316, 326, az));
  h = h * ends - 25 * (1 - ends);

  // The lagoon: a basin below sea level behind Ipanema, so the sea fills it.
  const la = LAGOON.az * DEG;
  const lx = x - LAGOON.x;
  const lz = z - LAGOON.z;
  const ld = Math.hypot((lx * -Math.sin(la) + lz * Math.cos(la)) / LAGOON.across, (lx * Math.cos(la) + lz * Math.sin(la)) / LAGOON.along);
  const lagoon = smoothstep(1.15, 0.95, ld + (noise2(x / 150, z / 150, 29) - 0.5) * 0.12);
  h = h * (1 - lagoon) - 6 * lagoon;

  const flat = 1 - smoothstep(35, 90, h);
  const urban = districtWeight(az, s) * flat * (1 - lagoon);
  let favela = 0;
  for (const f of FAVELAS) {
    const u = Math.hypot(x - f.x, z - f.z) / f.radius;
    favela = Math.max(favela, smoothstep(1, 0.45, u + (noise2(x / 90, z / 90, 81) - 0.5) * 0.5));
  }
  favela *= smoothstep(15, 40, h) * (1 - smoothstep(260, 320, h)) * (1 - rock);

  return { height: h, inland: s, urban, favela, rock, lagoon };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const COLORS = {
  seabed: new THREE.Color('#2a393c'),
  sand: new THREE.Color('#e6d7b4'),
  wetSand: new THREE.Color('#a8977a'),
  // Atlantic forest: very dark, saturated canopy with brighter crowns.
  forestDark: new THREE.Color('#0f2a12'),
  forestLight: new THREE.Color('#2a5520'),
  scrub: new THREE.Color('#61713a'),
  grass: new THREE.Color('#7d8a45'),
  granite: new THREE.Color('#8e8880'),
  graniteDark: new THREE.Color('#47433f'),
  urban: new THREE.Color('#8f8a82'),
  urbanWarm: new THREE.Color('#a89379'),
  favela: new THREE.Color('#9c6b4e'),
};

/** Azimuth samples: dense across Rio itself, coarser on the far shores. */
function azimuths(): number[] {
  const list: number[] = [];
  let az = 116;
  while (az <= 326) {
    list.push(az);
    az += az > 166 && az < 232 ? 0.085 : az > 150 && az < 275 ? 0.17 : 0.3;
  }
  return list;
}

function radii(): number[] {
  // Starts well inside the nearest landform, so no rock is sliced open at the grid's edge.
  const list: number[] = [3000];
  // Fine enough that steep rock faces are not drawn in horizontal steps.
  let spacing = 11;
  while (list[list.length - 1]! < 17500) {
    list.push(list[list.length - 1]! + spacing);
    spacing *= 1.0095;
  }
  return list;
}

/** Plain typed arrays: cheap to hand over, easy to wrap as geometry. */
export interface CoastData {
  readonly land: {
    position: Float32Array;
    normal: Float32Array;
    color: Float32Array;
    /** Per vertex: forest, bare rock, built-up (for the night glow), sky visibility. */
    surface: Float32Array;
    index: Uint32Array;
  };
  readonly buildings: {
    position: Float32Array;
    normal: Float32Array;
    color: Float32Array;
    /** Per vertex: building seed, height of its base, kind (0 block, 1 house, 2 roof). */
    window: Float32Array;
  };
  readonly lights: { position: Float32Array; color: Float32Array; lightData: Float32Array };
  readonly surf: { position: Float32Array; along: Float32Array; index: Uint32Array };
  /** Cable car stations (world positions): Praia Vermelha, Urca, Pão de Açúcar. */
  readonly cable: readonly [number, number, number][];
  /** The beach avenues, as polylines (x, y, z packed), for the night traffic. */
  readonly roads: readonly Float32Array[];
  /**
   * The terrain as a square height map (world heights, metres), in the bay's
   * own coordinates, for the shadows the mountains cast on each other.
   */
  readonly heightmap: { data: Float32Array; size: number; minX: number; minZ: number; span: number };
}

/**
 * Builds the bay. A generator: it yields whenever `budgetMs` has been spent,
 * so the caller can spread the work over frames. The return value is the data.
 */
export function* buildCoastSteps(seaLevel: number, budgetMs = 8): Generator<void, CoastData, void> {
  let sliceStart = performance.now();
  const tick = function* (): Generator<void, void, void> {
    if (performance.now() - sliceStart > budgetMs) {
      yield;
      sliceStart = performance.now();
    }
  };

  const azs = azimuths();
  const ring = radii();
  const columns = azs.length;
  const rows = ring.length;
  const count = columns * rows;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const samples: CoastSample[] = new Array(count);

  for (let row = 0; row < rows; row += 1) {
    const r = ring[row]!;
    for (let col = 0; col < columns; col += 1) {
      const [x, z] = polar(azs[col]!, r);
      const sample = sampleCoast(x, z);
      const i = row * columns + col;
      samples[i] = sample;
      positions[i * 3] = x;
      positions[i * 3 + 1] = seaLevel + sample.height;
      positions[i * 3 + 2] = z;
    }
    yield* tick();
  }

  const indices = new Uint32Array((rows - 1) * (columns - 1) * 6);
  let k = 0;
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < columns - 1; col += 1) {
      const a = row * columns + col;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }

  const land = new THREE.BufferGeometry();
  land.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  land.setIndex(new THREE.BufferAttribute(indices, 1));
  land.computeVertexNormals();
  let normals = land.getAttribute('normal') as THREE.BufferAttribute;
  let up = 0;
  for (let i = 0; i < count; i += 97) up += normals.getY(i);
  if (up < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1]!;
      indices[i + 1] = indices[i + 2]!;
      indices[i + 2] = t;
    }
    land.computeVertexNormals();
    normals = land.getAttribute('normal') as THREE.BufferAttribute;
  }
  // Guard every normal: a zero-length one would turn into NaN in the shader.
  for (let i = 0; i < count; i += 1) {
    const ny = normals.getY(i);
    if (!(Math.hypot(normals.getX(i), ny, normals.getZ(i)) > 1e-6)) normals.setXYZ(i, 0, 1, 0);
  }
  yield* tick();

  // Sky visibility (ambient occlusion), baked once: how much of the sky each
  // point of the terrain sees. Valleys, ravines and the feet of the rocks get
  // less skylight than ridges — that, more than anything, is what makes a
  // range read as solid rock and forest instead of a smooth shell.
  const surface = new Float32Array(count * 4);
  const AO_DIRECTIONS: readonly [number, number][] = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  const AO_STEPS = [1, 2, 4, 7, 12, 20, 32];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const i = row * columns + col;
      const x0 = positions[i * 3]!;
      const y0 = positions[i * 3 + 1]!;
      const z0 = positions[i * 3 + 2]!;
      let occlusion = 0;
      for (const [dr, dc] of AO_DIRECTIONS) {
        let maxSlope = 0;
        for (const k of AO_STEPS) {
          const r = row + dr * k;
          const c = col + dc * k;
          if (r < 0 || r >= rows || c < 0 || c >= columns) break;
          const j = r * columns + c;
          const dx = positions[j * 3]! - x0;
          const dz = positions[j * 3 + 2]! - z0;
          const slope = (positions[j * 3 + 1]! - y0) / Math.max(Math.hypot(dx, dz), 1);
          if (slope > maxSlope) maxSlope = slope;
        }
        // Sine of the horizon angle in this direction.
        occlusion += maxSlope / Math.sqrt(1 + maxSlope * maxSlope);
      }
      surface[i * 4 + 3] = Math.max(0.25, 1 - (occlusion / AO_DIRECTIONS.length) * 1.35);
    }
    if (row % 24 === 0) yield* tick();
  }

  const colour = new THREE.Color();
  const granite = new THREE.Color();
  for (let i = 0; i < count; i += 1) {
    const sample = samples[i]!;
    const x = positions[i * 3]!;
    const z = positions[i * 3 + 2]!;
    const steep = 1 - normals.getY(i);
    const h = sample.height;
    const n = fbm(x / 230, z / 230, 3, 41);

    let forest = 0;
    let bare = 0;
    let built = 0;
    if (h < 0) {
      colour.copy(COLORS.seabed);
    } else if (sample.inland < 75 && h < 6.5) {
      colour.copy(COLORS.wetSand).lerp(COLORS.sand, smoothstep(0, 22, sample.inland));
    } else {
      forest = 1;
      // Atlantic forest: dark canopy with lighter crowns; drier scrub low down.
      colour.copy(COLORS.forestDark).lerp(COLORS.forestLight, n * n * 1.2);
      if (h < 80) colour.lerp(COLORS.scrub, 0.25 * (1 - n));
      // Clearings and grassy slopes: pasture on the lower hills, the odd
      // burnt or landslid patch higher up.
      const clearing = smoothstep(0.66, 0.78, fbm(x / 300 + 3.1, z / 300, 3, 45)) * (1 - smoothstep(200, 450, h));
      colour.lerp(COLORS.grass, clearing * 0.45);
      const rock = Math.max(smoothstep(0.55, 0.8, steep), sample.rock * smoothstep(0.18, 0.4, steep));
      if (rock > 0) {
        // Rain-streaked granite: the pattern runs down the rock, not across it.
        granite.copy(COLORS.graniteDark).lerp(COLORS.granite, fbm(azimuthOf(x, z) * 4.5, h / 260, 3, 43));
        colour.lerp(granite, rock);
        bare = rock;
      }
      if (sample.urban > 0) {
        granite.copy(COLORS.urban).lerp(COLORS.urbanWarm, noise2(x / 120, z / 120, 47));
        colour.lerp(granite, sample.urban * 0.85);
      }
      if (sample.favela > 0) colour.lerp(COLORS.favela, sample.favela * 0.75);
      built = Math.min(1, sample.urban + sample.favela * 0.8);
      forest = Math.max(0, 1 - bare - built);
    }
    surface[i * 4] = forest;
    surface[i * 4 + 1] = bare;
    surface[i * 4 + 2] = built;
    colors[i * 3] = colour.r;
    colors[i * 3 + 1] = colour.g;
    colors[i * 3 + 2] = colour.b;
    if (i % 20000 === 0) yield* tick();
  }

  const city = yield* buildCity(seaLevel, tick);
  const surf = buildSurf(seaLevel);

  const station = (az: number, r: number, lift: number): [number, number, number] => {
    const [x, z] = polar(az, r);
    return [x, seaLevel + sampleCoast(x, z).height + lift, z];
  };
  const cable: [number, number, number][] = [
    station(225.7, 4700, 8),
    station(224.9, 4300, 10),
    station(227.3, 3950, 10),
  ];

  // Avenida Atlântica, Vieira Souto / Delfim Moreira, the Barra seafront and
  // Niterói's beach road, between the promenade and the first buildings.
  const roads = [
    { from: 201.3, to: 221.0 },
    { from: 183.4, to: 198.5 },
    { from: 123, to: 166.5 },
    { from: 259, to: 271.5 },
  ].map(({ from, to }) => {
    const points: number[] = [];
    let az = from;
    while (az <= to) {
      const shore = shoreRadius(az);
      const [x, z] = polar(az, shore + 104);
      points.push(x, seaLevel + Math.max(sampleCoast(x, z).height, 2) + 1.1, z);
      az += 20 / (shore * DEG);
    }
    return new Float32Array(points);
  });

  const heightmap = yield* buildHeightmap(azs, ring, positions, seaLevel, tick);

  return {
    heightmap,
    roads,
    land: { position: positions, normal: normals.array as Float32Array, color: colors, surface, index: indices },
    ...city,
    surf,
    cable,
  };
}

/** Wraps the arrays as geometry. */
export function coastGeometry(data: CoastData): {
  land: THREE.BufferGeometry;
  buildings: THREE.BufferGeometry;
  lights: THREE.BufferGeometry;
  surf: THREE.BufferGeometry;
} {
  const bounds = new THREE.Sphere(new THREE.Vector3(), 18500);
  const land = new THREE.BufferGeometry();
  land.setAttribute('position', new THREE.BufferAttribute(data.land.position, 3));
  land.setAttribute('normal', new THREE.BufferAttribute(data.land.normal, 3));
  land.setAttribute('color', new THREE.BufferAttribute(data.land.color, 3));
  land.setAttribute('aSurface', new THREE.BufferAttribute(data.land.surface, 4));
  land.setIndex(new THREE.BufferAttribute(data.land.index, 1));
  land.boundingSphere = bounds;

  const buildings = new THREE.BufferGeometry();
  buildings.setAttribute('position', new THREE.BufferAttribute(data.buildings.position, 3));
  buildings.setAttribute('normal', new THREE.BufferAttribute(data.buildings.normal, 3));
  buildings.setAttribute('color', new THREE.BufferAttribute(data.buildings.color, 3));
  buildings.setAttribute('aWindow', new THREE.BufferAttribute(data.buildings.window, 3));
  buildings.boundingSphere = bounds;

  const lights = new THREE.BufferGeometry();
  lights.setAttribute('position', new THREE.BufferAttribute(data.lights.position, 3));
  lights.setAttribute('color', new THREE.BufferAttribute(data.lights.color, 3));
  lights.setAttribute('lightData', new THREE.BufferAttribute(data.lights.lightData, 3));
  lights.boundingSphere = bounds;

  const surf = new THREE.BufferGeometry();
  surf.setAttribute('position', new THREE.BufferAttribute(data.surf.position, 3));
  surf.setAttribute('aAlong', new THREE.BufferAttribute(data.surf.along, 1));
  surf.setIndex(new THREE.BufferAttribute(data.surf.index, 1));
  surf.boundingSphere = bounds;
  return { land, buildings, lights, surf };
}

// ---------------------------------------------------------------------------
// Height map
// ---------------------------------------------------------------------------

/** Index of the last value in an ascending list that is <= x, with the fraction to the next. */
function locate(list: readonly number[], x: number): [number, number] | null {
  if (x < list[0]! || x > list[list.length - 1]!) return null;
  let lo = 0;
  let hi = list.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (list[mid]! <= x) lo = mid;
    else hi = mid;
  }
  const span = list[hi]! - list[lo]!;
  return [lo, span > 0 ? (x - list[lo]!) / span : 0];
}

const HEIGHTMAP_SIZE = 1024;

/**
 * Resamples the polar terrain grid into a square height map covering the
 * whole bay. The shaders march through it towards the sun (or the moon) to
 * find which slopes the mountains shade.
 */
function* buildHeightmap(
  azs: readonly number[],
  ring: readonly number[],
  positions: Float32Array,
  seaLevel: number,
  tick: () => Generator<void, void, void>,
): Generator<void, CoastData['heightmap'], void> {
  const columns = azs.length;
  const outer = ring[ring.length - 1]!;
  const minX = -outer;
  const minZ = -outer;
  const span = outer * 2;
  const size = HEIGHTMAP_SIZE;
  const data = new Float32Array(size * size).fill(seaLevel - 40);
  for (let j = 0; j < size; j += 1) {
    const z = minZ + ((j + 0.5) / size) * span;
    for (let i = 0; i < size; i += 1) {
      const x = minX + ((i + 0.5) / size) * span;
      const r = Math.hypot(x, z);
      const rowAt = locate(ring, r);
      if (!rowAt) continue;
      const colAt = locate(azs, azimuthOf(x, z));
      if (!colAt) continue;
      const [row, fr] = rowAt;
      const [col, fc] = colAt;
      const a = row * columns + col;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      const h = (k: number): number => positions[k * 3 + 1]!;
      data[j * size + i] = (h(a) * (1 - fc) + h(b) * fc) * (1 - fr) + (h(c) * (1 - fc) + h(d) * fc) * fr;
    }
    if (j % 32 === 0) yield* tick();
  }
  return { data, size, minX, minZ, span };
}

// ---------------------------------------------------------------------------
// City
// ---------------------------------------------------------------------------

// Rio's apartment blocks: whites and creams, sand and ochre, the odd pastel and grey.
const BUILDING_COLORS = ['#e3ddd0', '#d2cabb', '#c4bcad', '#e9e2d3', '#b3aea5', '#d4c3a4', '#bfc4c6', '#dcc9ad', '#c9a98c', '#aab3b4', '#e0d2bf', '#b9ab98'].map(
  (hex) => new THREE.Color(hex),
);
const HOUSE_COLORS = ['#b86f4a', '#c98b5e', '#a8634a', '#d8b48c', '#9e8a78', '#c7a27c', '#e0cdb0', '#8f5a45'].map(
  (hex) => new THREE.Color(hex),
);
const WINDOW_COLORS = ['#ffd08a', '#ffe2b0', '#fff1d6', '#ffc070', '#f2f4ff', '#ffe9c4'].map((hex) => new THREE.Color(hex));
const SODIUM = new THREE.Color('#ffb85c');
/** Flat roofs: weathered concrete, bitumen, the odd pale membrane. */
const ROOF_FLAT = ['#8d8a85', '#6f6c68', '#a9a59d', '#5d5b58', '#b8b4ab'].map((hex) => new THREE.Color(hex));
/** Favela roofs: fibre-cement sheets and clay tile. */
const ROOF_TILE = ['#9a9892', '#8a8580', '#a0583b', '#8c4b33', '#b5b0a5'].map((hex) => new THREE.Color(hex));
const BEACON = new THREE.Color('#ff3b30');

function slopeAt(x: number, z: number): number {
  const e = 10;
  const hx = sampleCoast(x + e, z).height - sampleCoast(x - e, z).height;
  const hz = sampleCoast(x, z + e).height - sampleCoast(x, z - e).height;
  return Math.hypot(hx, hz) / (2 * e);
}

function* buildCity(
  seaLevel: number,
  tick: () => Generator<void, void, void>,
): Generator<void, Pick<CoastData, 'buildings' | 'lights'>, void> {
  const random = rng(20261001);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const lightPos: number[] = [];
  const lightCol: number[] = [];
  const lightData: number[] = [];

  const addLight = (x: number, y: number, z: number, colour: THREE.Color, size: number, blink = 0): void => {
    lightPos.push(x, y, z);
    lightCol.push(colour.r, colour.g, colour.b);
    lightData.push(size, random() * Math.PI * 2, blink);
  };

  const win: number[] = [];

  /** A box with a roof and four walls, long side along the shore at this azimuth. */
  const box = (
    x: number,
    z: number,
    az: number,
    y0: number,
    height: number,
    width: number,
    depth: number,
    colour: THREE.Color,
    roofColour: THREE.Color,
    seed: number,
    kind: number,
  ): void => {
    const y1 = y0 + height;
    const angle = az * DEG;
    const ux = -Math.sin(angle);
    const uz = Math.cos(angle);
    const vx = Math.cos(angle);
    const vz = Math.sin(angle);
    const hw = width / 2;
    const hd = depth / 2;
    const corner = (su: number, sv: number, y: number): [number, number, number] => [
      x + ux * su * hw + vx * sv * hd,
      y,
      z + uz * su * hw + vz * sv * hd,
    ];
    const face = (
      corners: [number, number, number][],
      normal: [number, number, number],
      shade: number,
      tint: THREE.Color,
      faceKind: number,
    ): void => {
      const [a, b, c, d] = corners as [
        [number, number, number],
        [number, number, number],
        [number, number, number],
        [number, number, number],
      ];
      for (const v of [a, b, c, a, c, d]) {
        pos.push(v[0], v[1], v[2]);
        nor.push(normal[0], normal[1], normal[2]);
        col.push(tint.r * shade, tint.g * shade, tint.b * shade);
        // The window pattern needs the building's seed and the height of its
        // ground floor; roofs carry kind 2 (no windows).
        win.push(seed, y0 + 2, faceKind);
      }
    };
    face([corner(-1, -1, y0), corner(1, -1, y0), corner(1, -1, y1), corner(-1, -1, y1)], [-vx, 0, -vz], 1, colour, kind);
    face([corner(1, 1, y0), corner(-1, 1, y0), corner(-1, 1, y1), corner(1, 1, y1)], [vx, 0, vz], 1, colour, kind);
    face([corner(1, -1, y0), corner(1, 1, y0), corner(1, 1, y1), corner(1, -1, y1)], [ux, 0, uz], 1, colour, kind);
    face([corner(-1, 1, y0), corner(-1, -1, y0), corner(-1, -1, y1), corner(-1, 1, y1)], [-ux, 0, -uz], 1, colour, kind);
    face([corner(-1, -1, y1), corner(1, -1, y1), corner(1, 1, y1), corner(-1, 1, y1)], [0, 1, 0], 1, roofColour, 2);
  };

  /**
   * A building: its main block, and on anything tall the plant room / water
   * tank box that every Rio apartment block carries on its roof.
   */
  const block = (
    x: number,
    z: number,
    az: number,
    y0: number,
    height: number,
    width: number,
    depth: number,
    colour: THREE.Color,
    windows: number,
    kind = 0,
  ): void => {
    const seed = random();
    const roof = kind === 1 ? ROOF_TILE[Math.floor(random() * ROOF_TILE.length)]! : ROOF_FLAT[Math.floor(random() * ROOF_FLAT.length)]!;
    box(x, z, az, y0, height, width, depth, colour, roof, seed, kind);
    if (kind === 0 && height > 18) {
      const angle = az * DEG;
      const along = (random() - 0.5) * width * 0.4;
      const across = (random() - 0.5) * depth * 0.3;
      box(
        x - Math.sin(angle) * along + Math.cos(angle) * across,
        z + Math.cos(angle) * along + Math.sin(angle) * across,
        az,
        y0 + height,
        2.5 + random() * 2.5,
        width * (0.25 + random() * 0.2),
        depth * (0.3 + random() * 0.2),
        colour,
        ROOF_FLAT[0]!,
        seed,
        2,
      );
    }
    // Lit windows on the side facing the sea.
    const angle = az * DEG;
    for (let w = 0; w < windows; w += 1) {
      const su = random() * 1.7 - 0.85;
      const lx = x + -Math.sin(angle) * su * (width / 2) - Math.cos(angle) * (depth / 2) * 1.03;
      const lz = z + Math.cos(angle) * su * (width / 2) - Math.sin(angle) * (depth / 2) * 1.03;
      const ly = y0 + 3 + random() * (height - 3.5);
      addLight(lx, ly, lz, WINDOW_COLORS[Math.floor(random() * WINDOW_COLORS.length)]!, 1.1 + random() * 0.9);
    }
  };

  // The beachfront walls: Avenida Atlântica and Vieira Souto, block after block.
  const fronts = [
    { from: 201.2, to: 221.0, rows: 2 },
    { from: 183.3, to: 198.4, rows: 2 },
    { from: 122, to: 167, rows: 1, towers: true },
    { from: 259, to: 272, rows: 1 },
  ];
  for (const front of fronts) {
    let az = front.from;
    while (az < front.to) {
      const shore = shoreRadius(az);
      for (let row = 0; row < front.rows; row += 1) {
        const tower = 'towers' in front && front.towers;
        const inland = tower ? 140 + random() * 520 : 118 + row * 58 + random() * 8;
        const [x, z] = polar(az, shore + inland);
        const sample = sampleCoast(x, z);
        if (sample.height > 2 && sample.lagoon < 0.1) {
          const tower = 'towers' in front && front.towers;
          // Barra's condominiums: towers of different heights set back at different depths.
          const height = tower ? 35 + Math.pow(random(), 1.5) * 85 : 26 + random() * 22 - row * 4;
          const width = tower ? 20 + random() * 16 : 17 + random() * 6;
          block(
            x,
            z,
            az,
            seaLevel + sample.height - 2,
            height,
            width,
            tower ? 26 : 24,
            BUILDING_COLORS[Math.floor(random() * BUILDING_COLORS.length)]!,
            Math.round(height / 5),
          );
        }
      }
      // Next block: one building's width along the curve (Barra's towers stand apart).
      const step = ('towers' in front && front.towers ? 70 + random() * 160 : 22) / (shore * DEG);
      az += step;
    }
    yield* tick();
  }

  // Streets behind: lower, denser, irregular.
  for (const district of DISTRICTS) {
    const area = (district.to - district.from) * district.depth;
    const target = Math.round(area / 20);
    let placed = 0;
    let attempts = 0;
    while (placed < target && attempts < target * 6) {
      attempts += 1;
      const az = district.from + random() * (district.to - district.from);
      const inland = 200 + random() * (district.depth - 200);
      const [x, z] = polar(az, shoreRadius(az) + inland);
      const sample = sampleCoast(x, z);
      if (sample.urban < 0.4 || sample.height < 2.5 || slopeAt(x, z) > 0.12) continue;
      const height = 9 + Math.pow(random(), 2.2) * 34;
      block(
        x,
        z,
        az + (random() - 0.5) * 6,
        seaLevel + sample.height - 2,
        height,
        14 + random() * 14,
        14 + random() * 12,
        BUILDING_COLORS[Math.floor(random() * BUILDING_COLORS.length)]!,
        random() < 0.7 ? Math.round(height / 9) : 0,
      );
      // Street lamps between the blocks.
      if (random() < 0.35) addLight(x + (random() - 0.5) * 30, seaLevel + sample.height + 5, z + (random() - 0.5) * 30, SODIUM, 1.2);
      placed += 1;
      if (placed % 300 === 0) yield* tick();
    }
  }

  // Favelas: tiny brick houses packed up the slopes, most of them lit.
  for (const f of FAVELAS) {
    const target = Math.round(f.radius * f.radius * 0.0075);
    let placed = 0;
    let attempts = 0;
    while (placed < target && attempts < target * 8) {
      attempts += 1;
      const a = random() * Math.PI * 2;
      const u = Math.sqrt(random()) * f.radius;
      const x = f.x + Math.cos(a) * u;
      const z = f.z + Math.sin(a) * u;
      const sample = sampleCoast(x, z);
      if (sample.favela < 0.35) continue;
      const height = 4 + random() * 7;
      block(
        x,
        z,
        azimuthOf(x, z) + (random() - 0.5) * 30,
        seaLevel + sample.height - 3,
        height + 3,
        5 + random() * 5,
        5 + random() * 4,
        HOUSE_COLORS[Math.floor(random() * HOUSE_COLORS.length)]!,
        0,
        1,
      );
      if (random() < 0.8) {
        addLight(x, seaLevel + sample.height + height * 0.6, z, WINDOW_COLORS[Math.floor(random() * 4)]!, 1.0 + random() * 0.6);
      }
      placed += 1;
      if (placed % 400 === 0) yield* tick();
    }
  }

  // The promenade lamps: the curve of light along each beach at dusk.
  for (const beach of [
    { from: 201.0, to: 221.2 },
    { from: 183.0, to: 198.7 },
    { from: 122, to: 167.5 },
    { from: 258.5, to: 272 },
  ]) {
    let az = beach.from;
    while (az < beach.to) {
      const shore = shoreRadius(az);
      const [x, z] = polar(az, shore + 92);
      const sample = sampleCoast(x, z);
      if (sample.height > 2) addLight(x, seaLevel + sample.height + 7, z, SODIUM, 1.7);
      az += 14 / (shore * DEG);
    }
  }

  // Aviation beacons on the summits.
  for (const name of ['Pão de Açúcar', 'Corcovado', 'Sumaré', 'Morro da Urca']) {
    const p = PLACED.find((placed) => placed.form.name === name);
    if (!p) continue;
    addLight(p.cx, seaLevel + sampleCoast(p.cx, p.cz).height + 12, p.cz, BEACON, 2.6, 1);
  }

  return {
    buildings: {
      position: new Float32Array(pos),
      normal: new Float32Array(nor),
      color: new Float32Array(col),
      window: new Float32Array(win),
    },
    lights: { position: new Float32Array(lightPos), color: new Float32Array(lightCol), lightData: new Float32Array(lightData) },
  };
}

// ---------------------------------------------------------------------------
// Surf
// ---------------------------------------------------------------------------

/** A thin band of breaking surf along each beach, animated in the shader. */
function buildSurf(seaLevel: number): CoastData['surf'] {
  const pos: number[] = [];
  const along: number[] = [];
  const index: number[] = [];
  for (const beach of [
    { from: 201.0, to: 221.2 },
    { from: 183.0, to: 198.8 },
    { from: 122, to: 167.5 },
    { from: 258.5, to: 272 },
    { from: 225.35, to: 225.85 },
  ]) {
    const start = pos.length / 3;
    let travelled = 0;
    let n = 0;
    for (let az = beach.from; az <= beach.to; az += 0.04) {
      const shore = shoreRadius(az);
      for (const [offset, lift] of [
        [-26, 0.18],
        [4, 0.4],
      ] as const) {
        const [x, z] = polar(az, shore + offset);
        pos.push(x, seaLevel + lift, z);
        along.push(travelled);
      }
      travelled += 0.04 * DEG * shore;
      n += 1;
    }
    for (let i = 0; i < n - 1; i += 1) {
      const a = start + i * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  return { position: new Float32Array(pos), along: new Float32Array(along), index: new Uint32Array(index) };
}
