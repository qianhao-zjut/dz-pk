import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useGameStore } from './gameStore';
import type { Player } from './gameStore';
import type { TableConfig } from '../components/Lobby';
import { createDeck } from '../utils/poker';
import { buildObservation, toNpcSource } from '../ai/observation';
import { getNpcDiagnostics, getNpcLimits, resetNpcRuntimeForTests, setNpcLimits } from '../ai/runtime';

const TABLE: TableConfig = { id: 'test', name: '测试桌', smallBlind: 5, bigBlind: 10, buyIn: 1000 };

const makePlayer = (overrides: Partial<Player> & { id: string }): Player => ({
  name: overrides.id,
  isAI: true,
  chips: 1000,
  cards: [],
  currentBet: 0,
  invested: 0,
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

const BOARD_DRY = ['2h', '7c', '9d', 'Jc', '8c'];

/** 跟注或过牌直到摊牌。已经 all-in 的座位不得被轮到。 */
const callOrCheckToShowdown = (forbiddenIndex: number) => {
  const seen: number[] = [];
  for (let i = 0; i < 24; i++) {
    const s = useGameStore.getState();
    if (s.stage === 'showdown') break;
    expect(s.currentPlayerIndex).not.toBe(forbiddenIndex);
    expect(s.players[s.currentPlayerIndex].status).toBe('active');
    seen.push(s.currentPlayerIndex);
    const actor = s.players[s.currentPlayerIndex];
    if (actor.currentBet < s.currentMaxBet) useGameStore.getState().playerCall();
    else useGameStore.getState().playerCheck();
  }
  expect(useGameStore.getState().stage).toBe('showdown');
  expect(seen).not.toContain(forbiddenIndex);
  return seen;
};

describe('本手投入与摊牌分池', () => {
  it('不等额全下：短码只赢两边都投入的部分，超额退回', () => {
    setupMidHand([
      makePlayer({
        id: 'hero', name: '你', isAI: false,
        cards: ['As', 'Kd'], chips: 400, invested: 100, status: 'active',
      }),
      makePlayer({
        id: 'short', name: '短码',
        cards: ['Ah', 'Ad'], chips: 10, invested: 30, status: 'all-in',
      }),
      makePlayer({
        id: 'folder', name: '弃牌',
        cards: ['2c', '3d'], chips: 200, invested: 0, status: 'folded',
      }),
    ], { currentPlayerIndex: 0, currentMaxBet: 100, lastRaiseSize: 10, pot: 130, stage: 'river' });
    useGameStore.setState({ board: BOARD_DRY, dealerIndex: 0 });

    const before = totalChipsInSystem();
    useGameStore.getState().handleShowdown();

    const s = useGameStore.getState();
    expect(s.pot).toBe(0);
    expect(s.players[0].chips).toBe(470); // 只退回 70，不赢主池
    expect(s.players[0].invested).toBe(30);
    expect(s.players[1].chips).toBe(70); // 10 + 赢下的 60
    expect(s.players[2].chips).toBe(200);
    expect(totalChipsInSystem()).toBe(before);
  });

  it('边池：短码全下只赢主池，加注者赢边池', () => {
    setupMidHand([
      makePlayer({
        id: 'A', cards: ['As', 'Ah'], chips: 0, invested: 10, status: 'all-in',
      }),
      makePlayer({
        id: 'B', cards: ['Kd', 'Kc'], chips: 100, invested: 10,
      }),
      makePlayer({
        id: 'C', cards: ['Qd', 'Qc'], chips: 100, invested: 10,
      }),
    ], { currentPlayerIndex: 1, currentMaxBet: 0, lastRaiseSize: 10, pot: 30, stage: 'flop' });
    // 翻牌已在桌面；牌堆末尾两张依次是转牌、河牌
    useGameStore.setState({
      board: ['2s', '7c', '9d'],
      deck: ['3c', '4s'],
      dealerIndex: 0,
    });

    const before = totalChipsInSystem();
    useGameStore.getState().playerRaise(50);
    expect(useGameStore.getState().currentPlayerIndex).toBe(2);
    expect(useGameStore.getState().players[1].invested).toBe(60);
    useGameStore.getState().playerCall();

    const afterBet = useGameStore.getState();
    expect(afterBet.stage).toBe('turn');
    expect(afterBet.pot).toBe(130);
    expect(afterBet.players[0].invested).toBe(10); // 换街不清零
    expect(afterBet.players[1].currentBet).toBe(0);
    expect(afterBet.players[1].invested).toBe(60);
    expect(afterBet.players[2].invested).toBe(60);

    for (let i = 0; i < 8 && useGameStore.getState().stage !== 'showdown'; i++) {
      const s = useGameStore.getState();
      expect(s.players[s.currentPlayerIndex].status).toBe('active');
      useGameStore.getState().playerCheck();
    }

    const s = useGameStore.getState();
    expect(s.stage).toBe('showdown');
    expect(s.board.join(' ')).toBe('2s 7c 9d 4s 3c');
    expect(s.pot).toBe(0);
    expect(s.players[0].chips).toBe(30); // 只增加主池 30
    expect(s.players[1].chips).toBe(150); // 剩下 50，再赢边池 100
    expect(s.players[2].chips).toBe(50); // 跟了 50，不赢这一手的池
    expect(totalChipsInSystem()).toBe(before);
  });

  it('只剩一名未弃牌玩家时整池给他', () => {
    setupMidHand([
      makePlayer({ id: 'winner', cards: ['2c', '3d'], chips: 100, invested: 10, status: 'active' }),
      makePlayer({ id: 'folded', cards: ['As', 'Ah'], chips: 50, invested: 40, status: 'folded' }),
    ], { currentPlayerIndex: 0, currentMaxBet: 0, lastRaiseSize: 10, pot: 50, stage: 'river' });
    useGameStore.setState({ board: BOARD_DRY });

    const before = totalChipsInSystem();
    useGameStore.getState().handleShowdown();

    const s = useGameStore.getState();
    expect(s.players[0].chips).toBe(150);
    expect(s.players[1].chips).toBe(50);
    expect(s.pot).toBe(0);
    expect(totalChipsInSystem()).toBe(before);
  });

  it('平分余筹从按钮左手边开始发，弃牌玩家的投入算进底池但不能赢', () => {
    setupMidHand([
      makePlayer({ id: 'p0', cards: ['As', 'Kd'], chips: 100, invested: 5, status: 'active' }),
      makePlayer({ id: 'p1', cards: ['Ah', 'Kc'], chips: 100, invested: 5, status: 'active' }),
      makePlayer({ id: 'p2', cards: ['Qd', 'Qc'], chips: 40, invested: 5, status: 'folded' }),
    ], { currentPlayerIndex: 0, currentMaxBet: 0, lastRaiseSize: 10, pot: 15, stage: 'river' });
    useGameStore.setState({
      board: ['Qh', 'Js', '9c', '4h', '2s'],
      dealerIndex: 0,
    });

    const before = totalChipsInSystem();
    useGameStore.getState().handleShowdown();

    const s = useGameStore.getState();
    expect(s.pot).toBe(0);
    expect(s.players[0].chips).toBe(107);
    expect(s.players[1].chips).toBe(108); // 按钮左手边第一个赢家拿走余下的 1
    expect(s.players[2].chips).toBe(40);
    expect((s.players[0].chips - 100) + (s.players[1].chips - 100)).toBe(15);
    expect(totalChipsInSystem()).toBe(before);
  });

  it('坐出玩家即使牌最大也不分池', () => {
    setupMidHand([
      makePlayer({ id: 'p0', cards: ['As', 'Kd'], chips: 100, invested: 10, status: 'active' }),
      makePlayer({ id: 'p1', cards: ['Ah', 'Ad'], chips: 0, invested: 10, status: 'all-in' }),
      makePlayer({ id: 'out', cards: ['Js', 'Jh'], chips: 50, invested: 10, status: 'sitting-out' }),
    ], { currentPlayerIndex: 0, currentMaxBet: 0, lastRaiseSize: 10, pot: 30, stage: 'river' });
    useGameStore.setState({ board: BOARD_DRY, dealerIndex: 0 });

    const before = totalChipsInSystem();
    useGameStore.getState().handleShowdown();

    const s = useGameStore.getState();
    expect(s.pot).toBe(0);
    expect(s.players[0].chips).toBe(100);
    expect(s.players[1].chips).toBe(30);
    expect(s.players[2].chips).toBe(50);
    expect(totalChipsInSystem()).toBe(before);
  });
});

describe('短码盲注', () => {
  const startWithSeatChips = (chipsBySeat: Record<number, number>) => {
    useGameStore.getState().joinTable(TABLE, 1000);
    useGameStore.setState({
      dealerIndex: 0,
      players: useGameStore.getState().players.map((p, i) =>
        chipsBySeat[i] === undefined ? p : { ...p, chips: chipsBySeat[i] }
      ),
    });
    const before = totalChipsInSystem();
    useGameStore.getState().startHand();
    return before;
  };

  it('短码大盲全下，当前最高注是小盲实际下的 5', () => {
    const before = startWithSeatChips({ 2: 3 });
    const s = useGameStore.getState();

    expect(s.players[2].status).toBe('all-in');
    expect(s.players[2].chips).toBe(0);
    expect(s.players[2].currentBet).toBe(3);
    expect(s.players[2].invested).toBe(3);
    expect(s.players[1].currentBet).toBe(5);
    expect(s.players[1].invested).toBe(5);
    expect(s.players[1].status).toBe('active');
    expect(s.currentMaxBet).toBe(5);
    expect(s.lastRaiseSize).toBe(10);
    expect(s.currentPlayerIndex).not.toBe(2);

    callOrCheckToShowdown(2);
    expect(useGameStore.getState().players[2].status).toBe('all-in');
    expect(useGameStore.getState().pot).toBe(0);
    expect(totalChipsInSystem()).toBe(before);
  });

  it('短码小盲全下后，行动不会轮到他', () => {
    const before = startWithSeatChips({ 1: 2 });
    const s = useGameStore.getState();

    expect(s.players[1].status).toBe('all-in');
    expect(s.players[1].chips).toBe(0);
    expect(s.players[1].currentBet).toBe(2);
    expect(s.players[1].invested).toBe(2);
    expect(s.players[2].chips).toBe(990);
    expect(s.players[2].currentBet).toBe(10);
    expect(s.players[2].status).toBe('active');
    expect(s.currentMaxBet).toBe(10);
    expect(s.lastRaiseSize).toBe(10);
    expect(s.currentPlayerIndex).not.toBe(1);

    callOrCheckToShowdown(1);
    expect(useGameStore.getState().players[1].status).toBe('all-in');
    expect(useGameStore.getState().pot).toBe(0);
    expect(totalChipsInSystem()).toBe(before);
  });
});

describe('NPC 决策接入', () => {
  const limits = getNpcLimits();
  afterEach(() => {
    setNpcLimits(limits);
    resetNpcRuntimeForTests();
  });

  const npcSource = () => {
    const state = useGameStore.getState();
    return toNpcSource({
      sessionId: state.sessionId,
      handNumber: state.handNumber,
      decisionRevision: state.decisionRevision,
      stage: state.stage,
      pot: state.pot,
      board: state.board,
      dealerIndex: state.dealerIndex,
      currentPlayerIndex: state.currentPlayerIndex,
      currentMaxBet: state.currentMaxBet,
      lastRaiseSize: state.lastRaiseSize,
      bigBlind: state.table?.bigBlind ?? 0,
      players: state.players,
      streetActions: state.streetActions,
      deck: state.deck,
      gameLog: state.gameLog,
    });
  };

  it('只写日志不推进决策版本，成功动作会推进', () => {
    setupMidHand([
      makePlayer({ id: 'ai_0', currentBet: 0, chips: 1000 }),
      makePlayer({ id: 'ai_1', currentBet: 0, chips: 1000 }),
    ], { currentPlayerIndex: 0, currentMaxBet: 0, lastRaiseSize: 10, pot: 20, stage: 'flop' });
    useGameStore.setState({ board: ['2c', '7d', '9h'], sessionId: 's', handNumber: 1 });
    const before = useGameStore.getState().decisionRevision;
    useGameStore.getState().logAction('只是教学提示');
    expect(useGameStore.getState().decisionRevision).toBe(before);
    useGameStore.getState().playerCheck();
    expect(useGameStore.getState().decisionRevision).toBeGreaterThan(before);
  });

  it('翻前按自己的底牌行动，隐藏牌和诊断不进公开日志', async () => {
    setupMidHand([
      makePlayer({ id: 'human', isAI: false, currentBet: 10, chips: 990, cards: ['Qc', 'Qd'] }),
      makePlayer({ id: 'ai_0', currentBet: 0, chips: 1000, cards: ['7c', '2d'] }),
      makePlayer({ id: 'ai_1', currentBet: 0, chips: 1000, cards: ['As', 'Ad'] }),
      makePlayer({ id: 'ai_2', currentBet: 0, chips: 1000, cards: ['7h', '2c'] }),
    ], { currentPlayerIndex: 3, currentMaxBet: 10, lastRaiseSize: 10, pot: 15, stage: 'preflop' });
    useGameStore.setState({
      sessionId: 's',
      handNumber: 1,
      dealerIndex: 0,
      board: [],
      deck: ['4h', '5h', '6h'],
      streetActions: [
        { actorId: 'ai_0', stage: 'preflop', kind: 'post', to: 5 },
        { actorId: 'ai_1', stage: 'preflop', kind: 'post', to: 10 },
      ],
    });

    const first = buildObservation(npcSource());
    useGameStore.setState({
      deck: ['9c', '9d', '9h'],
      players: useGameStore.getState().players.map((player) => (
        player.id === 'human' ? { ...player, cards: ['Js', 'Jc'] } : player
      )),
    });
    expect(buildObservation(npcSource())).toEqual(first);

    await useGameStore.getState().actAI();
    const folded = useGameStore.getState();
    expect(folded.players[3].status).toBe('folded');
    expect(folded.gameLog.join('\n')).not.toContain('preflop-open-fold');
    expect(folded.gameLog.join('\n')).not.toContain('均匀随机');
    expect(getNpcDiagnostics().some((item) => item.reasonCode === 'preflop-open-fold')).toBe(true);

    setupMidHand([
      makePlayer({ id: 'human', isAI: false, currentBet: 10, chips: 990 }),
      makePlayer({ id: 'ai_0', currentBet: 0, chips: 1000 }),
      makePlayer({ id: 'ai_1', currentBet: 0, chips: 1000 }),
      makePlayer({ id: 'ai_2', currentBet: 0, chips: 1000, cards: ['As', 'Ad'] }),
    ], { currentPlayerIndex: 3, currentMaxBet: 10, lastRaiseSize: 10, pot: 15, stage: 'preflop' });
    useGameStore.setState({ sessionId: 's', handNumber: 1, dealerIndex: 0, board: [] });
    await useGameStore.getState().actAI();
    const raised = useGameStore.getState().players[3];
    expect(raised.currentBet).toBeGreaterThan(10);
    expect(raised.chips).toBeLessThan(1000);
  });

  it('连续行动、全下后摊牌和离桌不会卡死，筹码守恒', async () => {
    setNpcLimits({ samples: 8, timeBudgetMs: 20, batchSize: 8, overallTimeoutMs: 1000 });
    useGameStore.getState().joinTable(TABLE, 1000);
    const before = totalChipsInSystem();
    useGameStore.getState().startHand();
    for (let guard = 0; guard < 48 && useGameStore.getState().stage !== 'showdown'; guard++) {
      const state = useGameStore.getState();
      const actor = state.players[state.currentPlayerIndex];
      expect(actor.chips).toBeGreaterThanOrEqual(0);
      if (actor.isAI) await state.actAI();
      else if (actor.currentBet < state.currentMaxBet) state.playerCall();
      else state.playerCheck();
    }
    expect(useGameStore.getState().stage).toBe('showdown');
    expect(useGameStore.getState().players.every((player) => player.chips >= 0)).toBe(true);
    expect(totalChipsInSystem()).toBe(before);
    const humanChips = useGameStore.getState().players.find((player) => player.id === 'human')?.chips ?? -1;
    expect(useGameStore.getState().leaveTable()).toBe(humanChips);
    expect(useGameStore.getState().table).toBeNull();
  });

  it('河牌短码坚果会全下，而不是过牌', async () => {
    setNpcLimits({ samples: 20, timeBudgetMs: 30, batchSize: 20, overallTimeoutMs: 1000 });
    setupMidHand([
      makePlayer({ id: 'human', isAI: false, chips: 500, invested: 60, cards: ['9c', '8d'] }),
      makePlayer({ id: 'ai_0', chips: 30, invested: 60, cards: ['As', 'Ad'] }),
    ], { currentPlayerIndex: 1, currentMaxBet: 0, lastRaiseSize: 10, pot: 120, stage: 'river' });
    useGameStore.setState({
      board: ['Ac', 'Ah', 'Kd', '7c', '2s'],
      sessionId: 's',
      handNumber: 3,
      dealerIndex: 0,
    });
    await useGameStore.getState().actAI();
    const ai = useGameStore.getState().players[1];
    expect(ai.status).toBe('all-in');
    expect(ai.chips).toBe(0);
    expect(ai.currentBet).toBe(30);
  });
});
