import { describe, expect, it, beforeEach } from 'vitest';
import { estimateEquityInBatches } from './equity';
import { executeDecision, liveTurnFrom, type LiveTurn, type NpcTableActions } from './executor';
import { buildObservation } from './observation';
import { PROFILES } from './profiles';
import { mulberry32 } from './rng';
import { getNpcDiagnostics, resetNpcRuntimeForTests, runNpcDecision } from './runtime';
import type { AIDecision } from './types';
import type { ObservationSource, SourcePlayer } from './types';

function actor(extra: Partial<SourcePlayer> = {}): SourcePlayer {
  return {
    id: 'ai_0',
    chips: 1000,
    currentBet: 0,
    invested: 10,
    status: 'active',
    canRaise: true,
    cards: ['As', 'Kd'],
    ...extra,
  };
}

function source(partial: Partial<ObservationSource> = {}): ObservationSource {
  return {
    sessionId: 's',
    handNumber: 1,
    decisionRevision: 1,
    stage: 'flop',
    pot: 40,
    board: ['2c', '7d', '9h'],
    dealerIndex: 0,
    currentPlayerIndex: 0,
    currentMaxBet: 20,
    lastRaiseSize: 10,
    bigBlind: 10,
    streetActions: [],
    players: [actor(), { id: 'ai_1', chips: 800, currentBet: 20, invested: 20, status: 'active', canRaise: true }],
    ...partial,
  };
}

function liveOf(partial: Partial<ObservationSource> = {}): LiveTurn {
  return liveTurnFrom(source(partial));
}

function actions(): NpcTableActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fold: () => calls.push('fold'),
    check: () => calls.push('check'),
    call: () => calls.push('call'),
    raise: (raiseTo) => calls.push(`raise:${raiseTo}`),
  };
}

beforeEach(() => {
  resetNpcRuntimeForTests();
});

describe('执行器', () => {
  it('合法跟注、短码全下加注和最小加注可以执行一次', () => {
    const table = actions();
    const live = liveOf();
    const decision: AIDecision = { turnToken: live.turnToken, actorId: 'ai_0', move: { action: 'call' } };
    expect(executeDecision(decision, () => live, table).ok).toBe(true);
    expect(executeDecision(decision, () => ({ ...live, turnToken: 's:1:2:ai_0' }), table).ok).toBe(false);
    expect(table.calls).toEqual(['call']);
  });

  it('面对下注的过牌、非法金额和过小加注都改走兜底，且不调用加注', () => {
    const live = liveOf();
    const illegal: AIDecision['move'][] = [
      { action: 'check' },
      { action: 'raise', raiseTo: Number.NaN },
      { action: 'raise', raiseTo: Number.POSITIVE_INFINITY },
      { action: 'raise', raiseTo: -5 },
      { action: 'raise', raiseTo: 10.5 },
      { action: 'raise', raiseTo: live.minRaiseTo - 1 },
    ];
    for (const move of illegal) {
      const table = actions();
      const result = executeDecision({ turnToken: live.turnToken, actorId: 'ai_0', move }, () => live, table);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.applied).toEqual({ action: 'fold' });
      expect(table.calls).toEqual(['fold']);
    }
  });

  it('没人下注时非法加注改过牌；短码只接受全下目标', () => {
    const free = liveOf({
      currentMaxBet: 0,
      players: [actor({ currentBet: 0 }), { id: 'ai_1', chips: 800, currentBet: 0, invested: 20, status: 'active', canRaise: true }],
    });
    const table = actions();
    executeDecision({
      turnToken: free.turnToken,
      actorId: 'ai_0',
      move: { action: 'raise', raiseTo: 1 },
    }, () => free, table);
    expect(table.calls).toEqual(['check']);

    const short = liveOf({
      currentMaxBet: 40,
      lastRaiseSize: 40,
      players: [actor({ chips: 50 }), { id: 'ai_1', chips: 500, currentBet: 40, invested: 40, status: 'active', canRaise: true }],
    });
    const rejected = actions();
    executeDecision({
      turnToken: short.turnToken,
      actorId: 'ai_0',
      move: { action: 'raise', raiseTo: 60 },
    }, () => short, rejected);
    expect(rejected.calls).toEqual(['fold']);
    const accepted = actions();
    const ok = executeDecision({
      turnToken: short.turnToken,
      actorId: 'ai_0',
      move: { action: 'raise', raiseTo: 50 },
    }, () => short, accepted);
    expect(ok.ok).toBe(true);
    expect(accepted.calls).toEqual(['raise:50']);
  });

  it('旧令牌、离桌和重复执行都不会再行动', () => {
    let current = liveOf();
    const table = actions();
    const decision: AIDecision = { turnToken: current.turnToken, actorId: 'ai_0', move: { action: 'fold' } };
    expect(executeDecision(decision, () => current, table).ok).toBe(true);
    current = { ...current, turnToken: 's:1:2:ai_0' };
    expect(executeDecision(decision, () => current, table)).toMatchObject({ ok: false, reason: 'stale' });
    expect(executeDecision(decision, () => ({ ...current, tableExists: false }), table)).toMatchObject({ reason: 'no-table' });
    expect(table.calls).toEqual(['fold']);
  });
});

