const SOUND_STORAGE_KEY = 'dz-pk-sound';
let memory: boolean | null = null;

export function readSoundEnabled(): boolean {
  if (memory !== null) return memory;
  try {
    memory = globalThis.localStorage?.getItem(SOUND_STORAGE_KEY) !== 'off';
  } catch {
    memory = true;
  }
  return memory;
}

export function writeSoundEnabled(on: boolean): void {
  memory = on;
  try {
    globalThis.localStorage?.setItem(SOUND_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // 本次页面继续使用 memory。
  }
}
