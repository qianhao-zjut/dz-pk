import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../store/gameStore';
import type { Player } from '../store/gameStore';
import type { TableConfig } from '../components/Lobby';
import type { LiveHand, RecordedAction } from '../game/handRecord';
import { sessionFromTable } from '../game/sessionConfig';
import { applyExternalAction } from './applyAction';

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

const noDeduct = () => {
  throw new Error('不应扣款');
};

beforeEach(() => {
  useGameStore.setState(useGameStore.getInitialState());
});

describe('applyExternalAction', () => {
  it('没坐下时拒绝', () => {
    const result = applyExternalAction({ action: 'fold' }, noDeduct);
    expect(result).toEqual({ ok: false, action: 'fold', error: 'no_table' });
  });

  it('没轮到你时不替别人弃牌', () => {
    useGameStore.setState({
      table: TABLE,
      stage: 'flop',
      players: [
        makePlayer({ id: 'human', name: '你', isAI: false }),
        makePlayer({ id: 'ai_0' }),
      ],
      currentPlayerIndex: 1,
      currentMaxBet: 0,
      lastRaiseSize: 10,
    });

    const result = applyExternalAction({ action: 'fold' }, noDeduct);
    expect(result.error).toBe('not_your_turn');
    expect(useGameStore.getState().players[1].status).toBe('active');
  });

  it('面对下注时不能过牌，可以跟注', () => {
    useGameStore.setState({
      table: TABLE,
      stage: 'flop',
      pot: 20,
      players: [
        makePlayer({ id: 'ai_0', currentBet: 20, hasActed: true, chips: 980 }),
        makePlayer({ id: 'human', name: '你', isAI: false, chips: 200 }),
      ],
      currentPlayerIndex: 1,
      currentMaxBet: 20,
      lastRaiseSize: 20,
    });

    expect(applyExternalAction({ action: 'check' }, noDeduct).error).toBe('illegal_action');
    expect(useGameStore.getState().players[1].chips).toBe(200);

    const called = applyExternalAction({ action: 'call' }, noDeduct);
    expect(called).toEqual({ ok: true, action: 'call' });
    expect(useGameStore.getState().players[1].chips).toBe(180);
  });

  it('全下走加注到剩余筹码', () => {
    useGameStore.setState({
      table: TABLE,
      stage: 'flop',
      pot: 20,
      players: [
        makePlayer({ id: 'ai_0', currentBet: 20, hasActed: true, chips: 980 }),
        makePlayer({ id: 'human', name: '你', isAI: false, chips: 200, currentBet: 0 }),
        makePlayer({ id: 'ai_1', chips: 500 }),
      ],
      currentPlayerIndex: 1,
      currentMaxBet: 20,
      lastRaiseSize: 20,
    });

    expect(applyExternalAction({ action: 'allin' }, noDeduct)).toEqual({ ok: true, action: 'allin' });
    const human = useGameStore.getState().players[1];
    expect(human.chips).toBe(0);
    expect(human.status).toBe('all-in');
  });

  it('不允许加注时拒绝 allin', () => {
    useGameStore.setState({
      table: TABLE,
      stage: 'flop',
      players: [
        makePlayer({ id: 'human', name: '你', isAI: false, chips: 200, canRaise: false }),
      ],
      currentPlayerIndex: 0,
      currentMaxBet: 20,
      lastRaiseSize: 20,
    });

    expect(applyExternalAction({ action: 'allin' }, noDeduct).error).toBe('illegal_action');
    expect(useGameStore.getState().players[0].chips).toBe(200);
  });

  it('这一手还在进行时不能发牌', () => {
    useGameStore.setState({
      table: TABLE,
      stage: 'flop',
      players: [makePlayer({ id: 'human', name: '你', isAI: false, chips: 500 })],
      currentPlayerIndex: 0,
    });
    expect(applyExternalAction({ action: 'deal' }, noDeduct).error).toBe('hand_in_progress');
  });

  it('筹码为 0 时 deal 要求重买，rebuy 扣款后发牌', () => {
    const seats = [
      makePlayer({ id: 'human', name: '你', isAI: false, chips: 0 }),
      makePlayer({ id: 'ai_0', chips: 1000 }),
      makePlayer({ id: 'ai_1', chips: 1000 }),
      makePlayer({ id: 'ai_2', chips: 1000 }),
    ];
    useGameStore.setState({
      table: TABLE,
      stage: 'showdown',
      players: seats,
      dealerIndex: 0,
      currentPlayerIndex: -1,
      handNumber: 2,
    });

    expect(applyExternalAction({ action: 'deal' }, noDeduct).error).toBe('need_rebuy');

    const deducted: number[] = [];
    const bought = applyExternalAction({ action: 'rebuy' }, (amount) => {
      deducted.push(amount);
      return true;
    });
    expect(bought).toEqual({ ok: true, action: 'rebuy' });
    expect(deducted).toEqual([1000]);
    const after = useGameStore.getState();
    expect(after.stage).toBe('preflop');
    expect(after.handNumber).toBe(3);
    expect(after.players[0].chips).toBeGreaterThan(0);
  });

  it('资金不够时不重买', () => {
    useGameStore.setState({
      table: TABLE,
      stage: 'idle',
      players: [
        makePlayer({ id: 'human', name: '你', isAI: false, chips: 0 }),
        makePlayer({ id: 'ai_0' }),
        makePlayer({ id: 'ai_1' }),
        makePlayer({ id: 'ai_2' }),
      ],
      dealerIndex: 0,
    });

    const result = applyExternalAction({ action: 'rebuy' }, () => false);
    expect(result.error).toBe('insufficient_funds');
    expect(useGameStore.getState().stage).toBe('idle');
    expect(useGameStore.getState().players[0].chips).toBe(0);
  });

  const novice = { id: 't1', name: '新手桌 ($1/$2)', smallBlind: 1, bigBlind: 2, buyIn: 200 };
  const unsafe = Number.MAX_SAFE_INTEGER + 1;
  const seedAction: RecordedAction = {
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
  };

  const setupHumanRaise = () => {
    const liveHand: LiveHand = {
      sessionId: 's',
      handNumber: 1,
      startedAt: '2026-10-24T00:00:00.000Z',
      config: sessionFromTable(novice),
      dealerIndex: 0,
      seats: [],
      actions: [seedAction],
    };
    useGameStore.setState({
      table: novice,
      stage: 'preflop',
      pot: 3,
      players: [
        makePlayer({ id: 'human', name: '你', isAI: false, chips: 200 }),
        makePlayer({ id: 'ai_0', chips: 199, currentBet: 1, invested: 1 }),
        makePlayer({ id: 'ai_1', chips: 198, currentBet: 2, invested: 2 }),
        makePlayer({ id: 'ai_2', chips: 200, status: 'folded', hasActed: true }),
      ],
      currentPlayerIndex: 0,
      currentMaxBet: 2,
      lastRaiseSize: 2,
      decisionRevision: 4,
      gameLog: ['已有日志'],
      streetActions: [{ actorId: 'ai_2', stage: 'preflop', kind: 'fold', to: null }],
      liveHand,
      handNumber: 1,
      sessionId: 's',
    });
  };

  const copiedActions = () => {
    const state = useGameStore.getState();
    return {
      gameLog: [...state.gameLog],
      streetActions: state.streetActions.map((action) => ({ ...action })),
      liveActions: state.liveHand?.actions.map((action) => ({
        ...action,
        board: [...action.board],
        npc: action.npc ? { ...action.npc, assumptions: [...action.npc.assumptions] } : null,
      })) ?? null,
      revision: state.decisionRevision,
      pot: state.pot,
      chips: state.players.map((player) => player.chips),
      turn: state.currentPlayerIndex,
    };
  };

  it.each([6.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -4, unsafe])(
    '加注到 %s 返回 bad_amount，且 store 拒绝后不报成功',
    (to) => {
      setupHumanRaise();
      const before = copiedActions();
      const result = applyExternalAction({ action: 'raise', to }, noDeduct);
      expect(result).toEqual({ ok: false, action: 'raise', error: 'bad_amount' });
      const after = useGameStore.getState();
      expect(after.gameLog).toEqual(before.gameLog);
      expect(after.streetActions).toEqual(before.streetActions);
      expect(after.liveHand?.actions).toEqual(before.liveActions);
      expect(after.decisionRevision).toBe(before.revision);
      expect(after.pot).toBe(before.pot);
      expect(after.players.map((player) => player.chips)).toEqual(before.chips);
      expect(after.currentPlayerIndex).toBe(before.turn);
    },
  );

  it('合法整数加注会执行', () => {
    setupHumanRaise();
    const result = applyExternalAction({ action: 'raise', to: 6 }, noDeduct);
    expect(result).toEqual({ ok: true, action: 'raise' });
    expect(useGameStore.getState().players[0].currentBet).toBe(6);
    expect(useGameStore.getState().pot).toBe(9);
  });
});
