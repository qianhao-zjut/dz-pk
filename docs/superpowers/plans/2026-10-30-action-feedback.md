# 座位行动标签与短音效 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 四家座位用一行中文显示本街最后一次主动行动，并在行动和轮到你时播放短音效，且可以关掉。

**Architecture:** `seatActionLabel` 从 `streetActions` 和座位状态算出文案。`actionSoundGate` 比较前后帧，决定播哪一声，以及是否延迟「轮到你」。Web Audio 合成和 `localStorage` 开关放在浏览器适配层，不进 store。`GameTable` 只负责渲染标签、按钮，并把当前帧交给闸门。

**Tech Stack:** TypeScript、React 19、Zustand、Vitest、Web Audio API。不新增依赖。

## Global Constraints

- 直接在 `main` 提交。不建分支、worktree 或 PR。不删除用户文件。
- 不做弃牌收牌、筹码飞行、粒子、震屏或筹码堆。
- 盲注 `post` 不写标签，不播放声音。黄色本街金额保持原样。
- 不从 `gameLog` 反推行动。不改 `PublicAction` 字段。跟注的 `to` 仍是 `null`，标签不补金额。
- 不改侧边栏流水的内容、顺序和滚动，不改记录库，不改结算。store 里不调用播放器。
- 不新增音频文件、音量滑杆、jsdom 或组件测试库。
- 音效用 Web Audio 合成。全下最长不超过 350 毫秒。主增益约 0.15。
- 开关文案是 `音效开` / `音效关`。`localStorage` 键是 `dz-pk-sound`，值是 `on` 或 `off`。缺键、无法识别、读写失败都视为开。
- 默认开。进入牌桌的成功点击里 `resume` `AudioContext`。失败静默。`document.hidden === true` 时不播放，也不补播。
- 静音期间错过的声音不补播。标签在静音时照常显示。
- 测试命令用 `npx --no-install vitest run`。不要改测试去迁就错误实现。

规格：`docs/superpowers/specs/2026-10-30-action-feedback-design.md`。

---

### Task 1: 座位行动文案

**Files:**
- Create: `src/game/seatActionLabel.ts`
- Test: `src/game/seatActionLabel.test.ts`

**Interfaces:**
- Consumes: `PublicAction`、`SeatStatus`、`TableStage`（`src/ai/types.ts`）
- Produces:
  - `seatActionLabel(actorId: string, status: SeatStatus, stage: TableStage, streetActions: readonly PublicAction[]): string | null`
  - `isOpeningBet(action: PublicAction, streetActions: readonly PublicAction[]): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/game/seatActionLabel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PublicAction } from '../ai/types';
import { seatActionLabel } from './seatActionLabel';

function act(partial: Partial<PublicAction> & Pick<PublicAction, 'actorId' | 'kind'>): PublicAction {
  return {
    stage: 'flop',
    to: null,
    ...partial,
  };
}

describe('seatActionLabel', () => {
  it('过牌、跟注、弃牌和全下', () => {
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_0', kind: 'check' })])).toBe('过牌');
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_0', kind: 'call' })])).toBe('跟注');
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_0', kind: 'fold' })])).toBe('弃牌');
    expect(seatActionLabel('ai_0', 'folded', 'turn', [act({ actorId: 'ai_0', stage: 'flop', kind: 'check' })])).toBe('弃牌');
    expect(seatActionLabel('ai_0', 'all-in', 'turn', [act({ actorId: 'ai_0', stage: 'flop', kind: 'raise', to: 40 })])).toBe('全下');
  });

  it('跟注不写金额', () => {
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_0', kind: 'call' })])).not.toContain('$');
  });

  it('翻后第一次下注，翻前和面对下注时叫加注到', () => {
    const open = act({ actorId: 'ai_0', kind: 'raise', to: 10 });
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_1', kind: 'check' }), open])).toBe('下注 $10');
    const raised = act({ actorId: 'ai_0', kind: 'raise', to: 40 });
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_1', kind: 'raise', to: 10 }), raised])).toBe('加注到 $40');
    const pre = act({ actorId: 'human', stage: 'preflop', kind: 'raise', to: 30 });
    expect(seatActionLabel('human', 'active', 'preflop', [
      act({ actorId: 'ai_0', stage: 'preflop', kind: 'post', to: 5 }),
      pre,
    ])).toBe('加注到 $30');
  });

  it('同一人再次行动后只留最新一条', () => {
    const bet = act({ actorId: 'ai_0', kind: 'raise', to: 10 });
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_0', kind: 'check' }), bet])).toBe('下注 $10');
  });

  it('盲注没有标签，换街和摊牌清掉金额类标签', () => {
    expect(seatActionLabel('ai_0', 'active', 'preflop', [act({ actorId: 'ai_0', stage: 'preflop', kind: 'post', to: 5 })])).toBeNull();
    expect(seatActionLabel('ai_0', 'active', 'turn', [act({ actorId: 'ai_0', stage: 'flop', kind: 'check' })])).toBeNull();
    expect(seatActionLabel('ai_0', 'active', 'showdown', [act({ actorId: 'ai_0', stage: 'river', kind: 'check' })])).toBeNull();
    expect(seatActionLabel('ai_1', 'folded', 'showdown', [act({ actorId: 'ai_1', stage: 'flop', kind: 'fold' })])).toBe('弃牌');
  });

  it('非法加注额只留动词', () => {
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_0', kind: 'raise', to: null })])).toBe('下注');
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_0', kind: 'raise', to: 1.5 })])).toBe('下注');
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_1', kind: 'call' }), act({ actorId: 'ai_0', kind: 'raise', to: 0 })])).toBe('加注');
  });

  it('不显示别人的行动', () => {
    expect(seatActionLabel('human', 'active', 'flop', [act({ actorId: 'ai_0', kind: 'check' })])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --no-install vitest run src/game/seatActionLabel.test.ts`

