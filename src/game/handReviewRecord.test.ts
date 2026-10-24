import { describe, expect, it } from 'vitest';
import { isCompletedHand, type CompletedHand, type RecordedAction } from './handRecord';
import type { NpcActionContext } from '../ai/npcContext';
import {
  HAND_REVIEW_BODY_MAX_BYTES,
  HAND_REVIEW_PAYLOAD_MAX_BYTES,
  buildHandReviewRecord,
  isUploadReadyCompletedHand,
  parseCompletedHandFromBody,
} from './handReviewRecord';

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;

function npc(overrides: Partial<NpcActionContext> = {}): NpcActionContext {
  return {
    turnToken: 'sess-3:3:4:ai_0',
    actorId: 'ai_0',
    reasonCode: 'postflop-value-bet',
    profileId: 'ai_0',
    position: 'BTN',
    handKey: 'AKs',
    priceTier: 'normal',
    stackDepth: '100bb',
    samples: 48,
    equity: 0.137,
    evReference: 1.25,
    assumptions: ['对手按翻前开池范围估算', '未使用真实底牌重算'],
    fallback: false,
    rngDraw: 0.42,
    ...overrides,
  };
}

function action(overrides: Partial<RecordedAction> = {}): RecordedAction {
  return {
    actionSeq: 1,
    actorId: 'ai_0',
    street: 'preflop',
    kind: 'post',
    board: [],
    potBefore: 0,
    currentBetBefore: 0,
    currentMaxBetBefore: 0,
    callCost: 0,
    amountAdded: 1,
    raiseTo: 1,
    raiseIncrement: null,
    allIn: false,
    npc: null,
    ...overrides,
  };
}

function showdownHand(): CompletedHand {
  return {
    version: 1,
    id: 'sess-3:3',
    sessionId: 'sess-3',
    handNumber: 3,
    startedAt: '2026-10-24T04:00:00.000Z',
    endedAt: '2026-10-24T04:02:00.000Z',
    config: {
      version: 1,
      levelId: 't1',
      levelName: '新手桌 ($1/$2)',
      smallBlind: 1,
      bigBlind: 2,
      scenarioId: 'standard',
      buyInBb: 100,
      buyIn: 200,
      opponents: 'mixed',
      npcs: [
        { id: 'ai_0', name: '德州老手', profileId: 'ai_0', style: '稳健' },
        { id: 'ai_1', name: '激进小伙', profileId: 'ai_1', style: '激进' },
        { id: 'ai_2', name: '保守大叔', profileId: 'ai_2', style: '保守' },
      ],
    },
    dealerIndex: 0,
    seats: [
      { id: 'human', name: '你 (Player)', profileId: null, style: null, role: 'BTN', chipsBefore: 200, holeCards: ['As', 'Kd'] },
      { id: 'ai_0', name: '德州老手', profileId: 'ai_0', style: '稳健', role: 'SB', chipsBefore: 200, holeCards: ['Qh', 'Qd'] },
      { id: 'ai_1', name: '激进小伙', profileId: 'ai_1', style: '激进', role: 'BB', chipsBefore: 200, holeCards: ['9c', '8c'] },
      { id: 'ai_2', name: '保守大叔', profileId: 'ai_2', style: '保守', role: 'UTG', chipsBefore: 200, holeCards: ['7h', '2c'] },
    ],
    board: ['Ah', '7d', '2s', 'Jc', '3c'],
    actions: [
      action({ actionSeq: 1, actorId: 'ai_0', amountAdded: 1, raiseTo: 1 }),
      action({ actionSeq: 2, actorId: 'ai_1', amountAdded: 2, raiseTo: 2, potBefore: 1 }),
      action({
        actionSeq: 3,
        actorId: 'ai_2',
        kind: 'fold',
        amountAdded: 0,
        raiseTo: null,
        potBefore: 3,
        currentMaxBetBefore: 2,
      }),
      action({
        actionSeq: 8,
        actorId: 'ai_0',
        street: 'river',
        kind: 'raise',
        board: ['Ah', '7d', '2s', 'Jc', '3c'],
        potBefore: 40,
        currentBetBefore: 0,
        currentMaxBetBefore: 0,
        callCost: 0,
        amountAdded: 20,
        raiseTo: 20,
        raiseIncrement: 20,
        allIn: false,
        npc: npc(),
      }),
    ],
    payouts: [
      { label: '主池', playerId: 'human', amount: 80, kind: 'win' },
      { label: '未跟注退回', playerId: 'ai_0', amount: 5, kind: 'refund' },
    ],
    results: [
      { id: 'human', chips: 240, net: 40 },
      { id: 'ai_0', chips: 185, net: -15 },
      { id: 'ai_1', chips: 190, net: -10 },
      { id: 'ai_2', chips: 200, net: 0 },
    ],
    endKind: 'showdown',
  };
}