describe('运行时', () => {
  it('同一令牌只允许一个 in-flight，完成后可以再来', async () => {
    const live = liveOf();
    let release: (value: { decision: AIDecision; diagnosis: ReturnType<typeof diagnosisOf> }) => void = () => {};
    const gate = new Promise<{ decision: AIDecision; diagnosis: ReturnType<typeof diagnosisOf> }>((resolve) => {
      release = resolve;
    });
    const table = actions();
    const first = runNpcDecision({
      source: source(),
      readLive: () => live,
      actions: table,
      profile: PROFILES.ai_0,
      decideFn: () => gate,
    });
    const second = await runNpcDecision({
      source: source(),
      readLive: () => live,
      actions: table,
      profile: PROFILES.ai_0,
      decideFn: () => ({ decision: { turnToken: live.turnToken, actorId: 'ai_0', move: { action: 'fold' } }, diagnosis: diagnosisOf() }),
    });
    expect(second).toMatchObject({ reason: 'in-flight' });
    release({ decision: { turnToken: live.turnToken, actorId: 'ai_0', move: { action: 'call' } }, diagnosis: diagnosisOf() });
    expect(await first).toMatchObject({ ok: true, applied: { action: 'call' } });
    expect(table.calls).toEqual(['call']);
  });

  it('决策抛错时对当前轮兜底，下一轮还能行动', async () => {
    const live = liveOf();
    const table = actions();
    const failed = await runNpcDecision({
      source: source(),
      readLive: () => live,
      actions: table,
      profile: PROFILES.ai_0,
      decideFn: () => { throw new Error('boom'); },
    });
    expect(failed).toMatchObject({ reason: 'fallback', applied: { action: 'fold' } });
    const next = liveOf({ decisionRevision: 2 });
    const again = await runNpcDecision({
      source: source({ decisionRevision: 2 }),
      readLive: () => next,
      actions: table,
      profile: PROFILES.ai_0,
      decideFn: () => ({ decision: { turnToken: next.turnToken, actorId: 'ai_0', move: { action: 'call' } }, diagnosis: diagnosisOf() }),
    });
    expect(again).toMatchObject({ ok: true });
    expect(table.calls).toEqual(['fold', 'call']);
  });

  it('超时后的迟到加注不会执行，离桌后的错误也不兜底', async () => {
    const live = liveOf();
    const table = actions();
    let finish: (value: { decision: AIDecision; diagnosis: ReturnType<typeof diagnosisOf> }) => void = () => {};
    const hung = runNpcDecision({
      source: source(),
      readLive: () => live,
      actions: table,
      profile: PROFILES.ai_0,
      options: { overallTimeoutMs: 20 },
      decideFn: () => new Promise((resolve) => { finish = resolve; }),
    });
    const timed = await hung;
    expect(timed).toMatchObject({ reason: 'fallback', applied: { action: 'fold' } });
    finish({
      decision: { turnToken: live.turnToken, actorId: 'ai_0', move: { action: 'raise', raiseTo: 80 } },
      diagnosis: diagnosisOf(),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(table.calls).toEqual(['fold']);

    let moved = liveOf();
    const gone = actions();
    const left = await runNpcDecision({
      source: source(),
      readLive: () => moved,
      actions: gone,
      profile: PROFILES.ai_0,
      decideFn: () => {
        moved = liveOf({ decisionRevision: 8 });
        throw new Error('late');
      },
    });
    expect(left).toMatchObject({ reason: 'stale' });
    expect(gone.calls).toEqual([]);
  });

  it('轮次已经变化时，错误结果不会作用到新玩家', async () => {
    const live = liveOf();
    const moved = liveOf({ decisionRevision: 9 });
    const table = actions();
    const result = await runNpcDecision({
      source: source(),
      readLive: () => moved,
      actions: table,
      profile: PROFILES.ai_0,
      decideFn: () => { throw new Error('stale'); },
    });
    expect(result).toMatchObject({ reason: 'stale' });
    expect(table.calls).toEqual([]);
    void live;
  });

  it('八名对手的翻牌和转牌分批抽样，并完成一次决策', async () => {
    const opponents = Array.from({ length: 8 }, (_, index) => ({
      id: `v${index}`,
      chips: 1000,
      currentBet: 0,
      invested: 100,
      status: 'active' as const,
      canRaise: true,
    }));
    const measure = async (stage: 'flop' | 'turn', board: string[]) => {
      const raw = source({ stage, board, pot: 900, currentMaxBet: 0, players: [actor(), ...opponents] });
      const built = buildObservation(raw);
      expect(built.ok).toBe(true);
      if (!built.ok) return null;
      let yields = 0;
      const equity = await estimateEquityInBatches(
        built.observation,
        { samples: 200, timeBudgetMs: 40, batchSize: 8, sampleRng: mulberry32(stage === 'flop' ? 7 : 8) },
        async () => { yields += 1; },
        () => false,
      );
      expect(equity.ok).toBe(true);
      if (!equity.ok) return null;
      expect(equity.samples).toBeGreaterThan(0);
      expect(equity.samples).toBeLessThanOrEqual(200);
      expect(yields).toBeGreaterThan(0);
      return { samples: equity.samples, elapsedMs: Math.round(equity.elapsedMs * 10) / 10, yields };
    };
    const flop = await measure('flop', ['2c', '7d', '9h']);
    const turn = await measure('turn', ['2c', '7d', '9h', '4s']);
    const raw = source({
      stage: 'flop',
      board: ['2c', '7d', '9h'],
      pot: 900,
      currentMaxBet: 0,
      players: [actor(), ...opponents],
    });
    const decided = await runNpcDecision({
      source: raw,
      readLive: () => liveTurnFrom(raw),
      actions: actions(),
      profile: PROFILES.ai_0,
      options: { samples: 200, timeBudgetMs: 40, batchSize: 40, overallTimeoutMs: 1000, sampleRng: mulberry32(11) },
    });
    expect(decided.ok).toBe(true);
    const diagnosis = getNpcDiagnostics().at(-1);
    expect(diagnosis?.samples).toBeGreaterThan(0);
    expect(diagnosis?.reasonCode.startsWith('fallback')).toBe(false);
    expect({ flop, turn, decisionSamples: diagnosis?.samples, reason: diagnosis?.reasonCode }).toMatchObject({
      flop: { samples: expect.any(Number) },
      turn: { samples: expect.any(Number) },
    });
  });
});

function diagnosisOf() {
  return {
    profileId: 'ai_0',
    street: 'flop' as const,
    reasonCode: 'test',
    samples: 0,
    equity: null,
    evReference: null,
    elapsedMs: 0,
    assumptions: [],
    handKey: null,
    position: null,
  };
}
