import { describe, expect, it } from 'vitest';
import { UNIFORM_RANGE_ASSUMPTION, type EquityOk } from './equity';
import { buildObservation } from './observation';
import { PROFILES } from './profiles';
import { isLegalMove } from './prices';
import { decide, inPosition } from './strategy';
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

describe('全下许可', () => {
  function open(cards: string[], chips: number) {
    return must({
      currentPlayerIndex: 0,
      currentMaxBet: 10,
      players: four(0, cards, { chips }),
    });
  }

  it('开池目标等于或超过剩余筹码时，投机牌不能全下，AA 可以', () => {
    expect(decide(open(['7h', '6h'], 25), PROFILES.ai_0).decision.move.action).toBe('fold');
    expect(decide(open(['7h', '6h'], 20), PROFILES.ai_0).decision.move.action).toBe('fold');
    expect(decide(open(['As', 'Ad'], 25), PROFILES.ai_0).decision.move).toEqual({ action: 'raise', raiseTo: 25 });
    expect(decide(open(['As', 'Ad'], 20), PROFILES.ai_0).decision.move).toEqual({ action: 'raise', raiseTo: 20 });
  });

  it('激进大盲的 A4s 诈唬不会把剩余筹码全下', () => {
    const obs = must({
      currentPlayerIndex: 2,
      currentMaxBet: 30,
      lastRaiseSize: 20,
      pot: 40,
      players: four(2, ['As', '4s'], { chips: 70, currentBet: 10, invested: 10 }),
      streetActions: [{ actorId: 'human', stage: 'preflop', kind: 'raise', to: 30 }],
    });
    const move = decide(obs, PROFILES.ai_1, { rng: () => 0 }).decision.move;
    expect(isLegalMove(obs, move)).toBe(true);
    expect(move).toEqual({ action: 'fold' });
  });
});

describe('翻前价格档', () => {
  function facing(seatIndex: number, cards: string[], maxBet: number, heroExtra: Partial<SourcePlayer> = {}, players = four(seatIndex, cards, heroExtra)) {
    return must({
      currentPlayerIndex: seatIndex,
      currentMaxBet: maxBet,
      lastRaiseSize: 10,
      pot: 15 + maxBet,
      players,
      streetActions: [{ actorId: 'ai_2', stage: 'preflop', kind: 'raise', to: maxBet }],
    });
  }

  it('稳健按钮的 JTs 跟常规开池，面对 100BB 全下则退出', () => {
    const small = decide(facing(0, ['Js', 'Ts'], 20, { chips: 1000 }), PROFILES.ai_0).decision.move;
    const jammed = decide(facing(0, ['Js', 'Ts'], 1000, { chips: 1000 }), PROFILES.ai_0).decision.move;
    expect(small).toEqual({ action: 'call' });
    expect(jammed).toEqual({ action: 'fold' });
  });

  it('再加注跟注、价值再加注失败后的回退，以及大额诈唬都不能绕过收紧范围', () => {
    const reraised = (maxBet: number) => must({
      currentPlayerIndex: 0,
      currentMaxBet: maxBet,
      lastRaiseSize: 20,
      players: four(0, ['Th', 'Td'], { chips: 1000 }),
      streetActions: [
        { actorId: 'human', stage: 'preflop', kind: 'raise', to: 20 },
        { actorId: 'ai_1', stage: 'preflop', kind: 'raise', to: maxBet },
      ],
    });
    expect(decide(reraised(40), PROFILES.ai_0).decision.move.action).toBe('call');
    expect(decide(reraised(1000), PROFILES.ai_0).decision.move).toEqual({ action: 'fold' });

    const ninetyNine = facing(0, ['9h', '9c'], 1000, { chips: 1000 });
    expect(decide(ninetyNine, PROFILES.ai_0).decision.move).toEqual({ action: 'fold' });

    const fourBet = (maxBet: number) => must({
      currentPlayerIndex: 0,
      currentMaxBet: maxBet,
      lastRaiseSize: 20,
      players: four(0, ['Th', 'Td'], { chips: 1000 }),
      streetActions: [
        { actorId: 'human', stage: 'preflop', kind: 'raise', to: 20 },
        { actorId: 'ai_2', stage: 'preflop', kind: 'raise', to: maxBet },
      ],
    });
    expect(decide(fourBet(40), PROFILES.ai_1).decision.move.action).toBe('raise');
    expect(decide(fourBet(1000), PROFILES.ai_1).decision.move).toEqual({ action: 'fold' });

    const bluff = facing(0, ['Ah', '5h'], 60, { chips: 1000 });
    expect(decide(bluff, PROFILES.ai_1, { rng: () => 0.1 }).decision.move).toEqual({ action: 'fold' });
    expect(decide(facing(0, ['7c', '2d'], 20), PROFILES.ai_1).decision.move.action).toBe('fold');
  });

  it('5BB、20BB、15% 和 50% 筹码风险按档位切换', () => {
    const call = (cards: string[], maxBet: number, chips: number) => (
      decide(facing(0, cards, maxBet, { chips }), PROFILES.ai_0).decision.move.action
    );
    expect(call(['Js', 'Ts'], 50, 1000)).toBe('call');
    expect(call(['Js', 'Ts'], 60, 1000)).toBe('fold');
    expect(call(['Th', 'Td'], 190, 1000)).toBe('raise');
    expect(call(['Th', 'Td'], 200, 1000)).toBe('fold');
    expect(call(['Js', 'Ts'], 30, 201)).toBe('call');
    expect(call(['Js', 'Ts'], 30, 200)).toBe('fold');
    expect(call(['Th', 'Td'], 30, 61)).toBe('raise');
    expect(call(['Th', 'Td'], 30, 60)).toBe('fold');
  });

  it('便宜的短码主池可以跟，无资格边池不会把价格算得更松', () => {
    const cheap = four(0, ['Js', 'Ts'], { chips: 20, currentBet: 20, invested: 20 });
    for (const index of [1, 2, 3]) {
      cheap[index] = { ...cheap[index], currentBet: 30, invested: 30, chips: 1000 };
    }
    expect(decide(facing(0, ['Js', 'Ts'], 30, {}, cheap), PROFILES.ai_0).decision.move).toEqual({ action: 'call' });

    const tight = four(0, ['Js', 'Ts'], { chips: 20, currentBet: 20, invested: 20 });
    tight[1] = { ...tight[1], currentBet: 30, invested: 30, chips: 1000 };
    tight[2] = { ...tight[2], currentBet: 30, invested: 30, chips: 1000 };
    const deep = tight.map((player, index) => (
      index === 1 || index === 2 ? { ...player, invested: 5000 } : player
    ));
    expect(decide(facing(0, ['Js', 'Ts'], 30, {}, tight), PROFILES.ai_0).decision.move).toEqual({ action: 'fold' });
    expect(decide(facing(0, ['Js', 'Ts'], 30, {}, deep), PROFILES.ai_0).decision.move).toEqual({ action: 'fold' });

    const exactly = four(0, ['Js', 'Ts'], { chips: 40, currentBet: 80, invested: 80 });
    exactly[1] = { ...exactly[1], currentBet: 100, invested: 100, chips: 1000 };
    expect(decide(facing(0, ['Js', 'Ts'], 100, {}, exactly), PROFILES.ai_0).decision.move).toEqual({ action: 'call' });

    const overRatio = four(0, ['Js', 'Ts'], { chips: 40, currentBet: 70, invested: 70 });
    overRatio[1] = { ...overRatio[1], currentBet: 90, invested: 90, chips: 1000 };
    expect(decide(facing(0, ['Js', 'Ts'], 90, {}, overRatio), PROFILES.ai_0).decision.move).toEqual({ action: 'fold' });

    const overBlind = four(0, ['Js', 'Ts'], { chips: 40, currentBet: 100, invested: 100 });
    overBlind[1] = { ...overBlind[1], currentBet: 121, invested: 121, chips: 1000 };
    expect(decide(facing(0, ['Js', 'Ts'], 121, {}, overBlind), PROFILES.ai_0).decision.move).toEqual({ action: 'fold' });
  });
});

