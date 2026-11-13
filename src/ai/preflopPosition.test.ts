import { describe, expect, it } from 'vitest';
import { buildObservation } from './observation';
import { PROFILES } from './profiles';
import { branchWeights, chartBranches, preflopBranches } from './preflop';
import { isPositionCore, planForRole, positionPlan } from './preflopPosition';
import type { ObservationSource, SourcePlayer } from './types';

function player(id: string, cards?: string[], extra: Partial<SourcePlayer> = {}): SourcePlayer {
  return {
    id,
    chips: extra.chips ?? 1000,
    currentBet: extra.currentBet ?? 0,
    invested: extra.invested ?? extra.currentBet ?? 0,
    status: extra.status ?? 'active',
    canRaise: extra.canRaise ?? true,
    ...(cards ? { cards } : {}),
    ...extra,
  };
}

function ring(count: number, hero: number, cards: string[], heroExtra: Partial<SourcePlayer> = {}): SourcePlayer[] {
  return Array.from({ length: count }, (_, seat) => player(
    seat === 0 ? 'human' : `ai_${seat - 1}`,
    seat === hero ? cards : undefined,
    seat === hero ? heroExtra : {},
  ));
}

function observe(partial: Partial<ObservationSource>) {
  const built = buildObservation({
    sessionId: 's',
    handNumber: 1,
    decisionRevision: 1,
    stage: 'preflop',
    pot: 15,
    board: [],
    dealerIndex: 0,
    currentPlayerIndex: 3,
    currentMaxBet: 10,
    lastRaiseSize: 10,
    bigBlind: 10,
    streetActions: [],
    players: [],
    ...partial,
  });
  if (!built.ok) throw new Error(built.error);
  return built.observation;
}

