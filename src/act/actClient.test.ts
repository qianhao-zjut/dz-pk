import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../store/gameStore';
import type { Player } from '../store/gameStore';
import { pollActOnce } from './actClient';

const human = (): Player => ({
  id: 'human',
  name: '你',
  isAI: false,
  chips: 200,
  cards: [],
  currentBet: 0,
  invested: 0,
  status: 'active',
  hasActed: false,
  canRaise: true,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  useGameStore.setState(useGameStore.getInitialState());
  useGameStore.setState({
    table: { id: 'test', name: '测试桌', smallBlind: 5, bigBlind: 10, buyIn: 1000 },
    stage: 'flop',
    players: [human()],
    currentPlayerIndex: 0,
    currentMaxBet: 0,
    lastRaiseSize: 10,
  });
});

describe('pollActOnce', () => {
  it('领到弃牌后执行，并把结果送回', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return new Response(JSON.stringify({ id: '7', action: 'fold' }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    });

    await expect(pollActOnce()).resolves.toBe(true);
    expect(useGameStore.getState().players[0].status).toBe('folded');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Dz-Act': '1' });
    expect(calls[1].url).toBe('/api/act/result');
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ id: '7', ok: true, action: 'fold' });
  });

  it('没有动作时不改牌局', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
    await expect(pollActOnce()).resolves.toBe(false);
    expect(useGameStore.getState().players[0].status).toBe('active');
  });
});
