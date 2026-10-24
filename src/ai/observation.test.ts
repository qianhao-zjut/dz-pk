import { describe, expect, it } from 'vitest';
import { expandRangeToken } from './cards';
import { buildObservation, toNpcSource } from './observation';
import { PROFILES } from './profiles';
import type { ObservationSource, SourcePlayer } from './types';

function hero(cards: string[] = ['As', 'Kd'], extra: Partial<SourcePlayer> = {}): SourcePlayer {
  return {
    id: 'ai_0',
    chips: 1000,
    currentBet: 0,
    invested: 10,
    status: 'active',
    canRaise: true,
    cards,
    ...extra,
  };
}

function villain(id: string, extra: Partial<SourcePlayer> = {}): SourcePlayer {
  return {
    id,
    chips: 1000,
    currentBet: 10,
    invested: 10,
    status: 'active',
    canRaise: true,
    ...extra,
  };
}

function source(partial: Partial<ObservationSource> = {}): ObservationSource {
  return {
    sessionId: 'session',
    handNumber: 2,
    decisionRevision: 4,
    stage: 'preflop',
    pot: 20,
    board: [],
    dealerIndex: 0,
    currentPlayerIndex: 0,
    currentMaxBet: 10,
    lastRaiseSize: 10,
    bigBlind: 10,
    streetActions: [],
    players: [hero(), villain('ai_1')],
    ...partial,
  };
}

describe('observation 信息边界', () => {
  it('不复制牌堆、日志或其他人的底牌，并复制自己的牌', () => {
    const hole = ['As', 'Kd'];
    const input = {
      ...source({ players: [hero(hole), villain('ai_1', { cards: ['Qc', 'Qd'] })] }),
      deck: ['4h', '5h'],
      gameLog: ['你的底牌: Qc Qd', '秘密 4h'],
    };
    const snap = toNpcSource(input);
    const built = buildObservation(snap);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const text = JSON.stringify({ snap, observation: built.observation });
    expect(text).not.toContain('Qc');
    expect(text).not.toContain('4h');
    expect(text).not.toContain('秘密');
    expect(text).not.toContain('deck');
    expect(text).not.toContain('gameLog');
    hole[0] = '2c';
    expect(built.observation.holeCards).toEqual(['As', 'Kd']);
  });

  it('改变隐藏牌后，快照和令牌不变', () => {
    const first = source();
    const second = source({
      players: [hero(), villain('ai_1', { cards: ['Ah', 'Ad'] })],
    });
    const left = buildObservation(toNpcSource({ ...first, deck: ['2c'], gameLog: ['As Kd'] }));
    const right = buildObservation(toNpcSource({ ...second, deck: ['9s'], gameLog: ['完全不同'] }));
    expect(left).toEqual(right);
  });

  it('令牌绑定会话、手牌、版本和玩家', () => {
    const built = buildObservation(source());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.observation.turnToken).toBe('session:2:4:ai_0');
    const next = buildObservation(source({ decisionRevision: 5 }));
    expect(next.ok && next.observation.turnToken).not.toBe(built.observation.turnToken);
  });

  it('只统计本街加注，盲注不算加注', () => {
    const built = buildObservation(source({
      streetActions: [
        { actorId: 'ai_1', stage: 'preflop', kind: 'post', to: 10 },
        { actorId: 'human', stage: 'preflop', kind: 'raise', to: 30 },
        { actorId: 'ai_2', stage: 'flop', kind: 'raise', to: 20 },
      ],
    }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.observation.street).toEqual({
      raiseCount: 1,
      lastRaiserId: 'human',
      fullRaiseCount: 1,
      lastFullRaiserId: 'human',
      openerId: 'human',
      openTo: 30,
      threeBetActorId: null,
      threeBetTo: null,
    });
  });
});

