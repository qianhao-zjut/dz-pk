import { useBankrollStore } from '../store/bankrollStore';
import { useGameStore } from '../store/gameStore';
import { applyExternalAction, type ActCommand } from './applyAction';

function clientHeaders(): Record<string, string> {
  return { 'X-Dz-Act': '1', 'X-Dz-Client': clientId() };
}

function clientId(): string {
  try {
    const key = 'dz-pk-act-client';
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = Math.random().toString(36).slice(2);
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'page';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 取一条待执行动作。没有则返回 false。 */
export async function pollActOnce(): Promise<boolean> {
  if (!useGameStore.getState().table) return false;
  const res = await fetch('/api/act', { headers: clientHeaders() });
  if (res.status === 204) return false;
  if (!res.ok) return false;

  const cmd = (await res.json()) as ActCommand;
  const result = applyExternalAction(cmd, (amount) => useBankrollStore.getState().deductFunds(amount));
  await postResult({ id: cmd.id, ...result });
  return true;
}

async function postResult(payload: unknown): Promise<void> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch('/api/act/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...clientHeaders() },
        body: JSON.stringify(payload),
      });
      if (res.status === 204 || res.status === 404) return;
    } catch {
      // 页面已经执行过了，只是结果还没送回。再试几次。
    }
    await sleep(200);
  }
}

/** 页面开着就一直领动作。重复调用不会开第二条循环。 */
export function initActClient(): void {
  const marker = window as Window & { __dzPkActClient?: boolean };
  if (marker.__dzPkActClient) return;
  marker.__dzPkActClient = true;
  void (async () => {
    for (;;) {
      try {
        const worked = await pollActOnce();
        if (!worked) await sleep(300);
      } catch {
        await sleep(1000);
      }
    }
  })();
}
