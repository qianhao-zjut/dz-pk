import { afterEach, describe, expect, it, vi } from 'vitest';

async function load() {
  vi.resetModules();
  return import('./soundPreference');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('soundPreference', () => {
  it('缺键和无法识别的值都是开', async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => { mem.set(key, value); },
    });
    const pref = await load();
    expect(pref.readSoundEnabled()).toBe(true);
    mem.set('dz-pk-sound', 'maybe');
    vi.resetModules();
    const again = await load();
    expect(again.readSoundEnabled()).toBe(true);
  });

  it('off 会记住，读写失败时本次页面仍可关闭', async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => { mem.set(key, value); },
    });
    const pref = await load();
    pref.writeSoundEnabled(false);
    expect(mem.get('dz-pk-sound')).toBe('off');
    expect(pref.readSoundEnabled()).toBe(false);

    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    const broken = await load();
    expect(broken.readSoundEnabled()).toBe(true);
    expect(() => broken.writeSoundEnabled(false)).not.toThrow();
    expect(broken.readSoundEnabled()).toBe(false);
  });
});
