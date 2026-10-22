import { splitPots } from './pots';
import type { AIObservation } from './types';

/** 三个风格共用的翻前价格护栏。范围仍由各 profile 自己收紧。 */
export const PREFLOP_PRICE = {
  largeStackRisk: 0.15,
  highStackRisk: 0.5,
  /** raiseBB 大于该值进入大额档；等于 5 仍算常规。 */
  largeRaiseBB: 5,
  /** raiseBB 大于等于该值进入高风险档。 */
  highRaiseBB: 20,
  cheapCallMultiple: 2,
  cheapPriceRatio: 0.1,
} as const;

export type PriceTier = 'normal' | 'large' | 'high-risk';

export interface PreflopPrice {
  tier: PriceTier;
  stackRisk: number | null;
  raiseBB: number;
  eligiblePot: number;
  priceRatio: number | null;
  cheapException: boolean;
}

/** 按实际跟注额、剩余筹码和本人能争夺的池子分档。无资格边池不计入价格。 */
export function preflopPrice(obs: AIObservation): PreflopPrice {
  const hero = obs.players.find((player) => player.id === obs.actorId);
  const chips = hero?.chips ?? 0;
  const callCost = obs.callCost;
  const stackRisk = callCost > 0 && Number.isFinite(chips) && chips > 0 ? callCost / chips : null;
  const raiseBB = obs.bigBlind > 0 ? obs.currentMaxBet / obs.bigBlind : 0;
  const split = splitPots(obs.players.map((player) => ({
    id: player.id,
    invested: player.id === obs.actorId ? player.invested + callCost : player.invested,
    inHand: player.status === 'active' || player.status === 'all-in',
  })));
  const eligiblePot = split.pots
    .filter((pot) => pot.eligibleIds.includes(obs.actorId))
    .reduce((sum, pot) => sum + pot.amount, 0);
  const priceRatio = callCost > 0 && eligiblePot > 0 ? callCost / eligiblePot : null;
  const cheapException = callCost > 0
    && callCost <= PREFLOP_PRICE.cheapCallMultiple * obs.bigBlind
    && priceRatio != null
    && priceRatio <= PREFLOP_PRICE.cheapPriceRatio;
  const risk = stackRisk ?? 0;
  let tier: PriceTier = 'normal';
  if (risk >= PREFLOP_PRICE.highStackRisk || raiseBB >= PREFLOP_PRICE.highRaiseBB) tier = 'high-risk';
  else if (risk >= PREFLOP_PRICE.largeStackRisk || raiseBB > PREFLOP_PRICE.largeRaiseBB) tier = 'large';
  return { tier, stackRisk, raiseBB, eligiblePot, priceRatio, cheapException };
}
