// 冻结在 802980b 的旧翻前逻辑，只给体验对照使用。
import { handKey, isPremiumHand, rangeContains } from '../cards';
import { preflopPrice } from '../preflopPrice';
import type { AIAction, AIObservation, PublicPlayer } from '../types';
import type { AIProfile, RangeSpot } from './profiles';

export interface PreflopChoice {
  move: AIAction;
  reason: string;
  handKey: string | null;
  position: RangeSpot;
}

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

export function decidePreflop(obs: AIObservation, profile: AIProfile, rng: () => number): PreflopChoice {
  const key = handKey(obs.holeCards[0], obs.holeCards[1]);
  const position = rangeSpot(obs.actorSeat, obs.dealerIndex, obs.players);
  const choose = (move: AIAction, reason: string): PreflopChoice => ({ move, reason, handKey: key, position });
  if (!key) {
    return choose(obs.legal.canCheck ? { action: 'check' } : { action: 'fold' }, 'preflop-fold');
  }

  const chart = profile.charts;
  const premium = isPremiumHand(key);
  const price = preflopPrice(obs);
  const allowed = price.cheapException || price.tier === 'normal' || rangeContains(
    price.tier === 'large' ? profile.largeContinue : profile.highRiskContinue,
    key,
  );
  const inOpen = rangeContains(chart.open[position], key);
  const inLimp = rangeContains(chart.limpCall[position], key);
  const inCall = rangeContains(chart.callVsRaise[position], key);
  const inThreeBet = rangeContains(chart.threeBet[position], key);
  const inBluff = rangeContains(chart.threeBetBluff[position], key);
  const inFourBet = rangeContains(chart.fourBet[position], key);
  const inContinue = rangeContains(chart.callVsReraise[position], key);

  if (obs.street.raiseCount === 0) {
    if (inOpen && allowed) {
      const raised = attemptRaise(obs, obs.bigBlind * profile.openMultiple, premium);
      if (raised) return choose(raised, 'preflop-open-raise');
    }
    if (obs.toCall > 0 && inLimp && allowed && obs.legal.canCall) return choose({ action: 'call' }, 'preflop-limp-call');
    if (obs.legal.canCheck) return choose({ action: 'check' }, 'preflop-check');
    return choose({ action: 'fold' }, 'preflop-open-fold');
  }

  if (obs.street.raiseCount === 1) {
    if (inThreeBet && allowed) {
      const raised = attemptRaise(obs, obs.currentMaxBet * profile.threeBetMultiple, premium);
      if (raised) return choose(raised, 'preflop-three-bet');
    } else if (price.tier === 'normal' && inBluff && rng() < profile.threeBetBluffFrequency) {
      const raised = attemptRaise(obs, obs.currentMaxBet * profile.threeBetMultiple, false);
      if (raised) return choose(raised, 'preflop-three-bet-bluff');
    }
    if ((inCall || inThreeBet) && allowed && obs.legal.canCall) return choose({ action: 'call' }, 'preflop-call');
    if (obs.legal.canCheck) return choose({ action: 'check' }, 'preflop-check');
    return choose({ action: 'fold' }, 'preflop-fold');
  }

  if (inFourBet && allowed) {
    const raised = attemptRaise(obs, obs.currentMaxBet * profile.threeBetMultiple, premium);
    if (raised) return choose(raised, 'preflop-four-bet');
  }
  if ((inContinue || inFourBet) && allowed && obs.legal.canCall) return choose({ action: 'call' }, 'preflop-call-reraise');
  if (obs.legal.canCheck) return choose({ action: 'check' }, 'preflop-check');
  return choose({ action: 'fold' }, 'preflop-fold');
}