function foldHand(): CompletedHand {
  const hand = showdownHand();
  return {
    ...hand,
    id: 'sess-fold:1',
    sessionId: 'sess-fold',
    handNumber: 1,
    endedAt: '2026-10-24T12:26:00.000+08:00',
    config: {
      ...hand.config,
      levelId: 't2',
      levelName: '常规桌 ($2/$5)',
      smallBlind: 2,
      bigBlind: 5,
      scenarioId: 'short',
      buyInBb: 40,
      buyIn: 200,
    },
    board: [],
    seats: hand.seats.map((seat) => (
      seat.id === 'human' ? { ...seat, holeCards: ['Qh', 'Js'], chipsBefore: 200 } : { ...seat, holeCards: [...seat.holeCards] }
    )),
    actions: [
      action({ actionSeq: 1, actorId: 'ai_0', amountAdded: 2, raiseTo: 2, board: [] }),
      action({ actionSeq: 2, actorId: 'ai_1', amountAdded: 5, raiseTo: 5, potBefore: 2, board: [] }),
      action({ actionSeq: 3, actorId: 'human', kind: 'fold', amountAdded: 0, raiseTo: null, potBefore: 7, currentMaxBetBefore: 5, board: [] }),
    ],
    payouts: [{ label: '弃牌赢池', playerId: 'ai_1', amount: 7, kind: 'win' }],
    results: [
      { id: 'human', chips: 195, net: -5 },
      { id: 'ai_0', chips: 198, net: -2 },
      { id: 'ai_1', chips: 207, net: 7 },
      { id: 'ai_2', chips: 200, net: 0 },
    ],
    endKind: 'folds',
  };
}

function jsonFence(body: string): string {
  const open = body.indexOf('\n\n```json\n');
  const close = body.lastIndexOf('\n```');
  return body.slice(open + '\n\n```json\n'.length, close);
}

