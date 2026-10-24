// hand_review 可靠同步：归档事件入队 → 先持久化再 POST → 按 client_key ACK。
// 独立于 game_log 队列；不阻塞牌局；不打印 body/payload/底牌/URL/凭证。
import { create } from 'zustand';
import {
  buildHandReviewRecord,
  parseCompletedHandFromBody,
  type HandReviewRecord,
} from '../game/handReviewRecord';
import type { CompletedHand } from '../game/handRecord';
import { useHandHistoryStore } from './handHistoryStore';
import {
  cloneOutboxSnapshot,
  createDefaultOutboxStorage,
  type HandReviewOutboxItem,
  type HandReviewOutboxStorage,
} from './handReviewOutbox';

const RETRY_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const FLUSH_DELAY_MS = 300;

export interface HandReviewSyncStatus {
  pendingCount: number;
  failedCount: number;
  persistAvailable: boolean;
  lastError: string | null;
}

export const useHandReviewSyncStatus = create<HandReviewSyncStatus>(() => ({
  pendingCount: 0,
  failedCount: 0,
  persistAvailable: true,
  lastError: null,
}));

export type HandReviewFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface HandReviewSyncOptions {
  fetchImpl?: HandReviewFetch;
  storage?: HandReviewOutboxStorage;
  waitForHistoryHydration?: () => Promise<void>;
  getHistoryHands?: () => CompletedHand[];
  subscribeArchives?: (listener: (hands: CompletedHand[]) => void) => () => void;
  requestTimeoutMs?: number;
  retryIntervalMs?: number;
  flushDelayMs?: number;
  /** 测试用：允许再次 init。 */
  force?: boolean;
  /** 测试用：不启动周期定时器。 */
  disableInterval?: boolean;
}

let initialized = false;
let bootEpoch = 0;
let storage: HandReviewOutboxStorage | null = null;
let boundPromise: Promise<void> | null = null;
let resolveBound: (() => void) | null = null;
let fetchImpl: HandReviewFetch = globalThis.fetch.bind(globalThis);
let requestTimeoutMs = REQUEST_TIMEOUT_MS;
let flushDelayMs = FLUSH_DELAY_MS;
let flushing = false;
let flushScheduled = false;
let unsubscribers: Array<() => void> = [];
let intervalId: ReturnType<typeof setInterval> | null = null;
let getHistoryHands: () => CompletedHand[] = () => useHandHistoryStore.getState().hands;

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as object).sort();
    const bKeys = Object.keys(b as object).sort();
    if (aKeys.length !== bKeys.length) return false;
    if (!aKeys.every((key, index) => key === bKeys[index])) return false;
    return aKeys.every((key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return false;
}

function logSync(message: string, detail?: { handId?: string; count?: number; status?: number | string; error?: string }): void {
  const parts = [message];
  if (detail?.handId) parts.push(`hand=${detail.handId}`);
  if (detail?.count != null) parts.push(`count=${detail.count}`);
  if (detail?.status != null) parts.push(`status=${detail.status}`);
  if (detail?.error) parts.push(`error=${detail.error}`);
  console.info(`[handReviewSync] ${parts.join(' ')}`);
}

async function refreshStatus(): Promise<void> {
  if (!storage) return;
  const items = await storage.list();
  const pendingCount = items.filter((item) => item.status === 'pending').length;
  const failedCount = items.filter((item) => item.status === 'failed').length;
  const lastFailed = [...items].reverse().find((item) => item.status === 'failed');
  useHandReviewSyncStatus.setState({
    pendingCount,
    failedCount,
    persistAvailable: storage.persistAvailable,
    lastError: lastFailed?.error ?? null,
  });
}

export function whenHandHistoryHydrated(): Promise<void> {
  const api = useHandHistoryStore.persist;
  if (api.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = api.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
}

function toPostBody(item: HandReviewOutboxItem): Omit<HandReviewRecord, 'ok'> {
  return {
    source: item.source,
    kind: item.kind,
    client_key: item.client_key,
    created_at: item.created_at,
    body: item.body,
    payload: item.payload,
  };
}

async function enqueueHand(hand: CompletedHand): Promise<void> {
  if (!storage) return;
  const snapshot = cloneOutboxSnapshot(hand);
  const built = buildHandReviewRecord(snapshot);
  const clientKey = built.ok
    ? built.client_key
    : `dz-pk:hand_review:${snapshot.sessionId}:${snapshot.handNumber}`;

  if (await storage.getSynced(clientKey)) return;
  const existing = await storage.get(clientKey);
  if (existing) return;

  if (!built.ok) {
    await storage.put({
      client_key: clientKey,
      source: 'dz-pk',
      kind: 'hand_review',
      created_at: snapshot.endedAt,
      body: '',
      payload: {
        schema_version: 1,
        hand_id: snapshot.id,
        session: snapshot.sessionId,
        hand: snapshot.handNumber,
        table: snapshot.config.levelId,
        stage: 'showdown',
        scenario: snapshot.config.scenarioId,
        buy_in_bb: snapshot.config.buyInBb,
        human_net: null,
        snapshot_format: 'completed-hand-json/v1',
        snapshot_location: 'body',
      },
      snapshot,
      status: 'failed',
      error: built.message,
    });
    await refreshStatus();
    logSync('enqueue_failed_local', { handId: snapshot.id, error: built.reasons.join(',') });
    return;
  }

  await storage.put({
    client_key: built.client_key,
    source: built.source,
    kind: built.kind,
    created_at: built.created_at,
    body: built.body,
    payload: built.payload,
    snapshot,
    status: 'pending',
    error: null,
  });
  await refreshStatus();
  scheduleFlush();
}

async function backfillFromHistory(): Promise<void> {
  const hands = getHistoryHands().slice(-20);
  for (const hand of hands) {
    await enqueueHand(hand);
  }
  logSync('backfill_done', { count: hands.length });
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isDeterministicFailure(status: number): boolean {
  return status === 400 || status === 413 || (status >= 400 && status < 500 && status !== 408 && status !== 429);
}

interface ParsedRecord {
  id: string;
  source: unknown;
  kind: unknown;
  body: unknown;
  payload: unknown;
}

function asRecordResponse(value: unknown): ParsedRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== 'string' && typeof obj.id !== 'number') return null;
  return {
    id: String(obj.id),
    source: obj.source,
    kind: obj.kind,
    body: obj.body,
    payload: obj.payload,
  };
}

async function validateSuccessResponse(
  response: Response,
  item: HandReviewOutboxItem,
): Promise<{ ok: true; recordId: string } | { ok: false; reason: string; retryable: boolean }> {
  if (response.status !== 200 && response.status !== 201) {
    if (isRetryableStatus(response.status)) {
      return { ok: false, reason: `http_${response.status}`, retryable: true };
    }
    if (isDeterministicFailure(response.status)) {
      return { ok: false, reason: `http_${response.status}`, retryable: false };
    }
    return { ok: false, reason: `http_${response.status}`, retryable: true };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, reason: 'invalid_json', retryable: true };
  }

  const record = asRecordResponse(json);
  if (!record) {
    return { ok: false, reason: 'shape_mismatch', retryable: false };
  }
  if (record.source !== 'dz-pk' || record.kind !== 'hand_review') {
    return { ok: false, reason: 'identity_mismatch', retryable: false };
  }
  if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
    return { ok: false, reason: 'payload_mismatch', retryable: false };
  }
  const payload = record.payload as Record<string, unknown>;
  if (payload.hand_id !== item.payload.hand_id) {
    return { ok: false, reason: 'hand_id_mismatch', retryable: false };
  }
  if (typeof record.body !== 'string') {
    return { ok: false, reason: 'body_mismatch', retryable: false };
  }
  const parsed = parseCompletedHandFromBody(record.body);
  if (!parsed || !deepEqual(parsed, item.snapshot)) {
    return { ok: false, reason: 'snapshot_mismatch', retryable: false };
  }
  return { ok: true, recordId: record.id };
}

