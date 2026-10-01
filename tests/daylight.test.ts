import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  DAY_SUN,
  TRANSITION_SECONDS,
  daylight,
  evaluateDaylight,
  setDaylightImmediately,
  stepDaylight,
  type DaylightState,
} from '@/components/scene/daylight';

function sample(phase: number, path: DaylightState['path']): DaylightState {
  const state: DaylightState = {
    ...daylight,
    path,
    sunDirection: new THREE.Vector3(),
    sunColor: new THREE.Color(),
    moonDirection: daylight.moonDirection.clone(),
    keyDirection: new THREE.Vector3(),
    keyColor: new THREE.Color(),
    keyIrradiance: new THREE.Color(),
  };
  return evaluateDaylight(phase, state);
}

describe('time of day', () => {
  it('rests in full daylight and full night at the two ends', () => {
    const day = sample(0, 'dusk');
    expect(day.sunElevation).toBeCloseTo(DAY_SUN.elevation, 5);
    expect(day.night).toBe(0);
    expect(day.sunVisible).toBe(1);
    const night = sample(1, 'dusk');
    expect(night.sunElevation).toBeLessThan(-12);
    expect(night.night).toBe(1);
    expect(night.sunVisible).toBe(0);
  });

  it('changes smoothly: no jumps in light, exposure or sun position along either path', () => {
    for (const path of ['dusk', 'dawn'] as const) {
      let previous = sample(0, path);
      for (let i = 1; i <= 400; i += 1) {
        const next = sample(i / 400, path);
        // At 60 fps a step here is one frame: never more than ~5 % of full sunlight.
        expect(Math.abs(next.keyIntensity - previous.keyIntensity)).toBeLessThan(0.55);
        expect(Math.abs(next.exposure - previous.exposure)).toBeLessThan(0.02);
        expect(Math.abs(next.night - previous.night)).toBeLessThan(0.05);
        expect(next.sunDirection.angleTo(previous.sunDirection)).toBeLessThan(0.03);
        previous = next;
      }
    }
  });

  it('hands the key light from sun to moon only while it is dark', () => {
    for (let i = 0; i <= 400; i += 1) {
      const state = sample(i / 400, 'dusk');
      const onMoon = state.keyDirection.distanceTo(state.moonDirection) < 1e-9;
      const onSun = state.keyDirection.distanceTo(state.sunDirection) < 1e-9;
      expect(onMoon || onSun).toBe(true);
      // Near the handover the light must be (almost) off, so the switch is never seen.
      if (Math.abs(state.sunElevation + 2) < 0.3) expect(state.keyIntensity).toBeLessThan(0.3);
    }
  });

  it('never produces invalid numbers', () => {
    for (let i = 0; i <= 100; i += 1) {
      for (const path of ['dusk', 'dawn'] as const) {
        const state = sample(i / 100, path);
        for (const value of [state.keyIntensity, state.exposure, state.environment, state.background, state.haze, state.night, state.twilight]) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
        expect(state.sunDirection.length()).toBeCloseTo(1, 6);
      }
    }
  });

  it('walks to the target over the transition time, west at dusk and east at dawn', () => {
    setDaylightImmediately(0);
    daylight.target = 1;
    let frames = 0;
    while (stepDaylight(1 / 60)) frames += 1;
    expect(daylight.phase).toBe(1);
    expect(daylight.path).toBe('dusk');
    expect(frames).toBeGreaterThan(TRANSITION_SECONDS * 60 - 5);
    expect(frames).toBeLessThan(TRANSITION_SECONDS * 60 + 5);

    daylight.target = 0;
    stepDaylight(1 / 60);
    expect(daylight.path).toBe('dawn');
    while (stepDaylight(1 / 60));
    expect(daylight.phase).toBe(0);
  });

  it('retraces its own path when reversed half-way', () => {
    setDaylightImmediately(0);
    daylight.target = 1;
    for (let i = 0; i < 120; i += 1) stepDaylight(1 / 60);
    daylight.target = 0;
    stepDaylight(1 / 60);
    expect(daylight.path).toBe('dusk');
  });
});
