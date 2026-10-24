// hand_review 待发 outbox：按 client_key 原子写入/删除。
// 优先 IndexedDB；其次 localStorage + Web Locks；再不行仅内存并标记无法持久化。
import type { CompletedHand } from '../game/handRecord';
import type { HandReviewPayload } from '../game/handReviewRecord';

export const HAND_REVIEW_OUTBOX_LS_KEY = 'dz-pk-hand-review-queue';
export const HAND_REVIEW_SYNCED_LS_KEY = 'dz-pk-hand-review-synced';
export const HAND_REVIEW_OUTBOX_LOCK = 'dz-pk-hand-review-outbox';
export const HAND_REVIEW_IDB_NAME = 'dz-pk-hand-review-outbox';
export const HAND_REVIEW_IDB_STORE = 'items';
export const HAND_REVIEW_IDB_SYNCED = 'synced';

export type OutboxItemStatus = 'pending' | 'failed';

export interface HandReviewOutboxItem {
  client_key: string;
  source: 'dz-pk';
  kind: 'hand_review';
  created_at: string;
  body: string;
  payload: HandReviewPayload;
  /** 入队时深复制的完整档案，独立于 20 手展示历史。 */
  snapshot: CompletedHand;
  status: OutboxItemStatus;
  error: string | null;
}

export interface SyncedHandMeta {
  client_key: string;
  record_id: string;
  hand_id: string;
}

export interface HandReviewOutboxStorage {
  readonly persistAvailable: boolean;
  get(clientKey: string): Promise<HandReviewOutboxItem | null>;
  put(item: HandReviewOutboxItem): Promise<void>;
  /** 从当前队列按 key 移除；并发入队的其它项必须保留。 */
  removeByKey(clientKey: string): Promise<void>;
  list(): Promise<HandReviewOutboxItem[]>;
  getSynced(clientKey: string): Promise<SyncedHandMeta | null>;
  putSynced(meta: SyncedHandMeta): Promise<void>;
  listSynced(): Promise<SyncedHandMeta[]>;
}

function deepCloneHand(hand: CompletedHand): CompletedHand {
  return JSON.parse(JSON.stringify(hand)) as CompletedHand;
}

export function cloneOutboxSnapshot(hand: CompletedHand): CompletedHand {
  return deepCloneHand(hand);
}

/** 测试与回退用的内存存储。 */
export function createMemoryOutboxStorage(persistAvailable = true): HandReviewOutboxStorage {
  const items = new Map<string, HandReviewOutboxItem>();
  const synced = new Map<string, SyncedHandMeta>();
  return {
    persistAvailable,
    async get(clientKey) {
      return items.get(clientKey) ?? null;
    },
    async put(item) {
      items.set(item.client_key, {
        ...item,
        snapshot: deepCloneHand(item.snapshot),
        payload: { ...item.payload },
        body: item.body,
      });
    },
    async removeByKey(clientKey) {
      items.delete(clientKey);
    },
    async list() {
      return [...items.values()].map((item) => ({
        ...item,
        snapshot: deepCloneHand(item.snapshot),
        payload: { ...item.payload },
      }));
    },
    async getSynced(clientKey) {
      return synced.get(clientKey) ?? null;
    },
    async putSynced(meta) {
      synced.set(meta.client_key, { ...meta });
    },
    async listSynced() {
      return [...synced.values()].map((item) => ({ ...item }));
    },
  };
}

type LockFn = (name: string, callback: () => Promise<void>) => Promise<void>;

function webLocks(): LockFn | null {
  const locks = (globalThis as { navigator?: { locks?: { request: (name: string, cb: () => Promise<void>) => Promise<void> } } }).navigator?.locks;
  if (!locks || typeof locks.request !== 'function') return null;
  return (name, callback) => locks.request(name, callback);
}

