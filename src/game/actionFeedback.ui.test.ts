import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const table = readFileSync(new URL('../components/GameTable.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const store = readFileSync(new URL('../store/gameStore.ts', import.meta.url), 'utf8');

describe('行动反馈界面', () => {
  it('四个座位共用中文行动行，不再写英文弃牌和全下', () => {
    expect(table).not.toContain('Folded');
    expect(table).not.toContain('ALL-IN');
    expect(table).toContain('seatActionLabel');
    expect(table.match(/<SeatActionLine/g)).toHaveLength(4);
  });

  it('牌桌有音效开关，进桌点击解锁音频，store 不播放', () => {
    expect(table).toContain('音效开');
    expect(table).toContain('音效关');
    expect(table).toContain('liveActionSound');
    expect(app).toContain('primeActionAudio');
    expect(store).not.toContain('playActionCue');
    expect(store).not.toContain('liveActionSound');
  });
});
