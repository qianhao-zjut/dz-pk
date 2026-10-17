import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { claimAct, finishAct, handleActRequest, resetActQueue, submitAct } from './actQueue.mjs';

afterEach(() => {
  resetActQueue();
});

function listen(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    if (!handleActRequest(req, res)) {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('no port');
      resolve({ server, port: address.port });
    });
  });
}

describe('act queue', () => {
  it('页面取走并回报后，提交方得到成功', async () => {
    const pending = submitAct({ action: 'check' }, 1000);
    expect(claimAct()).toEqual({ id: '1', action: 'check' });
    expect(claimAct()).toBeNull();
    expect(finishAct('1', { ok: true })).toBe(true);
    await expect(pending).resolves.toEqual({ status: 200, body: { ok: true, action: 'check' } });
  });

  it('上一条还没结束时，下一条直接 pending', async () => {
    const first = submitAct({ action: 'fold' }, 1000);
    await expect(submitAct({ action: 'call' }, 1000)).resolves.toMatchObject({
      status: 409,
      body: { ok: false, error: 'pending', action: 'call' },
    });
    const cmd = claimAct();
    if (!cmd) throw new Error('missing claim');
    finishAct(cmd.id, { ok: false, error: 'not_your_turn' });
    await expect(first).resolves.toMatchObject({ status: 409, body: { error: 'not_your_turn', action: 'fold' } });
  });

  it('没入座的页面拒绝后，别的页面还能领走', async () => {
    const pending = submitAct({ action: 'deal' }, 1000);
    const first = claimAct('lobby');
    if (!first) throw new Error('missing claim');
    expect(finishAct(first.id, { ok: false, error: 'no_table' })).toBe('retry');
    expect(claimAct('lobby')).toBeNull();
    const second = claimAct('table');
    expect(second?.action).toBe('deal');
    if (!second) throw new Error('missing claim');
    finishAct(second.id, { ok: true });
    await expect(pending).resolves.toEqual({ status: 200, body: { ok: true, action: 'deal' } });
  });

  it('没人来取就超时', async () => {
    await expect(submitAct({ action: 'deal' }, 30)).resolves.toEqual({
      status: 504,
      body: { ok: false, error: 'no_table', action: 'deal' },
    });
  });

  it('POST /api/act 会等到页面执行', async () => {
    const { server, port } = await listen();
    try {
      const posted = fetch(`http://127.0.0.1:${port}/api/act`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'raise', to: 40 }),
      }).then(async (res) => ({ status: res.status, body: await res.json() }));

      const claimed = await new Promise<{ id: string; action: string; to: number }>((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          fetch(`http://127.0.0.1:${port}/api/act`, { headers: { 'X-Dz-Act': '1' } }).then(async (res) => {
            if (res.status === 204) {
              if (Date.now() - started > 1000) reject(new Error('没有取到动作'));
              else setTimeout(tick, 20);
              return;
            }
            resolve(await res.json());
          }).catch(reject);
        };
        tick();
      });
      expect(claimed).toMatchObject({ action: 'raise', to: 40 });

      const stolen = await fetch(`http://127.0.0.1:${port}/api/act`);
      expect(stolen.status).toBe(404);

      const reported = await fetch(`http://127.0.0.1:${port}/api/act/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dz-Act': '1' },
        body: JSON.stringify({ id: claimed.id, ok: true }),
      });
      expect(reported.status).toBe(204);
      await expect(posted).resolves.toEqual({ status: 200, body: { ok: true, action: 'raise' } });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('加注没有 to 时不占住信箱', async () => {
    const { server, port } = await listen();
    try {
      const bad = await fetch(`http://127.0.0.1:${port}/api/act`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'raise' }),
      });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ ok: false, error: 'bad_amount' });

      const pending = submitAct({ action: 'fold' }, 1000);
      const cmd = claimAct();
      expect(cmd?.action).toBe('fold');
      if (!cmd) throw new Error('missing claim');
      finishAct(cmd.id, { ok: true });
      await pending;
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
