// UI wiring: reads the setup form, runs the clock, updates the display and
// plays tones on phase changes. Timer math lives in timer.ts; sounds in tones.ts.
import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/jost/300.css';
import '@fontsource/jost/400.css';
import './style.css';
import { SETUP_KEY, parseSavedSetup, serializeSetup } from './setup';
import { buildSchedule, formatClock, positionAt, totalDurationMs, type Phase } from './timer';
import { DEFAULT_TONE_ID, TONES, playTone, setSoundMode, setVolume, unlockAudio, type SoundMode } from './tones';

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

// Reopen with the last setup that was actually used (saved in start()).
// Invalid or missing fields keep the defaults from index.html.
const numberInput = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
try {
  const saved = parseSavedSetup(
    localStorage.getItem(SETUP_KEY),
    TONES.map((t) => t.id),
  );
  if (saved.sets !== undefined) numberInput('sets').value = String(saved.sets);
  if (saved.workSeconds !== undefined) numberInput('work').value = String(saved.workSeconds);
  if (saved.restSeconds !== undefined) numberInput('rest').value = String(saved.restSeconds);
  if (saved.tone !== undefined) toneSelect.value = saved.tone;
} catch {}

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

// Sound: Off (the default) / On / Over podcast. iPhone can't both play on
// silent and mix with a podcast, so the user picks (see tones.ts).
// Remembered per device.
const soundInputs = [...form.querySelectorAll<HTMLInputElement>('input[name="sound"]')];
const soundHint = $('#sound-hint');
const previewBtn = $<HTMLButtonElement>('#preview-tone');
const SOUND_KEY = 'emilys-timer.sound';
const SOUND_HINTS: Record<SoundMode, string> = {
  off: "Tones won't play",
  on: 'Plays even on silent · pauses podcasts',
  mix: 'Plays over podcasts · turn off silent mode',
};

function currentSoundMode(): SoundMode {
  return (soundInputs.find((i) => i.checked)?.value ?? 'off') as SoundMode;
}

function applySound(): void {
  const mode = currentSoundMode();
  setSoundMode(mode);
  soundHint.textContent = SOUND_HINTS[mode];
  // Nothing to preview or adjust while sound is off.
  previewBtn.disabled = mode === 'off';
  volumeInput.disabled = mode === 'off';
}

try {
  // The older on/off toggle stored 'emilys-timer.soundOn'; carry "on" over.
  const saved =
    localStorage.getItem(SOUND_KEY) ?? (localStorage.getItem('emilys-timer.soundOn') === 'true' ? 'on' : null);
  const match = soundInputs.find((i) => i.value === saved);
  if (match) match.checked = true;
} catch {}
applySound();

for (const input of soundInputs) {
  input.addEventListener('change', () => {
    applySound();
    try {
      localStorage.setItem(SOUND_KEY, currentSoundMode());
    } catch {}
  });
}

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
  const num = (name: string) => numberInput(name).valueAsNumber || 0;
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
    const config = readConfig();
    // A new workout (not a resume): remember this setup for next time.
    try {
      localStorage.setItem(SETUP_KEY, serializeSetup({ ...config, tone: toneSelect.value }));
    } catch {}
    schedule = buildSchedule(config);
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
