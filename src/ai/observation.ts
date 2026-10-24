import { cardProblem } from './cards';
import { derivePrices } from './prices';
import {
  isBettingStage,
  type AIObservation,
  type NpcSourceInput,
  type ObservationError,
  type ObservationSource,
  type PublicPlayer,
  type StreetSummary,
} from './types';

export function makeTurnToken(
  sessionId: string | null,
  handNumber: number,
  decisionRevision: number,
  actorId: string,
): string {
  return `${sessionId ?? ''}:${handNumber}:${decisionRevision}:${actorId}`;
}

/** 复制公开字段。不读取、不保留牌堆、原始日志或其他人的底牌。 */
export function toNpcSource(input: NpcSourceInput): ObservationSource {
  const actorIndex = input.currentPlayerIndex;
  return {
    sessionId: input.sessionId,
    handNumber: input.handNumber,
    decisionRevision: input.decisionRevision,
    stage: input.stage,
    pot: input.pot,
    board: [...input.board],
    dealerIndex: input.dealerIndex,
    currentPlayerIndex: actorIndex,
    currentMaxBet: input.currentMaxBet,
    lastRaiseSize: input.lastRaiseSize,
    bigBlind: input.bigBlind,
    streetActions: input.streetActions.map((action) => ({ ...action })),
    players: input.players.map((player, seat) => {
      const copy = {
        id: player.id,
        chips: player.chips,
        currentBet: player.currentBet,
        invested: player.invested,
        status: player.status,
        canRaise: player.canRaise,
      };
      if (seat === actorIndex && player.cards) {
        return { ...copy, cards: player.cards.slice(0, 2) };
      }
      return copy;
    }),
  };
}

const EMPTY_STREET: StreetSummary = {
  raiseCount: 0,
  lastRaiserId: null,
  fullRaiseCount: 0,
  lastFullRaiserId: null,
  openerId: null,
  openTo: null,
  threeBetActorId: null,
  threeBetTo: null,
};

/** 用公开动作和最小加注增量区分完整加注与不足额全下。不读取底牌。 */
export function summarizeStreet(
  stage: NpcSourceInput['stage'],
  actions: readonly NpcSourceInput['streetActions'][number][],
  bigBlind: number,
): StreetSummary {
  if (!isBettingStage(stage)) return { ...EMPTY_STREET };
  let currentMax = 0;
  let minIncrement = bigBlind > 0 ? bigBlind : 0;
  const raw: Array<{ actorId: string; to: number }> = [];
  const full: Array<{ actorId: string; to: number }> = [];
  for (const action of actions) {
    if (action.stage !== stage) continue;
    if (action.kind === 'post') {
      if (action.to != null && action.to > currentMax) currentMax = action.to;
      continue;
    }
    if (action.kind !== 'raise' || action.to == null) continue;
    raw.push({ actorId: action.actorId, to: action.to });
    const increment = action.to - currentMax;
    const complete = increment > 0 && (minIncrement <= 0 || increment >= minIncrement);
    if (complete) {
      full.push({ actorId: action.actorId, to: action.to });
      minIncrement = increment;
      currentMax = action.to;
    } else if (action.to > currentMax) {
      currentMax = action.to;
    }
  }
  const last = raw[raw.length - 1];
  const lastFull = full[full.length - 1];
  const open = full[0];
  const threeBet = full[1];
  return {
    raiseCount: raw.length,
    lastRaiserId: last ? last.actorId : null,
    fullRaiseCount: full.length,
    lastFullRaiserId: lastFull ? lastFull.actorId : null,
    openerId: open ? open.actorId : null,
    openTo: open ? open.to : null,
    threeBetActorId: threeBet ? threeBet.actorId : null,
    threeBetTo: threeBet ? threeBet.to : null,
  };
}

function streetSummary(source: Pick<NpcSourceInput, 'stage' | 'streetActions' | 'bigBlind'>): StreetSummary {
  return summarizeStreet(source.stage, source.streetActions, source.bigBlind);
}

export function buildObservation(
  source: NpcSourceInput,
): { ok: true; observation: AIObservation } | { ok: false; error: ObservationError } {
  if (!isBettingStage(source.stage)) return { ok: false, error: 'not-betting' };
  const actor = source.players[source.currentPlayerIndex];
  if (!actor) return { ok: false, error: 'bad-player' };
  if (actor.status !== 'active') return { ok: false, error: 'not-acting' };
  const hole = actor.cards ? [...actor.cards] : [];
  const opponents = source.players.filter(
    (player, seat) => seat !== source.currentPlayerIndex && (player.status === 'active' || player.status === 'all-in'),
  ).length;
  const problem = cardProblem(hole, source.board, source.stage, opponents);
  if (problem) return { ok: false, error: problem };
  if (new Set(source.players.map((player) => player.id)).size !== source.players.length) {
    return { ok: false, error: 'bad-player' };
  }

  const prices = derivePrices(actor, source.currentMaxBet, source.lastRaiseSize);
  const players: PublicPlayer[] = source.players.map((player, seat) => ({
    id: player.id,
    seat,
    chips: player.chips,
    currentBet: player.currentBet,
    invested: player.invested,
    status: player.status,
  }));

  const observation: AIObservation = {
    turnToken: makeTurnToken(source.sessionId, source.handNumber, source.decisionRevision, actor.id),
    actorId: actor.id,
    actorSeat: source.currentPlayerIndex,
    stage: source.stage,
    holeCards: [hole[0], hole[1]],
    board: [...source.board],
    pot: source.pot,
    bigBlind: source.bigBlind,
    dealerIndex: source.dealerIndex,
    players,
    canRaise: actor.canRaise,
    currentMaxBet: source.currentMaxBet,
    lastRaiseSize: source.lastRaiseSize,
    toCall: prices.toCall,
    callCost: prices.callCost,
    minRaiseTo: prices.minRaiseTo,
    maxRaiseTo: prices.maxRaiseTo,
    legal: prices.legal,
    street: streetSummary(source),
  };
  return { ok: true, observation };
}
