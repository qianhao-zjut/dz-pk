import { roleAt } from '../game/positions';
import { handKey, isPremiumHand, rangeContains } from './cards';
import type { DefendLine } from './defendLines';
import { inPosition } from './position';
import { isPositionCore, positionAssumption, positionPlan, type PositionPlan } from './preflopPosition';
import { preflopPrice } from './preflopPrice';
import type { AIProfile, RangeSpot } from './profiles';
import type { ThreeBetRole } from './threeBetLines';
import type { AIAction, AIObservation, PublicPlayer } from './types';

export interface PreflopChoice {
  move: AIAction;
  reason: string;
  handKey: string | null;
  /** 本手真实角色，不是图表分档。 */
  position: string | null;
  rangeBucket: string | null;
  assumption: string;
}

export interface PreflopBranch {
  weight: number;
  move: AIAction;
  reason: string;
}

const SHORT_BB = 45;
const DEEP_BB = 160;

/** 四人桌及更少人数的位置。两人时按本牌桌的盲注座位，不套九人桌 UTG。 */
export function rangeSpot(seat: number, dealerIndex: number, players: readonly Pick<PublicPlayer, 'status'>[]): RangeSpot {
  const seatCount = Math.max(1, players.length);
  const inHand = players.filter((player) => player.status !== 'sitting-out').length;
  if (inHand <= 2) return 'HU';
  const offset = ((seat - dealerIndex) % seatCount + seatCount) % seatCount;
  const pos: RangeSpot = offset === 0 ? 'BTN' : offset === 1 ? 'SB' : offset === 2 ? 'BB' : 'UTG';
  if (inHand === 3) {
    if (pos === 'SB' || pos === 'BB') return pos;
    return 'BTN';
  }
  return pos;
}

export type StackDepth = 'short' | 'standard' | 'deep';

export interface StackReference {
  opponentId: string | null;
  effectiveBb: number;
}

function stackTotal(player: Pick<PublicPlayer, 'chips' | 'currentBet'>): number {
  return player.chips + player.currentBet;
}

/** 面对完整加注时参考该加注者；未开池时用仍可行动对手里本人能参与的最大有效深度。 */
export function stackReference(obs: AIObservation): StackReference {
  if (obs.bigBlind <= 0) return { opponentId: null, effectiveBb: 100 };
  const hero = obs.players.find((player) => player.id === obs.actorId);
  if (!hero) return { opponentId: null, effectiveBb: 100 };
  const heroStack = stackTotal(hero);
  const inHand = obs.players.filter((player) => (
    player.id !== obs.actorId && (player.status === 'active' || player.status === 'all-in')
  ));
  const covered = (player: PublicPlayer) => Math.min(heroStack, stackTotal(player));
  const fullRaiserId = obs.street.lastFullRaiserId;
  if (fullRaiserId) {
    const raiser = inHand.find((player) => player.id === fullRaiserId);
    if (raiser) return { opponentId: raiser.id, effectiveBb: covered(raiser) / obs.bigBlind };
  }
  const active = inHand.filter((player) => player.status === 'active');
  const pool = active.length > 0 ? active : inHand;
  if (pool.length === 0) return { opponentId: null, effectiveBb: heroStack / obs.bigBlind };
  if (active.length === 0) {
    const topBet = Math.max(...pool.map((player) => player.currentBet));
    const matching = pool.filter((player) => player.currentBet === topBet);
    const best = matching.reduce((left, right) => (covered(right) > covered(left) ? right : left));
    return { opponentId: best.id, effectiveBb: covered(best) / obs.bigBlind };
  }
  const best = pool.reduce((left, right) => (covered(right) > covered(left) ? right : left));
  return { opponentId: best.id, effectiveBb: covered(best) / obs.bigBlind };
}

/** 有效筹码按定价对手计算。弃牌、坐出和无关的短不足额全下不把深筹压短。 */
export function effectiveStackBb(obs: AIObservation): number {
  return stackReference(obs).effectiveBb;
}

