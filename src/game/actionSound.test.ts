import { describe, expect, it } from 'vitest';
import { playActionCue, primeActionAudio } from './actionSound';

describe('actionSound', () => {
  it('没有音频上下文时不抛', () => {
    expect(() => primeActionAudio()).not.toThrow();
    expect(() => playActionCue('check')).not.toThrow();
    expect(() => playActionCue('all-in')).not.toThrow();
    expect(() => playActionCue('your-turn')).not.toThrow();
  });
});
