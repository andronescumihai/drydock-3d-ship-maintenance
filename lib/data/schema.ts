/**
 * Zod schemas for the modeled sample vessel.
 *
 * The JSON files in this folder are the single source of truth for the model.
 * Parsing them through these schemas turns a typo into a loud error at load
 * time instead of an `undefined` that quietly breaks the graph three layers
 * further down.
 */

import { z } from 'zod';
import type { AccessNetwork, Vessel, ShipSystem, VesselComponent } from '@/lib/engine/types';

const criticalitySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

const boundsSchema = z
  .object({ min: vec3Schema, max: vec3Schema })
  .refine((b) => b.max.x > b.min.x && b.max.y > b.min.y && b.max.z > b.min.z, {
    message: 'bounds.max must be strictly greater than bounds.min on every axis',
  });

const hazardSchema = z.enum([
  'arc-flash',
  'flooding',
  'hot-surface',
  'hot-work',
  'confined-space',
  'pressurised',
  'fuel-spill',
]);

const materialSchema = z.enum([
  'steel-a36',
  'stainless-316l',
  'cast-iron-gg25',
  'bronze-b62',
  'copper-nickel-9010',
  'titanium-gr1',
  'aluminium-5083',
  'rubber-epdm',
  'grp-composite',
]);

const archetypeSchema = z.enum([
  'centrifugal-pump',
  'medium-speed-diesel',
  'generator-set',
  'switchboard',
  'plate-heat-exchanger',
  'shaft-line',
  'sea-chest',
  'tank',
  'air-compressor',
  'purifier',
  'steering-gear',
  'bow-thruster',
  'deck-crane',
  'hatch-cover',
  'windlass',
  'mooring-winch',
  'bollard',
  'funnel',
  'mast',
  'lifeboat',
  'propeller',
  'rudder',
]);

const systemKindSchema = z.enum([
  'propulsion',
  'electrical',
  'cooling',
  'fuel',
  'ballast',
  'bilge',
  'deck',
  'steering',
  'auxiliary',
  'navigation',
]);

const resourceKindSchema = z.enum([
  'electrical',
  'fuel',
  'cooling',
  'seawater',
  'lubrication',
  'hydraulic',
  'mechanical',
  'control',
]);

const supplyEdgeSchema = z.object({
  to: z.string().min(1),
  resource: resourceKindSchema,
});

const componentGeometrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('box'),
    size: vec3Schema,
    rotationY: z.number().optional(),
  }),
  z.object({
    kind: z.literal('cylinder'),
    radius: z.number().positive(),
    height: z.number().positive(),
    axis: z.enum(['x', 'y', 'z']),
  }),
  z.object({
    kind: z.literal('sphere'),
    radius: z.number().positive(),
  }),
  z.object({
    kind: z.literal('pipe'),
    radius: z.number().positive(),
    path: z.array(vec3Schema).min(2),
  }),
]);

const repairProfileSchema = z.object({
  meanRepairMinutes: z.number().nonnegative(),
  replaceMinutes: z.number().nonnegative(),
  crewRequired: z.number().int().positive(),
  requiresHotWork: z.boolean(),
  requiresSystemShutdown: z.boolean(),
  sparePartOnboard: z.boolean(),
});

export const deckSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  level: z.number(),
  note: z.string(),
});

export const compartmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  deckId: z.string().min(1),
  bounds: boundsSchema,
  note: z.string(),
});

export const hullSpecSchema = z.object({
  lengthOverall: z.number().positive(),
  beam: z.number().positive(),
  depth: z.number().positive(),
  draught: z.number().positive(),
  parallelMidBody: z.number().min(0).max(0.9),
  midshipFullness: z.number().min(1.2).max(8),
  bowFullness: z.number().min(1.2).max(8),
  sternFullness: z.number().min(1.2).max(8),
  transomWidthRatio: z.number().min(0).max(1),
  sheerForward: z.number().min(0),
  sheerAft: z.number().min(0),
});

export const vesselSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  disclaimer: z.string().min(1),
  hull: hullSpecSchema,
  superstructure: z.object({ bounds: boundsSchema, note: z.string() }),
  decks: z.array(deckSchema).min(1),
  compartments: z.array(compartmentSchema).min(1),
});

export const systemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: systemKindSchema,
  criticality: criticalitySchema,
  hudColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'hudColor must be a #rrggbb hex colour'),
  note: z.string(),
});

export const componentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  systemId: z.string().min(1),
  compartmentId: z.string().min(1),
  position: vec3Schema,
  geometry: componentGeometrySchema,
  archetype: archetypeSchema.optional(),
  material: materialSchema,
  criticality: criticalitySchema,
  isSource: z.boolean(),
  feeds: z.array(supplyEdgeSchema),
  backedUpBy: z.array(z.string().min(1)),
  accessNodeId: z.string().min(1),
  hazards: z.array(hazardSchema),
  repair: repairProfileSchema,
  note: z.string().min(1),
});

const accessNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['entry', 'walkway', 'door', 'hatch', 'ladder', 'stair', 'removal', 'workface']),
  deckId: z.string().min(1),
  compartmentId: z.string().min(1),
  position: vec3Schema,
  minutes: z.number().nonnegative(),
  action: z.string(),
  reinstall: z.boolean().optional(),
  componentId: z.string().min(1).optional(),
});

const accessEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  minutes: z.number().nonnegative().optional(),
});

export const accessNetworkSchema = z.object({
  entryNodeId: z.string().min(1),
  walkingSpeed: z.number().positive(),
  note: z.string(),
  nodes: z.array(accessNodeSchema).min(1),
  edges: z.array(accessEdgeSchema),
});

export const systemsSchema = z.array(systemSchema).min(1);
export const componentsSchema = z.array(componentSchema).min(1);

/**
 * Compile-time guarantee that the schemas and the hand-written domain types
 * cannot drift apart. If a schema stops producing a valid domain object, these
 * lines stop type-checking.
 */
type AssertAssignable<A extends B, B> = A;
export type ParsedVessel = AssertAssignable<z.infer<typeof vesselSchema>, Vessel>;
export type ParsedSystem = AssertAssignable<z.infer<typeof systemSchema>, ShipSystem>;
export type ParsedComponent = AssertAssignable<z.infer<typeof componentSchema>, VesselComponent>;
export type ParsedAccess = AssertAssignable<z.infer<typeof accessNetworkSchema>, AccessNetwork>;
