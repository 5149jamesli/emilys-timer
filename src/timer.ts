// Pure interval-timer logic. No DOM, no audio, no clocks — everything here is
// a function of its inputs so it can be unit tested.

export interface TimerConfig {
  sets: number;
  workSeconds: number;
  restSeconds: number;
}

export type PhaseKind = 'work' | 'rest';

export interface Phase {
  kind: PhaseKind;
  /** 1-based set number this phase belongs to. */
  set: number;
  durationMs: number;
}

export type TimerPosition =
  | { done: false; index: number; phase: Phase; remainingMs: number }
  | { done: true };

/**
 * Expand a config into the ordered list of phases.
 * Every set has a work phase; a rest follows each set except the last,
 * and rest phases are skipped entirely when restSeconds is 0.
 */
export function buildSchedule(config: TimerConfig): Phase[] {
  const phases: Phase[] = [];
  for (let set = 1; set <= config.sets; set++) {
    phases.push({ kind: 'work', set, durationMs: config.workSeconds * 1000 });
    if (set < config.sets && config.restSeconds > 0) {
      phases.push({ kind: 'rest', set, durationMs: config.restSeconds * 1000 });
    }
  }
  return phases;
}

export function totalDurationMs(schedule: Phase[]): number {
  return schedule.reduce((sum, p) => sum + p.durationMs, 0);
}

/** Where in the schedule we are after `elapsedMs` of running time. */
export function positionAt(schedule: Phase[], elapsedMs: number): TimerPosition {
  let start = 0;
  for (let index = 0; index < schedule.length; index++) {
    const phase = schedule[index];
    const end = start + phase.durationMs;
    if (elapsedMs < end) {
      return { done: false, index, phase, remainingMs: end - elapsedMs };
    }
    start = end;
  }
  return { done: true };
}

/** Format milliseconds as M:SS, rounding up so the display never shows 0:00 early. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
