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
 * Sound mode, chosen with the three-way "Sound" control. iPhone won't let a web
 * app both ignore the silent switch and mix with a podcast, so the user picks:
 * - 'off':  no tones at all. The app never touches the audio session.
 * - 'on':   audio session 'playback'. Plays even on silent, but a playing
 *           podcast pauses and stays paused (confirmed on a real iPhone).
 * - 'mix':  audio session 'ambient'. Mixes over a podcast that keeps playing,
 *           but is muted when the phone is on silent.
 * The audio session (navigator.audioSession, Safari 16.4+) is ignored by other
 * browsers, where 'on' and 'mix' sound the same.
 */
export type SoundMode = 'off' | 'on' | 'mix';
let mode: SoundMode = 'off';

const SESSION_TYPE: Record<Exclude<SoundMode, 'off'>, string> = {
  on: 'playback',
  mix: 'ambient',
};

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

function applySessionType(): void {
  if (mode === 'off') return;
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = SESSION_TYPE[mode];
}

/**
 * Change the sound mode. Call it from the control's handler: choosing a mode
 * with sound is a user gesture, which iPhone needs before audio can start.
 */
export function setSoundMode(next: SoundMode): void {
  mode = next;
  if (mode === 'off') {
    // Stop using the speaker entirely.
    if (ctx && ctx.state === 'running') void ctx.suspend();
    return;
  }
  applySessionType();
  unlockAudio();
}

/**
 * Browsers only allow audio after a user gesture, so this runs from taps
 * (Start, Listen, choosing a Sound mode). It does nothing while sound is off,
 * so the app never touches the audio session (or a podcast) then.
 */
export function unlockAudio(): AudioContext | null {
  if (mode === 'off') return null;
  if (!ctx) {
    applySessionType();
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volumeToGain(volume);
    master.connect(ctx.destination);
  }
  // Suspended by switching to Off, or 'interrupted' by iPhone after a call.
  if (ctx.state !== 'running') void ctx.resume();
  return ctx;
}

/** Play a tone `repeat` times back to back (used for the "workout done" signal). */
export async function playTone(id: string, repeat = 1): Promise<void> {
  const audio = unlockAudio();
  if (!audio) return;
  if (audio.state !== 'running') {
    try {
      await audio.resume();
    } catch {
      // Nothing more we can do; the next tap will unlock it again.
    }
  }
  const tone = getTone(id);
  const start = audio.currentTime + 0.02;
  for (let i = 0; i < repeat; i++) {
    tone.play(audio, start + i * tone.length);
  }
}