Expected: FAIL，`Cannot find module './seatActionLabel'`。

- [ ] **Step 3: Write minimal implementation**

Create `src/game/seatActionLabel.ts`:

```ts
import type { PublicAction, SeatStatus, TableStage } from '../ai/types';
import { isBettingStage } from '../ai/types';

export function isOpeningBet(action: PublicAction, streetActions: readonly PublicAction[]): boolean {
  if (action.kind !== 'raise' || action.stage === 'preflop') return false;
  const index = streetActions.indexOf(action);
  if (index < 0) return false;
  return !streetActions.slice(0, index).some((item) => (
    item.stage === action.stage && (item.kind === 'post' || item.kind === 'call' || item.kind === 'raise')
  ));
}

function raiseText(action: PublicAction, streetActions: readonly PublicAction[]): string {
  const opening = isOpeningBet(action, streetActions);
  const verb = opening ? '下注' : '加注';
  const amount = typeof action.to === 'number' && Number.isSafeInteger(action.to) && action.to > 0
    ? `$${action.to}`
    : null;
  if (!amount) return verb;
  return opening ? `下注 ${amount}` : `加注到 ${amount}`;
}

export function seatActionLabel(
  actorId: string,
  status: SeatStatus,
  stage: TableStage,
  streetActions: readonly PublicAction[],
): string | null {
  if (status === 'folded') return '弃牌';
  if (status === 'all-in') return '全下';
  if (!isBettingStage(stage)) return null;
  const mine = streetActions.filter((action) => action.actorId === actorId && action.stage === stage && action.kind !== 'post');
  const last = mine[mine.length - 1];
  if (!last) return null;
  if (last.kind === 'check') return '过牌';
  if (last.kind === 'call') return '跟注';
  if (last.kind === 'fold') return '弃牌';
  if (last.kind === 'raise') return raiseText(last, streetActions);
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --no-install vitest run src/game/seatActionLabel.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/game/seatActionLabel.ts src/game/seatActionLabel.test.ts
git commit -m "$(cat <<'EOF'
用公开行动算出座位上的过牌、跟注、下注和加注文案。

EOF
)"
```

### Task 2: 把文案接到四个座位

**Files:**
- Modify: `src/components/GameTable.tsx`
- Test: `src/game/actionFeedback.ui.test.ts`

**Interfaces:**
- Consumes: `seatActionLabel(actorId, status, stage, streetActions)`
- Produces: `GameTable` 内的 `SeatActionLine`，四个座位各用一次。英文 `Folded` 和 `ALL-IN` 从该文件消失。

- [ ] **Step 1: Write the failing test**

Create `src/game/actionFeedback.ui.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const table = readFileSync(new URL('../components/GameTable.tsx', import.meta.url), 'utf8');

describe('行动反馈界面', () => {
  it('四个座位共用中文行动行，不再写英文弃牌和全下', () => {
    expect(table).not.toContain('Folded');
    expect(table).not.toContain('ALL-IN');
    expect(table).toContain('seatActionLabel');
    expect(table.match(/<SeatActionLine/g)).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --no-install vitest run src/game/actionFeedback.ui.test.ts`

Expected: FAIL，`Folded` 仍在 `GameTable.tsx`。

- [ ] **Step 3: Write minimal implementation**

在 `src/components/GameTable.tsx` 增加导入：

```ts
import { seatActionLabel } from '../game/seatActionLabel';
```

在 `GameTable` 组件上方增加：

