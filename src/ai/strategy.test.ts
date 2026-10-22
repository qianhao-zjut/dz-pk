import { describe, expect, it } from 'vitest';
import { UNIFORM_RANGE_ASSUMPTION, type EquityOk } from './equity';
import { buildObservation } from './observation';
import { PROFILES } from './profiles';
import { decide } from './strategy';
import type { AIProfile } from './profiles';
import type { ObservationSource, SourcePlayer } from './types';

function seat(id: string, cards?: string[], extra: Partial<SourcePlayer> = {}): SourcePlayer {
  return {
    id,
    chips: extra.chips ?? 1000,
    currentBet: extra.currentBet ?? 0,
    invested: extra.invested ?? 0,
    status: extra.status ?? 'active',
    canRaise: extra.canRaise ?? true,
    ...(cards ? { cards } : {}),
    ...extra,
  };
}

function observe(partial: Partial<ObservationSource>): ReturnType<typeof buildObservation> {
  return buildObservation({
    sessionId: 's',
    handNumber: 1,
    decisionRevision: 1,
    stage: 'preflop',
    pot: 30,
    board: [],
    dealerIndex: 0,
    currentPlayerIndex: 0,
    currentMaxBet: 10,
    lastRaiseSize: 10,
    bigBlind: 10,
    streetActions: [],
    players: [],
    ...partial,
  });
}

function must(partial: Partial<ObservationSource>) {
  const built = observe(partial);
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error(built.error);
  return built.observation;
}

function four(heroSeat: number, cards: string[], heroExtra: Partial<SourcePlayer> = {}) {
  return [0, 1, 2, 3].map((seatIndex) => seat(
    seatIndex === 0 ? 'human' : `ai_${seatIndex - 1}`,
    seatIndex === heroSeat ? cards : undefined,
    seatIndex === heroSeat ? heroExtra : {},
  ));
}

function fakeEquity(partial: Partial<EquityOk>): EquityOk {
  return {
    ok: true,
    equity: 0.5,
    expectedRecovery: 50,
    evReference: 20,
    samples: 100,
    elapsedMs: 1,
    contestable: 100,
    heroEligible: 100,
    heroRefund: 0,
    assumption: UNIFORM_RANGE_ASSUMPTION,
    ...partial,
  };
}

const dry = ['Kd', '8c', '3h', 'Qc', '6s'];

