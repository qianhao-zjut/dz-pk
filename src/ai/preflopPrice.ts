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

export type ActionContext = 'unopened' | 'facing-open' | 'facing-3bet' | 'facing-4bet-plus' | 'unknown';

export interface PreflopPrice {
  tier: PriceTier;
  stackRisk: number | null;
  raiseBB: number;
  eligiblePot: number;
  priceRatio: number | null;
  cheapException: boolean;
  actionContext: ActionContext;
  conservativeReason: string | null;
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
  const context = actionContextOf(obs);
  const tier = priceTier(obs, context.kind, risk, raiseBB);
  return {
    tier,
    stackRisk,
    raiseBB,
    eligiblePot,
    priceRatio,
    cheapException,
    actionContext: context.kind,
    conservativeReason: context.conservativeReason,
  };
}

function actionContextOf(obs: AIObservation): { kind: ActionContext; conservativeReason: string | null } {
  const count = obs.street.fullRaiseCount;
  if (count <= 0) return { kind: 'unopened', conservativeReason: null };
  if (count === 1) {
    if (obs.street.openTo == null || obs.street.openerId == null) {
      return { kind: 'unknown', conservativeReason: '缺少完整开池信息，按保守价格处理' };
    }
    return { kind: 'facing-open', conservativeReason: null };
  }
  if (count === 2) {
    if (obs.street.openTo == null || obs.street.threeBetTo == null) {
      return { kind: 'unknown', conservativeReason: '缺少完整三次下注信息，按保守价格处理' };
    }
    return { kind: 'facing-3bet', conservativeReason: null };
  }
  return { kind: 'facing-4bet-plus', conservativeReason: '四注及以上保持保守价格' };
}

/** 高投入优先。普通 3bet 只在前一开池正常、约 4 倍以内、目标小于 20bb 且跟注风险小于 15% 时放开。 */
function priceTier(obs: AIObservation, kind: ActionContext, risk: number, raiseBB: number): PriceTier {
  if (risk >= PREFLOP_PRICE.highStackRisk || raiseBB >= PREFLOP_PRICE.highRaiseBB) return 'high-risk';
  if (kind === 'facing-3bet' && obs.street.openTo != null && obs.bigBlind > 0) {
    const openBb = obs.street.openTo / obs.bigBlind;
    const threeTo = obs.street.threeBetTo ?? obs.currentMaxBet;
    const withinMultiple = threeTo <= obs.street.openTo * 4;
    const normalThreeBet = openBb <= PREFLOP_PRICE.largeRaiseBB
      && withinMultiple
      && threeTo / obs.bigBlind < PREFLOP_PRICE.highRaiseBB
      && risk < PREFLOP_PRICE.largeStackRisk;
    if (normalThreeBet) return 'normal';
    return 'large';
  }
  if (risk >= PREFLOP_PRICE.largeStackRisk || raiseBB > PREFLOP_PRICE.largeRaiseBB) return 'large';
  return 'normal';
}