```tsx
function SeatActionLine({
  dealer,
  bet,
  label,
  human = false,
}: {
  dealer: boolean;
  bet: number;
  label: string | null;
  human?: boolean;
}) {
  const dealerClass = human
    ? 'w-5 h-5 sm:w-6 sm:h-6 text-xs'
    : 'w-4 h-4 sm:w-5 sm:h-5 text-[10px]';
  const betClass = human
    ? 'px-3 py-1 bg-yellow-600/90 rounded-full text-xs sm:text-sm font-bold border border-yellow-400 shadow-lg'
    : 'px-1 sm:px-2 bg-yellow-600/80 rounded text-[10px] sm:text-xs font-bold border border-yellow-400';
  const rowClass = human
    ? 'flex items-center justify-center space-x-2 mb-1 h-6'
    : 'flex items-center justify-center space-x-1 sm:space-x-2 mb-1 h-6';
  const loud = label === '弃牌' || label === '全下';
  return (
    <>
      <div className={rowClass}>
        {dealer && (
          <div className={`${dealerClass} bg-white text-black rounded-full flex items-center justify-center font-bold shadow-md`}>D</div>
        )}
        {bet > 0 && <div className={betClass}>${bet}</div>}
      </div>
      <div className="h-5 mb-1 flex items-center justify-center text-[10px] sm:text-xs font-bold">
        {label ? (
          <span className={loud ? 'px-1 sm:px-2 bg-red-600/80 rounded' : 'px-1 sm:px-2 bg-black/50 rounded'}>{label}</span>
        ) : null}
      </div>
    </>
  );
}
```

三处 AI 座位里，把下面这一整段换成 `SeatActionLine`。三处原文相同：

```tsx
                  <div className="flex items-center space-x-1 sm:space-x-2 mb-2 h-6">
                    {isDealer && <div className="w-4 h-4 sm:w-5 sm:h-5 bg-white text-black rounded-full flex items-center justify-center text-[10px] font-bold shadow-md">D</div>}
                    {p.currentBet > 0 && <div className="px-1 sm:px-2 bg-yellow-600/80 rounded text-[10px] sm:text-xs font-bold border border-yellow-400">${p.currentBet}</div>}
                    {p.status === 'folded' && <div className="px-1 sm:px-2 bg-red-600/80 rounded text-[10px] sm:text-xs">Folded</div>}
                    {p.status === 'all-in' && <div className="px-1 sm:px-2 bg-red-600/80 rounded text-[10px] sm:text-xs font-bold">ALL-IN</div>}
                  </div>
```

替换为：

```tsx
                  <SeatActionLine
                    dealer={isDealer}
                    bet={p.currentBet}
                    label={seatActionLabel(p.id, p.status, stage, streetActions)}
                  />
```

本人座位把状态行换成：

```tsx
              <SeatActionLine
                human
                dealer={humanSeat === buttonIndex}
                bet={human.currentBet}
                label={seatActionLabel(human.id, human.status, stage, streetActions)}
              />
```

被换掉的原文是 `GameTable.tsx` 里注释 `{/* 状态 / 下注 */}` 下面的 `h-6` 区块，其中包含 `Folded` 和 `ALL-IN`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --no-install vitest run src/game/actionFeedback.ui.test.ts src/game/seatActionLabel.test.ts`

Expected: PASS。`npm run build` 也要通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/GameTable.tsx src/game/actionFeedback.ui.test.ts
git commit -m "$(cat <<'EOF'
在四个座位显示本街最后一次主动行动。

EOF
)"
```

### Task 3: 行动声闸门

**Files:**
- Create: `src/game/actionSoundGate.ts`
- Test: `src/game/actionSoundGate.test.ts`

**Interfaces:**
- Consumes: `isOpeningBet`、`isBettingStage`、`PublicAction`、`SeatStatus`、`TableStage`
- Produces:
  - `ActionCue = 'check' | 'fold' | 'call' | 'bet' | 'raise' | 'all-in' | 'your-turn'`
  - `YOUR_TURN_DELAY_MS = 200`
  - `cueForAction(action: PublicAction, status: SeatStatus, streetActions: readonly PublicAction[]): ActionCue | null`
  - `SoundFrame`，字段为 `handNumber: number`、`stage: TableStage`、`streetActions: readonly PublicAction[]`、`currentPlayerIndex: number`、`currentPlayerId: string | null`、`humanStatus: SeatStatus | null`、`statuses: Readonly<Record<string, SeatStatus>>`
  - `createActionSoundGate(deps: { play: (cue: ActionCue) => void; delay: (ms: number, run: () => void) => () => void; enabled: () => boolean; hidden: () => boolean }): { onFrame: (frame: SoundFrame) => () => void }`