describe('翻前范围、位置和风格', () => {
  it('四人桌按钮位的 76s 会开池，同一手牌在 UTG 会弃牌', () => {
    const button = must({
      currentPlayerIndex: 0,
      players: four(0, ['7h', '6h']),
    });
    const utg = must({
      currentPlayerIndex: 3,
      players: four(3, ['7h', '6h']),
    });
    expect(decide(button, PROFILES.ai_0, { rng: () => 0.5 }).decision.move.action).toBe('raise');
    expect(decide(utg, PROFILES.ai_0, { rng: () => 0.5 }).decision.move.action).toBe('fold');
  });

  it('三人时原来的枪口位按按钮范围，两人时按短桌范围', () => {
    const players = four(3, ['7h', '6h']);
    players[1] = { ...players[1], status: 'sitting-out', chips: 0 };
    const three = must({ currentPlayerIndex: 3, players });
    expect(decide(three, PROFILES.ai_0).decision.move.action).toBe('raise');

    const heads = four(3, ['7h', '7d']);
    heads[1] = { ...heads[1], status: 'sitting-out' };
    heads[2] = { ...heads[2], status: 'sitting-out' };
    const hu = must({ currentPlayerIndex: 3, players: heads });
    const full = must({ currentPlayerIndex: 3, players: four(3, ['7h', '7d']) });
    expect(decide(hu, PROFILES.ai_2).decision.move.action).toBe('raise');
    expect(decide(full, PROFILES.ai_2).decision.move.action).toBe('fold');
  });

  it('同一起手牌上三个风格方向不同', () => {
    const utg = (cards: string[]) => must({
      currentPlayerIndex: 3,
      players: four(3, cards),
    });
    const moves = (cards: string[]) => (Object.values(PROFILES) as AIProfile[]).map((profile) => (
      decide(utg(cards), profile, { rng: () => 0.2 }).decision.move.action
    ));
    expect(moves(['As', 'Td'])).toEqual(['fold', 'raise', 'fold']);
    expect(moves(['9h', '9c'])).toEqual(['raise', 'raise', 'fold']);
    expect(moves(['As', 'Ad'])).toEqual(['raise', 'raise', 'raise']);
    expect(moves(['7c', '2d'])).toEqual(['fold', 'fold', 'fold']);
  });

  it('可以免费过牌时不弃牌，开池尺寸随风格变化', () => {
    const option = must({
      currentPlayerIndex: 2,
      currentMaxBet: 10,
      players: four(2, ['7c', '2d'], { currentBet: 10, invested: 10 }),
    });
    for (const profile of Object.values(PROFILES)) {
      expect(decide(option, profile).decision.move).toEqual({ action: 'check' });
    }
    const opener = must({ currentPlayerIndex: 3, players: four(3, ['As', 'Ad']) });
    const solid = decide(opener, PROFILES.ai_0).decision.move;
    const aggro = decide(opener, PROFILES.ai_1).decision.move;
    expect(solid).toEqual({ action: 'raise', raiseTo: 25 });
    expect(aggro).toEqual({ action: 'raise', raiseTo: 35 });
  });

  it('面对加注时 99 分别跟注、再加注和弃牌', () => {
    const facing = must({
      currentPlayerIndex: 3,
      currentMaxBet: 30,
      lastRaiseSize: 20,
      pot: 45,
      players: four(3, ['9h', '9c']),
      streetActions: [{ actorId: 'human', stage: 'preflop', kind: 'raise', to: 30 }],
    });
    expect(decide(facing, PROFILES.ai_0).decision.move.action).toBe('call');
    expect(decide(facing, PROFILES.ai_1).decision.move.action).toBe('raise');
    expect(decide(facing, PROFILES.ai_2).decision.move.action).toBe('fold');
  });

  it('激进风格的翻前诈唬随控制随机数混合，另外两个风格不诈唬', () => {
    const facing = must({
      currentPlayerIndex: 0,
      currentMaxBet: 30,
      lastRaiseSize: 20,
      players: four(0, ['Ah', '5h']),
      streetActions: [{ actorId: 'ai_2', stage: 'preflop', kind: 'raise', to: 30 }],
    });
    expect(decide(facing, PROFILES.ai_1, { rng: () => 0.1 }).decision.move.action).toBe('raise');
    expect(decide(facing, PROFILES.ai_1, { rng: () => 0.9 }).decision.move.action).toBe('fold');
    expect(decide(facing, PROFILES.ai_0, { rng: () => 0.1 }).decision.move.action).toBe('fold');
    expect(decide(facing, PROFILES.ai_2, { rng: () => 0.1 }).decision.move.action).toBe('fold');
  });

  it('短码不够完整加注时，强牌可以全下，投机牌弃牌', () => {
    const spot = (cards: string[]) => must({
      currentPlayerIndex: 0,
      currentMaxBet: 10,
      players: four(0, cards, { chips: 15 }),
    });
    expect(decide(spot(['As', 'Ad']), PROFILES.ai_0).decision.move).toEqual({ action: 'raise', raiseTo: 15 });
    expect(decide(spot(['7h', '6h']), PROFILES.ai_0).decision.move.action).toBe('fold');
  });
});

