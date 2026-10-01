/**
 * Human-readable labels and formatters for domain values.
 * Pure functions, no React — the HUD and any future export share them.
 */

import type { Criticality, Hazard, Material, ResourceKind } from './types';

export const MATERIAL_LABELS: Readonly<Record<Material, string>> = {
  'steel-a36': 'Mild steel (A36)',
  'stainless-316l': 'Stainless steel 316L',
  'cast-iron-gg25': 'Cast iron (GG25)',
  'bronze-b62': 'Bronze (B62)',
  'copper-nickel-9010': 'Copper-nickel 90/10',
  'titanium-gr1': 'Titanium Grade 1',
  'aluminium-5083': 'Aluminium 5083',
  'rubber-epdm': 'EPDM rubber',
  'grp-composite': 'GRP composite',
};

export const HAZARD_LABELS: Readonly<Record<Hazard, string>> = {
  'arc-flash': 'Arc flash',
  flooding: 'Flooding',
  'hot-surface': 'Hot surface',
  'hot-work': 'Hot work',
  'confined-space': 'Confined space',
  pressurised: 'Pressurised',
  'fuel-spill': 'Fuel spill',
};

export const RESOURCE_LABELS: Readonly<Record<ResourceKind, string>> = {
  electrical: 'Electrical power',
  fuel: 'Fuel oil',
  cooling: 'Cooling',
  seawater: 'Sea water',
  lubrication: 'Lube oil',
  hydraulic: 'Hydraulic',
  mechanical: 'Mechanical drive',
  control: 'Control signal',
};

export const CRITICALITY_LABELS: Readonly<Record<Criticality, string>> = {
  1: 'Minor',
  2: 'Low',
  3: 'Moderate',
  4: 'High',
  5: 'Vital',
};

/** Minutes -> a compact, readable duration such as "2 d 4 h" or "45 min" ("m" would read as metres). */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  // Round once, up front, so 119.7 reads "2 h" rather than "1 h 60 min".
  const whole = Math.round(minutes);
  if (whole < 60) return `${Math.max(whole, minutes > 0 ? 1 : 0)} min`;

  const totalHours = Math.floor(whole / 60);
  const restMinutes = whole % 60;

  if (totalHours < 24) {
    return restMinutes === 0 ? `${totalHours} h` : `${totalHours} h ${restMinutes} min`;
  }

  const days = Math.floor(totalHours / 24);
  const restHours = totalHours % 24;
  return restHours === 0 ? `${days} d` : `${days} d ${restHours} h`;
}

/** Vessel coordinates -> a short "FR +12.0 / 1.7 ABL / 2.8 STBD" style position. */
export function formatPosition(x: number, y: number, z: number): string {
  const lateral = z === 0 ? 'CL' : `${Math.abs(z).toFixed(1)} ${z > 0 ? 'STBD' : 'PORT'}`;
  const longitudinal = `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)} m`;
  return `${longitudinal} · ${y.toFixed(1)} ABL · ${lateral}`;
}