export function stackDepth(obs: AIObservation): StackDepth {
  const eff = effectiveStackBb(obs);
  if (eff <= SHORT_BB) return 'short';
  if (eff >= DEEP_BB) return 'deep';
  return 'standard';
}

export function coldCallerCount(obs: AIObservation): number {
  const raiserId = obs.street.lastFullRaiserId ?? obs.street.lastRaiserId;
  return obs.players.filter((player) => (
    player.id !== obs.actorId
    && player.id !== raiserId
    && player.status !== 'folded'
    && player.status !== 'sitting-out'
    && obs.currentMaxBet > 0
    && player.currentBet >= obs.currentMaxBet
  )).length;
}

export function voluntaryLimpCount(obs: AIObservation): number {
  if (obs.street.fullRaiseCount > 0 || obs.street.raiseCount > 0 || obs.bigBlind <= 0) return 0;
  const statuses = obs.players.map((player) => player.status);
  return obs.players.filter((player) => (
    player.id !== obs.actorId
    && roleAt(player.seat, obs.dealerIndex, statuses) !== 'BB'
    && player.status !== 'folded'
    && player.status !== 'sitting-out'
    && player.currentBet >= obs.bigBlind
  )).length;
}

/** 无位置更大；每个冷跟加一倍当前最高注。同一输入不引入随机金额。 */
export function reraiseMultiple(obs: AIObservation, profile: AIProfile): number {
  const base = inPosition(obs) ? profile.reraiseInPosition : profile.reraiseOutOfPosition;
  return base + coldCallerCount(obs);
}

function attemptRaise(obs: AIObservation, desired: number, shoveOk: boolean): AIAction | null {
  if (!obs.legal.canRaise) return null;
  if (obs.legal.shortAllInOnly) {
    if (!shoveOk) return null;
    return { action: 'raise', raiseTo: obs.maxRaiseTo };
  }
  let target = Math.round(desired);
  if (!Number.isInteger(target) || target <= obs.currentMaxBet) return null;
  if (target < obs.minRaiseTo) target = obs.minRaiseTo;
  if (target > obs.maxRaiseTo) target = obs.maxRaiseTo;
  if (target === obs.maxRaiseTo && !shoveOk) return null;
  return { action: 'raise', raiseTo: target };
}

function openerPlayer(obs: AIObservation): PublicPlayer | null {
  const id = obs.street.openerId ?? obs.street.lastFullRaiserId ?? obs.street.lastRaiserId;
  if (!id) return null;
  return obs.players.find((player) => player.id === id) ?? null;
}

function openTokens(profile: AIProfile, position: RangeSpot, depth: StackDepth): readonly string[] {
  if (depth === 'short') return profile.shortOpen[position];
  if (depth === 'deep') return [...profile.charts.open[position], ...profile.deepExtraOpen[position]];
  return profile.charts.open[position];
}

function only(move: AIAction, reason: string): PreflopBranch[] {
  return [{ weight: 1, move, reason }];
}