describe('合法动作', () => {
  it('面对下注不能过牌，可以跟注', () => {
    const built = buildObservation(source());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.observation.toCall).toBe(10);
    expect(built.observation.callCost).toBe(10);
    expect(built.observation.legal.canCheck).toBe(false);
    expect(built.observation.legal.canCall).toBe(true);
    expect(built.observation.minRaiseTo).toBe(20);
  });

  it('没有加注权限时不能加注', () => {
    const built = buildObservation(source({
      players: [hero(['As', 'Kd'], { canRaise: false }), villain('ai_1')],
    }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.observation.legal.canRaise).toBe(false);
  });

  it('短码跟注仍然合法，短码加注只允许一个目标', () => {
    const built = buildObservation(source({
      currentMaxBet: 100,
      lastRaiseSize: 40,
      players: [hero(['As', 'Kd'], { chips: 30, currentBet: 0 }), villain('ai_1', { currentBet: 100 })],
    }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.observation.callCost).toBe(30);
    expect(built.observation.legal.canCall).toBe(true);
    expect(built.observation.maxRaiseTo).toBe(30);
    expect(built.observation.legal.canRaise).toBe(false);
  });

  it('够跟注但不够最小加注时，只能全下加注到剩余筹码', () => {
    const built = buildObservation(source({
      currentMaxBet: 40,
      lastRaiseSize: 40,
      players: [hero(['As', 'Kd'], { chips: 50, currentBet: 0 }), villain('ai_1', { currentBet: 40 })],
    }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.observation.minRaiseTo).toBe(80);
    expect(built.observation.maxRaiseTo).toBe(50);
    expect(built.observation.legal.shortAllInOnly).toBe(true);
    expect(built.observation.legal.canRaise).toBe(true);
  });

  it('没人下注时可以过牌，最小下注是上一次加注增量', () => {
    const built = buildObservation(source({
      stage: 'flop',
      board: ['2c', '7d', '9h'],
      currentMaxBet: 0,
      lastRaiseSize: 10,
      pot: 40,
      players: [hero(), villain('ai_1', { currentBet: 0 })],
    }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.observation.legal.canCheck).toBe(true);
    expect(built.observation.legal.canCall).toBe(false);
    expect(built.observation.minRaiseTo).toBe(10);
    expect(built.observation.legal.shortAllInOnly).toBe(false);
  });

  it('非法牌、重复牌和人数过多会失败，而不是继续评估', () => {
    expect(buildObservation(source({ players: [hero(['As', 'As']), villain('ai_1')] })).ok).toBe(false);
    expect(buildObservation(source({ stage: 'flop', board: ['As', 'Kd'] })).ok).toBe(false);
    expect(buildObservation(source({ players: [hero(['ZZ', 'Kd']), villain('ai_1')] })).ok).toBe(false);
    const crowd = [hero(), ...Array.from({ length: 30 }, (_, i) => villain(`v${i}`))];
    const tooMany = buildObservation(source({ players: crowd }));
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error).toBe('not-enough-cards');
    expect(buildObservation(source({ stage: 'showdown' })).ok).toBe(false);
  });
});

describe('范围记号', () => {
  it('对子和同花连张可以按加号展开', () => {
    expect(expandRangeToken('77+')).toContain('AA');
    expect(expandRangeToken('77+')).not.toContain('66');
    expect(expandRangeToken('ATs+')).toEqual(['ATs', 'AJs', 'AQs', 'AKs']);
    expect(expandRangeToken('AKo')).toEqual(['AKo']);
  });

  it('三个配置里的记号都能展开', () => {
    const groups = ['open', 'limpCall', 'callVsRaise', 'threeBet', 'threeBetBluff', 'fourBet', 'callVsReraise'] as const;
    const spots = ['UTG', 'BTN', 'SB', 'BB', 'HU'] as const;
    for (const profile of Object.values(PROFILES)) {
      for (const group of groups) {
        for (const spot of spots) {
          for (const token of profile.charts[group][spot]) {
            expect(expandRangeToken(token).length).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});
