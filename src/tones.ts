// Alert tones, synthesized with the Web Audio API (no audio files to ship).
// TONES is ordered from most jarring to most soothing, and the dropdown keeps
// that order. To add a tone: add an entry with a unique id, a label, its
// length in seconds, and a play() function.

export interface Tone {
  id: string;
  label: string;
  /** Roughly how long the tone lasts, in seconds. Used to space repeats. */
  length: number;
  play(ctx: AudioContext, at: number): void;
}

interface NoteOptions {
  type?: OscillatorType;
  volume?: number;
  /** Seconds to fade in. Short = clicky/percussive, longer = softer. */
  attack?: number;
}

/** One enveloped oscillator note. Times are in AudioContext seconds. */
function note(
  ctx: AudioContext,
  at: number,
  freq: number,
  duration: number,
  { type = 'sine', volume = 0.3, attack = 0.01 }: NoteOptions = {},
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain).connect(master ?? ctx.destination);
  osc.start(at);
  osc.stop(at + duration + 0.05);
}

export const TONES: Tone[] = [
  {
    // 1. Most jarring: rapid, harsh alternating square-wave pulses.
    id: 'alarm',
    label: 'Alarm clock',
    length: 0.85,
    play: (ctx, at) => {
      for (let i = 0; i < 8; i++) {
        note(ctx, at + i * 0.1, i % 2 ? 1250 : 950, 0.09, { type: 'square', volume: 0.12, attack: 0.002 });
      }
    },
  },
  {
    // 2. Alerting but tidier: three clean electronic beeps.
    id: 'digital',
    label: 'Digital beep',
    length: 0.6,
    play: (ctx, at) => {
      for (let i = 0; i < 3; i++) {
        note(ctx, at + i * 0.2, 1046.5, 0.13, { type: 'triangle', volume: 0.25, attack: 0.005 });
      }
    },
  },
  {
    // 3. Middle of the range: a soft two-note "ding-dong".
    id: 'chime',
    label: 'Doorbell chime',
    length: 1.6,
    play: (ctx, at) => {
      for (const [offset, freq] of [[0, 659.3], [0.45, 523.3]] as const) {
        note(ctx, at + offset, freq, 1.1, { volume: 0.25 });
        note(ctx, at + offset, freq * 2, 0.6, { volume: 0.05 });
      }
    },
  },
  {
    // 4. Gentle: a light cascade of high pentatonic notes, like wind chimes.
    id: 'wind',
    label: 'Wind chimes',
    length: 2,
    play: (ctx, at) => {
      const notes = [1568, 2093, 1760, 2349, 1976];
      notes.forEach((freq, i) => {
        const t = at + i * 0.14;
        note(ctx, t, freq, 1.4, { volume: 0.09, attack: 0.004 });
        note(ctx, t, freq * 2.76, 0.4, { volume: 0.02, attack: 0.004 });
      });
    },
  },
  {
    // 5. Most soothing: a struck singing bowl / temple bell with a long,
    //    shimmering decay. The partials are inharmonic like a real bowl, and the
    //    slightly detuned twin of the fundamental gives a slow "wah" beating.
    id: 'temple',
    label: 'Temple bell',
    length: 3,
    play: (ctx, at) => {
      const f = 330;
      note(ctx, at, f, 6, { volume: 0.22, attack: 0.015 });
      note(ctx, at, f + 1.6, 6, { volume: 0.12, attack: 0.015 });
      note(ctx, at, f * 2.76, 4, { volume: 0.1, attack: 0.01 });
      note(ctx, at, f * 5.4, 2.2, { volume: 0.04, attack: 0.005 });
      note(ctx, at, f * 8.93, 1.2, { volume: 0.02, attack: 0.003 });
    },
  },
];

export const DEFAULT_TONE_ID = 'temple';

export function getTone(id: string): Tone {
  return TONES.find((t) => t.id === id) ?? TONES.find((t) => t.id === DEFAULT_TONE_ID)!;
}

/**
 * How our sounds share the speaker with other apps on iPhone (Audio Session
 * API; Safari 16.4+, ignored by other browsers). iPhone forces a choice:
 * - 'playback': plays even when the phone is on silent, but stops any podcast
 *   or music that's playing.
 * - 'transient': short alerts that mix over a podcast (ducking it briefly), but
 *   the silent switch mutes them.
 * The user picks with the "Play on silent" switch (setPlayOnSilent).
 */
type AudioSessionType = 'playback' | 'transient';
let sessionType: AudioSessionType = 'playback';

function applySessionType(): void {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = sessionType;
}

/** true = hear tones even on silent (pauses podcasts); false = mix with podcasts. */
export function setPlayOnSilent(on: boolean): void {
  sessionType = on ? 'playback' : 'transient';
  applySessionType();
}

let ctx: AudioContext | null = null;
/** Every note goes through this node, so it sets the overall volume. */
let master: GainNode | null = null;
/** Slider position, 0–1. 1 = the tones' designed loudness. */
let volume = 0.8;

/**
 * Sliders feel more even when loudness follows a curve rather than a straight
 * line (a linear gain makes the top half of the slider seem to do little).
 */
function volumeToGain(v: number): number {
  return v * v;
}

/** Set the tone volume (0–1). Safe to call before audio is unlocked. */
export function setVolume(v: number): void {
  volume = Math.min(1, Math.max(0, v));
  if (ctx && master) master.gain.setTargetAtTime(volumeToGain(volume), ctx.currentTime, 0.02);
}

/**
 * Browsers only allow audio after a user gesture, so call this from a click
 * handler (e.g. Start) before the timer needs to make sound.
 */
export function unlockAudio(): AudioContext {
  if (!ctx) {
    applySessionType();
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volumeToGain(volume);
    master.connect(ctx.destination);
  }
  // iPhone can leave the context 'suspended' or 'interrupted' (e.g. after a call
  // or switching apps); anything but 'running' needs a resume.
  if (ctx.state !== 'running') void ctx.resume();
  return ctx;
}

// Coming back to the app after a podcast app, a call or the lock screen.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') void ctx.resume();
});

/** Play a tone `repeat` times back to back (used for the "workout done" signal). */
export function playTone(id: string, repeat = 1): void {
  const audio = unlockAudio();
  const tone = getTone(id);
  for (let i = 0; i < repeat; i++) {
    tone.play(audio, audio.currentTime + i * tone.length);
  }
}
