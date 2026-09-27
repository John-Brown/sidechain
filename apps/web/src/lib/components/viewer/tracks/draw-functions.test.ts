import { describe, it, expect } from 'vitest';
import { rulerSteps } from './draw-functions.js';

describe('rulerSteps', () => {
  it('matches the design at 72 px/s: 0.5 s ticks, 1 s, 5 s majors, labels every 2 s', () => {
    expect(rulerSteps(72)).toEqual({ minor: 0.5, mid: 1, major: 5, label: 2 });
  });

  it('coarsens when zoomed out, keeping each tier a multiple of the one below', () => {
    const s = rulerSteps(6.7);
    expect(s.minor * 6.7).toBeGreaterThanOrEqual(24);
    expect(s.mid % s.minor).toBe(0);
    expect(s.major % s.mid).toBe(0);
    expect(s.label % s.mid).toBe(0);
    expect(s.label * 6.7).toBeGreaterThanOrEqual(100);
  });

  it('never picks a step below half a second when zoomed far in', () => {
    expect(rulerSteps(1000).minor).toBe(0.5);
  });
});
