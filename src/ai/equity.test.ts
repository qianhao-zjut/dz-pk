import { describe, expect, it } from 'vitest';
import { dealSample, estimateEquity } from './equity';
import { splitPots } from './pots';
import { buildObservation } from './observation';
import { mulberry32 } from './rng';
import type { ObservationSource, SourcePlayer } from './types';

const ROYAL = ['Ah', 'Kh', 'Qh', 'Jh', 'Th'];
const NUTS_BOARD = ['Ac', 'Ah', 'Kd', '7c', '2s'];

function player(id: string, invested: number, status: SourcePlayer['status'] = 'active', cards?: string[]): SourcePlayer {
  return {
    id,
    chips: 1000,
    currentBet: 0,
    invested,
    status,
    canRaise: true,
    ...(cards ? { cards } : {}),
  };
}

function river(players: SourcePlayer[], board: string[], partial: Partial<ObservationSource> = {}): ObservationSource {
  return {
    sessionId: 'eq',
    handNumber: 1,
    decisionRevision: 1,
    stage: 'river',
    pot: players.reduce((sum, item) => sum + item.invested, 0),
    board,
    dealerIndex: 0,
    currentPlayerIndex: 0,
    currentMaxBet: 0,
    lastRaiseSize: 10,
    bigBlind: 10,
    streetActions: [],
    players,
    ...partial,
  };
}