async function postItem(item: HandReviewOutboxItem): Promise<
  | { kind: 'success'; recordId: string }
  | { kind: 'retry'; error: string }
  | { kind: 'fail'; error: string }
> {
  if (!item.body) {
    return { kind: 'fail', error: item.error ?? 'empty_body' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetchImpl('/v1/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toPostBody(item)),
      signal: controller.signal,
    });
    const checked = await validateSuccessResponse(response, item);
    if (checked.ok) return { kind: 'success', recordId: checked.recordId };
    return checked.retryable
      ? { kind: 'retry', error: checked.reason }
      : { kind: 'fail', error: checked.reason };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : 'network_error';
    if (name === 'AbortError') return { kind: 'retry', error: 'timeout' };
    return { kind: 'retry', error: message || 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

async function flush(): Promise<void> {
  if (flushing || !storage) return;
  flushing = true;
  try {
    // 每轮从当前存储读最新队列，避免用旧快照覆盖并发入队项。
    for (;;) {
      const queue = await storage.list();
      const next = queue.find((item) => item.status === 'pending');
      if (!next) break;

      const result = await postItem(next);
      if (result.kind === 'success') {
        await storage.removeByKey(next.client_key);
        await storage.putSynced({
          client_key: next.client_key,
          record_id: result.recordId,
          hand_id: next.payload.hand_id,
        });
        logSync('synced', { handId: next.payload.hand_id, status: 'ok' });
        await refreshStatus();
        continue;
      }
      if (result.kind === 'fail') {
        await storage.put({ ...next, status: 'failed', error: result.error });
        logSync('failed', { handId: next.payload.hand_id, error: result.error });
        await refreshStatus();
        continue;
      }
      logSync('retry_later', { handId: next.payload.hand_id, error: result.error });
      useHandReviewSyncStatus.setState({ lastError: result.error });
      break;
    }
  } finally {
    flushing = false;
  }
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    void flush();
  }, flushDelayMs);
}

function bindArchiveSubscription(subscribeArchives: (listener: (hands: CompletedHand[]) => void) => () => void): void {
  let prevIds = new Set(getHistoryHands().map((hand) => hand.id));
  const unsub = subscribeArchives((hands) => {
    for (const hand of hands) {
      if (!prevIds.has(hand.id)) {
        void enqueueHand(hand);
      }
    }
    // 同一 id 重复 archive（更新）不改已入队快照；新 id 才入队。
    prevIds = new Set(hands.map((hand) => hand.id));
  });
  unsubscribers.push(unsub);
}

function defaultSubscribeArchives(listener: (hands: CompletedHand[]) => void): () => void {
  return useHandHistoryStore.subscribe((state, prev) => {
    if (state.hands !== prev.hands) listener(state.hands);
  });
}

/** 启动 hand_review 同步。main 中调用一次。 */
export function initHandReviewSync(options: HandReviewSyncOptions = {}): void {
  if (initialized && !options.force) return;
  if (initialized && options.force) {
    resetHandReviewSyncForTests();
  }
  initialized = true;

  fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  flushDelayMs = options.flushDelayMs ?? FLUSH_DELAY_MS;
  getHistoryHands = options.getHistoryHands ?? (() => useHandHistoryStore.getState().hands);
  const waitHydration = options.waitForHistoryHydration ?? whenHandHistoryHydrated;
  const subscribeArchives = options.subscribeArchives ?? defaultSubscribeArchives;

  const epoch = ++bootEpoch;
  boundPromise = new Promise<void>((resolve) => {
    resolveBound = resolve;
  });

  void (async () => {
    const nextStorage = options.storage ?? await createDefaultOutboxStorage();
    if (epoch !== bootEpoch) return;
    storage = nextStorage;
    useHandReviewSyncStatus.setState({ persistAvailable: storage.persistAvailable });
    await refreshStatus();
    if (epoch !== bootEpoch) return;

    bindArchiveSubscription(subscribeArchives);
    resolveBound?.();

    await waitHydration();
    if (epoch !== bootEpoch) return;
    await backfillFromHistory();
    if (epoch !== bootEpoch) return;
    scheduleFlush();
  })();

  if (!options.disableInterval) {
    intervalId = setInterval(() => {
      void (async () => {
        if (!storage) return;
        const items = await storage.list();
        if (items.some((item) => item.status === 'pending')) scheduleFlush();
      })();
    }, options.retryIntervalMs ?? RETRY_INTERVAL_MS);
  }
}

/** 手动重试失败项（仍用原 client_key）。 */
export async function retryFailedHandReviews(): Promise<void> {
  if (!storage) return;
  const items = await storage.list();
  for (const item of items) {
    if (item.status === 'failed' && item.body) {
      await storage.put({ ...item, status: 'pending', error: null });
    }
  }
  await refreshStatus();
  scheduleFlush();
  // 立即尝试一轮，便于测试与点击后反馈。
  await flush();
}

export async function getHandReviewOutboxForTests(): Promise<HandReviewOutboxItem[]> {
  if (!storage) return [];
  return storage.list();
}

export async function getSyncedHandReviewsForTests(): Promise<Array<{ client_key: string; record_id: string; hand_id: string }>> {
  if (!storage) return [];
  return storage.listSynced();
}

export async function flushHandReviewSyncForTests(): Promise<void> {
  await flush();
}

export function resetHandReviewSyncForTests(): void {
  for (const unsub of unsubscribers) unsub();
  unsubscribers = [];
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  initialized = false;
  bootEpoch += 1;
  storage = null;
  boundPromise = null;
  resolveBound = null;
  flushing = false;
  flushScheduled = false;
  fetchImpl = globalThis.fetch.bind(globalThis);
  requestTimeoutMs = REQUEST_TIMEOUT_MS;
  flushDelayMs = FLUSH_DELAY_MS;
  getHistoryHands = () => useHandHistoryStore.getState().hands;
  useHandReviewSyncStatus.setState({
    pendingCount: 0,
    failedCount: 0,
    persistAvailable: true,
    lastError: null,
  });
}

/** 测试辅助：直接入队一手（走与 archive 相同路径）。 */
export async function enqueueHandForTests(hand: CompletedHand): Promise<void> {
  await enqueueHand(hand);
}

/** 等待 init 完成 storage 与归档订阅绑定（hydration 补传可能仍在等待）。 */
export async function waitForHandReviewSyncReadyForTests(timeoutMs = 2000): Promise<void> {
  if (!boundPromise) throw new Error('handReviewSync not started');
  await Promise.race([
    boundPromise,
    new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('handReviewSync not ready')), timeoutMs);
    }),
  ]);
}
