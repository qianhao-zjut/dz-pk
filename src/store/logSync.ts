// 对局日志推送：把 gameLog 的每一行作为一条记录推送到记录库（sqlite-lib）。
//
// 方案要点（与用户对齐）：
// - 每个动作一条记录：kind=game_log，source=dz-pk，body=日志行文本
// - payload 带归属三元组 {session, table, hand, seq, stage}，家庭电脑按 (session, hand) 分组、按 seq 排序还原一手
// - client_key = dz-pk:game_log:{session}:{hand}:{seq}，重试幂等，重复提交返回原记录不插第二行
// - 浏览器请求同源 /v1/records：线上由 dz-pk nginx 反代到 recordstore:8787，
//   本地 dev 由 vite middleware 转发（RECORDSTORE_URL，默认 http://127.0.0.1:8787）
// - best-effort：失败进 localStorage 队列，新日志产生、页面加载、每 60s 兜底重试，绝不阻塞游戏
import { useGameStore } from './gameStore';

const QUEUE_KEY = 'dz-pk-game-log-queue';
const KIND = 'game_log';
const SOURCE = 'dz-pk';
const RETRY_INTERVAL_MS = 60_000;

interface QueuedRecord {
  source: string;
  kind: string;
  body: string;
  payload: Record<string, unknown>;
  created_at: string;
  client_key: string;
}

// 已入队位置：当前手牌编号 + 该手已入队的行数（gameLog 每手重置，按下标对齐即可）
let trackedHand = -1;
let enqueuedCount = 0;
let flushScheduled = false;
let flushing = false;

function loadQueue(): QueuedRecord[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedRecord[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage 满或不可用时放弃持久化，内存队列仍在本次页面生命周期内有效
  }
}

function enqueueNewLines(): void {
  const s = useGameStore.getState();
  if (!s.table || !s.sessionId) return;
  if (s.handNumber !== trackedHand) {
    trackedHand = s.handNumber;
    enqueuedCount = 0;
  }
  if (s.gameLog.length <= enqueuedCount) return;

  const queue = loadQueue();
  for (let i = enqueuedCount; i < s.gameLog.length; i++) {
    queue.push({
      source: SOURCE,
      kind: KIND,
      body: s.gameLog[i],
      payload: {
        session: s.sessionId,
        table: s.table.id,
        hand: s.handNumber,
        seq: i,
        stage: s.stage,
      },
      created_at: new Date().toISOString(),
      client_key: `dz-pk:game_log:${s.sessionId}:${s.handNumber}:${i}`,
    });
  }
  enqueuedCount = s.gameLog.length;
  saveQueue(queue);
  scheduleFlush();
}

async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let queue = loadQueue();
    while (queue.length > 0) {
      try {
        const resp = await fetch('/v1/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(queue[0]),
        });
        if (!resp.ok) throw new Error(`recordstore ${resp.status}`);
      } catch {
        // 推送失败：保留队列，静默等待下次重试
        break;
      }
      queue = queue.slice(1);
      saveQueue(queue);
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
  }, 300);
}

/** 启动日志推送。模块级调用一次即可（main.tsx）。 */
export function initLogSync(): void {
  useGameStore.subscribe((state, prev) => {
    if (state.gameLog !== prev.gameLog || state.handNumber !== prev.handNumber) {
      enqueueNewLines();
    }
  });
  // 页面加载：补推上次未推完的队列
  scheduleFlush();
  // 周期兜底重试
  setInterval(() => {
    if (loadQueue().length > 0) scheduleFlush();
  }, RETRY_INTERVAL_MS);
}