function createLocalStorageOutbox(lock: LockFn): HandReviewOutboxStorage {
  const readQueue = (): HandReviewOutboxItem[] => {
    try {
      const raw = localStorage.getItem(HAND_REVIEW_OUTBOX_LS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const writeQueue = (queue: HandReviewOutboxItem[]) => {
    localStorage.setItem(HAND_REVIEW_OUTBOX_LS_KEY, JSON.stringify(queue));
  };
  const readSynced = (): SyncedHandMeta[] => {
    try {
      const raw = localStorage.getItem(HAND_REVIEW_SYNCED_LS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const writeSynced = (list: SyncedHandMeta[]) => {
    localStorage.setItem(HAND_REVIEW_SYNCED_LS_KEY, JSON.stringify(list));
  };

  const withLock = async <T>(fn: () => T): Promise<T> => {
    let result!: T;
    await lock(HAND_REVIEW_OUTBOX_LOCK, async () => {
      result = fn();
    });
    return result;
  };

  return {
    persistAvailable: true,
    async get(clientKey) {
      return withLock(() => readQueue().find((item) => item.client_key === clientKey) ?? null);
    },
    async put(item) {
      await withLock(() => {
        const queue = readQueue();
        const next = queue.filter((entry) => entry.client_key !== item.client_key);
        next.push({
          ...item,
          snapshot: deepCloneHand(item.snapshot),
          payload: { ...item.payload },
        });
        writeQueue(next);
      });
    },
    async removeByKey(clientKey) {
      await withLock(() => {
        writeQueue(readQueue().filter((item) => item.client_key !== clientKey));
      });
    },
    async list() {
      return withLock(() => readQueue().map((item) => ({
        ...item,
        snapshot: deepCloneHand(item.snapshot),
        payload: { ...item.payload },
      })));
    },
    async getSynced(clientKey) {
      return withLock(() => readSynced().find((item) => item.client_key === clientKey) ?? null);
    },
    async putSynced(meta) {
      await withLock(() => {
        const list = readSynced().filter((item) => item.client_key !== meta.client_key);
        list.push({ ...meta });
        writeSynced(list);
      });
    },
    async listSynced() {
      return withLock(() => readSynced().map((item) => ({ ...item })));
    },
  };
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HAND_REVIEW_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HAND_REVIEW_IDB_STORE)) {
        db.createObjectStore(HAND_REVIEW_IDB_STORE, { keyPath: 'client_key' });
      }
      if (!db.objectStoreNames.contains(HAND_REVIEW_IDB_SYNCED)) {
        db.createObjectStore(HAND_REVIEW_IDB_SYNCED, { keyPath: 'client_key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb_open_failed'));
  });
}

function idbReq<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('idb_request_failed'));
  });
}

function createIndexedDbOutbox(): HandReviewOutboxStorage {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = () => {
    if (!dbPromise) dbPromise = openIdb();
    return dbPromise;
  };

  return {
    persistAvailable: true,
    async get(clientKey) {
      const database = await db();
      return idbReq(database.transaction(HAND_REVIEW_IDB_STORE, 'readonly').objectStore(HAND_REVIEW_IDB_STORE).get(clientKey)) as Promise<HandReviewOutboxItem | null>;
    },
    async put(item) {
      const database = await db();
      const stored: HandReviewOutboxItem = {
        ...item,
        snapshot: deepCloneHand(item.snapshot),
        payload: { ...item.payload },
      };
      await idbReq(database.transaction(HAND_REVIEW_IDB_STORE, 'readwrite').objectStore(HAND_REVIEW_IDB_STORE).put(stored));
    },
    async removeByKey(clientKey) {
      const database = await db();
      await idbReq(database.transaction(HAND_REVIEW_IDB_STORE, 'readwrite').objectStore(HAND_REVIEW_IDB_STORE).delete(clientKey));
    },
    async list() {
      const database = await db();
      const all = await idbReq(database.transaction(HAND_REVIEW_IDB_STORE, 'readonly').objectStore(HAND_REVIEW_IDB_STORE).getAll()) as HandReviewOutboxItem[];
      return (all ?? []).map((item) => ({
        ...item,
        snapshot: deepCloneHand(item.snapshot),
        payload: { ...item.payload },
      }));
    },
    async getSynced(clientKey) {
      const database = await db();
      return idbReq(database.transaction(HAND_REVIEW_IDB_SYNCED, 'readonly').objectStore(HAND_REVIEW_IDB_SYNCED).get(clientKey)) as Promise<SyncedHandMeta | null>;
    },
    async putSynced(meta) {
      const database = await db();
      await idbReq(database.transaction(HAND_REVIEW_IDB_SYNCED, 'readwrite').objectStore(HAND_REVIEW_IDB_SYNCED).put({ ...meta }));
    },
    async listSynced() {
      const database = await db();
      const all = await idbReq(database.transaction(HAND_REVIEW_IDB_SYNCED, 'readonly').objectStore(HAND_REVIEW_IDB_SYNCED).getAll()) as SyncedHandMeta[];
      return (all ?? []).map((item) => ({ ...item }));
    },
  };
}

async function probeIdb(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  try {
    const database = await openIdb();
    database.close();
    return true;
  } catch {
    return false;
  }
}

function probeLocalStorage(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const probe = '__duck_hand_review_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** 选择可用持久化；都失败时返回内存队列并 persistAvailable=false。 */
export async function createDefaultOutboxStorage(): Promise<HandReviewOutboxStorage> {
  if (await probeIdb()) {
    try {
      return createIndexedDbOutbox();
    } catch {
      // fall through
    }
  }
  const lock = webLocks();
  if (lock && probeLocalStorage()) {
    try {
      const storage = createLocalStorageOutbox(lock);
      await storage.list();
      return storage;
    } catch {
      // fall through
    }
  }
  return createMemoryOutboxStorage(false);
}
