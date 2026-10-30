import { createActionSoundGate, type ActionCue, type SoundFrame } from './actionSoundGate';
import { readSoundEnabled } from './soundPreference';

let audioContext: AudioContext | null = null;

export function primeActionAudio(): void {
  try {
    if (typeof window === 'undefined' || !window.AudioContext) return;
    if (!audioContext) audioContext = new window.AudioContext();
    void audioContext.resume().catch(() => {});
  } catch {
    // 浏览器拒绝时保留标签，不提示。
  }
}

function tone(ctx: AudioContext, freq: number, when: number, duration: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.15, when + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

function click(ctx: AudioContext, when: number, duration: number) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.15, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start(when);
  source.stop(when + duration);
}

export function playActionCue(cue: ActionCue): void {
  const ctx = audioContext;
  if (!ctx || ctx.state !== 'running') return;
  try {
    const now = ctx.currentTime;
    if (cue === 'check') tone(ctx, 880, now, 0.04);
    else if (cue === 'fold') tone(ctx, 180, now, 0.08);
    else if (cue === 'call') click(ctx, now, 0.03);
    else if (cue === 'bet') {
      tone(ctx, 520, now, 0.04);
      tone(ctx, 520, now + 0.09, 0.04);
    } else if (cue === 'raise') {
      tone(ctx, 880, now, 0.04);
      tone(ctx, 880, now + 0.09, 0.04);
    } else if (cue === 'all-in') {
      click(ctx, now, 0.03);
      tone(ctx, 140, now, 0.15);
    } else if (cue === 'your-turn') tone(ctx, 660, now, 0.12);
  } catch {
    // 合成失败时静默。
  }
}

export const liveActionSound: { onFrame: (frame: SoundFrame) => () => void } = createActionSoundGate({
  play: playActionCue,
  delay: (ms, run) => {
    const id = setTimeout(run, ms);
    return () => clearTimeout(id);
  },
  enabled: readSoundEnabled,
  hidden: () => typeof document !== 'undefined' && document.hidden,
});
