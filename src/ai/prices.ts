import type { AIAction, LegalActions } from './types';

export interface PriceInput {
  chips: number;
  currentBet: number;
  canRaise: boolean;
}

export interface PriceFields {
  toCall: number;
  callCost: number;
  minRaiseTo: number;
  maxRaiseTo: number;
  legal: LegalActions;
}

export function derivePrices(actor: PriceInput, currentMaxBet: number, lastRaiseSize: number): PriceFields {
  const toCall = Math.max(0, currentMaxBet - actor.currentBet);
  const callCost = Math.min(Math.max(0, actor.chips), toCall);
  const minRaiseTo = currentMaxBet + lastRaiseSize;
  const maxRaiseTo = actor.currentBet + Math.max(0, actor.chips);
  let canRaise = false;
  let shortAllInOnly = false;
  if (actor.canRaise && actor.chips > 0 && maxRaiseTo > currentMaxBet) {
    canRaise = true;
    shortAllInOnly = maxRaiseTo < minRaiseTo;
  }
  return {
    toCall,
    callCost,
    minRaiseTo,
    maxRaiseTo,
    legal: {
      canFold: true,
      canCheck: toCall === 0,
      canCall: toCall > 0 && actor.chips > 0,
      canRaise,
      shortAllInOnly,
      minRaiseTo: canRaise && !shortAllInOnly ? minRaiseTo : null,
      maxRaiseTo: canRaise ? maxRaiseTo : null,
    },
  };
}

export function isLegalMove(
  fields: Pick<PriceFields, 'legal' | 'minRaiseTo' | 'maxRaiseTo'> & { currentMaxBet: number },
  move: AIAction,
): boolean {
  if (move.action === 'fold') return fields.legal.canFold;
  if (move.action === 'check') return fields.legal.canCheck;
  if (move.action === 'call') return fields.legal.canCall;
  if (!fields.legal.canRaise) return false;
  const raiseTo = move.raiseTo;
  if (!Number.isInteger(raiseTo) || raiseTo <= fields.currentMaxBet) return false;
  if (fields.legal.shortAllInOnly) return raiseTo === fields.maxRaiseTo;
  return raiseTo >= fields.minRaiseTo && raiseTo <= fields.maxRaiseTo;
}
