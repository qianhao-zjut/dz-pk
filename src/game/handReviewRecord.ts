// 从已完成的 CompletedHand 构造 hand_review v1 记录。纯函数，不发请求、不改原档案。
import { handId, type CompletedHand } from './handRecord';
import type { ScenarioId } from './sessionConfig';

export const HAND_REVIEW_BODY_MAX_BYTES = 64 * 1024;
export const HAND_REVIEW_PAYLOAD_MAX_BYTES = 16 * 1024;

const INTEGRITY_NOTE = '完整性说明：存在非整数金额或净变化与初末筹码不一致，已保留原值。';
const JSON_OPEN = '\n\n```json\n';
const JSON_CLOSE = '\n```';

const STREETS = new Set(['preflop', 'flop', 'turn', 'river']);
const ACTION_KINDS = new Set(['post', 'fold', 'check', 'call', 'raise']);
const ROLES = new Set(['BTN', 'SB', 'BB', 'UTG']);

export type HandReviewFailureCode = 'invalid_hand' | 'body_too_large' | 'payload_too_large';

export interface HandReviewPayload {
  schema_version: 1;
  hand_id: string;
  session: string;
  hand: number;
  table: string;
  stage: 'showdown';
  scenario: ScenarioId;
  buy_in_bb: number;
  human_net: number | null;
  snapshot_format: 'completed-hand-json/v1';
  snapshot_location: 'body';
}

export interface HandReviewRecord {
  ok: true;
  source: 'dz-pk';
  kind: 'hand_review';
  client_key: string;
  created_at: string;
  body: string;
  payload: HandReviewPayload;
}

export interface HandReviewBuildFailure {
  ok: false;
  reasons: HandReviewFailureCode[];
  message: string;
  bodyBytes: number | null;
  payloadBytes: number | null;
}

export type HandReviewBuildResult = HandReviewRecord | HandReviewBuildFailure;

export function isUploadReadyCompletedHand(value: unknown): value is CompletedHand {
  return uploadIssues(value).length === 0;
}

export function buildHandReviewRecord(hand: CompletedHand): HandReviewBuildResult {
  if (!isUploadReadyCompletedHand(hand)) {
    return {
      ok: false,
      reasons: ['invalid_hand'],
      message: `手牌档案不完整，不能构造 hand_review：${uploadIssues(hand).join('、')}`,
      bodyBytes: null,
      payloadBytes: null,
    };
  }

  const body = renderBody(hand);
  const payload = renderPayload(hand);
  const bodyBytes = utf8Bytes(body);
  const payloadBytes = utf8Bytes(JSON.stringify(payload));
  const reasons: Array<'body_too_large' | 'payload_too_large'> = [];
  if (bodyBytes > HAND_REVIEW_BODY_MAX_BYTES) reasons.push('body_too_large');
  if (payloadBytes > HAND_REVIEW_PAYLOAD_MAX_BYTES) reasons.push('payload_too_large');
  if (reasons.length > 0) {
    const parts: string[] = [];
    if (bodyBytes > HAND_REVIEW_BODY_MAX_BYTES) parts.push(`body 超过 64KiB（UTF-8 ${bodyBytes} 字节），未截断`);
    if (payloadBytes > HAND_REVIEW_PAYLOAD_MAX_BYTES) parts.push(`payload 超过 16KiB（UTF-8 ${payloadBytes} 字节），未截断`);
    return { ok: false, reasons, message: parts.join('；'), bodyBytes, payloadBytes };
  }

  return {
    ok: true,
    source: 'dz-pk',
    kind: 'hand_review',
    client_key: `dz-pk:hand_review:${hand.sessionId}:${hand.handNumber}`,
    created_at: hand.endedAt,
    body,
    payload,
  };
}

