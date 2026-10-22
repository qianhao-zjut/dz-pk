import { estimateEquity, estimateEquityInBatches } from './equity';
import { buildObservation } from './observation';
import { PROFILES } from './profiles';
import { mulberry32 } from './rng';
import { decide } from './strategy';
import type { ObservationSource, SourcePlayer } from './types';

export interface BenchRow {
  label: string;
  opponents: number;
  requestedSamples: number;
  samples: number;
  elapsedMs: number;
  equity: number | null;
  error?: string;
}

function player(id: string, cards?: string[]): SourcePlayer {
  return {
    id,
    chips: 1000,
    currentBet: 0,
    invested: 100,
    status: 'active',
    canRaise: true,
    ...(cards ? { cards } : {}),
  };
}

function source(opponents: number): ObservationSource {
  const players = [player('ai_0', ['As', 'Kd']), ...Array.from({ length: opponents }, (_, i) => player(`v${i}`))];
  return {
    sessionId: 'bench',
    handNumber: 1,
    decisionRevision: 1,
    stage: 'flop',
    pot: 100 * players.length,
    board: ['2c', '7d', '9h'],
    dealerIndex: 0,
    currentPlayerIndex: 0,
    currentMaxBet: 0,
    lastRaiseSize: 10,
    bigBlind: 10,
    players,
    streetActions: [],
  };
}

export function runEquityBench(opponents: number, sampleCounts: readonly number[], seed = 7): BenchRow[] {
  const built = buildObservation(source(opponents));
  if (!built.ok) {
    return sampleCounts.map((requestedSamples) => ({
      label: `${opponents} opponents`,
      opponents,
      requestedSamples,
      samples: 0,
      elapsedMs: 0,
      equity: null,
      error: built.error,
    }));
  }
  return sampleCounts.map((requestedSamples) => {
    const result = estimateEquity(built.observation, {
      samples: requestedSamples,
      timeBudgetMs: 60_000,
      sampleRng: mulberry32(seed + requestedSamples),
    });
    if (!result.ok) {
      return {
        label: `${opponents} opponents / flop`,
        opponents,
        requestedSamples,
        samples: 0,
        elapsedMs: 0,
        equity: null,
        error: result.error,
      };
    }
    return {
      label: `${opponents} opponents / flop`,
      opponents,
      requestedSamples,
      samples: result.samples,
      elapsedMs: Math.round(result.elapsedMs * 10) / 10,
      equity: Math.round(result.equity * 1000) / 1000,
    };
  });
}

/** 生产路径：分批让出后再做一次翻牌决策。耗时含 setTimeout 让出，不是纯计算。 */
export async function timeYieldingDecision(opponents: number, samples: number, batchSize: number, seed = 7) {
  const built = buildObservation(source(opponents));
  if (!built.ok) return { opponents, samples: 0, elapsedMs: 0, action: null, error: built.error };
  const started = performance.now();
  const equity = await estimateEquityInBatches(
    built.observation,
    { samples, timeBudgetMs: 60_000, batchSize, sampleRng: mulberry32(seed) },
    async () => { await new Promise((resolve) => setTimeout(resolve, 0)); },
    () => false,
  );
  if (!equity.ok) {
    return { opponents, samples: 0, elapsedMs: Math.round((performance.now() - started) * 10) / 10, action: null, error: equity.error };
  }
  const decided = decide(built.observation, PROFILES.ai_0, { equityOverride: equity, rng: mulberry32(seed + 1) });
  return {
    opponents,
    samples: equity.samples,
    elapsedMs: Math.round((performance.now() - started) * 10) / 10,
    action: decided.decision.move.action,
    reason: decided.diagnosis.reasonCode,
  };
}
