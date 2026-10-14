import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './gameStore';
import type { Player } from './gameStore';
import type { TableConfig } from '../components/Lobby';
import { createDeck } from '../utils/poker';

const TABLE: TableConfig = { id: 'test', name: '测试桌', smallBlind: 5, bigBlind: 10, buyIn: 1000 };

const makePlayer = (overrides: Partial<Player> & { id: string }): Player => ({
  name: overrides.id,
  isAI: true,
  chips: 1000,
  cards: [],
  currentBet: 0,
  status: 'active',
  hasActed: false,
  canRaise: true,
  ...overrides,
});

/** 直接构造一个下注进行中的牌局快照（绕过发牌随机性） */
const setupMidHand = (players: Player[], opts: {
  currentPlayerIndex: number;
  currentMaxBet: number;
  lastRaiseSize: number;
  pot?: number;
  stage?: 'preflop' | 'flop' | 'turn' | 'river';
}) => {
  useGameStore.setState({
    table: TABLE,
    stage: opts.stage ?? 'flop',
    pot: opts.pot ?? 0,
    board: [],
    deck: createDeck(),
    players,
    dealerIndex: 0,
    currentPlayerIndex: opts.currentPlayerIndex,
    currentMaxBet: opts.currentMaxBet,
    lastRaiseSize: opts.lastRaiseSize,
    gameLog: [],
  });
};

const totalChipsInSystem = () => {
  const { players, pot } = useGameStore.getState();
  return players.reduce((sum, p) => sum + p.chips, 0) + pot;
};

beforeEach(() => {
  useGameStore.setState(useGameStore.getInitialState());
});

describe('Bug1 回归：短码 All-in 不得拉低 currentMaxBet，不得产生负跟注', () => {
  it('All-in 金额小于当前最高下注时，currentMaxBet 保持不变', () => {
    setupMidHand([
      makePlayer({ id: 'ai_0', currentBet: 100, hasActed: true, chips: 900 }),
      makePlayer({ id: 'ai_1', currentBet: 100, hasActed: true, chips: 900 }),
      makePlayer({ id: 'ai_2', currentBet: 0, chips: 900 }), // 还未跟注，保证本轮不结束
      makePlayer({ id: 'human', isAI: false, currentBet: 0, chips: 50 }),
    ], { currentPlayerIndex: 3, currentMaxBet: 100, lastRaiseSize: 90, pot: 250 });

    const before = totalChipsInSystem();
    // 人类只剩 50，全下（通过 playerRaise，等同 UI 的 All-in 按钮）
    useGameStore.getState().playerRaise(50);

    const s = useGameStore.getState();
    expect(s.currentMaxBet).toBe(100); // 旧代码会被拉低到 50
    expect(s.players[3].status).toBe('all-in');
    expect(s.players[3].chips).toBe(0);
    // 系统总筹码守恒（旧代码后续会产生 -50 负跟注，凭空造筹码）
    expect(totalChipsInSystem()).toBe(before);
  });

  it('playerCall 的跟注额不会为负数', () => {
    setupMidHand([
      makePlayer({ id: 'ai_0', currentBet: 100, chips: 900 }),
      makePlayer({ id: 'ai_1', currentBet: 0, chips: 900 }),
    ], { currentPlayerIndex: 0, currentMaxBet: 50, lastRaiseSize: 10, pot: 100 });

    // currentBet(100) > currentMaxBet(50) 的异常状态下 Call
    useGameStore.getState().playerCall();

    const s = useGameStore.getState();
    expect(s.players[0].chips).toBe(900); // 旧代码 chips -= -50 → 筹码变多
    expect(s.pot).toBe(100);
  });
});

describe('Bug2 回归：最小加注额（min-raise）校验', () => {
  it('筹码充足但加注增量小于上次增量时，钳制到最小加注额', () => {
    // 10 → 100（增量 90），最小反加应为 190
    setupMidHand([
      makePlayer({ id: 'ai_0', currentBet: 0, chips: 1000 }),
      makePlayer({ id: 'ai_1', currentBet: 100, hasActed: true, chips: 900 }),
    ], { currentPlayerIndex: 0, currentMaxBet: 100, lastRaiseSize: 90, pot: 100 });

    useGameStore.getState().playerRaise(130); // 非法小加注（增量 30 < 90）

    const s = useGameStore.getState();
    expect(s.players[0].currentBet).toBe(190); // 被钳制到最小加注
    expect(s.currentMaxBet).toBe(190);
    expect(s.lastRaiseSize).toBe(90);
  });

  it('完整加注更新 lastRaiseSize', () => {
    setupMidHand([
      makePlayer({ id: 'ai_0', currentBet: 0, chips: 1000 }),
      makePlayer({ id: 'ai_1', currentBet: 100, hasActed: true, chips: 900 }),
    ], { currentPlayerIndex: 0, currentMaxBet: 100, lastRaiseSize: 90, pot: 100 });

    useGameStore.getState().playerRaise(300); // 增量 200 ≥ 90，合法

    const s = useGameStore.getState();
    expect(s.currentMaxBet).toBe(300);
    expect(s.lastRaiseSize).toBe(200);
  });
});