/** 代码段里的 JSON 能通过上传校验时返回原档案；旧文本或缺字段时返回 null，不补造。 */
export function parseCompletedHandFromBody(body: string): CompletedHand | null {
  if (typeof body !== 'string') return null;
  const openAt = body.indexOf(JSON_OPEN);
  if (openAt < 0 || body.indexOf(JSON_OPEN, openAt + JSON_OPEN.length) !== -1) return null;
  if (!body.endsWith(JSON_CLOSE)) return null;
  const jsonText = body.slice(openAt + JSON_OPEN.length, -JSON_CLOSE.length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  return isUploadReadyCompletedHand(parsed) ? parsed : null;
}

function renderBody(hand: CompletedHand): string {
  const summary = [
    `第 ${hand.handNumber} 手`,
    hand.config.levelName,
    `${hand.config.buyInBb}bb`,
    `买入 $${hand.config.buyIn}`,
    `底牌 ${holeText(hand)}`,
    `结果 ${netText(hand)}`,
    hand.endKind === 'folds' ? '弃牌结束' : '摊牌',
  ].join(' · ');
  const prefix = hasIntegrityIssue(hand) ? `${summary}\n${INTEGRITY_NOTE}` : summary;
  return `${prefix}${JSON_OPEN}${JSON.stringify(hand)}${JSON_CLOSE}`;
}

function renderPayload(hand: CompletedHand): HandReviewPayload {
  const human = hand.results.find((result) => result.id === 'human');
  return {
    schema_version: 1,
    hand_id: hand.id,
    session: hand.sessionId,
    hand: hand.handNumber,
    table: hand.config.levelId,
    stage: 'showdown',
    scenario: hand.config.scenarioId,
    buy_in_bb: hand.config.buyInBb,
    human_net: human ? human.net : null,
    snapshot_format: 'completed-hand-json/v1',
    snapshot_location: 'body',
  };
}

function holeText(hand: CompletedHand): string {
  const human = hand.seats.find((seat) => seat.id === 'human');
  if (!human) return '无人类座位';
  if (human.holeCards.length === 0) return '无';
  return human.holeCards.join(' ');
}

function netText(hand: CompletedHand): string {
  const human = hand.results.find((result) => result.id === 'human');
  if (!human) return '无';
  if (human.net > 0) return `+$${human.net}`;
  if (human.net < 0) return `-$${Math.abs(human.net)}`;
  return '$0';
}

function hasIntegrityIssue(hand: CompletedHand): boolean {
  const money = [
    hand.config.smallBlind,
    hand.config.bigBlind,
    hand.config.buyInBb,
    hand.config.buyIn,
  ];
  for (const seat of hand.seats) money.push(seat.chipsBefore);
  for (const action of hand.actions) {
    money.push(action.potBefore, action.currentBetBefore, action.currentMaxBetBefore, action.callCost, action.amountAdded);
    if (action.raiseTo !== null) money.push(action.raiseTo);
    if (action.raiseIncrement !== null) money.push(action.raiseIncrement);
  }
  for (const payout of hand.payouts) money.push(payout.amount);
  for (const result of hand.results) {
    money.push(result.chips, result.net);
    const seat = hand.seats.find((item) => item.id === result.id);
    if (seat && result.net !== result.chips - seat.chipsBefore) return true;
  }
  return money.some((value) => !Number.isSafeInteger(value));
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function uploadIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['hand'];
  const issues: string[] = [];
  if ('deck' in value) issues.push('deck');
  if ('liveHand' in value) issues.push('liveHand');
  if (value.version !== 1) issues.push('version');
  if (typeof value.sessionId !== 'string' || value.sessionId === '') issues.push('sessionId');
  if (!Number.isSafeInteger(value.handNumber) || (value.handNumber as number) < 1) issues.push('handNumber');
  if (typeof value.id !== 'string' || value.id === '') issues.push('id');
  else if (typeof value.sessionId === 'string' && Number.isSafeInteger(value.handNumber) && value.id !== handId(value.sessionId, value.handNumber as number)) {
    issues.push('id');
  }
  if (!isTimestamp(value.startedAt)) issues.push('startedAt');
  if (!isTimestamp(value.endedAt)) issues.push('endedAt');
  issues.push(...configIssues(value.config));
  if (!Number.isSafeInteger(value.dealerIndex) || (value.dealerIndex as number) < 0) issues.push('dealerIndex');
  issues.push(...seatIssues(value.seats, value.results));
  if (!isStringArray(value.board)) issues.push('board');
  issues.push(...actionIssues(value.actions));
  issues.push(...payoutIssues(value.payouts));
  if (value.endKind !== 'folds' && value.endKind !== 'showdown') issues.push('endKind');
  return issues;
}

function configIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['config'];
  const issues: string[] = [];
  if (value.version !== 1) issues.push('config.version');
  if (typeof value.levelId !== 'string' || value.levelId === '') issues.push('config.levelId');
  if (typeof value.levelName !== 'string' || value.levelName === '') issues.push('config.levelName');
  for (const key of ['smallBlind', 'bigBlind', 'buyInBb', 'buyIn'] as const) {
    if (!isFiniteNumber(value[key])) issues.push(`config.${key}`);
  }
  if (!isScenario(value.scenarioId)) issues.push('config.scenarioId');
  if (value.opponents !== 'mixed' && value.opponents !== 'loose' && value.opponents !== 'tight') issues.push('config.opponents');
  if (!Array.isArray(value.npcs) || value.npcs.some((seat) => !isNpcSeat(seat))) issues.push('config.npcs');
  if ('npcConfigVersion' in value && (typeof value.npcConfigVersion !== 'string' || value.npcConfigVersion === '')) {
    issues.push('config.npcConfigVersion');
  }
  return issues;
}