换手或行动数组变短时，把进度对齐到当前数组末尾，不播放这一帧里已经存在的行动。`startHand` 会在同一次渲染写入两条 `post`，所以盲注不会响。自愿行动出现在后续帧。`onFrame` 返回的函数只取消还没响的「轮到你」，不把进度退回去。

- [ ] **Step 1: Write the failing test**

Create `src/game/actionSoundGate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PublicAction, SeatStatus } from '../ai/types';
import { createActionSoundGate, YOUR_TURN_DELAY_MS, type SoundFrame } from './actionSoundGate';

function act(partial: Partial<PublicAction> & Pick<PublicAction, 'actorId' | 'kind'>): PublicAction {
  return { stage: 'preflop', to: null, ...partial };
}

function frame(partial: Partial<SoundFrame> & Pick<SoundFrame, 'streetActions'>): SoundFrame {
  return {
    handNumber: 1,
    stage: 'preflop',
    currentPlayerIndex: 0,
    currentPlayerId: 'ai_0',
    humanStatus: 'active',
    statuses: {},
    ...partial,
  };
}

function harness(initial: { enabled?: boolean; hidden?: boolean } = {}) {
  const played: string[] = [];
  let enabled = initial.enabled ?? true;
  let hidden = initial.hidden ?? false;
  const waiting: { ms: number; run: () => void }[] = [];
  const gate = createActionSoundGate({
    play: (cue) => { played.push(cue); },
    delay: (ms, run) => {
      const item = { ms, run };
      waiting.push(item);
      return () => {
        const index = waiting.indexOf(item);
        if (index >= 0) waiting.splice(index, 1);
      };
    },
    enabled: () => enabled,
    hidden: () => hidden,
  });
  return {
    played,
    gate,
    setEnabled: (value: boolean) => { enabled = value; },
    setHidden: (value: boolean) => { hidden = value; },
    flush: (ms = YOUR_TURN_DELAY_MS) => {
      const due = waiting.filter((item) => item.ms === ms);
      for (const item of due) {
        const index = waiting.indexOf(item);
        if (index >= 0) waiting.splice(index, 1);
        item.run();
      }
    },
    waiting: () => waiting.length,
  };
}

describe('actionSoundGate', () => {
  const posts = [
    act({ actorId: 'ai_0', kind: 'post', to: 5 }),
    act({ actorId: 'ai_1', kind: 'post', to: 10 }),
  ];

  it('盲注不响，之后的行动按种类响一次', () => {
    const box = harness();
    box.gate.onFrame(frame({ streetActions: posts, statuses: { ai_0: 'active', ai_1: 'active' } }));
    expect(box.played).toEqual([]);
    const check = act({ actorId: 'ai_2', stage: 'flop', kind: 'check' });
    const withCheck = [...posts, check];
    box.gate.onFrame(frame({
      stage: 'flop',
      streetActions: withCheck,
      statuses: { ai_0: 'active', ai_1: 'active', ai_2: 'active' },
    }));
    expect(box.played).toEqual(['check']);
    box.gate.onFrame(frame({ stage: 'flop', streetActions: withCheck, statuses: { ai_2: 'active' } }));
    expect(box.played).toEqual(['check']);
  });

  it('跟注、下注、加注、弃牌和全下用不同声音', () => {
    const box = harness();
    box.gate.onFrame(frame({ streetActions: [] }));
    const call = act({ actorId: 'ai_0', stage: 'flop', kind: 'call' });
    const bet = act({ actorId: 'ai_1', stage: 'flop', kind: 'raise', to: 10 });
    const raised = act({ actorId: 'ai_2', stage: 'flop', kind: 'raise', to: 40 });
    const folded = act({ actorId: 'human', stage: 'turn', kind: 'fold' });
    const jammed = act({ actorId: 'ai_0', stage: 'river', kind: 'call' });
    const statuses: Record<string, SeatStatus> = {
      ai_0: 'active', ai_1: 'active', ai_2: 'active', human: 'folded',
    };
    box.gate.onFrame(frame({ stage: 'flop', streetActions: [call], statuses }));
    box.gate.onFrame(frame({ stage: 'flop', streetActions: [call, bet], statuses }));
    box.gate.onFrame(frame({ stage: 'flop', streetActions: [call, bet, raised], statuses }));
    box.gate.onFrame(frame({ stage: 'turn', streetActions: [call, bet, raised, folded], statuses }));
    box.gate.onFrame(frame({
      stage: 'river',
      streetActions: [call, bet, raised, folded, jammed],
      statuses: { ...statuses, ai_0: 'all-in' },
    }));
    expect(box.played).toEqual(['call', 'bet', 'raise', 'fold', 'all-in']);
  });

  it('同一帧的多条行动按顺序播放', () => {
    const box = harness();
    box.gate.onFrame(frame({ streetActions: [] }));
    box.gate.onFrame(frame({
      stage: 'flop',
      streetActions: [
        act({ actorId: 'ai_0', stage: 'flop', kind: 'check' }),
        act({ actorId: 'ai_1', stage: 'flop', kind: 'fold' }),
      ],
      statuses: { ai_0: 'active', ai_1: 'folded' },
    }));
    expect(box.played).toEqual(['check', 'fold']);
  });

  it('静音、隐藏和换手都不补播', () => {
    const check = act({ actorId: 'ai_0', stage: 'flop', kind: 'check' });
    const quiet = harness({ enabled: false });
    quiet.gate.onFrame(frame({ streetActions: [] }));
    quiet.gate.onFrame(frame({ stage: 'flop', streetActions: [check], statuses: { ai_0: 'active' } }));
    quiet.setEnabled(true);
    quiet.gate.onFrame(frame({ stage: 'flop', streetActions: [check], statuses: { ai_0: 'active' } }));
    expect(quiet.played).toEqual([]);

    const away = harness({ hidden: true });
    away.gate.onFrame(frame({ streetActions: [] }));
    away.gate.onFrame(frame({ stage: 'flop', streetActions: [check], statuses: { ai_0: 'active' } }));
    away.setHidden(false);
    away.gate.onFrame(frame({ stage: 'flop', streetActions: [check], statuses: { ai_0: 'active' } }));
    expect(away.played).toEqual([]);

    const next = harness();
    next.gate.onFrame(frame({ streetActions: [] }));
    next.gate.onFrame(frame({ stage: 'flop', streetActions: [check], statuses: { ai_0: 'active' } }));
    expect(next.played).toEqual(['check']);
    next.gate.onFrame(frame({ handNumber: 2, streetActions: posts }));
    expect(next.played).toEqual(['check']);
  });

  it('对手行动后轮到你时，提示音晚 200 毫秒，并且只响一次', () => {
    const box = harness();
    box.gate.onFrame(frame({ streetActions: posts, currentPlayerId: 'ai_0' }));
    const stop = box.gate.onFrame(frame({
      streetActions: [...posts, act({ actorId: 'ai_2', kind: 'fold' })],
      currentPlayerIndex: 3,
      currentPlayerId: 'human',
      statuses: { ai_2: 'folded', human: 'active' },
    }));
    expect(box.played).toEqual(['fold']);
    stop();
    box.gate.onFrame(frame({
      streetActions: [...posts, act({ actorId: 'ai_2', kind: 'fold' })],
      currentPlayerIndex: 3,
      currentPlayerId: 'human',
      statuses: { ai_2: 'folded', human: 'active' },
    }));
    expect(box.played).toEqual(['fold']);
    box.flush();
    expect(box.played).toEqual(['fold', 'your-turn']);
    box.flush();
    expect(box.played).toEqual(['fold', 'your-turn']);
  });

  it('延迟提示在静音、隐藏或轮转失效时不响', () => {
    const muted = harness();
    muted.gate.onFrame(frame({ streetActions: posts }));
    muted.gate.onFrame(frame({
      streetActions: [...posts, act({ actorId: 'ai_2', kind: 'fold' })],
      currentPlayerId: 'human',
      currentPlayerIndex: 3,
      statuses: { ai_2: 'folded' },
    }));
    muted.setEnabled(false);
    muted.flush();
    expect(muted.played).toEqual(['fold']);

    const hidden = harness();
    hidden.gate.onFrame(frame({ streetActions: posts }));
    hidden.gate.onFrame(frame({
      streetActions: [...posts, act({ actorId: 'ai_2', kind: 'fold' })],
      currentPlayerId: 'human',
      currentPlayerIndex: 3,
      statuses: { ai_2: 'folded' },
    }));
    hidden.setHidden(true);
    hidden.flush();
    expect(hidden.played).toEqual(['fold']);

    const left = harness();
    left.gate.onFrame(frame({ streetActions: posts }));
    const cancel = left.gate.onFrame(frame({
      streetActions: [...posts, act({ actorId: 'ai_2', kind: 'fold' })],
      currentPlayerId: 'human',
      currentPlayerIndex: 3,
      statuses: { ai_2: 'folded' },
    }));
    cancel();
    left.gate.onFrame(frame({
      streetActions: [...posts, act({ actorId: 'ai_2', kind: 'fold' }), act({ actorId: 'human', kind: 'call' })],
      currentPlayerId: 'ai_0',
      currentPlayerIndex: 0,
      statuses: { ai_2: 'folded', human: 'active' },
    }));
    left.flush();
    expect(left.played).toEqual(['fold', 'call']);
  });

  it('开局轮到你时立即提示，本人行动后不再提示自己', () => {
    const box = harness();
    box.gate.onFrame(frame({
      streetActions: posts,
      currentPlayerId: 'human',
      currentPlayerIndex: 2,
    }));
    expect(box.played).toEqual(['your-turn']);
    box.gate.onFrame(frame({
      streetActions: [...posts, act({ actorId: 'human', kind: 'call' })],
      currentPlayerId: 'ai_0',
      currentPlayerIndex: 0,
      statuses: { human: 'active' },
    }));
    box.flush();
    expect(box.played).toEqual(['your-turn', 'call']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --no-install vitest run src/game/actionSoundGate.test.ts`

