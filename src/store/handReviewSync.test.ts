import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompletedHand, RecordedAction } from '../game/handRecord';
import type { NpcActionContext } from '../ai/npcContext';
import { buildHandReviewRecord } from '../game/handReviewRecord';
import {
  HAND_REVIEW_OUTBOX_LS_KEY,
  createMemoryOutboxStorage,
  type HandReviewOutboxStorage,
} from './handReviewOutbox';
import {
  enqueueHandForTests,
  flushHandReviewSyncForTests,
  getHandReviewOutboxForTests,
  getSyncedHandReviewsForTests,
  initHandReviewSync,
  resetHandReviewSyncForTests,
  retryFailedHandReviews,
  useHandReviewSyncStatus,
  waitForHandReviewSyncReadyForTests,
} from './handReviewSync';
import { resetHandHistoryForTests, useHandHistoryStore } from './handHistoryStore';

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
    assumptions: ['对手按翻前开池范围估算'],
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

function sampleHand(n: number, sessionId = 'sess-sync'): CompletedHand {
  return {
    version: 1,
    id: `${sessionId}:${n}`,
    sessionId,
    handNumber: n,
    startedAt: '2026-10-24T04:00:00.000Z',
    endedAt: `2026-10-24T04:${String(n).padStart(2, '0')}:00.000Z`,
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
      action({
        actionSeq: 8,
        actorId: 'ai_0',
        street: 'river',
        kind: 'raise',
        board: ['Ah', '7d', '2s', 'Jc', '3c'],
        potBefore: 40,
        amountAdded: 20,
        raiseTo: 20,
        raiseIncrement: 20,
        npc: npc(),
      }),
    ],
    payouts: [{ label: '主池', playerId: 'human', amount: 80, kind: 'win' }],
    results: [
      { id: 'human', chips: 240, net: 40 },
      { id: 'ai_0', chips: 185, net: -15 },
      { id: 'ai_1', chips: 190, net: -10 },
      { id: 'ai_2', chips: 200, net: 0 },
    ],
    endKind: 'showdown',
  };
}

function successResponse(hand: CompletedHand, id = 'rec-1', status = 201): Response {
  const built = buildHandReviewRecord(hand);
  if (!built.ok) throw new Error('fixture build failed');
  return new Response(JSON.stringify({
    id,
    source: built.source,
    kind: built.kind,
    body: built.body,
    payload: built.payload,
    created_at: built.created_at,
  }), { status, headers: { 'Content-Type': 'application/json' } });
}

function installMemoryLocalStorage(): void {
  if (typeof globalThis.localStorage !== 'undefined') return;
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, String(value)); },
      removeItem: (key: string) => { map.delete(key); },
      clear: () => { map.clear(); },
    },
  });
}

function boot(opts: Parameters<typeof initHandReviewSync>[0] = {}) {
  const storage = opts.storage ?? createMemoryOutboxStorage(true);
  const fetchImpl = opts.fetchImpl ?? vi.fn(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { payload: { hand_id: string }; body: string };
    const { parseCompletedHandFromBody } = await import('../game/handReviewRecord');
    const parsed = parseCompletedHandFromBody(body.body);
    if (!parsed) throw new Error('bad fixture body');
    return successResponse(parsed, `rec-${body.payload.hand_id}`, 201);
  });
  initHandReviewSync({
    force: true,
    disableInterval: true,
    flushDelayMs: 0,
    waitForHistoryHydration: async () => {},
    getHistoryHands: () => [],
    ...opts,
    storage,
    fetchImpl,
  });
  return { storage, fetchImpl };
}

beforeEach(() => {
  resetHandReviewSyncForTests();
  resetHandHistoryForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  resetHandReviewSyncForTests();
  resetHandHistoryForTests();
});

