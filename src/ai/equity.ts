import { Hand } from 'pokersolver';
import { cardProblem, unknownCards } from './cards';
import { splitPots, type PotPlayer, type PotSplit } from './pots';
import type { AIObservation, ObservationError } from './types';

export const UNIFORM_RANGE_ASSUMPTION = '对手底牌按均匀随机合法组合抽样，不是已识别的对手范围';

export interface EquityOk {
  ok: true;
  equity: number;
  expectedRecovery: number;
  evReference: number;
  samples: number;
  elapsedMs: number;
  contestable: number;
  heroEligible: number;
  heroRefund: number;
  assumption: string;
}

export type EquityResult = EquityOk | { ok: false; error: ObservationError | 'no-samples' | 'aborted' };

export interface EquityOptions {
  samples?: number;
  timeBudgetMs?: number;
  sampleRng?: () => number;
  now?: () => number;
  callCost?: number;
}

interface SolvedHand {
  id: string;
  hand: Hand;
}

function inHand(status: string): boolean {
  return status === 'active' || status === 'all-in';
}

function potPlayers(obs: AIObservation, callCost: number): PotPlayer[] {
  return obs.players.map((player) => ({
    id: player.id,
    invested: player.id === obs.actorId ? player.invested + callCost : player.invested,
    inHand: inHand(player.status),
  }));
}

/** 从未知牌里不放回地抽出 count 张，不修改原数组。 */
export function drawCards(source: readonly string[], count: number, rng: () => number): string[] {
  const deck = source.slice();
  const drawn: string[] = [];
  for (let i = 0; i < count; i++) {
    const span = deck.length - i;
    const j = i + Math.floor(rng() * span);
    const card = deck[j];
    deck[j] = deck[i];
    deck[i] = card;
    drawn.push(card);
  }
  return drawn;
}

export function dealSample(
  hole: readonly string[],
  board: readonly string[],
  opponentCount: number,
  rng: () => number,
): { board: string[]; holes: [string, string][]; used: string[] } {
  const unknown = unknownCards(hole, board);
  const need = opponentCount * 2 + (5 - board.length);
  const drawn = drawCards(unknown, need, rng);
  const holes: [string, string][] = [];
  for (let i = 0; i < opponentCount; i++) {
    holes.push([drawn[i * 2], drawn[i * 2 + 1]]);
  }
  const fullBoard = [...board, ...drawn.slice(opponentCount * 2)];
  return {
    board: fullBoard,
    holes,
    used: [...hole, ...fullBoard, ...holes.flat()],
  };
}

function winnerShare(heroId: string, eligibleIds: readonly string[], solved: readonly SolvedHand[]): number {
  const group = solved.filter((entry) => eligibleIds.includes(entry.id));
  if (!group.some((entry) => entry.id === heroId) || group.length === 0) return 0;
  const winners = Hand.winners(group.map((entry) => entry.hand));
  let winnerCount = 0;
  let heroWins = false;
  for (const entry of group) {
    if (winners.includes(entry.hand)) {
      winnerCount += 1;
      if (entry.id === heroId) heroWins = true;
    }
  }
  if (!heroWins || winnerCount === 0) return 0;
  return 1 / winnerCount;
}

function scoreSplit(split: PotSplit, heroId: string, solved: readonly SolvedHand[]): { potWon: number; recovery: number } {
  const refund = split.refunds.find((item) => item.playerId === heroId)?.amount ?? 0;
  let potWon = 0;
  for (const pot of split.pots) {
    if (!pot.eligibleIds.includes(heroId)) continue;
    potWon += pot.amount * winnerShare(heroId, pot.eligibleIds, solved);
  }
  return { potWon, recovery: potWon + refund };
}

function solveShowdown(heroId: string, heroCards: string[], opponents: { id: string; cards: string[] }[]): SolvedHand[] {
  const solved: SolvedHand[] = [{ id: heroId, hand: Hand.solve(heroCards.slice()) }];
  for (const opponent of opponents) {
    solved.push({ id: opponent.id, hand: Hand.solve(opponent.cards.slice()) });
  }
  return solved;
}

