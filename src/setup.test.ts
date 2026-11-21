import { describe, expect, it } from 'vitest';
import { parseSavedSetup, serializeSetup } from './setup';

const TONE_IDS = ['alarm', 'digital', 'chime', 'wind', 'temple'];

describe('saved setup', () => {
  it('round-trips a valid setup', () => {
    const setup = { sets: 10, workSeconds: 30, restSeconds: 30, tone: 'wind' };
    expect(parseSavedSetup(serializeSetup(setup), TONE_IDS)).toEqual(setup);
  });

  it('allows zero rest', () => {
    const raw = serializeSetup({ sets: 3, workSeconds: 45, restSeconds: 0, tone: 'temple' });
    expect(parseSavedSetup(raw, TONE_IDS).restSeconds).toBe(0);
  });

  it('returns nothing when nothing is saved or the data is unreadable', () => {
    expect(parseSavedSetup(null, TONE_IDS)).toEqual({});
    expect(parseSavedSetup('not json', TONE_IDS)).toEqual({});
    expect(parseSavedSetup('42', TONE_IDS)).toEqual({});
  });

  it('keeps valid fields and drops invalid ones', () => {
    const raw = JSON.stringify({ sets: 0, workSeconds: 30, restSeconds: 5000, tone: 'gong' });
    expect(parseSavedSetup(raw, TONE_IDS)).toEqual({ workSeconds: 30 });
  });

  it('rejects fractional and non-number values', () => {
    const raw = JSON.stringify({ sets: 2.5, workSeconds: '30', restSeconds: null, tone: 7 });
    expect(parseSavedSetup(raw, TONE_IDS)).toEqual({});
  });
});