describe('Bug3 回归：不完整 All-in 加注不重新开放加注', () => {
  it('已行动玩家被禁止再加注，未行动玩家不受影响', () => {
    setupMidHand([
      makePlayer({ id: 'ai_0', currentBet: 100, hasActed: true, chips: 900 }),
      makePlayer({ id: 'human', isAI: false, currentBet: 100, hasActed: true, chips: 900 }),
      makePlayer({ id: 'ai_1', currentBet: 0, chips: 130 }), // 短码，全下 130（增量 30 < 90）
      makePlayer({ id: 'ai_2', currentBet: 0, chips: 900 }),
    ], { currentPlayerIndex: 2, currentMaxBet: 100, lastRaiseSize: 90, pot: 200 });

    useGameStore.getState().playerRaise(130);

    const s = useGameStore.getState();
    expect(s.currentMaxBet).toBe(130); // 大家必须跟到 130
    expect(s.lastRaiseSize).toBe(90);  // 最小加注增量不变
    expect(s.players[0].canRaise).toBe(false); // 已行动 → 只能跟/弃
    expect(s.players[1].canRaise).toBe(false);
    expect(s.players[3].canRaise).toBe(true);  // 未行动 → 仍可加注
  });

  it('canRaise=false 的玩家调用 playerRaise 会被降级为跟注', () => {
    setupMidHand([
      makePlayer({ id: 'ai_0', currentBet: 100, hasActed: true, canRaise: false, chips: 900 }),
      makePlayer({ id: 'ai_1', currentBet: 130, status: 'all-in', chips: 0 }),
      makePlayer({ id: 'ai_2', currentBet: 0, chips: 900 }),
    ], { currentPlayerIndex: 0, currentMaxBet: 130, lastRaiseSize: 90, pot: 330 });

    useGameStore.getState().playerRaise(500); // 试图加注，但无权限

    const s = useGameStore.getState();
    expect(s.players[0].currentBet).toBe(130); // 只补到跟注额
    expect(s.currentMaxBet).toBe(130);         // 不构成加注
    expect(s.lastRaiseSize).toBe(90);
  });

  it('完整加注后所有玩家恢复加注权限', () => {
    setupMidHand([
      makePlayer({ id: 'ai_0', currentBet: 100, hasActed: true, canRaise: false, chips: 900 }),
      makePlayer({ id: 'human', isAI: false, currentBet: 100, hasActed: true, canRaise: false, chips: 900 }),
      makePlayer({ id: 'ai_1', currentBet: 130, status: 'all-in', chips: 0 }),
      makePlayer({ id: 'ai_2', currentBet: 0, chips: 900 }),
    ], { currentPlayerIndex: 3, currentMaxBet: 130, lastRaiseSize: 90, pot: 330 });

    useGameStore.getState().playerRaise(230); // 增量 100 ≥ 90，完整加注

    const s = useGameStore.getState();
    expect(s.currentMaxBet).toBe(230);
    expect(s.lastRaiseSize).toBe(100);
    expect(s.players[0].canRaise).toBe(true); // 行动重新开放
    expect(s.players[1].canRaise).toBe(true);
  });
});

describe('每街重置', () => {
  it('进入新街后 lastRaiseSize 重置为大盲，canRaise 全部恢复', () => {
    setupMidHand([
      makePlayer({ id: 'ai_0', currentBet: 100, hasActed: true, canRaise: false, chips: 900 }),
      makePlayer({ id: 'ai_1', currentBet: 100, hasActed: true, canRaise: false, chips: 900 }),
    ], { currentPlayerIndex: 1, currentMaxBet: 100, lastRaiseSize: 90, pot: 200, stage: 'flop' });

    // ai_1 已平齐且行动过 → 直接推进到转牌
    useGameStore.getState().playerCheck();

    const s = useGameStore.getState();
    expect(s.stage).toBe('turn');
    expect(s.lastRaiseSize).toBe(10); // 大盲
    expect(s.players.every(p => p.canRaise)).toBe(true);
  });
});
