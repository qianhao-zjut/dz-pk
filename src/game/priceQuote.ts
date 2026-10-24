import { splitPots } from '../ai/pots';

export interface QuotePlayer {
  id: string;
  invested: number;
  chips: number;
  currentBet: number;
  status: 'active' | 'folded' | 'all-in' | 'sitting-out';
}

export interface CallQuote {
  toCall: number;
  callCost: number;
  /** 可精确报价时的当前可争夺池，已含对手下注、不含本次跟注。 */
  pot: number | null;
  potAfter: number | null;
  /** C / P */
  share: number | null;
  /** C / (P + C)，忽略后续下注、权益实现和抽水。 */
  threshold: number | null;
  shortAllIn: boolean;
  freeCheck: boolean;
  approximate: boolean;
  label: string;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function quoteCall(
  actor: QuotePlayer,
  currentMaxBet: number,
  players: readonly QuotePlayer[],
  potNow = 0,
): CallQuote {
  const toCall = Math.max(0, currentMaxBet - actor.currentBet);
  const callCost = Math.min(Math.max(0, actor.chips), toCall);
  const base = {
    toCall,
    callCost,
    pot: null,
    potAfter: null,
    share: null,
    threshold: null,
    shortAllIn: false,
    freeCheck: toCall === 0,
    approximate: false,
    label: '',
  };
  if (toCall === 0) return { ...base, label: '可以过牌' };
  if (callCost <= 0) return { ...base, label: '无法跟注' };

  const shortAllIn = actor.chips <= toCall;
  const simulated = players.map((player) => ({
    id: player.id,
    invested: player.id === actor.id ? player.invested + callCost : player.invested,
    inHand: player.id === actor.id || player.status === 'active' || player.status === 'all-in',
  }));
  const split = splitPots(simulated);
  const eligible = split.pots.filter((pot) => pot.eligibleIds.includes(actor.id));
  if (eligible.length !== 1) {
    return {
      ...base,
      shortAllIn,
      approximate: true,
      label: shortAllIn ? `全下跟注 $${callCost}。多边池，仅作参考` : `跟注 $${callCost}。多边池，仅作参考`,
    };
  }
  const side = split.pots.length > 1 || split.refunds.length > 0;
  const contestable = eligible[0].amount;
  const pot = side ? contestable - callCost : potNow;
  const potAfter = side ? contestable : potNow + callCost;
  if (pot <= 0 || potAfter <= callCost) {
    return {
      ...base,
      shortAllIn,
      approximate: true,
      label: shortAllIn ? `全下跟注 $${callCost}。可争夺底池不足，仅作参考` : `跟注 $${callCost}。可争夺底池不足，仅作参考`,
    };
  }
  const share = callCost / pot;
  const threshold = callCost / potAfter;
  const prefix = shortAllIn ? `全下跟注 $${callCost}` : `跟注 $${callCost}`;
  const detail = `占当前可争夺池 ${pct(share)}；摊牌权益门槛参考 ${pct(threshold)}；跟后可争夺 $${potAfter}`;
  return {
    ...base,
    pot,
    potAfter,
    share,
    threshold,
    shortAllIn,
    approximate: false,
    label: side ? `${prefix}。${detail}。不含无资格边池或未匹配退还` : `${prefix}。${detail}`,
  };
}
