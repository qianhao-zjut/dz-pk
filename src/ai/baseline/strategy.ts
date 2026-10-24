// 冻结在 802980b 的旧启发式，只给体验对照使用，牌桌不会调用这里。
import { handKey } from '../cards';
import { estimateEquity, type EquityOk, type EquityResult } from '../equity';
import { isLegalMove } from '../prices';
import type { AIAction, AIDecision, AIDiagnosis, AIObservation } from '../types';
import { HEURISTIC_ASSUMPTION, PREFLOP_ASSUMPTION, SHOWDOWN_ASSUMPTION, type AIProfile } from './profiles';
import { decidePreflop, rangeSpot } from './preflop';

const RANKS = '23456789TJQKA';

export interface DecideOptions {
  rng?: () => number;
  sampleRng?: () => number;
  samples?: number;
  timeBudgetMs?: number;
  now?: () => number;
  equityOverride?: EquityResult;
}

export interface Decided {
  decision: AIDecision;
  diagnosis: AIDiagnosis;
}

/** 三张以上花色，或三张点数落在 4 的跨度里，视为有明显同花或顺子可能。 */
export function boardWet(board: readonly string[]): boolean {
  if (board.length < 3) return false;
  const suits = new Map<string, number>();
  const ranks: number[] = [];
  for (const card of board) {
    suits.set(card[1], (suits.get(card[1]) ?? 0) + 1);
    ranks.push(RANKS.indexOf(card[0]));
  }
  if ([...suits.values()].some((count) => count >= 3)) return true;
  const unique = [...new Set(ranks)].filter((rank) => rank >= 0).sort((a, b) => a - b);
  const axis = unique.includes(12) ? [-1, ...unique] : unique;
  for (let i = 0; i < axis.length; i++) {
    let close = 1;
    for (let j = i + 1; j < axis.length; j++) {
      if (axis[j] - axis[i] <= 4) close += 1;
    }
    if (close >= 3) return true;
  }
  return false;
}

/** 从按钮下一位起绕桌，最后一个仍可行动的玩家才有位置。 */
export function inPosition(obs: AIObservation): boolean {
  const count = obs.players.length;
  if (count === 0) return false;
  const active = obs.players.filter((player) => player.status === 'active');
  if (!active.some((player) => player.seat === obs.actorSeat)) return false;
  const order = (seat: number) => ((seat - obs.dealerIndex - 1) % count + count) % count;
  const last = Math.max(...active.map((player) => order(player.seat)));
  return order(obs.actorSeat) === last;
}

function stackToPot(obs: AIObservation): number {
  const hero = obs.players.find((player) => player.id === obs.actorId);
  if (!hero) return 99;
  const opponents = obs.players.filter((player) => player.id !== obs.actorId && (player.status === 'active' || player.status === 'all-in'));
  const opponentChips = opponents.length > 0 ? Math.max(...opponents.map((player) => player.chips)) : hero.chips;
  return Math.min(hero.chips, opponentChips) / Math.max(obs.pot, obs.bigBlind, 1);
}

function sizedRaise(obs: AIObservation, fraction: number, basis: number, allowAllIn: boolean): number | null {
  if (!obs.legal.canRaise) return null;
  const actor = obs.players.find((player) => player.id === obs.actorId);
  if (!actor) return null;
  if (obs.legal.shortAllInOnly) return allowAllIn ? obs.maxRaiseTo : null;
  const potBasis = Math.max(basis, obs.bigBlind, 1);
  const extra = obs.toCall + Math.max(obs.bigBlind, Math.round(potBasis * fraction));
  let raiseTo = actor.currentBet + extra;
  if (raiseTo >= obs.maxRaiseTo) {
    if (allowAllIn) return obs.maxRaiseTo;
    if (obs.minRaiseTo < obs.maxRaiseTo) return obs.minRaiseTo;
    return null;
  }
  if (raiseTo < obs.minRaiseTo) raiseTo = obs.minRaiseTo;
  if (!allowAllIn && raiseTo >= obs.maxRaiseTo) return null;
  return raiseTo;
}

function continueCall(obs: AIObservation, profile: AIProfile, equity: EquityOk): boolean {
  const involved = obs.players.filter((player) => player.status === 'active' || player.status === 'all-in').length;
  const multi = involved >= 3 ? profile.multiwayCaution : 0;
  const wet = boardWet(obs.board) ? profile.textureCaution : 0;
  const positionPenalty = inPosition(obs) ? 0 : profile.positionCaution;
  const lowSample = equity.samples > 0 && equity.samples < 40 ? 0.05 : 0;
  const extra = (multi + wet + positionPenalty + lowSample) * obs.callCost;
  return equity.evReference >= profile.callCushionFraction * obs.callCost + extra;
}

function betBasis(obs: AIObservation, equity: EquityOk): number {
  const whole = obs.pot + obs.toCall;
  if (equity.heroEligible > 0) return Math.min(whole, equity.heroEligible);
  return whole;
}