Expected: FAIL，`Cannot find module './actionSoundGate'`。

- [ ] **Step 3: Write minimal implementation**

Create `src/game/actionSoundGate.ts`:

```ts
import type { PublicAction, SeatStatus, TableStage } from '../ai/types';
import { isBettingStage } from '../ai/types';
import { isOpeningBet } from './seatActionLabel';

export const YOUR_TURN_DELAY_MS = 200;

export type ActionCue = 'check' | 'fold' | 'call' | 'bet' | 'raise' | 'all-in' | 'your-turn';

export interface SoundFrame {
  handNumber: number;
  stage: TableStage;
  streetActions: readonly PublicAction[];
  currentPlayerIndex: number;
  currentPlayerId: string | null;
  humanStatus: SeatStatus | null;
  statuses: Readonly<Record<string, SeatStatus>>;
}

export function cueForAction(
  action: PublicAction,
  status: SeatStatus,
  streetActions: readonly PublicAction[],
): ActionCue | null {
  if (action.kind === 'post') return null;
  if (status === 'all-in') return 'all-in';
  if (action.kind === 'fold' || status === 'folded') return 'fold';
  if (action.kind === 'check') return 'check';
  if (action.kind === 'call') return 'call';
  if (action.kind === 'raise') return isOpeningBet(action, streetActions) ? 'bet' : 'raise';
  return null;
}

export function createActionSoundGate(deps: {
  play: (cue: ActionCue) => void;
  delay: (ms: number, run: () => void) => () => void;
  enabled: () => boolean;
  hidden: () => boolean;
}): { onFrame: (frame: SoundFrame) => () => void } {
  let handNumber = -1;
  let playedThrough = 0;
  let committedKey: string | null = null;
  let delayedKey: string | null = null;
  let cancelTimer: (() => void) | null = null;
  let latestKey: string | null = null;

  const disarm = () => {
    if (!cancelTimer) return;
    cancelTimer();
    cancelTimer = null;
  };

  const onFrame = (frame: SoundFrame) => {
    disarm();
    if (frame.handNumber !== handNumber || frame.streetActions.length < playedThrough) {
      handNumber = frame.handNumber;
      playedThrough = frame.streetActions.length;
      committedKey = null;
      delayedKey = null;
    }

    const heard: ActionCue[] = [];
    for (const action of frame.streetActions.slice(playedThrough)) {
      const cue = cueForAction(action, frame.statuses[action.actorId] ?? 'active', frame.streetActions);
      if (!cue) continue;
      heard.push(cue);
      if (deps.enabled() && !deps.hidden()) deps.play(cue);
    }
    playedThrough = frame.streetActions.length;

    const yourTurn = frame.currentPlayerId === 'human'
      && frame.humanStatus === 'active'
      && isBettingStage(frame.stage);
    const key = `${frame.handNumber}:${frame.currentPlayerIndex}:${frame.streetActions.length}`;
    latestKey = yourTurn ? key : null;

    if (yourTurn && committedKey !== key) {
      const wait = heard.length > 0 || delayedKey === key;
      if (heard.length > 0) delayedKey = key;
      const fire = () => {
        cancelTimer = null;
        if (committedKey === key || latestKey !== key) return;
        if (deps.enabled() && !deps.hidden()) deps.play('your-turn');
        committedKey = key;
        if (delayedKey === key) delayedKey = null;
      };
      if (wait) cancelTimer = deps.delay(YOUR_TURN_DELAY_MS, fire);
      else fire();
    } else if (!yourTurn) {
      delayedKey = null;
    }

    return disarm;
  };

  return { onFrame };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --no-install vitest run src/game/actionSoundGate.test.ts`

