import type { NpcActionContext } from './npcContext';
import { makeTurnToken } from './observation';
import { derivePrices, isLegalMove } from './prices';
import { isBettingStage, type AIAction, type AIDecision, type LegalActions, type ObservationSource, type SeatStatus } from './types';

export interface LiveTurn {
  tableExists: boolean;
  betting: boolean;
  actorId: string | null;
  actorStatus: SeatStatus | null;
  turnToken: string;
  toCall: number;
  callCost: number;
  currentMaxBet: number;
  minRaiseTo: number;
  maxRaiseTo: number;
  legal: LegalActions;
}

export interface NpcTableActions {
  fold: (ctx?: NpcActionContext) => void;
  check: (ctx?: NpcActionContext) => void;
  call: (ctx?: NpcActionContext) => void;
  raise: (raiseTo: number, ctx?: NpcActionContext) => void;
}

export type ExecuteResult =
  | { ok: true; applied: AIAction }
  | { ok: false; reason: 'stale' | 'no-table' | 'illegal-fallback'; applied?: AIAction };

const NO_LEGAL: LegalActions = {
  canFold: false,
  canCheck: false,
  canCall: false,
  canRaise: false,
  shortAllInOnly: false,
  minRaiseTo: null,
  maxRaiseTo: null,
};

export function emptyLive(): LiveTurn {
  return {
    tableExists: false,
    betting: false,
    actorId: null,
    actorStatus: null,
    turnToken: '',
    toCall: 0,
    callCost: 0,
    currentMaxBet: 0,
    minRaiseTo: 0,
    maxRaiseTo: 0,
    legal: NO_LEGAL,
  };
}

export function liveTurnFrom(source: ObservationSource): LiveTurn {
  const actor = source.players[source.currentPlayerIndex];
  if (!actor || !isBettingStage(source.stage)) {
    return { ...emptyLive(), tableExists: true };
  }
  const prices = derivePrices(actor, source.currentMaxBet, source.lastRaiseSize);
  return {
    tableExists: true,
    betting: true,
    actorId: actor.id,
    actorStatus: actor.status,
    turnToken: makeTurnToken(source.sessionId, source.handNumber, source.decisionRevision, actor.id),
    toCall: prices.toCall,
    callCost: prices.callCost,
    currentMaxBet: source.currentMaxBet,
    minRaiseTo: prices.minRaiseTo,
    maxRaiseTo: prices.maxRaiseTo,
    legal: prices.legal,
  };
}

function apply(move: AIAction, actions: NpcTableActions, ctx?: NpcActionContext): void {
  if (move.action === 'fold') actions.fold(ctx);
  else if (move.action === 'check') actions.check(ctx);
  else if (move.action === 'call') actions.call(ctx);
  else actions.raise(move.raiseTo, ctx);
}

function asFallback(ctx: NpcActionContext | undefined, move: AIAction): NpcActionContext | undefined {
  if (!ctx) return undefined;
  return {
    ...ctx,
    fallback: true,
    reasonCode: move.action === 'check' ? 'fallback-check' : 'fallback-fold',
    equity: null,
    evReference: null,
  };
}

/** 先核对轮次和金额，再调用牌桌动作。过期结果不会改用兜底动作打到新的一轮。 */
export function executeDecision(
  decision: AIDecision,
  readLive: () => LiveTurn,
  actions: NpcTableActions,
  context?: NpcActionContext,
): ExecuteResult {
  const live = readLive();
  if (!live.tableExists) return { ok: false, reason: 'no-table' };
  if (!live.betting || live.actorStatus !== 'active' || live.actorId !== decision.actorId || live.turnToken !== decision.turnToken) {
    return { ok: false, reason: 'stale' };
  }
  if (!isLegalMove(live, decision.move)) {
    const move: AIAction = live.legal.canCheck ? { action: 'check' } : { action: 'fold' };
    if (!isLegalMove(live, move)) return { ok: false, reason: 'stale' };
    apply(move, actions, asFallback(context, move));
    return { ok: false, reason: 'illegal-fallback', applied: move };
  }
  apply(decision.move, actions, context);
  return { ok: true, applied: decision.move };
}
