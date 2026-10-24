import type { NpcActionContext } from '../ai/npcContext';
import type { BettingStage } from '../ai/types';
import type { SessionSnapshot } from './sessionConfig';
import type { SeatRole } from './positions';

export const HAND_RECORD_VERSION = 1;

export interface RecordedSeat {
  id: string;
  name: string;
  profileId: string | null;
  style: string | null;
  role: SeatRole;
  chipsBefore: number;
  holeCards: string[];
}

export interface RecordedAction {
  actionSeq: number;
  actorId: string;
  street: BettingStage;
  kind: 'post' | 'fold' | 'check' | 'call' | 'raise';
  board: string[];
  potBefore: number;
  currentBetBefore: number;
  currentMaxBetBefore: number;
  callCost: number;
  amountAdded: number;
  raiseTo: number | null;
  raiseIncrement: number | null;
  allIn: boolean;
  npc: NpcActionContext | null;
}

export interface PotPayout {
  label: string;
  playerId: string;
  amount: number;
  kind: 'win' | 'refund';
}

export interface HandResultSeat {
  id: string;
  chips: number;
  net: number;
}

export interface CompletedHand {
  version: 1;
  id: string;
  sessionId: string;
  handNumber: number;
  startedAt: string;
  endedAt: string;
  config: SessionSnapshot;
  dealerIndex: number;
  seats: RecordedSeat[];
  board: string[];
  actions: RecordedAction[];
  payouts: PotPayout[];
  results: HandResultSeat[];
  endKind: 'folds' | 'showdown';
}

export interface LiveHand {
  sessionId: string;
  handNumber: number;
  startedAt: string;
  config: SessionSnapshot;
  dealerIndex: number;
  seats: RecordedSeat[];
  actions: RecordedAction[];
}

export function handId(sessionId: string, handNumber: number): string {
  return `${sessionId}:${handNumber}`;
}

export function isCompletedHand(value: unknown): value is CompletedHand {
  if (!value || typeof value !== 'object') return false;
  const hand = value as Partial<CompletedHand>;
  return hand.version === 1
    && typeof hand.sessionId === 'string'
    && typeof hand.handNumber === 'number'
    && Array.isArray(hand.actions)
    && Array.isArray(hand.seats)
    && Array.isArray(hand.results);
}

const REASONS: Record<string, string> = {
  'preflop-open-raise': '翻前开池加注',
  'preflop-isolate': '翻前隔离加注',
  'preflop-limp-call': '翻前跟入盲注',
  'preflop-open-fold': '翻前不开池',
  'preflop-three-bet': '翻前价值再加注',
  'preflop-three-bet-mix': '翻前中间牌混合再加注',
  'preflop-three-bet-bluff': '翻前诈唬再加注',
  'preflop-call': '翻前跟注',
  'preflop-fold': '翻前弃牌',
  'preflop-check': '翻前过牌',
  'preflop-four-bet': '翻前四注',
  'preflop-call-reraise': '翻前跟注再加注',
  'postflop-raise': '翻后加注',
  'postflop-call': '翻后跟注',
  'postflop-fold': '翻后弃牌',
  'postflop-check': '翻后过牌',
  'postflop-value-bet': '翻后价值下注',
  'postflop-bluff': '翻后诈唬',
  'fallback-fold': '安全降级弃牌',
  'fallback-check': '安全降级过牌',
  'equity-fallback': '权益估计失败后的安全动作',
};

export function reasonText(code: string, fallback: boolean): string {
  if (fallback) return REASONS[code] ?? '安全降级';
  return REASONS[code] ?? code;
}

export function practiceTip(role: SeatRole): string {
  const where = role === 'BB' ? '大盲' : role === 'BTN' ? '按钮' : role === 'SB' ? '小盲' : '枪口';
  return `${where}的通用提示：跟注门槛看的是补齐金额占跟注后可争夺底池的比例，不是对手那一枪占下注前底池的比例。这不代表某次弃牌一定错。`;
}
