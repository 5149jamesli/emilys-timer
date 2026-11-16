// UI wiring: reads the setup form, runs the clock, updates the display and
// plays tones on phase changes. Timer math lives in timer.ts; sounds in tones.ts.
import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/jost/300.css';
import '@fontsource/jost/400.css';
import './style.css';
import { buildSchedule, formatClock, positionAt, totalDurationMs, type Phase } from './timer';
import { DEFAULT_TONE_ID, TONES, playTone, setSoundOn, setVolume, unlockAudio } from './tones';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const form = $<HTMLFormElement>('#setup');
const toneSelect = $<HTMLSelectElement>('#tone');
const phaseEl = $('#phase');
const clockEl = $('#clock');
const progressEl = $('#progress');
const ringEl = document.querySelector<SVGCircleElement>('#ring')!;
const startBtn = $<HTMLButtonElement>('#start');
const resetBtn = $<HTMLButtonElement>('#reset');

for (const tone of TONES) toneSelect.add(new Option(tone.label, tone.id));
toneSelect.value = DEFAULT_TONE_ID;

$('#preview-tone').addEventListener('click', () => playTone(toneSelect.value));

// Volume: works any time, even mid-workout. Remembered per device. Storage can
// be unavailable (private mode), and that's fine.
const volumeInput = $<HTMLInputElement>('#volume');
const volumeValue = $<HTMLOutputElement>('#volume-value');
const VOLUME_KEY = 'emilys-timer.volume';

function applyVolume(): void {
  const percent = volumeInput.valueAsNumber;
  setVolume(percent / 100);
  volumeValue.textContent = percent === 0 ? 'Off' : `${percent}%`;
  volumeInput.style.setProperty('--fill', `${percent}%`);
}

try {
  const saved = localStorage.getItem(VOLUME_KEY);
  if (saved !== null) volumeInput.value = saved;
} catch {}
applyVolume();

volumeInput.addEventListener('input', applyVolume);
// When the slider is let go, save the level and play the tone so you hear it.
volumeInput.addEventListener('change', () => {
  try {
    localStorage.setItem(VOLUME_KEY, volumeInput.value);
  } catch {}
  if (volumeInput.valueAsNumber > 0) playTone(toneSelect.value);
});

// Sound toggle. Off (the default) = no tones, even with the phone's ringer on.
// On = tones play even when the phone is on silent; on iPhone a playing podcast
// pauses at each tone and may resume after (see tones.ts). Remembered per device.
const soundInput = $<HTMLInputElement>('#sound-on');
const soundHint = $('#sound-hint');
const previewBtn = $<HTMLButtonElement>('#preview-tone');
const SOUND_KEY = 'emilys-timer.soundOn';

function applySound(): void {
  setSoundOn(soundInput.checked);
  soundHint.textContent = soundInput.checked
    ? 'On · plays on silent · pauses podcasts'
    : "Off · tones won't play";
  // Nothing to preview or adjust while sound is off.
  previewBtn.disabled = !soundInput.checked;
  volumeInput.disabled = !soundInput.checked;
}

try {
  soundInput.checked = localStorage.getItem(SOUND_KEY) === 'true';
} catch {}
applySound();

soundInput.addEventListener('change', () => {
  applySound();
  try {
    localStorage.setItem(SOUND_KEY, String(soundInput.checked));
  } catch {}
});

type RunState = 'idle' | 'running' | 'paused' | 'done';

let state: RunState = 'idle';
let schedule: Phase[] = [];
/** Running time accumulated before the current run segment (ms). */
let elapsedBeforeMs = 0;
/** performance.now() when the current run segment started. */
let segmentStart = 0;
let lastIndex = -1;
let frame = 0;
let wakeLock: WakeLockSentinel | null = null;

function readConfig() {
  // Read inputs directly: FormData skips disabled inputs, and they're disabled mid-run.
  const num = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).valueAsNumber || 0;
  return {
    sets: num('sets'),
    workSeconds: num('work'),
    restSeconds: num('rest'),
  };
}

function elapsed(): number {
  return state === 'running' ? elapsedBeforeMs + (performance.now() - segmentStart) : elapsedBeforeMs;
}

function render(): void {
  // Timing is derived from timestamps each frame, so it doesn't drift.
  const pos = positionAt(schedule, elapsed());
  if (pos.done) {
    finish();
    return;
  }
  if (pos.index !== lastIndex) {
    if (lastIndex !== -1) playTone(toneSelect.value);
    lastIndex = pos.index;
  }
  const sets = schedule.filter((p) => p.kind === 'work').length;
  phaseEl.textContent = pos.phase.kind === 'work' ? 'Work' : 'Rest';
  document.body.dataset.phase = pos.phase.kind;
  clockEl.textContent = formatClock(pos.remainingMs);
  progressEl.textContent = `Set ${pos.phase.set} of ${sets}`;
  setRing(pos.remainingMs / pos.phase.durationMs);
}

/** Fraction of the ring still drawn: 1 = full circle, 0 = empty. */
function setRing(fraction: number): void {
  ringEl.style.strokeDashoffset = String(1 - fraction);
}

function loop(): void {
  render();
  if (state === 'running') frame = requestAnimationFrame(loop);
}

async function keepScreenOn(on: boolean): Promise<void> {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    // Wake Lock is best-effort; unsupported or denied is fine.
  }
}

function start(): void {
  if (!form.reportValidity()) return;
  unlockAudio();
  if (state === 'idle' || state === 'done') {
    schedule = buildSchedule(readConfig());
    elapsedBeforeMs = 0;
    lastIndex = -1;
    playTone(toneSelect.value);
  }
  state = 'running';
  segmentStart = performance.now();
  void keepScreenOn(true);
  syncControls();
  loop();
}

function pause(): void {
  elapsedBeforeMs = elapsed();
  state = 'paused';
  cancelAnimationFrame(frame);
  void keepScreenOn(false);
  syncControls();
}

function finish(): void {
  state = 'done';
  cancelAnimationFrame(frame);
  elapsedBeforeMs = totalDurationMs(schedule);
  playTone(toneSelect.value, 3);
  phaseEl.textContent = 'Done!';
  clockEl.textContent = formatClock(0);
  setRing(0);
  delete document.body.dataset.phase;
  void keepScreenOn(false);
  syncControls();
}

function reset(): void {
  state = 'idle';
  cancelAnimationFrame(frame);
  elapsedBeforeMs = 0;
  lastIndex = -1;
  phaseEl.textContent = 'Ready';
  clockEl.textContent = formatClock(readConfig().workSeconds * 1000);
  progressEl.textContent = '';
  setRing(1);
  delete document.body.dataset.phase;
  void keepScreenOn(false);
  syncControls();
}

function syncControls(): void {
  document.body.dataset.state = state;
  startBtn.textContent = state === 'running' ? 'Pause' : state === 'paused' ? 'Resume' : 'Start';
  resetBtn.disabled = state === 'idle';
  for (const el of form.elements) {
    // Lock the workout settings mid-run, but never the volume slider.
    if (el instanceof HTMLInputElement && el.type === 'number') {
      el.disabled = state === 'running' || state === 'paused';
    }
  }
}

startBtn.addEventListener('click', () => (state === 'running' ? pause() : start()));
resetBtn.addEventListener('click', reset);
form.addEventListener('input', (e) => {
  // Only the workout numbers affect the display; volume and switches don't.
  if (state === 'idle' && e.target instanceof HTMLInputElement && e.target.type === 'number') reset();
});

reset();

// Offline support: the service worker only exists in production builds.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Offline support is a nice-to-have; the app works without it.
  });
}