describe('位置近似', () => {
  it('四人满桌沿用原图表，六人和九人按规格分档', () => {
    expect(isPositionCore('QQ')).toBe(true);
    expect(isPositionCore('AKs')).toBe(true);
    expect(isPositionCore('AKo')).toBe(true);
    expect(isPositionCore('JJ')).toBe(false);
    expect(isPositionCore('TT')).toBe(false);
    expect(isPositionCore('AQs')).toBe(false);
    expect(planForRole('UTG', 4)).toMatchObject({ bucket: 'legacy', keep: 1, sources: [{ spot: 'UTG', weight: 1 }] });
    expect(planForRole('UTG', 6)).toMatchObject({ bucket: 'early', keep: 0.85 });
    expect(planForRole('LJ', 9)).toMatchObject({ bucket: 'early', keep: 0.85 });
    expect(planForRole('UTG', 9)).toMatchObject({ bucket: 'early-tight', keep: 0.65 });
    expect(planForRole('UTG+2', 9)).toMatchObject({ bucket: 'early-tight', keep: 0.65 });
    expect(planForRole('HJ', 6).sources).toEqual([{ spot: 'UTG', weight: 0.75 }, { spot: 'BTN', weight: 0.25 }]);
    expect(planForRole('CO', 9).sources).toEqual([{ spot: 'UTG', weight: 0.4 }, { spot: 'BTN', weight: 0.6 }]);
    expect(planForRole('BTN', 9)).toMatchObject({ bucket: 'BTN', keep: 1, sources: [{ spot: 'BTN', weight: 1 }] });
    expect(planForRole('BB', 2)).toMatchObject({ bucket: 'HU', sources: [{ spot: 'HU', weight: 1 }] });
  });

  it('四人正常满桌分支与显式原图表一致，九人弃到两人也不改分档', () => {
    const profile = PROFILES.ai_0;
    for (const [seat, spot] of [[0, 'BTN'], [1, 'SB'], [2, 'BB'], [3, 'UTG']] as const) {
      const obs = observe({
        currentPlayerIndex: seat,
        players: ring(4, seat, ['7h', '6h']),
      });
      expect(positionPlan(seat, 0, obs.players.map((item) => item.status)).bucket).toBe(spot === 'UTG' ? 'legacy' : spot);
      expect(preflopBranches(obs, profile)).toEqual(chartBranches(obs, profile, spot, null));
    }
    const folded = ring(9, 3, ['7h', '6h']);
    for (let seat = 4; seat < 9; seat += 1) folded[seat] = { ...folded[seat], status: 'folded' };
    const still = observe({ currentPlayerIndex: 3, players: folded });
    expect(positionPlan(3, 0, still.players.map((item) => item.status))).toMatchObject({ role: 'UTG', bucket: 'early-tight' });
    const startedShort = ring(9, 0, ['7h', '6h']);
    for (let seat = 2; seat < 9; seat += 1) startedShort[seat] = { ...startedShort[seat], status: 'sitting-out' };
    const hu = observe({ currentPlayerIndex: 0, players: startedShort });
    expect(positionPlan(0, 0, hu.players.map((item) => item.status)).bucket).toBe('HU');
  });

  it('前位收紧边缘牌，核心牌和原弃牌不变，中后位落在两个来源之间', () => {
    const profile = PROFILES.ai_0;
    const marginal = (count: number, seat: number) => observe({
      currentPlayerIndex: seat,
      players: ring(count, seat, ['9h', '9c']),
    });
    const four = branchWeights(preflopBranches(marginal(4, 3), profile));
    const six = branchWeights(preflopBranches(marginal(6, 3), profile));
    const nine = branchWeights(preflopBranches(marginal(9, 3), profile));
    expect(four.raise).toBe(1);
    expect(six.raise).toBeCloseTo(0.85);
    expect(nine.raise).toBeCloseTo(0.65);
    expect(six.fold).toBeCloseTo(0.15);
    expect(nine.fold).toBeCloseTo(0.35);

    const premium = observe({ currentPlayerIndex: 3, players: ring(9, 3, ['As', 'Ah']) });
    expect(branchWeights(preflopBranches(premium, profile)).raise).toBe(1);
    const trash = observe({ currentPlayerIndex: 3, players: ring(9, 3, ['7c', '2d']) });
    expect(branchWeights(preflopBranches(trash, profile)).fold).toBe(1);

    const btn = branchWeights(preflopBranches(observe({ currentPlayerIndex: 0, players: ring(9, 0, ['7h', '6h']) }), profile));
    const hj = branchWeights(preflopBranches(observe({ currentPlayerIndex: 7, players: ring(9, 7, ['7h', '6h']) }), profile));
    const co = branchWeights(preflopBranches(observe({ currentPlayerIndex: 8, players: ring(9, 8, ['7h', '6h']) }), profile));
    const utgSource = branchWeights(chartBranches(observe({ currentPlayerIndex: 0, players: ring(9, 0, ['7h', '6h']) }), profile, 'UTG', null));
    expect(utgSource.raise).toBe(0);
    expect(btn.raise).toBe(1);
    expect(hj.raise).toBeCloseTo(0.25);
    expect(co.raise).toBeCloseTo(0.6);
    expect(hj.raise).toBeGreaterThan(utgSource.raise);
    expect(co.raise).toBeGreaterThan(hj.raise);
    expect(co.raise).toBeLessThan(btn.raise);
    for (const weights of [four, six, nine, btn, hj, co]) {
      expect(weights.fold + weights.check + weights.call + weights.raise).toBeCloseTo(1);
      expect(Math.min(weights.fold, weights.check, weights.call, weights.raise)).toBeGreaterThanOrEqual(0);
    }
  });

  it('面对后位开池使用组合列，面对前位不借用按钮列', () => {
    const profile = PROFILES.ai_0;
    const defend = (opener: number, openTo = 25) => {
      const players = ring(9, 2, ['9h', '9c'], { currentBet: 10, invested: 10, chips: 990 });
      players[opener] = { ...players[opener], currentBet: openTo, invested: openTo, chips: 1000 - openTo };
      return observe({
        currentPlayerIndex: 2,
        currentMaxBet: openTo,
        lastRaiseSize: openTo - 10,
        pot: 15 + openTo,
        players,
        streetActions: [{ actorId: players[opener].id, stage: 'preflop', kind: 'raise', to: openTo }],
      });
    };
    const versusEarly = preflopBranches(defend(3), profile);
    const versusCutoff = preflopBranches(defend(8), profile);
    const pureEarly = chartBranches(defend(3), profile, 'BB', 'UTG');
    const fromUtg = branchWeights(chartBranches(defend(8), profile, 'BB', 'UTG'));
    const fromButton = branchWeights(chartBranches(defend(8), profile, 'BB', 'BTN'));
    const mixed = branchWeights(versusCutoff);
    expect(versusEarly).toEqual(pureEarly);
    expect(mixed.raise).toBeCloseTo(fromUtg.raise * 0.4 + fromButton.raise * 0.6);
    expect(mixed.call).toBeCloseTo(fromUtg.call * 0.4 + fromButton.call * 0.6);
    expect(mixed.fold + mixed.call + mixed.raise + mixed.check).toBeCloseTo(1);
  });
});