function seatIssues(seats: unknown, results: unknown): string[] {
  if (!Array.isArray(seats) || seats.length === 0) return ['seats'];
  const issues: string[] = [];
  seats.forEach((seat, index) => {
    if (!isSeat(seat)) issues.push(`seats[${index}]`);
  });
  if (!Array.isArray(results) || results.some((result) => !isResult(result))) {
    issues.push('results');
    return issues;
  }
  const resultIds = new Set(results.map((result) => (result as { id: string }).id));
  seats.forEach((seat, index) => {
    if (isRecord(seat) && typeof seat.id === 'string' && !resultIds.has(seat.id)) issues.push(`seats[${index}].result`);
  });
  return issues;
}

function actionIssues(value: unknown): string[] {
  if (!Array.isArray(value)) return ['actions'];
  const issues: string[] = [];
  value.forEach((action, index) => {
    if (!isAction(action)) issues.push(`actions[${index}]`);
  });
  return issues;
}

function payoutIssues(value: unknown): string[] {
  if (!Array.isArray(value)) return ['payouts'];
  const issues: string[] = [];
  value.forEach((payout, index) => {
    if (!isPayout(payout)) issues.push(`payouts[${index}]`);
  });
  return issues;
}

function isSeat(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && value.id !== ''
    && typeof value.name === 'string'
    && (value.profileId === null || typeof value.profileId === 'string')
    && (value.style === null || typeof value.style === 'string')
    && ROLES.has(value.role as string)
    && isFiniteNumber(value.chipsBefore)
    && isStringArray(value.holeCards);
}

function isAction(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Number.isSafeInteger(value.actionSeq)
    && typeof value.actorId === 'string'
    && value.actorId !== ''
    && STREETS.has(value.street as string)
    && ACTION_KINDS.has(value.kind as string)
    && isStringArray(value.board)
    && isFiniteNumber(value.potBefore)
    && isFiniteNumber(value.currentBetBefore)
    && isFiniteNumber(value.currentMaxBetBefore)
    && isFiniteNumber(value.callCost)
    && isFiniteNumber(value.amountAdded)
    && (value.raiseTo === null || isFiniteNumber(value.raiseTo))
    && (value.raiseIncrement === null || isFiniteNumber(value.raiseIncrement))
    && typeof value.allIn === 'boolean'
    && (value.npc === null || isNpcContext(value.npc));
}

function isNpcContext(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.turnToken === 'string'
    && typeof value.actorId === 'string'
    && typeof value.reasonCode === 'string'
    && typeof value.profileId === 'string'
    && isNullableString(value.position)
    && isNullableString(value.handKey)
    && isNullableString(value.priceTier)
    && isNullableString(value.stackDepth)
    && isFiniteNumber(value.samples)
    && (value.equity === null || isFiniteNumber(value.equity))
    && (value.evReference === null || isFiniteNumber(value.evReference))
    && (value.rngDraw === null || isFiniteNumber(value.rngDraw))
    && isStringArray(value.assumptions)
    && typeof value.fallback === 'boolean'
    && optionalNullableId(value, 'referenceOpponentId')
    && optionalNullableNumber(value, 'effectiveStackBb')
    && optionalNullableId(value, 'actionContext');
}

function optionalNullableId(value: Record<string, unknown>, key: string): boolean {
  if (!(key in value)) return true;
  return value[key] === null || (typeof value[key] === 'string' && value[key] !== '');
}

function optionalNullableNumber(value: Record<string, unknown>, key: string): boolean {
  if (!(key in value)) return true;
  return value[key] === null || isFiniteNumber(value[key]);
}

function isPayout(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.label === 'string'
    && typeof value.playerId === 'string'
    && value.playerId !== ''
    && isFiniteNumber(value.amount)
    && (value.kind === 'win' || value.kind === 'refund');
}

function isResult(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && value.id !== ''
    && isFiniteNumber(value.chips)
    && isFiniteNumber(value.net);
}

function isNpcSeat(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && value.id !== ''
    && typeof value.name === 'string'
    && typeof value.profileId === 'string'
    && value.profileId !== ''
    && typeof value.style === 'string';
}

function isScenario(value: unknown): value is ScenarioId {
  return value === 'standard' || value === 'short' || value === 'deep';
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