function passive(obs: AIObservation, foldReason: string): PreflopBranch[] {
  if (obs.legal.canCheck) return only({ action: 'check' }, 'preflop-check');
  return only({ action: 'fold' }, foldReason);
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function pickBranch<T extends { weight: number }>(branches: readonly T[], rng: () => number): T {
  const usable = branches.filter((branch) => branch.weight > 0);
  const pool = usable.length > 0 ? usable : branches;
  const total = pool.reduce((sum, branch) => sum + branch.weight, 0);
  let roll = rng() * (total > 0 ? total : 1);
  for (const branch of pool) {
    roll -= branch.weight;
    if (roll < 0) return branch;
  }
  return pool[pool.length - 1];
}

function defendLine(profile: AIProfile, hero: RangeSpot, opener: RangeSpot | null): DefendLine | null {
  if (!opener) return null;
  return profile.defend[hero]?.[opener] ?? null;
}

function facingRaise(
  obs: AIObservation,
  profile: AIProfile,
  key: string,
  heroSpot: RangeSpot,
  openerSpot: RangeSpot | null,
): PreflopBranch[] {
  const chart = profile.charts;
  const position = heroSpot;
  const price = preflopPrice(obs);
  const depth = stackDepth(obs);
  const premium = isPremiumHand(key);
  const line = defendLine(profile, position, openerSpot);
  const callTokens = line ? line.call : chart.callVsRaise[position];
  const valueTokens = line ? line.value : chart.threeBet[position];
  const mixTokens = line ? line.mix : [];
  const bluffTokens = line ? line.bluff : chart.threeBetBluff[position];
  const allowed = price.cheapException || price.tier === 'normal' || rangeContains(
    price.tier === 'large' ? profile.largeContinue : profile.highRiskContinue,
    key,
  );
  const inValue = rangeContains(valueTokens, key);
  const inMix = rangeContains(mixTokens, key);
  const inCall = rangeContains(callTokens, key) || (depth === 'deep' && !!line && rangeContains(line.deepCall, key));
  const inBluff = rangeContains(bluffTokens, key);
  const canFlat = (kind: 'value' | 'other') => {
    if (!obs.legal.canCall) return false;
    if (depth !== 'short' || !line || kind === 'value') return true;
    return rangeContains(line.shortFlat, key);
  };

  if (!allowed) return passive(obs, 'preflop-fold');

  const desired = obs.currentMaxBet * reraiseMultiple(obs, profile);
  if (inValue) {
    const raised = attemptRaise(obs, desired, premium);
    if (raised) return only(raised, 'preflop-three-bet');
    if (canFlat('value')) return only({ action: 'call' }, 'preflop-call');
    return passive(obs, 'preflop-fold');
  }

  if (inMix && price.tier === 'normal') {
    const raised = attemptRaise(obs, desired, premium);
    const freq = raised ? clamp01(line?.mixFrequency ?? 0) : 0;
    const branches: PreflopBranch[] = [];
    if (raised && freq > 0) branches.push({ weight: freq, move: raised, reason: 'preflop-three-bet-mix' });
    const rest = 1 - freq;
    if (rest > 0) {
      if (canFlat('other')) branches.push({ weight: rest, move: { action: 'call' }, reason: 'preflop-call' });
      else branches.push(...passive(obs, 'preflop-fold').map((branch) => ({ ...branch, weight: rest })));
    }
    return branches;
  }

  const bluffFreq = price.tier === 'normal'
    ? profile.threeBetBluffFrequency * (depth === 'deep' ? 0.5 : 1)
    : 0;
  if (inBluff && bluffFreq > 0) {
    const raised = attemptRaise(obs, desired, false);
    if (raised) {
      const freq = clamp01(bluffFreq);
      const rest = inCall && canFlat('other')
        ? { move: { action: 'call' as const }, reason: 'preflop-call' }
        : (obs.legal.canCheck
          ? { move: { action: 'check' as const }, reason: 'preflop-check' }
          : { move: { action: 'fold' as const }, reason: 'preflop-fold' });
      return [
        { weight: freq, move: raised, reason: 'preflop-three-bet-bluff' },
        { weight: 1 - freq, move: rest.move, reason: rest.reason },
      ];
    }
  }

  if ((inCall || inMix) && canFlat('other')) return only({ action: 'call' }, 'preflop-call');
  return passive(obs, 'preflop-fold');
}

function threeBetRole(obs: AIObservation): ThreeBetRole {
  if (obs.street.openerId && obs.street.openerId === obs.actorId) return 'opener';
  const hero = obs.players.find((player) => player.id === obs.actorId);
  const openTo = obs.street.openTo ?? 0;
  if (hero && openTo > 0 && hero.currentBet >= openTo) return 'coldCaller';
  return 'cold';
}

function facingThreeBet(obs: AIObservation, profile: AIProfile, key: string, heroSpot: RangeSpot): PreflopBranch[] {
  const position = heroSpot;
  const price = preflopPrice(obs);
  const depth = stackDepth(obs);
  const premium = isPremiumHand(key);
  const spotLine = profile.vsThreeBet[threeBetRole(obs)][position];
  const allowed = price.cheapException || price.tier === 'normal' || rangeContains(
    price.tier === 'large' ? profile.largeContinue : profile.highRiskContinue,
    key,
  );
  if (!allowed) return passive(obs, 'preflop-fold');
  const inRaise = rangeContains(spotLine.raise, key);
  const inCall = rangeContains(spotLine.call, key) || (depth === 'deep' && rangeContains(spotLine.deepCall, key));
  const desired = obs.currentMaxBet * reraiseMultiple(obs, profile);
  if (inRaise) {
    const raised = attemptRaise(obs, desired, premium);
    if (raised) return only(raised, 'preflop-four-bet');
    if (obs.legal.canCall) return only({ action: 'call' }, 'preflop-call-3bet');
    return passive(obs, 'preflop-fold');
  }
  if (inCall && obs.legal.canCall && (depth !== 'short' || rangeContains(spotLine.shortCall, key))) {
    return only({ action: 'call' }, 'preflop-call-3bet');
  }
  return passive(obs, 'preflop-fold');
}

/** 用显式图表来源计算分支。不改写真实座位、加注者和价格。 */
export function chartBranches(
  obs: AIObservation,
  profile: AIProfile,
  heroSpot: RangeSpot,
  openerSpot: RangeSpot | null,
): PreflopBranch[] {
  const key = handKey(obs.holeCards[0], obs.holeCards[1]);
  if (!key) return passive(obs, 'preflop-fold');

  const position = heroSpot;
  const chart = profile.charts;
  const price = preflopPrice(obs);
  const depth = stackDepth(obs);
  const premium = isPremiumHand(key);
  const allowed = price.cheapException || price.tier === 'normal' || rangeContains(
    price.tier === 'large' ? profile.largeContinue : profile.highRiskContinue,
    key,
  );

  const fullRaises = obs.street.fullRaiseCount;
  if (fullRaises <= 0) {
    if (rangeContains(openTokens(profile, position, depth), key) && allowed) {
      const limps = voluntaryLimpCount(obs);
      const raised = attemptRaise(obs, obs.bigBlind * (profile.openMultiple + limps), premium);
      if (raised) return only(raised, limps > 0 ? 'preflop-isolate' : 'preflop-open-raise');
    }
    if (obs.toCall > 0 && rangeContains(chart.limpCall[position], key) && allowed && obs.legal.canCall) {
      return only({ action: 'call' }, 'preflop-limp-call');
    }
    return passive(obs, 'preflop-open-fold');
  }

  if (fullRaises === 1) return facingRaise(obs, profile, key, heroSpot, openerSpot);
  if (fullRaises === 2) return facingThreeBet(obs, profile, key, heroSpot);

  if (rangeContains(chart.fourBet[position], key) && allowed) {
    const raised = attemptRaise(obs, obs.currentMaxBet * reraiseMultiple(obs, profile), premium);
    if (raised) return only(raised, 'preflop-four-bet');
  }
  if ((rangeContains(chart.callVsReraise[position], key) || rangeContains(chart.fourBet[position], key)) && allowed && obs.legal.canCall) {
    return only({ action: 'call' }, 'preflop-call-reraise');
  }
  return passive(obs, 'preflop-fold');
}

function scaleBranches(branches: readonly PreflopBranch[], weight: number): PreflopBranch[] {
  return branches.map((branch) => ({ ...branch, weight: branch.weight * weight }));
}

function sameMove(left: AIAction, right: AIAction): boolean {
  if (left.action !== right.action) return false;
  if (left.action === 'raise' && right.action === 'raise') return left.raiseTo === right.raiseTo;
  return true;
}

function mergeBranches(parts: readonly PreflopBranch[]): PreflopBranch[] {
  const merged: PreflopBranch[] = [];
  for (const branch of parts) {
    if (branch.weight <= 0) continue;
    const found = merged.find((item) => item.reason === branch.reason && sameMove(item.move, branch.move));
    if (found) found.weight += branch.weight;
    else merged.push({ ...branch, move: { ...branch.move } });
  }
  return merged;
}

function applyKeep(branches: readonly PreflopBranch[], obs: AIObservation, keep: number): PreflopBranch[] {
  let released = 0;
  const next: PreflopBranch[] = [];
  for (const branch of branches) {
    const passiveMove = branch.move.action === 'fold' || branch.move.action === 'check';
    if (passiveMove) {
      next.push({ ...branch, move: { ...branch.move } });
      continue;
    }
    const kept = branch.weight * keep;
    released += branch.weight - kept;
    if (kept > 0) next.push({ ...branch, weight: kept, move: { ...branch.move } });
  }
  if (released > 0) {
    const move: AIAction = obs.legal.canCheck ? { action: 'check' } : { action: 'fold' };
    const reason = move.action === 'check' ? 'preflop-check' : 'preflop-fold';
    const existing = next.find((branch) => branch.move.action === move.action);
    if (existing) existing.weight += released;
    else next.push({ weight: released, move, reason });
  }
  return next.filter((branch) => branch.weight > 0);
}

export function preflopBranches(obs: AIObservation, profile: AIProfile): PreflopBranch[] {
  const key = handKey(obs.holeCards[0], obs.holeCards[1]);
  if (!key) return passive(obs, 'preflop-fold');
  const statuses = obs.players.map((player) => player.status);
  const hero = positionPlan(obs.actorSeat, obs.dealerIndex, statuses);
  if (hero.sources.length === 0) return passive(obs, 'preflop-fold');
  const opener = openerPlayer(obs);
  const openerPlan = opener ? positionPlan(opener.seat, obs.dealerIndex, statuses) : null;
  const parts: PreflopBranch[] = [];
  if (obs.street.fullRaiseCount === 1 && openerPlan && openerPlan.sources.length > 0) {
    for (const heroSource of hero.sources) {
      for (const openerSource of openerPlan.sources) {
        parts.push(...scaleBranches(
          chartBranches(obs, profile, heroSource.spot, openerSource.spot),
          heroSource.weight * openerSource.weight,
        ));
      }
    }
  } else {
    for (const heroSource of hero.sources) {
      parts.push(...scaleBranches(chartBranches(obs, profile, heroSource.spot, null), heroSource.weight));
    }
  }
  let merged = mergeBranches(parts);
  if (hero.keep < 1 && !isPositionCore(key)) merged = applyKeep(merged, obs, hero.keep);
  return merged.length > 0 ? merged : passive(obs, 'preflop-fold');
}

export function branchWeights(branches: readonly PreflopBranch[]): { fold: number; check: number; call: number; raise: number } {
  const weights = { fold: 0, check: 0, call: 0, raise: 0 };
  for (const branch of branches) weights[branch.move.action] += branch.weight;
  return weights;
}

export function decidePreflop(obs: AIObservation, profile: AIProfile, rng: () => number): PreflopChoice {
  const key = handKey(obs.holeCards[0], obs.holeCards[1]);
  const plan: PositionPlan = positionPlan(obs.actorSeat, obs.dealerIndex, obs.players.map((player) => player.status));
  const picked = pickBranch(preflopBranches(obs, profile), rng);
  return {
    move: picked.move,
    reason: picked.reason,
    handKey: key,
    position: plan.role,
    rangeBucket: plan.bucket,
    assumption: positionAssumption(plan),
  };
}