export function estimateEquity(obs: AIObservation, options: EquityOptions = {}): EquityResult {
  const opponents = obs.players.filter((player) => player.id !== obs.actorId && inHand(player.status));
  const problem = cardProblem(obs.holeCards, obs.board, obs.stage, opponents.length);
  if (problem) return { ok: false, error: problem };

  const callCost = options.callCost ?? obs.callCost;
  if (!Number.isFinite(callCost) || callCost < 0) return { ok: false, error: 'bad-card' };
  const split = splitPots(potPlayers(obs, callCost));
  const heroRefund = split.refunds.find((item) => item.playerId === obs.actorId)?.amount ?? 0;
  const contestable = split.pots.reduce((sum, pot) => sum + pot.amount, 0);
  const heroEligible = split.pots
    .filter((pot) => pot.eligibleIds.includes(obs.actorId))
    .reduce((sum, pot) => sum + pot.amount, 0);

  const target = options.samples ?? 1;
  if (!Number.isInteger(target) || target <= 0) return { ok: false, error: 'no-samples' };
  const budget = options.timeBudgetMs ?? Number.POSITIVE_INFINITY;
  if (budget <= 0) return { ok: false, error: 'no-samples' };
  const now = options.now ?? (() => performance.now());
  const rng = options.sampleRng ?? Math.random;
  const start = now();

  if (opponents.length === 0) {
    const recovery = heroRefund + heroEligible;
    return {
      ok: true,
      equity: heroEligible > 0 || heroRefund > 0 ? 1 : 0,
      expectedRecovery: recovery,
      evReference: recovery - callCost,
      samples: 0,
      elapsedMs: Math.max(0, now() - start),
      contestable,
      heroEligible,
      heroRefund,
      assumption: UNIFORM_RANGE_ASSUMPTION,
    };
  }

  let equitySum = 0;
  let recoverySum = 0;
  let samples = 0;
  for (let i = 0; i < target; i++) {
    if (i > 0 && now() - start >= budget) break;
    const deal = dealSample(obs.holeCards, obs.board, opponents.length, rng);
    const solved = solveShowdown(
      obs.actorId,
      [...obs.holeCards, ...deal.board],
      opponents.map((player, index) => ({ id: player.id, cards: [...deal.holes[index], ...deal.board] })),
    );
    const scored = scoreSplit(split, obs.actorId, solved);
    equitySum += heroEligible > 0 ? scored.potWon / heroEligible : 0;
    recoverySum += scored.recovery;
    samples += 1;
  }
  if (samples === 0) return { ok: false, error: 'no-samples' };
  const expectedRecovery = recoverySum / samples;
  return {
    ok: true,
    equity: equitySum / samples,
    expectedRecovery,
    evReference: expectedRecovery - callCost,
    samples,
    elapsedMs: Math.max(0, now() - start),
    contestable,
    heroEligible,
    heroRefund,
    assumption: UNIFORM_RANGE_ASSUMPTION,
  };
}

export async function estimateEquityInBatches(
  obs: AIObservation,
  options: EquityOptions & { batchSize?: number },
  yieldFn: () => Promise<void>,
  aborted: () => boolean,
): Promise<EquityResult> {
  const target = options.samples ?? 1;
  const budget = options.timeBudgetMs ?? Number.POSITIVE_INFINITY;
  const batchSize = Math.max(1, options.batchSize ?? 24);
  const now = options.now ?? (() => performance.now());
  const rng = options.sampleRng ?? Math.random;
  const callCost = options.callCost ?? obs.callCost;
  const start = now();
  let done = 0;
  let equitySum = 0;
  let recoverySum = 0;
  let last: EquityOk | null = null;

  while (done < target) {
    if (aborted()) return { ok: false, error: 'aborted' };
    const spent = now() - start;
    if (done > 0 && spent >= budget) break;
    const requested = Math.min(batchSize, target - done);
    const part = estimateEquity(obs, {
      samples: requested,
      timeBudgetMs: Math.max(0.001, budget - spent),
      sampleRng: rng,
      now,
      callCost,
    });
    if (!part.ok) {
      if (done === 0) return part;
      break;
    }
    equitySum += part.equity * part.samples;
    recoverySum += part.expectedRecovery * part.samples;
    done += part.samples;
    last = part;
    if (part.samples < requested) break;
    if (done < target) await yieldFn();
  }

  if (!last || done === 0) return { ok: false, error: aborted() ? 'aborted' : 'no-samples' };
  const expectedRecovery = recoverySum / done;
  return {
    ok: true,
    equity: equitySum / done,
    expectedRecovery,
    evReference: expectedRecovery - callCost,
    samples: done,
    elapsedMs: Math.max(0, now() - start),
    contestable: last.contestable,
    heroEligible: last.heroEligible,
    heroRefund: last.heroRefund,
    assumption: last.assumption,
  };
}