describe('翻后行动位置', () => {
  function spot(statuses: Array<'active' | 'folded' | 'all-in' | 'sitting-out'>, heroSeat: number, dealerIndex: number) {
    return must({
      stage: 'river',
      board: dry,
      pot: 80,
      currentMaxBet: 0,
      lastRaiseSize: 10,
      dealerIndex,
      currentPlayerIndex: heroSeat,
      players: statuses.map((status, index) => seat(
        index === 0 ? 'human' : `ai_${index - 1}`,
        index === heroSeat ? ['7c', '2d'] : undefined,
        { status, chips: status === 'all-in' ? 0 : 2000, invested: 40 },
      )),
    });
  }

  function bluff(statuses: Array<'active' | 'folded' | 'all-in' | 'sitting-out'>, heroSeat: number, dealerIndex = 0) {
    return decide(spot(statuses, heroSeat, dealerIndex), PROFILES.ai_1, {
      equityOverride: fakeEquity({ equity: 0.2, evReference: 10, heroEligible: 80 }),
      rng: () => 0.15,
    }).decision.move.action;
  }

  it('按钮还在时按钮最后行动；按钮退出后，真正最后的 active 玩家才有位置', () => {
    const active = ['active', 'active', 'folded', 'folded'] as const;
    expect(inPosition(spot([...active], 0, 0))).toBe(true);
    expect(inPosition(spot([...active], 1, 0))).toBe(false);
    expect(bluff([...active], 0)).toBe('raise');
    expect(bluff([...active], 1)).toBe('check');

    const buttonOut = ['folded', 'active', 'folded', 'active'] as const;
    expect(inPosition(spot([...buttonOut], 1, 0))).toBe(false);
    expect(inPosition(spot([...buttonOut], 3, 0))).toBe(true);
    expect(bluff([...buttonOut], 1)).toBe('check');
    expect(bluff([...buttonOut], 3)).toBe('raise');

    for (const status of ['all-in', 'sitting-out'] as const) {
      const gone = [status, 'active', 'folded', 'active'] as const;
      expect(inPosition(spot([...gone], 1, 0))).toBe(false);
      expect(inPosition(spot([...gone], 3, 0))).toBe(true);
    }

    const wrapped = ['active', 'folded', 'active', 'folded'] as const;
    expect(inPosition(spot([...wrapped], 0, 3))).toBe(false);
    expect(inPosition(spot([...wrapped], 2, 3))).toBe(true);
    expect(inPosition(spot(['active', 'folded', 'folded', 'folded'], 0, 1))).toBe(true);
    expect(inPosition({
      players: [],
      dealerIndex: 0,
      actorSeat: 0,
    } as unknown as ReturnType<typeof spot>)).toBe(false);
  });
});
