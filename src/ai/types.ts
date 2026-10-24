/** 下注街。摊牌和空闲不是决策输入。 */
export type BettingStage = 'preflop' | 'flop' | 'turn' | 'river';

export type TableStage = BettingStage | 'idle' | 'showdown';

export type SeatStatus = 'active' | 'folded' | 'all-in' | 'sitting-out';

export type ProfileId = 'ai_0' | 'ai_1' | 'ai_2' | 'loose_passive';

/** 本街公开动作。不含底牌。 */
export interface PublicAction {
  actorId: string;
  stage: BettingStage;
  kind: 'post' | 'fold' | 'check' | 'call' | 'raise';
  /** 加注到的本街总额；盲注记投入额；其他动作为 null */
  to: number | null;
}

export interface PublicPlayer {
  id: string;
  seat: number;
  chips: number;
  currentBet: number;
  invested: number;
  status: SeatStatus;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canRaise: boolean;
  /** 筹码不够一次完整加注时，唯一合法加注目标是 maxRaiseTo */
  shortAllInOnly: boolean;
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
}

export interface StreetSummary {
  /** 本街 kind=raise 的次数，含不足额全下。不能单靠它判断 3bet。 */
  raiseCount: number;
  lastRaiserId: string | null;
  /** 达到最小加注增量的完整加注次数。不足额全下不计入。 */
  fullRaiseCount: number;
  lastFullRaiserId: string | null;
  openerId: string | null;
  openTo: number | null;
  threeBetActorId: string | null;
  threeBetTo: number | null;
}

export interface AIObservation {
  turnToken: string;
  actorId: string;
  actorSeat: number;
  stage: BettingStage;
  holeCards: [string, string];
  board: string[];
  pot: number;
  bigBlind: number;
  dealerIndex: number;
  players: PublicPlayer[];
  /** 牌桌给这个玩家的加注开关，不是最终合法性 */
  canRaise: boolean;
  currentMaxBet: number;
  lastRaiseSize: number;
  toCall: number;
  callCost: number;
  minRaiseTo: number;
  maxRaiseTo: number;
  legal: LegalActions;
  street: StreetSummary;
}

export type AIAction =
  | { action: 'fold' }
  | { action: 'check' }
  | { action: 'call' }
  | { action: 'raise'; raiseTo: number };

export interface AIDecision {
  turnToken: string;
  actorId: string;
  move: AIAction;
}

export interface AIDiagnosis {
  profileId: string;
  street: BettingStage;
  reasonCode: string;
  samples: number;
  equity: number | null;
  evReference: number | null;
  elapsedMs: number;
  assumptions: string[];
  handKey: string | null;
  position: string | null;
  priceTier?: string | null;
  stackDepth?: string | null;
  /** 本次定价参考的对手。没有可参考对手时为 null。旧档案可以缺这个字段。 */
  referenceOpponentId?: string | null;
  /** 策略用的有效深度，单位是大盲。不改变真实可争夺底池。 */
  effectiveStackBb?: number | null;
  /** unopened / facing-open / facing-3bet / facing-4bet-plus / unknown */
  actionContext?: string | null;
  fallback?: boolean;
  rngDraw?: number | null;
}

export type ObservationError =
  | 'not-betting'
  | 'not-acting'
  | 'bad-hole-count'
  | 'bad-board-count'
  | 'bad-card'
  | 'duplicate-card'
  | 'not-enough-cards'
  | 'bad-player';

export interface SourcePlayer {
  id: string;
  chips: number;
  currentBet: number;
  invested: number;
  status: SeatStatus;
  canRaise: boolean;
  cards?: readonly string[];
}

/** 构造快照的输入。deck / gameLog 即使传入也不会进入结果。 */
export interface NpcSourceInput {
  sessionId: string | null;
  handNumber: number;
  decisionRevision: number;
  stage: TableStage;
  pot: number;
  board: readonly string[];
  dealerIndex: number;
  currentPlayerIndex: number;
  currentMaxBet: number;
  lastRaiseSize: number;
  bigBlind: number;
  players: readonly SourcePlayer[];
  streetActions: readonly PublicAction[];
  deck?: readonly string[];
  gameLog?: readonly string[];
}

export interface ObservationSource {
  sessionId: string | null;
  handNumber: number;
  decisionRevision: number;
  stage: TableStage;
  pot: number;
  board: string[];
  dealerIndex: number;
  currentPlayerIndex: number;
  currentMaxBet: number;
  lastRaiseSize: number;
  bigBlind: number;
  players: SourcePlayer[];
  streetActions: PublicAction[];
}

export function isBettingStage(stage: TableStage): stage is BettingStage {
  return stage === 'preflop' || stage === 'flop' || stage === 'turn' || stage === 'river';
}
