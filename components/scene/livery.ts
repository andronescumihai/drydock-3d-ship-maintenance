/**
 * How each machine is painted.
 *
 * Two real-world conventions, so the colour carries information instead of
 * being decoration:
 *
 *  - PIPEWORK follows ISO 14726, the ships' piping identification standard:
 *    green sea water, blue fresh water, brown fuel, orange oils other than fuel
 *    (lubricating and hydraulic), red fire fighting, black waste (bilge), grey
 *    non-flammable gases (compressed air).
 *  - MACHINERY is painted as engine rooms commonly are: pumps in the colour of
 *    the fluid they move, engines and generator sets in maker's colours,
 *    switchboards in light grey, deck machinery in the company blue.
 *
 * The colours are a documented modelling choice for the sample vessel, not a
 * record of any real ship.
 */

import type { VesselComponent } from '@/lib/engine/types';

/** ISO 14726 main colours used on this vessel. */
export const ISO_14726 = {
  seaWater: '#2e7d4f',
  freshWater: '#2466a8',
  fuel: '#6e4526',
  otherOils: '#d8731f',
  fireFighting: '#b3241c',
  waste: '#232527',
  gases: '#8e969c',
} as const;

export interface Livery {
  /** Paint on castings and machine bodies. */
  readonly machine?: string;
  /** Paint on pipework. */
  readonly pipe?: string;
}

/** Per-component overrides, where one machine differs from its system. */
const BY_COMPONENT: Readonly<Record<string, Livery>> = {
  'ME-MAIN-01': { machine: '#5f8a74', pipe: ISO_14726.otherOils },
  'DG-01': { machine: '#2f6697', pipe: ISO_14726.fuel },
  'DG-02': { machine: '#2f6697', pipe: ISO_14726.fuel },
  'PMP-SW-01': { machine: ISO_14726.seaWater, pipe: ISO_14726.seaWater },
  'PMP-SW-02': { machine: ISO_14726.seaWater, pipe: ISO_14726.seaWater },
  'SEA-CHEST-01': { pipe: ISO_14726.seaWater },
  'HX-CENTRAL-01': { machine: '#7f8c93', pipe: ISO_14726.seaWater },
  'PMP-FW-01': { machine: ISO_14726.freshWater, pipe: ISO_14726.freshWater },
  'PMP-LO-01': { machine: ISO_14726.otherOils, pipe: ISO_14726.otherOils },
  'HX-LO-01': { machine: '#7f8c93', pipe: ISO_14726.otherOils },
  'PUR-LO-01': { machine: '#dde2e5', pipe: ISO_14726.otherOils },
  'PUR-FO-01': { machine: '#dde2e5', pipe: ISO_14726.fuel },
  'PMP-FO-01': { machine: ISO_14726.fuel, pipe: ISO_14726.fuel },
  'PMP-BILGE-01': { machine: ISO_14726.waste, pipe: ISO_14726.waste },
  'PMP-BALLAST-01': { machine: ISO_14726.seaWater, pipe: ISO_14726.seaWater },
  'PMP-FIRE-01': { machine: ISO_14726.fireFighting, pipe: ISO_14726.fireFighting },
  'COMP-AIR-01': { machine: '#5d7f99', pipe: ISO_14726.gases },
  'COMP-AIR-02': { machine: '#5d7f99', pipe: ISO_14726.gases },
  'STEER-01': { machine: '#2f5d8a', pipe: ISO_14726.otherOils },
  'THRUSTER-01': { machine: '#2f5d8a', pipe: ISO_14726.otherOils },
};

/** Fallbacks by system, for anything not listed above. */
const BY_SYSTEM: Readonly<Record<string, Livery>> = {
  'SYS-PROP': { machine: '#5f8a74', pipe: ISO_14726.otherOils },
  'SYS-ELEC': { machine: '#2f6697' },
  'SYS-COOL': { machine: ISO_14726.seaWater, pipe: ISO_14726.seaWater },
  'SYS-FUEL': { machine: ISO_14726.fuel, pipe: ISO_14726.fuel },
  'SYS-BALL': { machine: ISO_14726.seaWater, pipe: ISO_14726.seaWater },
  'SYS-BILGE': { machine: ISO_14726.waste, pipe: ISO_14726.waste },
  'SYS-DECK': { machine: '#1d4f91', pipe: ISO_14726.otherOils },
  'SYS-STEER': { machine: '#2f5d8a', pipe: ISO_14726.otherOils },
  'SYS-AUX': { machine: '#5d7f99', pipe: ISO_14726.gases },
  'SYS-NAV': {},
};

export function liveryFor(component: VesselComponent): Livery {
  return BY_COMPONENT[component.id] ?? BY_SYSTEM[component.systemId] ?? {};
}