Expected: PASS。同一手里新出现的过牌必须播放。换手那一帧只对齐进度，不播放新手牌里已经写好的盲注，也不重播上一手。

- [ ] **Step 5: Commit**

```bash
git add src/game/actionSoundGate.ts src/game/actionSoundGate.test.ts
git commit -m "$(cat <<'EOF'
按行动种类播放一次短音，轮到你时再延迟提示。

EOF
)"
```

### Task 4: 合成音、开关和进桌解锁

**Files:**
- Create: `src/game/soundPreference.ts`
- Create: `src/game/actionSound.ts`
- Test: `src/game/soundPreference.test.ts`
- Test: `src/game/actionSound.test.ts`
- Modify: `src/game/actionFeedback.ui.test.ts`
- Modify: `src/components/GameTable.tsx`
- Modify: `src/App.tsx`
- Modify: `docs/superpowers/specs/2026-10-30-action-feedback-design.md`（状态改为「已实现」，并写上本计划路径）

**Interfaces:**
- Consumes: `createActionSoundGate`、`ActionCue`、`SoundFrame`
- Produces:
  - `readSoundEnabled(): boolean`
  - `writeSoundEnabled(on: boolean): void`
  - `primeActionAudio(): void`
  - `playActionCue(cue: ActionCue): void`
  - `liveActionSound.onFrame(frame: SoundFrame): () => void`

