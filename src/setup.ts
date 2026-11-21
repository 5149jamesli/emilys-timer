// The last workout setup that was actually used (saved when a new workout
// starts), so the app reopens with it. Pure functions, no DOM or storage, so
// they can be unit tested; main.ts does the localStorage reads and writes.

export const SETUP_KEY = 'emilys-timer.setup';

export interface SavedSetup {
  sets: number;
  workSeconds: number;
  restSeconds: number;
  tone: string;
}

/** Allowed ranges. Keep in sync with the min/max on the inputs in index.html. */
export const LIMITS = {
  sets: [1, 99],
  workSeconds: [1, 3600],
  restSeconds: [0, 3600],
} as const satisfies Record<string, readonly [number, number]>;

function inRange(value: unknown, [min, max]: readonly [number, number]): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Read a saved setup. Returns only the fields that are present and valid, so a
 * damaged or outdated entry can't put a bad value in the form; anything left
 * out keeps the form's default.
 */
export function parseSavedSetup(raw: string | null, toneIds: readonly string[]): Partial<SavedSetup> {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== 'object' || data === null) return {};
  const d = data as Record<string, unknown>;
  const result: Partial<SavedSetup> = {};
  if (inRange(d.sets, LIMITS.sets)) result.sets = d.sets;
  if (inRange(d.workSeconds, LIMITS.workSeconds)) result.workSeconds = d.workSeconds;
  if (inRange(d.restSeconds, LIMITS.restSeconds)) result.restSeconds = d.restSeconds;
  if (typeof d.tone === 'string' && toneIds.includes(d.tone)) result.tone = d.tone;
  return result;
}

export function serializeSetup(setup: SavedSetup): string {
  return JSON.stringify(setup);
}
