import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../store/gameStore';
import type { Player } from '../store/gameStore';
import type { TableConfig } from '../components/Lobby';
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
});