describe('翻后价格、价值下注和全下约束', () => {
  function checkedTo(cards: string[], heroExtra: Partial<SourcePlayer> = {}) {
    return must({
      stage: 'river',
      board: dry,
      pot: 80,
      currentMaxBet: 0,
      lastRaiseSize: 10,
      currentPlayerIndex: 0,
      players: [
        seat('ai_0', cards, { chips: 2000, invested: 40, ...heroExtra }),
        seat('ai_1', undefined, { chips: 2000, invested: 40, currentBet: 0 }),
      ],
    });
  }

  it('深码强牌价值下注，但不会因为权益高就全下', () => {
    const obs = checkedTo(['As', 'Ad']);
    const move = decide(obs, PROFILES.ai_0, {
      equityOverride: fakeEquity({ equity: 0.95, evReference: 80, heroEligible: 80, expectedRecovery: 80 }),
      rng: () => 0.99,
    }).decision.move;
    expect(move.action).toBe('raise');
    if (move.action === 'raise') {
      expect(move.raiseTo).toBeGreaterThanOrEqual(10);
      expect(move.raiseTo).toBeLessThan(obs.maxRaiseTo);
    }
  });

  it('短码高权益可以全下，低权益不会因为可全下就全下', () => {
    const obs = checkedTo(['As', 'Ad'], { chips: 30 });
    const jammed = decide(obs, PROFILES.ai_0, {
      equityOverride: fakeEquity({ equity: 0.9, evReference: 90, heroEligible: 120, contestable: 120 }),
    }).decision.move;
    expect(jammed).toEqual({ action: 'raise', raiseTo: 30 });
    const checked = decide(obs, PROFILES.ai_0, {
      equityOverride: fakeEquity({ equity: 0.3, evReference: 10, heroEligible: 120 }),
      rng: () => 0.99,
    }).decision.move;
    expect(checked.action).not.toBe('raise');
  });

  it('弱牌面对高价格弃牌，强牌继续；负期望的高权益也不全下', () => {
    const priced = must({
      stage: 'river',
      board: dry,
      pot: 500,
      currentMaxBet: 400,
      lastRaiseSize: 200,
      currentPlayerIndex: 0,
      players: [
        seat('ai_0', ['7c', '2d'], { chips: 1000, invested: 100 }),
        seat('ai_1', undefined, { chips: 0, currentBet: 400, invested: 500, status: 'all-in' }),
      ],
    });
    const weak = decide(priced, PROFILES.ai_1, {
      equityOverride: fakeEquity({ equity: 0.08, evReference: -300, samples: 80 }),
    }).decision.move.action;
    const strong = decide(priced, PROFILES.ai_2, {
      equityOverride: fakeEquity({ equity: 0.95, evReference: 400, samples: 80 }),
    }).decision.move.action;
    expect(weak).toBe('fold');
    expect(strong).not.toBe('fold');
    const trapped = decide(priced, PROFILES.ai_1, {
      equityOverride: fakeEquity({ equity: 0.96, evReference: -40, samples: 100 }),
    }).decision.move.action;
    expect(trapped).toBe('fold');
  });

  it('同样的中等权益，激进会下注，稳健和保守过牌', () => {
    const obs = checkedTo(['Jh', 'Td']);
    const equity = fakeEquity({ equity: 0.58, evReference: 30, heroEligible: 80 });
    expect(decide(obs, PROFILES.ai_1, { equityOverride: equity, rng: () => 0.99 }).decision.move.action).toBe('raise');
    expect(decide(obs, PROFILES.ai_0, { equityOverride: equity, rng: () => 0.99 }).decision.move.action).toBe('check');
    expect(decide(obs, PROFILES.ai_2, { equityOverride: equity, rng: () => 0.99 }).decision.move.action).toBe('check');
  });

  it('跟注边缘上激进会继续，稳健和保守放弃', () => {
    const obs = must({
      stage: 'river',
      board: dry,
      pot: 100,
      currentMaxBet: 30,
      lastRaiseSize: 20,
      currentPlayerIndex: 0,
      players: [
        seat('ai_0', ['Jh', 'Td'], { chips: 1000, invested: 50 }),
        seat('ai_1', undefined, { chips: 1000, currentBet: 30, invested: 80 }),
      ],
    });
    const equity = fakeEquity({ equity: 0.22, evReference: -1.4, samples: 100 });
    expect(decide(obs, PROFILES.ai_1, { equityOverride: equity }).decision.move.action).toBe('call');
    expect(decide(obs, PROFILES.ai_0, { equityOverride: equity }).decision.move.action).toBe('fold');
    expect(decide(obs, PROFILES.ai_2, { equityOverride: equity }).decision.move.action).toBe('fold');
  });

  it('诈唬频率按控制随机数区分，且不是每个随机数都同一动作', () => {
    const obs = checkedTo(['7c', '2d']);
    const equity = fakeEquity({ equity: 0.2, evReference: 10, heroEligible: 80 });
    const draws = [0.01, 0.05, 0.1, 0.15, 0.25, 0.5];
    const count = (profile: AIProfile) => draws.filter((roll) => (
      decide(obs, profile, { equityOverride: equity, rng: () => roll }).decision.move.action === 'raise'
    )).length;
    const aggro = count(PROFILES.ai_1);
    const solid = count(PROFILES.ai_0);
    const tight = count(PROFILES.ai_2);
    expect(aggro).toBeGreaterThan(tight);
    expect(aggro).toBeGreaterThan(solid);
    expect(aggro).toBeLessThan(draws.length);
    expect(tight).toBeGreaterThan(0);
  });

  it('诊断留在返回值里，假设写明均匀范围和摊牌参考', () => {
    const obs = checkedTo(['As', 'Ad']);
    const decided = decide(obs, PROFILES.ai_0, {
      equityOverride: fakeEquity({ equity: 0.9, heroEligible: 80 }),
    });
    expect(decided.diagnosis.reasonCode).toBe('postflop-value-bet');
    expect(decided.diagnosis.assumptions.some((item) => item.includes('均匀随机'))).toBe(true);
    expect(decided.diagnosis.assumptions.some((item) => item.includes('直接摊牌'))).toBe(true);
    expect(JSON.stringify(decided.decision)).not.toContain('equity');
  });
});