- [ ] **Step 1: Write the failing test**

Create `src/game/soundPreference.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

async function load() {
  vi.resetModules();
  return import('./soundPreference');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('soundPreference', () => {
  it('缺键和无法识别的值都是开', async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => { mem.set(key, value); },
    });
    const pref = await load();
    expect(pref.readSoundEnabled()).toBe(true);
    mem.set('dz-pk-sound', 'maybe');
    vi.resetModules();
    const again = await load();
    expect(again.readSoundEnabled()).toBe(true);
  });

  it('off 会记住，读写失败时本次页面仍可关闭', async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => { mem.set(key, value); },
    });
    const pref = await load();
    pref.writeSoundEnabled(false);
    expect(mem.get('dz-pk-sound')).toBe('off');
    expect(pref.readSoundEnabled()).toBe(false);

    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    const broken = await load();
    expect(broken.readSoundEnabled()).toBe(true);
    expect(() => broken.writeSoundEnabled(false)).not.toThrow();
    expect(broken.readSoundEnabled()).toBe(false);
  });
});
```

Create `src/game/actionSound.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { playActionCue, primeActionAudio } from './actionSound';

describe('actionSound', () => {
  it('没有音频上下文时不抛', () => {
    expect(() => primeActionAudio()).not.toThrow();
    expect(() => playActionCue('check')).not.toThrow();
    expect(() => playActionCue('all-in')).not.toThrow();
    expect(() => playActionCue('your-turn')).not.toThrow();
  });
});
```