describe('hand_review v1 记录', () => {
  it('用固定身份、索引 payload 和紧凑 JSON 正文还原摊牌手牌', () => {
    const hand = showdownHand();
    const result = buildHandReviewRecord(hand);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('dz-pk');
    expect(result.kind).toBe('hand_review');
    expect(result.client_key).toBe('dz-pk:hand_review:sess-3:3');
    expect(result.created_at).toBe('2026-10-24T04:02:00.000Z');
    expect(result.payload).toEqual({
      schema_version: 1,
      hand_id: 'sess-3:3',
      session: 'sess-3',
      hand: 3,
      table: 't1',
      stage: 'showdown',
      scenario: 'standard',
      buy_in_bb: 100,
      human_net: 40,
      snapshot_format: 'completed-hand-json/v1',
      snapshot_location: 'body',
    });
    expect(Object.keys(result.payload)).toEqual([
      'schema_version',
      'hand_id',
      'session',
      'hand',
      'table',
      'stage',
      'scenario',
      'buy_in_bb',
      'human_net',
      'snapshot_format',
      'snapshot_location',
    ]);

    const summary = '第 3 手 · 新手桌 ($1/$2) · 100bb · 买入 $200 · 底牌 As Kd · 结果 +$40 · 摊牌';
    const json = JSON.stringify(hand);
    expect(result.body).toBe(`${summary}\n\n\`\`\`json\n${json}\n\`\`\``);
    expect(jsonFence(result.body)).toBe(json);
    expect(parseCompletedHandFromBody(result.body)).toEqual(hand);
    expect(JSON.stringify(result.payload)).not.toContain('holeCards');
    expect(JSON.stringify(result.payload)).not.toContain('As');
    expect(JSON.stringify(result.payload)).not.toContain('assumptions');
    expect(result.body).not.toContain('"deck"');
  });

  it('保留空公共牌、空 assumptions、null 依据、浮点权益和已弃牌底牌', () => {
    const hand = foldHand();
    hand.actions[0] = action({
      ...hand.actions[0],
      npc: npc({
        equity: null,
        evReference: null,
        rngDraw: null,
        assumptions: [],
        position: null,
        handKey: null,
        priceTier: null,
        stackDepth: null,
      }),
    });
    hand.seats = hand.seats.map((seat) => {
      if (seat.id === 'ai_2') return { ...seat, chipsBefore: 19.5, holeCards: ['7h', '2c'] };
      if (seat.id === 'ai_1') return { ...seat, holeCards: [] };
      return seat;
    });
    const folded = hand.results.find((result) => result.id === 'ai_2');
    if (folded) {
      folded.chips = 19.5;
      folded.net = 0;
    }

    const before = JSON.stringify(hand);
    const result = buildHandReviewRecord(hand);
    expect(JSON.stringify(hand)).toBe(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.created_at).toBe('2026-10-24T12:26:00.000+08:00');
    expect(result.client_key).toBe('dz-pk:hand_review:sess-fold:1');
    expect(result.payload.stage).toBe('showdown');
    expect(result.payload.scenario).toBe('short');
    expect(result.payload.buy_in_bb).toBe(40);
    expect(result.payload.table).toBe('t2');
    expect(result.payload.human_net).toBe(-5);
    expect(result.body.startsWith('第 1 手 · 常规桌 ($2/$5) · 40bb · 买入 $200 · 底牌 Qh Js · 结果 -$5 · 弃牌结束\n')).toBe(true);
    expect(result.body).toContain('完整性说明：存在非整数金额或净变化与初末筹码不一致，已保留原值。');

    const parsed = parseCompletedHandFromBody(result.body);
    expect(parsed).toEqual(hand);
    expect(parsed?.board).toEqual([]);
    expect(parsed?.actions[0]?.npc?.equity).toBeNull();
    expect(parsed?.actions[0]?.npc?.assumptions).toEqual([]);
    expect(parsed?.actions[0]?.raiseIncrement).toBeNull();
    expect(parsed?.seats.find((seat) => seat.id === 'ai_2')?.holeCards).toEqual(['7h', '2c']);
    expect(parsed?.seats.find((seat) => seat.id === 'ai_1')?.holeCards).toEqual([]);
    expect(parsed?.seats.find((seat) => seat.id === 'ai_2')?.chipsBefore).toBe(19.5);
    expect(jsonFence(result.body)).not.toContain('Ah');
    expect(result.body.split('\n\n```json\n')[0]).not.toContain('7h');
  });

  it('重复构造不改变 created_at，也不改写原档案', () => {
    const hand = showdownHand();
    const first = buildHandReviewRecord(hand);
    const second = buildHandReviewRecord(hand);
    expect(first.ok).toBe(true);
    expect(first).toEqual(second);
  });

  it('比宽松的 isCompletedHand 更严格，缺字段时不补底牌或 NPC 原因', () => {
    const loose = { version: 1, sessionId: 'sess-3', handNumber: 3, actions: [], seats: [], results: [] };
    expect(isCompletedHand(loose)).toBe(true);
    expect(isUploadReadyCompletedHand(loose)).toBe(false);
    const rejected = buildHandReviewRecord(loose as unknown as CompletedHand);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.reasons).toEqual(['invalid_hand']);
    expect(rejected).not.toHaveProperty('body');
    expect(rejected.message).not.toContain('As');
    expect(rejected.message).not.toContain('翻前弃牌');

    const partialNpc = showdownHand();
    partialNpc.actions[3] = {
      ...partialNpc.actions[3],
      npc: { reasonCode: 'preflop-fold' } as NpcActionContext,
    };
    expect(buildHandReviewRecord(partialNpc).ok).toBe(false);
    const invented = parseCompletedHandFromBody(
      `第 3 手 底牌 As Kd\n\n\`\`\`json\n${JSON.stringify(partialNpc)}\n\`\`\``,
    );
    expect(invented).toBeNull();

    const withReference = showdownHand();
    const npcAction = withReference.actions.find((action) => action.npc);
    if (!npcAction?.npc) throw new Error('缺少 NPC 依据');
    npcAction.npc = {
      ...npcAction.npc,
      referenceOpponentId: 'human',
      effectiveStackBb: 200,
      actionContext: 'facing-open',
    };
    withReference.config = { ...withReference.config, npcConfigVersion: '2026-10-24.2' };
    const built = buildHandReviewRecord(withReference);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(parseCompletedHandFromBody(built.body)).toEqual(withReference);

    const broken = showdownHand();
    const brokenAction = broken.actions.find((action) => action.npc);
    if (!brokenAction?.npc) throw new Error('缺少 NPC 依据');
    brokenAction.npc = { ...brokenAction.npc, referenceOpponentId: '' };
    expect(buildHandReviewRecord(broken).ok).toBe(false);
  });

  it('拒绝带 deck 或 liveHand 的对象，避免把未发牌装进记录', () => {
    const withDeck = { ...showdownHand(), deck: ['Ah', 'Kd', 'Qc'] };
    const withLive = { ...showdownHand(), liveHand: { actions: [] } };
    expect(buildHandReviewRecord(withDeck)).toMatchObject({
      ok: false,
      reasons: ['invalid_hand'],
      message: expect.stringContaining('deck'),
    });
    expect(buildHandReviewRecord(withLive)).toMatchObject({
      ok: false,
      reasons: ['invalid_hand'],
      message: expect.stringContaining('liveHand'),
    });
    expect(parseCompletedHandFromBody(
      `摘要\n\n\`\`\`json\n${JSON.stringify(withDeck)}\n\`\`\``,
    )).toBeNull();
  });

  it('身份不一致时拒绝，不把 id 改写成 session 加手号', () => {
    const hand = showdownHand();
    hand.id = 'other-id';
    const result = buildHandReviewRecord(hand);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toEqual(['invalid_hand']);
    expect(JSON.stringify(result)).not.toContain('dz-pk:hand_review:sess-3:3');
    expect(hand.id).toBe('other-id');
  });

  it('旧小数和异常净变化保留原值，只在摘要附完整性说明', () => {
    const hand = showdownHand();
    hand.config = { ...hand.config, bigBlind: 2.5, buyIn: 19.5 };
    hand.results = hand.results.map((result) => (
      result.id === 'human' ? { ...result, chips: 220, net: 15 } : result
    ));
    const result = buildHandReviewRecord(hand);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.human_net).toBe(15);
    expect(result.payload.buy_in_bb).toBe(100);
    expect(result.body).toContain('买入 $19.5');
    expect(result.body).toContain('结果 +$15');
    expect(result.body).toContain('完整性说明：存在非整数金额或净变化与初末筹码不一致，已保留原值。');
    expect(parseCompletedHandFromBody(result.body)?.config.bigBlind).toBe(2.5);
    expect(parseCompletedHandFromBody(result.body)?.results.find((item) => item.id === 'human')?.net).toBe(15);
    expect(jsonFence(result.body)).toContain('"net":15');
    expect(jsonFence(result.body)).not.toContain('"net":20');
  });

  it('没有人类座位时不把净赢记成 0，也不借用其他底牌', () => {
    const hand = showdownHand();
    hand.seats = hand.seats.filter((seat) => seat.id !== 'human');
    hand.results = hand.results.filter((result) => result.id !== 'human');
    const result = buildHandReviewRecord(hand);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.human_net).toBeNull();
    expect(result.body.startsWith('第 3 手 · 新手桌 ($1/$2) · 100bb · 买入 $200 · 底牌 无人类座位 · 结果 无 · 摊牌\n')).toBe(true);
    expect(result.body.split('\n\n```json\n')[0]).not.toContain('Qh');
  });

  it('旧文本和截断代码段不能还原时返回 null，不补造快照', () => {
    expect(parseCompletedHandFromBody('你的底牌: As Kd\n本手结果 +$40')).toBeNull();
    expect(parseCompletedHandFromBody('')).toBeNull();
    expect(parseCompletedHandFromBody('第 1 手\n\n```json\n{"version":1}\n```')).toBeNull();
    const full = buildHandReviewRecord(showdownHand());
    if (!full.ok) throw new Error('fixture should build');
    expect(parseCompletedHandFromBody(full.body.slice(0, -20))).toBeNull();
    const renamed = full.body.replace(
      '第 3 手 · 新手桌 ($1/$2) · 100bb · 买入 $200 · 底牌 As Kd · 结果 +$40 · 摊牌',
      '家庭电脑上的另一份摘要，没有底牌',
    );
    expect(parseCompletedHandFromBody(renamed)).toEqual(showdownHand());
    const pretty = renamed.replace(jsonFence(renamed), JSON.stringify(showdownHand(), null, 2));
    expect(parseCompletedHandFromBody(pretty)).toEqual(showdownHand());
  });

  it('假设文本里的反引号不会挡住整手还原', () => {
    const hand = showdownHand();
    hand.actions[3] = action({
      ...hand.actions[3],
      npc: npc({ assumptions: ['对手范围含 ``` 代码段', '未使用真实底牌重算'] }),
    });
    const result = buildHandReviewRecord(hand);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(parseCompletedHandFromBody(result.body)).toEqual(hand);
  });

  it('典型手牌和高行动数手牌的 body/payload 按 UTF-8 字节计仍在限额内', () => {
    const typical = buildHandReviewRecord(showdownHand());
    expect(typical.ok).toBe(true);
    if (!typical.ok) return;
    const typicalBody = utf8Bytes(typical.body);
    const typicalPayload = utf8Bytes(JSON.stringify(typical.payload));
    expect(typicalBody).toBeGreaterThan(400);
    expect(typicalBody).toBeLessThanOrEqual(HAND_REVIEW_BODY_MAX_BYTES);
    expect(typicalPayload).toBeLessThanOrEqual(HAND_REVIEW_PAYLOAD_MAX_BYTES);
    expect(typicalPayload).toBeLessThan(1024);

    const heavy = showdownHand();
    heavy.actions = Array.from({ length: 40 }, (_, index) => action({
      actionSeq: index + 1,
      actorId: index % 2 === 0 ? 'ai_0' : 'human',
      street: index < 10 ? 'preflop' : index < 20 ? 'flop' : index < 30 ? 'turn' : 'river',
      kind: 'call',
      board: index < 10 ? [] : ['Ah', '7d', '2s'],
      potBefore: index * 10,
      currentBetBefore: 20,
      currentMaxBetBefore: 40,
      callCost: 20,
      amountAdded: 20,
      raiseTo: null,
      raiseIncrement: null,
      npc: index % 2 === 0 ? npc({ turnToken: `sess-3:3:${index}:ai_0`, assumptions: ['对手按翻前开池范围估算', '未使用真实底牌重算'] }) : null,
    }));
    const built = buildHandReviewRecord(heavy);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const bodyBytes = utf8Bytes(built.body);
    const payloadBytes = utf8Bytes(JSON.stringify(built.payload));
    expect(parseCompletedHandFromBody(built.body)?.actions).toHaveLength(40);
    expect(bodyBytes).toBeGreaterThan(10 * 1024);
    expect(bodyBytes).toBeLessThanOrEqual(HAND_REVIEW_BODY_MAX_BYTES);
    expect(payloadBytes).toBeLessThanOrEqual(HAND_REVIEW_PAYLOAD_MAX_BYTES);
  });

  it('中文把 body 撑过 64KiB 时失败且不截断，字符数仍可能低于上限', () => {
    const hand = showdownHand();
    const note = '注'.repeat(22_000);
    hand.actions[3] = action({
      ...hand.actions[3],
      npc: npc({ assumptions: [note] }),
    });
    const result = buildHandReviewRecord(hand);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toEqual(['body_too_large']);
    expect(result.bodyBytes).toBeGreaterThan(HAND_REVIEW_BODY_MAX_BYTES);
    expect(result.payloadBytes).toBeLessThanOrEqual(HAND_REVIEW_PAYLOAD_MAX_BYTES);
    expect(result.bodyBytes).toBeGreaterThan(note.length);
    expect(result.message).toContain('未截断');
    expect(result).not.toHaveProperty('body');
    expect(hand.actions[3]?.npc?.assumptions[0]).toHaveLength(22_000);
  });

  it('中文 table 标识把 payload 撑过 16KiB 时失败，且不因为字符数较短而放过', () => {
    const hand = showdownHand();
    hand.config = { ...hand.config, levelId: '桌'.repeat(6_000) };
    const result = buildHandReviewRecord(hand);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toEqual(['payload_too_large']);
    expect(result.payloadBytes).toBeGreaterThan(HAND_REVIEW_PAYLOAD_MAX_BYTES);
    expect(result.payloadBytes).toBeGreaterThan('桌'.repeat(6_000).length);
    expect(result.bodyBytes).toBeLessThanOrEqual(HAND_REVIEW_BODY_MAX_BYTES);
    expect(result.message).toContain('未截断');
    expect(result).not.toHaveProperty('payload');
    expect(hand.config.levelId).toHaveLength(6_000);
  });

  it('body 和 payload 同时超限时同时标记，仍不返回可上传记录', () => {
    const hand = showdownHand();
    const sessionId = 's'.repeat(40_000);
    hand.sessionId = sessionId;
    hand.id = `${sessionId}:3`;
    const result = buildHandReviewRecord(hand);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toEqual(['body_too_large', 'payload_too_large']);
    expect(result.bodyBytes).toBeGreaterThan(HAND_REVIEW_BODY_MAX_BYTES);
    expect(result.payloadBytes).toBeGreaterThan(HAND_REVIEW_PAYLOAD_MAX_BYTES);
    expect(result).not.toHaveProperty('body');
    expect(result).not.toHaveProperty('client_key');
  });
});