describe('handReviewSync outbox', () => {
  it('归档后先入队再请求，201 校验通过后按 key 移除并保存 record id', async () => {
    const hand = sampleHand(1);
    const fetchImpl = vi.fn(async () => successResponse(hand, 'rid-1', 201));
    const storage = createMemoryOutboxStorage(true);
    boot({ storage, fetchImpl, getHistoryHands: () => [] });
    await waitForHandReviewSyncReadyForTests();

    await enqueueHandForTests(hand);
    expect((await getHandReviewOutboxForTests()).map((item) => item.client_key)).toEqual([
      'dz-pk:hand_review:sess-sync:1',
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();

    await flushHandReviewSyncForTests();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const posted = JSON.parse(String(call[1].body));
    expect(posted.client_key).toBe('dz-pk:hand_review:sess-sync:1');
    expect(posted.source).toBe('dz-pk');
    expect(posted.kind).toBe('hand_review');

    expect(await getHandReviewOutboxForTests()).toEqual([]);
    expect(await getSyncedHandReviewsForTests()).toEqual([
      { client_key: 'dz-pk:hand_review:sess-sync:1', record_id: 'rid-1', hand_id: 'sess-sync:1' },
    ]);
    expect(useHandReviewSyncStatus.getState().pendingCount).toBe(0);
  });

  it('200 幂等成功同样 ACK，且不因重复入队创建第二项', async () => {
    const hand = sampleHand(2);
    const fetchImpl = vi.fn(async () => successResponse(hand, 'rid-2', 200));
    boot({ fetchImpl });
    await waitForHandReviewSyncReadyForTests();
    await enqueueHandForTests(hand);
    await enqueueHandForTests(hand);
    expect(await getHandReviewOutboxForTests()).toHaveLength(1);
    await flushHandReviewSyncForTests();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await getSyncedHandReviewsForTests()).toHaveLength(1);
    await enqueueHandForTests(hand);
    expect(await getHandReviewOutboxForTests()).toHaveLength(0);
  });

  it('ACK 先写 synced 再删队列：remove 与 synced 之间入队不会变成 pending+synced', async () => {
    const hand = sampleHand(1);
    const base = createMemoryOutboxStorage(true);
    let releaseAfterRemove!: () => void;
    const afterRemoveGate = new Promise<void>((resolve) => { releaseAfterRemove = resolve; });
    let removeStarted = false;
    const storage: HandReviewOutboxStorage = {
      persistAvailable: base.persistAvailable,
      get: (key) => base.get(key),
      put: (item) => base.put(item),
      list: () => base.list(),
      getSynced: (key) => base.getSynced(key),
      listSynced: () => base.listSynced(),
      putSynced: (meta) => base.putSynced(meta),
      async removeByKey(clientKey) {
        await base.removeByKey(clientKey);
        removeStarted = true;
        // 模拟旧顺序 remove→putSynced 的中间窗口；新顺序此时 synced 已存在。
        await afterRemoveGate;
      },
    };
    const fetchImpl = vi.fn(async () => successResponse(hand, 'rid-race', 201));
    boot({ storage, fetchImpl });
    await waitForHandReviewSyncReadyForTests();

    await enqueueHandForTests(hand);
    const flushPromise = flushHandReviewSyncForTests();
    await vi.waitFor(() => expect(removeStarted).toBe(true));

    // 窗口内再次入队：若先 remove 后 synced，会重 put 并在后续 flush 多 POST。
    await enqueueHandForTests(hand);
    expect(await getHandReviewOutboxForTests()).toEqual([]);
    expect(await getSyncedHandReviewsForTests()).toEqual([
      { client_key: 'dz-pk:hand_review:sess-sync:1', record_id: 'rid-race', hand_id: hand.id },
    ]);

    releaseAfterRemove();
    await flushPromise;
    expect(await getHandReviewOutboxForTests()).toEqual([]);
    await flushHandReviewSyncForTests();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('A 发送期间 B 入队，ACK 只按 key 移除 A，不丢 B', async () => {
    const handA = sampleHand(1);
    const handB = sampleHand(2);
    let releaseA!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => { releaseA = resolve; });
    let calls = 0;
    const fetchImpl = vi.fn(async (_url, init) => {
      calls += 1;
      const posted = JSON.parse(String(init?.body)) as { payload: { hand_id: string } };
      if (posted.payload.hand_id === handA.id) {
        return gate;
      }
      // B 先失败保留在队列，便于观察 ACK A 时没有被旧快照 slice 丢掉。
      return new Response('', { status: 503 });
    });
    boot({ fetchImpl, flushDelayMs: 0 });
    await waitForHandReviewSyncReadyForTests();

    await enqueueHandForTests(handA);
    const flushA = flushHandReviewSyncForTests();
    await vi.waitFor(() => expect(calls).toBe(1));

    await enqueueHandForTests(handB);
    expect((await getHandReviewOutboxForTests()).map((item) => item.payload.hand_id).sort()).toEqual([
      handA.id,
      handB.id,
    ]);

    releaseA(successResponse(handA, 'rid-a', 201));
    await flushA;
    expect((await getHandReviewOutboxForTests()).map((item) => item.payload.hand_id)).toEqual([handB.id]);
    expect(await getSyncedHandReviewsForTests()).toEqual([
      { client_key: 'dz-pk:hand_review:sess-sync:1', record_id: 'rid-a', hand_id: handA.id },
    ]);
  });

  it('等待 hydration 后再补传，补传不弹回顾且可重复 init 幂等', async () => {
    const hand = sampleHand(3);
    let resolveHydration!: () => void;
    const hydration = new Promise<void>((resolve) => { resolveHydration = resolve; });
    let hands: CompletedHand[] = [];
    // 503 避免补传后立刻 ACK，便于断言队列
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
    const listeners: Array<(next: CompletedHand[]) => void> = [];

    boot({
      fetchImpl,
      waitForHistoryHydration: () => hydration,
      getHistoryHands: () => hands,
      subscribeArchives: (listener) => {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
    });
    await waitForHandReviewSyncReadyForTests();
    expect(await getHandReviewOutboxForTests()).toEqual([]);
    expect(useHandHistoryStore.getState().pendingAutoOpenId).toBeNull();

    hands = [hand];
    resolveHydration();
    await vi.waitFor(async () => {
      expect(await getHandReviewOutboxForTests()).toHaveLength(1);
    });
    expect(useHandHistoryStore.getState().pendingAutoOpenId).toBeNull();

    // 同一 storage 上再次补传：幂等，不增加第二项
    await enqueueHandForTests(hand);
    expect(await getHandReviewOutboxForTests()).toHaveLength(1);
    expect(listeners).toHaveLength(1);
  });

  it('展示历史裁到 20 手不影响 outbox 待发项', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
    boot({ fetchImpl });
    await waitForHandReviewSyncReadyForTests();
    for (let n = 1; n <= 25; n += 1) {
      await enqueueHandForTests(sampleHand(n));
    }
    expect(await getHandReviewOutboxForTests()).toHaveLength(25);
    await flushHandReviewSyncForTests();
    expect(await getHandReviewOutboxForTests()).toHaveLength(25);
  });

  it('400/413 标失败且不阻塞后续手牌', async () => {
    const bad = sampleHand(1);
    const good = sampleHand(2);
    const fetchImpl = vi.fn(async (_url, init) => {
      const posted = JSON.parse(String(init?.body)) as { payload: { hand_id: string } };
      if (posted.payload.hand_id === bad.id) {
        return new Response(JSON.stringify({ error: 'too_large' }), { status: 413 });
      }
      return successResponse(good, 'rid-good', 201);
    });
    boot({ fetchImpl });
    await waitForHandReviewSyncReadyForTests();
    await enqueueHandForTests(bad);
    await enqueueHandForTests(good);
    await flushHandReviewSyncForTests();

    const queue = await getHandReviewOutboxForTests();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.status).toBe('failed');
    expect(queue[0]?.error).toBe('http_413');
    expect(queue[0]?.client_key).toBe('dz-pk:hand_review:sess-sync:1');
    expect(await getSyncedHandReviewsForTests()).toEqual([
      { client_key: 'dz-pk:hand_review:sess-sync:2', record_id: 'rid-good', hand_id: good.id },
    ]);
    expect(useHandReviewSyncStatus.getState().failedCount).toBe(1);
  });

  it('请求超时保留 pending，可稍后重试', async () => {
    const hand = sampleHand(1);
    const fetchImpl = vi.fn(async (_url, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });
    boot({ fetchImpl, requestTimeoutMs: 20 });
    await waitForHandReviewSyncReadyForTests();
    await enqueueHandForTests(hand);
    await flushHandReviewSyncForTests();
    const queue = await getHandReviewOutboxForTests();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.status).toBe('pending');
  });

  it('错误 200/201（身份或内容不符）不能标成功，保留原 key', async () => {
    const hand = sampleHand(1);
    const built = buildHandReviewRecord(hand);
    if (!built.ok) throw new Error('build');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: 'bad',
      source: 'other',
      kind: 'hand_review',
      body: built.body,
      payload: built.payload,
    }), { status: 201 }));
    boot({ fetchImpl });
    await waitForHandReviewSyncReadyForTests();
    await enqueueHandForTests(hand);
    await flushHandReviewSyncForTests();
    const queue = await getHandReviewOutboxForTests();
    expect(queue[0]?.status).toBe('failed');
    expect(queue[0]?.error).toBe('identity_mismatch');
    expect(queue[0]?.client_key).toBe(built.client_key);
    expect(await getSyncedHandReviewsForTests()).toEqual([]);
  });

  it('body 还原与待发快照不一致时失败', async () => {
    const hand = sampleHand(1);
    const other = sampleHand(2);
    const built = buildHandReviewRecord(hand);
    const otherBuilt = buildHandReviewRecord(other);
    if (!built.ok || !otherBuilt.ok) throw new Error('build');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: 'x',
      source: 'dz-pk',
      kind: 'hand_review',
      body: otherBuilt.body,
      payload: built.payload,
    }), { status: 201 }));
    boot({ fetchImpl });
    await waitForHandReviewSyncReadyForTests();
    await enqueueHandForTests(hand);
    await flushHandReviewSyncForTests();
    expect((await getHandReviewOutboxForTests())[0]?.error).toBe('snapshot_mismatch');
  });

  it('存储不可持久化时仍可内存同步，并暴露 persistAvailable=false', async () => {
    installMemoryLocalStorage();
    const hand = sampleHand(1);
    const fetchImpl = vi.fn(async () => successResponse(hand, 'rid-mem', 201));
    const storage = createMemoryOutboxStorage(false);
    boot({ storage, fetchImpl });
    await waitForHandReviewSyncReadyForTests();
    expect(useHandReviewSyncStatus.getState().persistAvailable).toBe(false);
    await enqueueHandForTests(hand);
    await flushHandReviewSyncForTests();
    expect(await getSyncedHandReviewsForTests()).toHaveLength(1);
    expect(localStorage.getItem(HAND_REVIEW_OUTBOX_LS_KEY)).toBeNull();
  });

  it('入队深复制：之后改原对象不影响待发快照', async () => {
    const hand = sampleHand(1);
    boot({ fetchImpl: vi.fn(async () => new Response('', { status: 503 })) });
    await waitForHandReviewSyncReadyForTests();
    await enqueueHandForTests(hand);
    hand.board.push('Xx');
    hand.seats[0]!.holeCards[0] = 'CHANGED';
    const queued = (await getHandReviewOutboxForTests())[0]!;
    expect(queued.snapshot.board).toEqual(['Ah', '7d', '2s', 'Jc', '3c']);
    expect(queued.snapshot.seats[0]?.holeCards[0]).toBe('As');
  });

  it('手动重试把 failed 恢复为 pending 并用原 key 再发', async () => {
    const hand = sampleHand(1);
    let status = 400;
    const fetchImpl = vi.fn(async () => {
      if (status === 400) return new Response('{}', { status: 400 });
      return successResponse(hand, 'rid-retry', 200);
    });
    boot({ fetchImpl });
    await waitForHandReviewSyncReadyForTests();
    await enqueueHandForTests(hand);
    await flushHandReviewSyncForTests();
    expect((await getHandReviewOutboxForTests())[0]?.status).toBe('failed');

    status = 200;
    await retryFailedHandReviews();
    expect(await getHandReviewOutboxForTests()).toEqual([]);
    expect(await getSyncedHandReviewsForTests()).toEqual([
      { client_key: 'dz-pk:hand_review:sess-sync:1', record_id: 'rid-retry', hand_id: hand.id },
    ]);
  });

  it('重复初始化不会注册两套订阅导致双倍请求', async () => {
    const hand = sampleHand(1);
    const fetchImpl = vi.fn(async () => successResponse(hand, 'rid', 201));
    const handsRef = { current: [] as CompletedHand[] };
    const listeners: Array<(hands: CompletedHand[]) => void> = [];
    const storage = createMemoryOutboxStorage(true);

    const opts = {
      force: true as const,
      storage,
      fetchImpl,
      disableInterval: true as const,
      flushDelayMs: 0,
      waitForHistoryHydration: async () => {},
      getHistoryHands: () => handsRef.current,
      subscribeArchives: (listener: (hands: CompletedHand[]) => void) => {
        listeners.push(listener);
        return () => {
          const i = listeners.indexOf(listener);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
    };
    initHandReviewSync(opts);
    await waitForHandReviewSyncReadyForTests();
    initHandReviewSync({ ...opts, force: false }); // no force → no-op
    expect(listeners).toHaveLength(1);

    handsRef.current = [hand];
    for (const listener of listeners) listener(handsRef.current);
    await vi.waitFor(async () => expect(await getSyncedHandReviewsForTests()).toHaveLength(1));
    // 再通知一次同一手，不应再发请求
    for (const listener of listeners) listener(handsRef.current);
    await flushHandReviewSyncForTests();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('localStorage outbox 在锁内按 key 删除，不覆盖并发写入', async () => {
    installMemoryLocalStorage();
    const lockCalls: string[] = [];
    const fakeLocks = {
      request: async (_name: string, cb: () => Promise<void>) => {
        lockCalls.push('enter');
        await cb();
        lockCalls.push('exit');
      },
    };
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { locks: fakeLocks },
    });
    localStorage.removeItem(HAND_REVIEW_OUTBOX_LS_KEY);

    const { createDefaultOutboxStorage } = await import('./handReviewOutbox');
    const originalIdb = globalThis.indexedDB;
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });

    const storage = await createDefaultOutboxStorage();
    expect(storage.persistAvailable).toBe(true);

    const a = sampleHand(1);
    const b = sampleHand(2);
    const builtA = buildHandReviewRecord(a);
    const builtB = buildHandReviewRecord(b);
    if (!builtA.ok || !builtB.ok) throw new Error('build');

    await storage.put({
      client_key: builtA.client_key,
      source: 'dz-pk',
      kind: 'hand_review',
      created_at: builtA.created_at,
      body: builtA.body,
      payload: builtA.payload,
      snapshot: a,
      status: 'pending',
      error: null,
    });
    await storage.put({
      client_key: builtB.client_key,
      source: 'dz-pk',
      kind: 'hand_review',
      created_at: builtB.created_at,
      body: builtB.body,
      payload: builtB.payload,
      snapshot: b,
      status: 'pending',
      error: null,
    });
    await storage.removeByKey(builtA.client_key);
    const left = await storage.list();
    expect(left.map((item) => item.client_key)).toEqual([builtB.client_key]);
    expect(lockCalls.length).toBeGreaterThan(0);

    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: originalIdb });
  });

  it('真实 archive 入队，且不碰 game_log 队列 key', async () => {
    installMemoryLocalStorage();
    localStorage.removeItem('dz-pk-game-log-queue');
    const hand = sampleHand(9);
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
    boot({
      fetchImpl,
      getHistoryHands: () => useHandHistoryStore.getState().hands,
      // 使用默认 hands 订阅
      subscribeArchives: undefined,
    });
    await waitForHandReviewSyncReadyForTests();
    useHandHistoryStore.getState().archive(hand);
    await vi.waitFor(async () => {
      expect(await getHandReviewOutboxForTests()).toHaveLength(1);
    });
    expect(localStorage.getItem('dz-pk-game-log-queue')).toBeNull();
    expect(useHandHistoryStore.getState().pendingAutoOpenId).toBeNull();
  });

  it('控制台日志不含 body、底牌或 /v1 地址', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    const hand = sampleHand(1);
    boot({ fetchImpl: vi.fn(async () => successResponse(hand, 'rid', 201)) });
    await waitForHandReviewSyncReadyForTests();
    await enqueueHandForTests(hand);
    await flushHandReviewSyncForTests();
    const joined = lines.join('\n');
    expect(joined).toContain('handReviewSync');
    expect(joined).not.toContain('As');
    expect(joined).not.toContain('```json');
    expect(joined).not.toContain('/v1/records');
    expect(joined).not.toContain(hand.seats[0]!.holeCards.join(' '));
    spy.mockRestore();
  });
});