把 `src/game/actionFeedback.ui.test.ts` 换成：

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const table = readFileSync(new URL('../components/GameTable.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const store = readFileSync(new URL('../store/gameStore.ts', import.meta.url), 'utf8');

describe('行动反馈界面', () => {
  it('四个座位共用中文行动行，不再写英文弃牌和全下', () => {
    expect(table).not.toContain('Folded');
    expect(table).not.toContain('ALL-IN');
    expect(table).toContain('seatActionLabel');
    expect(table.match(/<SeatActionLine/g)).toHaveLength(4);
  });

  it('牌桌有音效开关，进桌点击解锁音频，store 不播放', () => {
    expect(table).toContain('音效开');
    expect(table).toContain('音效关');
    expect(table).toContain('liveActionSound');
    expect(app).toContain('primeActionAudio');
    expect(store).not.toContain('playActionCue');
    expect(store).not.toContain('liveActionSound');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --no-install vitest run src/game/soundPreference.test.ts src/game/actionSound.test.ts src/game/actionFeedback.ui.test.ts`

Expected: FAIL，找不到 `./soundPreference` 和 `./actionSound`。界面测试里还没有 `音效开`。

- [ ] **Step 3: Write minimal implementation**

Create `src/game/soundPreference.ts`:

```ts
const SOUND_STORAGE_KEY = 'dz-pk-sound';
let memory: boolean | null = null;

export function readSoundEnabled(): boolean {
  if (memory !== null) return memory;
  try {
    memory = globalThis.localStorage?.getItem(SOUND_STORAGE_KEY) !== 'off';
  } catch {
    memory = true;
  }
  return memory;
}

export function writeSoundEnabled(on: boolean): void {
  memory = on;
  try {
    globalThis.localStorage?.setItem(SOUND_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // 本次页面继续使用 memory。
  }
}
```

Create `src/game/actionSound.ts`:

```ts
import { createActionSoundGate, type ActionCue, type SoundFrame } from './actionSoundGate';
import { readSoundEnabled } from './soundPreference';

let audioContext: AudioContext | null = null;

export function primeActionAudio(): void {
  try {
    if (typeof window === 'undefined' || !window.AudioContext) return;
    if (!audioContext) audioContext = new window.AudioContext();
    void audioContext.resume().catch(() => {});
  } catch {
    // 浏览器拒绝时保留标签，不提示。
  }
}

function tone(ctx: AudioContext, freq: number, when: number, duration: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.15, when + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

function click(ctx: AudioContext, when: number, duration: number) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.15, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start(when);
  source.stop(when + duration);
}

export function playActionCue(cue: ActionCue): void {
  const ctx = audioContext;
  if (!ctx || ctx.state !== 'running') return;
  try {
    const now = ctx.currentTime;
    if (cue === 'check') tone(ctx, 880, now, 0.04);
    else if (cue === 'fold') tone(ctx, 180, now, 0.08);
    else if (cue === 'call') click(ctx, now, 0.03);
    else if (cue === 'bet') {
      tone(ctx, 520, now, 0.04);
      tone(ctx, 520, now + 0.09, 0.04);
    } else if (cue === 'raise') {
      tone(ctx, 880, now, 0.04);
      tone(ctx, 880, now + 0.09, 0.04);
    } else if (cue === 'all-in') {
      click(ctx, now, 0.03);
      tone(ctx, 140, now, 0.15);
    } else if (cue === 'your-turn') tone(ctx, 660, now, 0.12);
  } catch {
    // 合成失败时静默。
  }
}

export const liveActionSound: { onFrame: (frame: SoundFrame) => () => void } = createActionSoundGate({
  play: playActionCue,
  delay: (ms, run) => {
    const id = setTimeout(run, ms);
    return () => clearTimeout(id);
  },
  enabled: readSoundEnabled,
  hidden: () => typeof document !== 'undefined' && document.hidden,
});
```

在 `GameTable.tsx` 增加导入：

```ts
import { liveActionSound, primeActionAudio } from '../game/actionSound';
import { readSoundEnabled, writeSoundEnabled } from '../game/soundPreference';
```

组件内、现有 `useState` 旁边：

```tsx
  const [soundOn, setSoundOn] = useState(() => readSoundEnabled());
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    writeSoundEnabled(next);
    if (next) primeActionAudio();
  };
```

游戏日志滚动的 `useEffect` 后面增加：

```tsx
  useEffect(() => {
    const statuses: Record<string, typeof players[number]['status']> = {};
    for (const player of players) statuses[player.id] = player.status;
    const humanPlayer = players.find((player) => player.id === 'human') ?? null;
    return liveActionSound.onFrame({
      handNumber,
      stage,
      streetActions,
      currentPlayerIndex,
      currentPlayerId: players[currentPlayerIndex]?.id ?? null,
      humanStatus: humanPlayer?.status ?? null,
      statuses,
    });
  }, [handNumber, stage, streetActions, players, currentPlayerIndex]);
```

顶栏右侧改成开关在「站起离开」左边：

```tsx
          <div className="flex items-center gap-2">
            <button type="button" onClick={toggleSound} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-bold shadow-md transition-colors">
              {soundOn ? '音效开' : '音效关'}
            </button>
            <button onClick={handleLeave} className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-bold shadow-md transition-colors">
              站起离开
            </button>
          </div>
```

`src/App.tsx` 的 `handleJoin` 在扣款成功后、`setCurrentTable` 之前调用 `primeActionAudio()`。导入来自 `./game/actionSound`。扣款失败不调用。

规格文件状态改为「已实现」。配套计划那一行已经在日期下面，不要重复添加。

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx --no-install vitest run src/game/seatActionLabel.test.ts src/game/actionSoundGate.test.ts src/game/soundPreference.test.ts src/game/actionSound.test.ts src/game/actionFeedback.ui.test.ts
npx --no-install vitest run
npm run build
```

Expected: 新增测试 PASS，原有测试 PASS，`npm run build` 通过。

- [ ] **Step 5: Commit**

```bash
git add src/game/soundPreference.ts src/game/soundPreference.test.ts src/game/actionSound.ts src/game/actionSound.test.ts src/game/actionFeedback.ui.test.ts src/components/GameTable.tsx src/App.tsx docs/superpowers/specs/2026-10-30-action-feedback-design.md
git commit -m "$(cat <<'EOF'
为行动和轮到你加上可关闭的短音效。

EOF
)"
```

## 自测记录

实现时把每条命令的通过数量写在这里。手动听一次不是合并条件；自动化测试和构建通过即可提交。若要亲耳确认：进桌后让对手过牌、跟注、下注、加注、弃牌、全下，并确认轮到你有单独一声。关掉开关后刷新仍是关，打开后刷新仍是开。切到别的标签页时没有声音。
