import { describe, expect, it } from 'vitest';
import { buildSchedule, formatClock, positionAt, totalDurationMs } from './timer';

describe('buildSchedule', () => {
  it('alternates work and rest with no rest after the last set', () => {
    const s = buildSchedule({ sets: 3, workSeconds: 60, restSeconds: 30 });
    expect(s.map((p) => `${p.kind}${p.set}`)).toEqual(['work1', 'rest1', 'work2', 'rest2', 'work3']);
    expect(totalDurationMs(s)).toBe((3 * 60 + 2 * 30) * 1000);
  });

  it('skips rest phases when rest is 0', () => {
    const s = buildSchedule({ sets: 2, workSeconds: 10, restSeconds: 0 });
    expect(s.map((p) => p.kind)).toEqual(['work', 'work']);
  });
});

describe('positionAt', () => {
  const s = buildSchedule({ sets: 2, workSeconds: 60, restSeconds: 30 });

  it('starts in the first work phase', () => {
    expect(positionAt(s, 0)).toMatchObject({ done: false, index: 0, remainingMs: 60_000 });
  });

  it('moves to rest exactly at the phase boundary', () => {
    expect(positionAt(s, 60_000)).toMatchObject({ done: false, index: 1, remainingMs: 30_000 });
  });

  it('is done once the total duration has elapsed', () => {
    expect(positionAt(s, totalDurationMs(s))).toEqual({ done: true });
  });
});

describe('formatClock', () => {
  it('rounds up partial seconds', () => {
    expect(formatClock(59_001)).toBe('01:00');
    expect(formatClock(500)).toBe('00:01');
    expect(formatClock(0)).toBe('00:00');
  });
});