function mustEquity(source: ObservationSource, samples = 4) {
  const built = buildObservation(source);
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error(built.error);
  const result = estimateEquity(built.observation, {
    samples,
    sampleRng: mulberry32(11),
    timeBudgetMs: 5000,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return { observation: built.observation, result };
}

describe('分池资格', () => {
  it('50/100/100 时短码只竞争 150 的主池', () => {
    const split = splitPots([
      { id: 'short', invested: 50, inHand: true },
      { id: 'b', invested: 100, inHand: true },
      { id: 'c', invested: 100, inHand: true },
    ]);
    expect(split.refunds).toEqual([]);
    expect(split.pots).toEqual([
      { amount: 150, eligibleIds: ['short', 'b', 'c'] },
      { amount: 100, eligibleIds: ['b', 'c'] },
    ]);
  });

  it('弃牌的投入留在池中但没有资格', () => {
    const split = splitPots([
      { id: 'hero', invested: 100, inHand: true },
      { id: 'villain', invested: 100, inHand: true },
      { id: 'folder', invested: 40, inHand: false },
    ]);
    expect(split.pots.reduce((sum, pot) => sum + pot.amount, 0)).toBe(240);
    expect(split.pots.every((pot) => !pot.eligibleIds.includes('folder'))).toBe(true);
  });

  it('只有一人盖过的超额按返还，不进入可争夺池', () => {
    const split = splitPots([
      { id: 'hero', invested: 100, inHand: true },
      { id: 'villain', invested: 40, inHand: true },
    ]);
    expect(split.refunds).toEqual([{ playerId: 'hero', amount: 60 }]);
    expect(split.pots).toEqual([{ amount: 80, eligibleIds: ['hero', 'villain'] }]);
  });
});

describe('权益抽样', () => {
  it('公共牌是皇家同花顺时，单挑 0.5、四人 0.25', () => {
    const heads = mustEquity(river([
      player('hero', 100, 'active', ['2c', '3d']),
      player('v', 100),
    ], ROYAL));
    expect(heads.result.equity).toBe(0.5);

    const four = mustEquity(river([
      player('hero', 100, 'active', ['2c', '3d']),
      player('v1', 100),
      player('v2', 100),
      player('v3', 100),
      player('folder', 100, 'folded', ['As', 'Ad']),
    ], ROYAL));
    expect(four.result.equity).toBe(0.25);
    expect(four.result.expectedRecovery).toBe(125);
  });

  it('河牌绝对坚果的权益是 1', () => {
    const nuts = mustEquity(river([
      player('hero', 100, 'active', ['As', 'Ad']),
      player('v', 100),
    ], NUTS_BOARD));
    expect(nuts.result.equity).toBe(1);
    expect(nuts.result.expectedRecovery).toBe(200);
  });

  it('短码坚果只回收主池，超额返还单独计入', () => {
    const short = mustEquity(river([
      player('hero', 50, 'active', ['As', 'Ad']),
      player('b', 100),
      player('c', 100),
    ], NUTS_BOARD));
    expect(short.result.heroEligible).toBe(150);
    expect(short.result.contestable).toBe(250);
    expect(short.result.expectedRecovery).toBe(150);
    expect(short.result.equity).toBe(1);

    const refund = mustEquity(river([
      player('hero', 100, 'active', ['As', 'Ad']),
      player('v', 40),
    ], NUTS_BOARD));
    expect(refund.result.heroRefund).toBe(60);
    expect(refund.result.expectedRecovery).toBe(140);
  });

  it('每次抽样的牌唯一，并补齐五张公共牌，且不修改输入', () => {
    const built = buildObservation(river([
      player('hero', 20, 'active', ['9c', '8c']),
      player('v1', 20),
      player('v2', 20),
    ], ['2d', '5h', 'Js'], { stage: 'flop', board: ['2d', '5h', 'Js'] }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    Object.freeze(built.observation.holeCards);
    Object.freeze(built.observation.board);
    Object.freeze(built.observation.players);
    const deal = dealSample(built.observation.holeCards, built.observation.board, 2, mulberry32(3));
    expect(deal.board).toHaveLength(5);
    expect(deal.board.slice(0, 3)).toEqual(['2d', '5h', 'Js']);
    expect(new Set(deal.used).size).toBe(deal.used.length);
    const again = estimateEquity(built.observation, { samples: 6, sampleRng: mulberry32(3) });
    expect(again.ok).toBe(true);
    expect(built.observation.board).toEqual(['2d', '5h', 'Js']);
    expect(built.observation.holeCards).toEqual(['9c', '8c']);
  });

  it('固定种子下，隐藏牌和牌堆不影响权益', () => {
    const left = river([
      player('hero', 50, 'active', ['Qs', 'Jh']),
      player('v', 50, 'active', ['2c', '3d']),
    ], ['8d', '4c', '2h', '9s', 'Td']);
    const right = river([
      player('hero', 50, 'active', ['Qs', 'Jh']),
      player('v', 50, 'active', ['Ac', 'Ad']),
    ], ['8d', '4c', '2h', '9s', 'Td']);
    const a = mustEquity(left, 30);
    const rightBuilt = buildObservation(right);
    expect(rightBuilt.ok).toBe(true);
    if (!rightBuilt.ok) return;
    const b = estimateEquity(rightBuilt.observation, {
      samples: 30,
      sampleRng: mulberry32(11),
    });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.equity).toBe(a.result.equity);
    expect(b.assumption).toContain('均匀随机');
  });

  it('坏牌和抽不出来的局面有界失败', () => {
    const built = buildObservation(river([
      player('hero', 10, 'active', ['Qs', 'Jd']),
      player('v', 10),
    ], NUTS_BOARD));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const broken = {
      ...built.observation,
      holeCards: ['As', 'As'] as [string, string],
    };
    expect(estimateEquity(broken, { samples: 5 }).ok).toBe(false);
    const clock = [0, 1000];
    let i = 0;
    const limited = estimateEquity(built.observation, {
      samples: 50,
      timeBudgetMs: 10,
      now: () => clock[Math.min(i++, clock.length - 1)],
      sampleRng: mulberry32(1),
    });
    expect(limited.ok).toBe(true);
    if (!limited.ok) return;
    expect(limited.samples).toBe(1);
    expect(Number.isFinite(limited.equity)).toBe(true);
  });
});