function decidePostflop(
  obs: AIObservation,
  profile: AIProfile,
  equity: EquityOk,
  rng: () => number,
): { move: AIAction; reason: string } {
  const basis = betBasis(obs, equity);
  const fraction = Math.min(1, profile.betFraction + (equity.equity >= 0.85 ? 0.15 : 0) + (inPosition(obs) ? 0.05 : 0));
  const allowAllIn = stackToPot(obs) <= 1.25 && equity.equity >= 0.75;
  const involved = obs.players.filter((player) => player.status === 'active' || player.status === 'all-in').length;

  if (obs.toCall > 0) {
    const pricedIn = continueCall(obs, profile, equity);
    if (pricedIn && equity.equity >= profile.strongEquity) {
      const raiseTo = sizedRaise(obs, fraction, basis, allowAllIn);
      if (raiseTo != null && (allowAllIn || raiseTo < obs.maxRaiseTo)) {
        return { move: { action: 'raise', raiseTo }, reason: 'postflop-raise' };
      }
    }
    if (pricedIn && obs.legal.canCall) return { move: { action: 'call' }, reason: 'postflop-call' };
    if (obs.legal.canCheck) return { move: { action: 'check' }, reason: 'postflop-check' };
    return { move: { action: 'fold' }, reason: 'postflop-fold' };
  }

  if (equity.equity >= profile.valueEquity) {
    const raiseTo = sizedRaise(obs, fraction, basis, allowAllIn);
    if (raiseTo != null && (allowAllIn || raiseTo < obs.maxRaiseTo)) {
      return { move: { action: 'raise', raiseTo }, reason: 'postflop-value-bet' };
    }
  }
  const bluffFrequency = profile.bluffFrequency * (inPosition(obs) ? 1 : 0.5);
  if (equity.equity < 0.4 && involved <= 2 && rng() < bluffFrequency) {
    const raiseTo = sizedRaise(obs, 0.33, basis, false);
    if (raiseTo != null && raiseTo < obs.maxRaiseTo) {
      return { move: { action: 'raise', raiseTo }, reason: 'postflop-bluff' };
    }
  }
  if (obs.legal.canCheck) return { move: { action: 'check' }, reason: 'postflop-check' };
  return { move: { action: 'fold' }, reason: 'postflop-fold' };
}

function ensureLegal(obs: AIObservation, move: AIAction): AIAction {
  if (move.action === 'fold' && obs.legal.canCheck) return { action: 'check' };
  if (isLegalMove(obs, move)) return move;
  if (obs.legal.canCheck) return { action: 'check' };
  return { action: 'fold' };
}

export function decide(obs: AIObservation, profile: AIProfile, options: DecideOptions = {}): Decided {
  const rng = options.rng ?? Math.random;
  const started = performance.now();
  const assumptions = [HEURISTIC_ASSUMPTION];
  let equity: number | null = null;
  let evReference: number | null = null;
  let samples = 0;
  let equityElapsed = 0;
  let reason: string;
  let move: AIAction = obs.legal.canCheck ? { action: 'check' } : { action: 'fold' };
  let hand = handKey(obs.holeCards[0], obs.holeCards[1]);
  let position: string | null = rangeSpot(obs.actorSeat, obs.dealerIndex, obs.players);

  if (obs.stage === 'preflop') {
    const choice = decidePreflop(obs, profile, rng);
    move = choice.move;
    reason = choice.reason;
    hand = choice.handKey;
    position = choice.position;
    assumptions.push(PREFLOP_ASSUMPTION);
  } else {
    const estimated = options.equityOverride ?? estimateEquity(obs, {
      samples: options.samples ?? 200,
      timeBudgetMs: options.timeBudgetMs ?? 40,
      sampleRng: options.sampleRng ?? Math.random,
      now: options.now,
      callCost: obs.callCost,
    });
    if (!estimated.ok) {
      reason = 'equity-fallback';
      assumptions.push(SHOWDOWN_ASSUMPTION);
    } else {
      equity = estimated.equity;
      evReference = estimated.evReference;
      samples = estimated.samples;
      equityElapsed = estimated.elapsedMs;
      const choice = decidePostflop(obs, profile, estimated, rng);
      move = choice.move;
      reason = choice.reason;
      assumptions.push(estimated.assumption, SHOWDOWN_ASSUMPTION);
    }
  }

  move = ensureLegal(obs, move);
  const diagnosis: AIDiagnosis = {
    profileId: profile.id,
    street: obs.stage,
    reasonCode: reason,
    samples,
    equity,
    evReference,
    elapsedMs: Math.max(0, performance.now() - started) + equityElapsed,
    assumptions,
    handKey: hand,
    position,
  };
  return {
    decision: { turnToken: obs.turnToken, actorId: obs.actorId, move },
    diagnosis,
  };
}
