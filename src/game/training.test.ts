import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { reasonText } from './handRecord';
import { executeDecision, liveTurnFrom } from '../ai/executor';
import { toNpcSource } from '../ai/observation';
import { getNpcLimits, resetNpcRuntimeForTests, setNpcLimits } from '../ai/runtime';
import { Lobby } from '../components/Lobby';
import { ReviewBody } from '../components/HandReview';
import type { TableConfig } from '../components/Lobby';
import { stackText } from './positions';
import { analyzeDraws } from './draws';
import { quoteCall, type QuotePlayer } from './priceQuote';
import { reviewAutoOpenDecision } from './reviewGate';
import { bankrollAdvice, npcsFor, resolveBuyIn, sessionFromTable, tableFromSelection, LEVELS } from './sessionConfig';
import { RANGE_CONFIG_VERSION } from '../ai/profiles';
import { actionShortcuts, raiseVerb } from './shortcuts';
import { resetHandHistoryForTests, useHandHistoryStore } from '../store/handHistoryStore';
import { useGameStore } from '../store/gameStore';

const TABLE: TableConfig = { id: 'test', name: '测试桌', smallBlind: 5, bigBlind: 10, buyIn: 1000 };

const seat = (id: string, invested: number, chips: number, currentBet = invested): QuotePlayer => ({
  id,
  invested,
  chips,
  currentBet,
  status: 'active',
});

beforeEach(() => {
  resetHandHistoryForTests();
  resetNpcRuntimeForTests();
  useGameStore.setState(useGameStore.getInitialState());
});

describe('界面文案', () => {
  it('大厅提供深度、对手和回顾开关，牌桌标出位置', () => {
    const lobby = renderToStaticMarkup(React.createElement(Lobby, { onJoinTable: () => undefined }));
    expect(lobby).toContain('40bb');
    expect(lobby).toContain('200bb');
    expect(lobby).toContain('每手结束自动展开回顾');
    expect(lobby).not.toContain('破产风险极高');
    expect(lobby).toContain('混合对手');
    expect(lobby).toContain('当前组合：稳健、松凶、松跟。');
  });
});

describe('跟注价格', () => {
  it('用当前底池而不是下注尺度计算第 1 手门槛', () => {
    const first = quoteCall(seat('human', 0, 200, 0), 14, [seat('human', 0, 200, 0), seat('villain', 14, 200, 14)], 27);
    expect(first.approximate).toBe(false);
    expect(first.share).toBeCloseTo(0.5185, 3);
    expect(first.threshold).toBeCloseTo(0.3415, 3);
    expect(first.potAfter).toBe(41);
    expect(first.label).toContain('51.9%');
    expect(first.label).toContain('34.1%');
    expect(first.label).not.toContain('80.5%');

    const later = quoteCall(seat('human', 0, 200, 0), 33, [seat('human', 0, 200, 0), seat('villain', 33, 200, 33)], 74);
    expect(later.share).toBeCloseTo(33 / 74, 4);
    expect(later.threshold).toBeCloseTo(33 / 107, 4);
    expect(later.potAfter).toBe(107);
    expect(later.label).toContain('44.6%');
    expect(later.label).toContain('30.8%');
  });

  it('短码只报实际跟注，多边池不给虚假门槛', () => {
    const short = quoteCall(seat('human', 0, 5, 0), 14, [seat('human', 0, 5, 0), seat('villain', 5, 200, 14)], 27);
    expect(short.callCost).toBe(5);
    expect(short.shortAllIn).toBe(true);
    expect(short.label.startsWith('全下跟注 $5')).toBe(true);

    const folded: QuotePlayer = { ...seat('folded', 7, 0, 7), status: 'folded' };
    const multi = quoteCall(seat('human', 0, 200, 0), 14, [seat('human', 0, 200, 0), seat('villain', 20, 200, 20), folded], 27);
    expect(multi.approximate).toBe(true);
    expect(multi.threshold).toBeNull();
    expect(multi.label).toContain('多边池，仅作参考');

    const free = quoteCall(seat('human', 10, 90, 10), 10, [seat('human', 10, 90, 10)], 20);
    expect(free.freeCheck).toBe(true);
    expect(free.label).toBe('可以过牌');
  });
});

describe('快捷金额', () => {
  it('翻前按 bb 和倍数取整，翻后区分下注和加注', () => {
    const open = actionShortcuts({
      street: 'preflop', bigBlind: 5, pot: 7, currentMaxBet: 5, lastRaiseSize: 5,
      heroBet: 0, heroChips: 200, canRaise: true, raiseCount: 0, limpers: 1, inPosition: true,
    });
    expect(open.verb).toBe('加注');
    expect(open.shortcuts.find((item) => item.id === 'open-2.5')?.label).toBe('隔离 约 2.5bb · $13');
    expect(raiseVerb('flop', 0)).toBe('下注');
    expect(raiseVerb('flop', 20)).toBe('加注');

    const facing = actionShortcuts({
      street: 'preflop', bigBlind: 10, pot: 35, currentMaxBet: 25, lastRaiseSize: 15,
      heroBet: 10, heroChips: 400, canRaise: true, raiseCount: 1, limpers: 0, inPosition: false,
    });
    expect(facing.defaultRaiseTo).toBe(Math.round(25 * 3.5));
    expect(facing.shortcuts.some((item) => item.label.includes('加到 $'))).toBe(true);

    const bet = actionShortcuts({
      street: 'flop', bigBlind: 10, pot: 90, currentMaxBet: 0, lastRaiseSize: 10,
      heroBet: 0, heroChips: 400, canRaise: true, raiseCount: 0, limpers: 0, inPosition: true,
    });
    expect(bet.verb).toBe('下注');
    expect(bet.shortcuts.map((item) => item.raiseTo)).toContain(45);

    const jammed = actionShortcuts({
      street: 'preflop', bigBlind: 10, pot: 15, currentMaxBet: 10, lastRaiseSize: 10,
      heroBet: 0, heroChips: 25, canRaise: true, raiseCount: 0, limpers: 0, inPosition: true,
    });
    const allIns = jammed.shortcuts.filter((item) => item.allIn);
    expect(allIns).toHaveLength(1);
    expect(allIns[0]?.label).toBe('全下 $25');
  });
});

describe('听牌', () => {
  it('只计算本人下一张能完成的牌，后门和河牌不算 outs', () => {
    const flush = analyzeDraws(['Ah', 'Kh'], ['2h', '7h', '9c']);
    expect(flush.labels).toContain('同花听牌');
    expect(flush.outs.every((card) => card.endsWith('h'))).toBe(true);
    expect(new Set(flush.outs).size).toBe(flush.outs.length);

    const boardOnly = analyzeDraws(['As', 'Kd'], ['2h', '7h', '9h', 'Qh']);
    expect(boardOnly.labels).not.toContain('同花听牌');
    expect(boardOnly.outs.some((card) => card.endsWith('h'))).toBe(false);

    const openEnded = analyzeDraws(['9h', '8c'], ['7d', '6s', '2c']);
    expect(openEnded.labels).toContain('两头顺');
    const backdoor = analyzeDraws(['Ah', 'Kd'], ['2h', '7h', '9c']);
    expect(backdoor.backdoor.some((item) => item.includes('后门'))).toBe(true);
    expect(backdoor.outs.some((card) => card[1] !== 'h' && !['5', '6', 'T', 'J', 'Q'].includes(card[0]))).toBe(false);

    expect(analyzeDraws(['Ah', 'Kd'], ['2c', '7d', '9s', 'Jc', '3h']).outs).toEqual([]);
  });
});

describe('买入和对手', () => {
  it('40、100、200bb 改变买入，对手组合改变风格名字', () => {
    expect(resolveBuyIn(2, 40)).toBe(80);
    expect(resolveBuyIn(5, 100)).toBe(500);
    expect(resolveBuyIn(20, 200)).toBe(4000);
    const loose = npcsFor('loose');
    const tight = npcsFor('tight');
    expect(new Set(loose.map((seat) => seat.profileId))).toEqual(new Set(['ai_1']));
    expect(loose.every((seat) => seat.style === '松凶')).toBe(true);
    const mixed = npcsFor('mixed');
    expect(mixed.map((seat) => seat.profileId)).toEqual(['ai_0', 'ai_1', 'loose_passive']);
    expect(mixed.map((seat) => seat.style)).toEqual(['稳健', '松凶', '松跟']);
    expect(mixed.map((seat) => seat.id)).toEqual(['ai_0', 'ai_1', 'ai_2']);
    expect(new Set(tight.map((seat) => seat.profileId))).toEqual(new Set(['ai_2']));
    expect(tight.every((seat) => !seat.name.includes('激进'))).toBe(true);
    const table = tableFromSelection(LEVELS[0], 'short', 40, 'tight');
    expect(table.buyIn).toBe(80);
    expect(table.npcs?.every((seat) => seat.profileId === 'ai_2')).toBe(true);
    const selected = tableFromSelection(LEVELS[0], 'standard', 100, 'mixed');
    expect(selected.npcConfigVersion).toBe(RANGE_CONFIG_VERSION);
    expect(sessionFromTable(selected).npcConfigVersion).toBe(RANGE_CONFIG_VERSION);
    const legacy = sessionFromTable({ id: 'old', name: '旧桌', smallBlind: 1, bigBlind: 2, buyIn: 200, npcs: npcsFor('tight') });
    expect(legacy.npcConfigVersion).toBeUndefined();
    expect(legacy.npcs.every((seat) => seat.profileId === 'ai_2')).toBe(true);
    expect(sessionFromTable({ ...selected, npcConfigVersion: 'frozen-old' }).npcConfigVersion).toBe('frozen-old');
  });

  it('资金提示用可买入次数，不把 30 个买入写成破产概率', () => {
    const advice = bankrollAdvice(1390, 100);
    expect(advice.canSit).toBe(true);
    expect(advice.advice).toContain('13.9');
    expect(advice.advice).toContain('并非本次游戏的破产概率');
    expect(bankrollAdvice(50, 100).canSit).toBe(false);
    expect(stackText(180, 2)).toBe('$180 · 90bb');
    useGameStore.getState().joinTable({ ...TABLE, smallBlind: 1, bigBlind: 2, buyIn: 20, buyInBb: 10 }, 20);
    expect(useGameStore.getState().players.every((player) => player.chips === 20)).toBe(true);
    expect(useGameStore.getState().leaveTable()).toBe(20);
  });
});

describe('已完成手牌', () => {
  it('结算后保存，进行中不公开，过期决策不记行动', async () => {
    const limits = getNpcLimits();
    setNpcLimits({ ...limits, samples: 8, timeBudgetMs: 20, batchSize: 8, overallTimeoutMs: 500 });
    useGameStore.getState().joinTable(TABLE, 1000);
    useGameStore.getState().startHand();
    const started = useGameStore.getState();
    const actor = started.players[started.currentPlayerIndex];
    expect(actor.id).toBe('ai_2');
    useGameStore.setState({
      players: started.players.map((player) => player.id === 'ai_2' ? { ...player, cards: ['7c', '2d'] } : player),
      liveHand: started.liveHand && {
        ...started.liveHand,
        seats: started.liveHand.seats.map((seat) => seat.id === 'ai_2' ? { ...seat, holeCards: ['7c', '2d'] } : seat),
      },
    });
    expect(useHandHistoryStore.getState().hands).toHaveLength(0);
    await useGameStore.getState().actAI();
    const live = useGameStore.getState().liveHand;
    const npcFold = live?.actions.find((action) => action.actorId === 'ai_2' && action.kind === 'fold');
    expect(npcFold?.npc?.reasonCode).toBeTruthy();
    expect(npcFold?.npc?.actorId).toBe('ai_2');
    expect(npcFold?.npc?.turnToken).toBeTruthy();

    const source = toNpcSource({
      sessionId: useGameStore.getState().sessionId,
      handNumber: useGameStore.getState().handNumber,
      decisionRevision: useGameStore.getState().decisionRevision,
      stage: useGameStore.getState().stage,
      pot: useGameStore.getState().pot,
      board: useGameStore.getState().board,
      dealerIndex: useGameStore.getState().dealerIndex,
      currentPlayerIndex: useGameStore.getState().currentPlayerIndex,
      currentMaxBet: useGameStore.getState().currentMaxBet,
      lastRaiseSize: useGameStore.getState().lastRaiseSize,
      bigBlind: 10,
      players: useGameStore.getState().players,
      streetActions: useGameStore.getState().streetActions,
      deck: useGameStore.getState().deck,
      gameLog: useGameStore.getState().gameLog,
    });
    const before = useGameStore.getState().liveHand?.actions.length ?? 0;
    const stale = executeDecision(
      { turnToken: 'expired', actorId: useGameStore.getState().players[useGameStore.getState().currentPlayerIndex].id, move: { action: 'fold' } },
      () => liveTurnFrom(source),
      {
        fold: (ctx) => useGameStore.getState().playerFold(ctx),
        check: (ctx) => useGameStore.getState().playerCheck(ctx),
        call: (ctx) => useGameStore.getState().playerCall(ctx),
        raise: (raiseTo, ctx) => useGameStore.getState().playerRaise(raiseTo, ctx),
      },
    );
    expect(stale).toEqual({ ok: false, reason: 'stale' });
    expect(useGameStore.getState().liveHand?.actions).toHaveLength(before);

    while (useGameStore.getState().stage !== 'showdown') {
      useGameStore.getState().playerFold();
    }
    const finished = useHandHistoryStore.getState().hands;
    expect(finished).toHaveLength(1);
    expect(finished[0]?.endKind).toBe('folds');
    expect(finished[0]?.board).toEqual([]);
    expect(finished[0]?.actions.some((action) => action.street !== 'preflop')).toBe(false);
    expect(finished[0]?.seats.every((seat) => seat.holeCards.length === 2)).toBe(true);
    expect(finished[0]?.actions.some((action) => action.npc?.actorId === 'ai_2')).toBe(true);
    expect(useGameStore.getState().dealerIndex).not.toBe(finished[0]?.dealerIndex);
    const markup = renderToStaticMarkup(React.createElement(ReviewBody, { hand: finished[0]! }));
    expect(markup).toContain('7c');
    expect(markup).toContain('实际依据');
    expect(markup).toContain(reasonText(npcFold?.npc?.reasonCode ?? '', npcFold?.npc?.fallback === true));
  });

  it('自动展开只针对开关打开后的新手牌，刷新不补弹', async () => {
    expect(reviewAutoOpenDecision({ pendingId: 's:1', hand: { sessionId: 's', handNumber: 1 }, stage: 'preflop', sessionId: 's', handNumber: 1 })).toBe('wait');
    expect(reviewAutoOpenDecision({ pendingId: 's:1', hand: { sessionId: 's', handNumber: 1 }, stage: 'showdown', sessionId: 's', handNumber: 1 })).toBe('open');
    expect(reviewAutoOpenDecision({ pendingId: 's:1', hand: { sessionId: 's', handNumber: 1 }, stage: 'showdown', sessionId: 's', handNumber: 2 })).toBe('drop');
    expect(reviewAutoOpenDecision({ pendingId: 's:1', hand: { sessionId: 's', handNumber: 1 }, stage: 'idle', sessionId: 's', handNumber: 1 })).toBe('drop');

    const hand = {
      version: 1 as const,
      id: 's:1',
      sessionId: 's',
      handNumber: 1,
      startedAt: 't',
      endedAt: 't',
      config: {
        version: 1 as const,
        levelId: 't',
        levelName: '测试',
        smallBlind: 5,
        bigBlind: 10,
        scenarioId: 'standard' as const,
        buyInBb: 100,
        buyIn: 1000,
        opponents: 'mixed' as const,
        npcs: [],
      },
      dealerIndex: 0,
      seats: [],
      board: [],
      actions: [],
      payouts: [],
      results: [],
      endKind: 'folds' as const,
    };
    useHandHistoryStore.getState().archive(hand);
    expect(useHandHistoryStore.getState().pendingAutoOpenId).toBeNull();
    expect(useHandHistoryStore.getState().hands).toHaveLength(1);
    useHandHistoryStore.getState().setAutoOpenReview(true);
    expect(useHandHistoryStore.getState().pendingAutoOpenId).toBeNull();
    useHandHistoryStore.getState().archive({ ...hand, id: 's:2', handNumber: 2 });
    expect(useHandHistoryStore.getState().pendingAutoOpenId).toBe('s:2');
    useHandHistoryStore.getState().archive({ ...hand, id: 's:2', handNumber: 2, board: ['As'] });
    expect(useHandHistoryStore.getState().pendingAutoOpenId).toBe('s:2');
    await useHandHistoryStore.persist.rehydrate();
    expect(useHandHistoryStore.getState().pendingAutoOpenId).toBeNull();
    expect(useHandHistoryStore.getState().autoOpenReview).toBe(true);
    expect(useHandHistoryStore.getState().hands).toHaveLength(2);
    useHandHistoryStore.getState().setAutoOpenReview(false);
    useHandHistoryStore.getState().archive({ ...hand, id: 's:3', handNumber: 3 });
    expect(useHandHistoryStore.getState().pendingAutoOpenId).toBeNull();
    expect(useHandHistoryStore.getState().hands.map((item) => item.handNumber)).toEqual([1, 2, 3]);
  });

  it('翻牌结束不补造后面的街，离桌和下一手仍留着档案', () => {
    useGameStore.getState().joinTable(TABLE, 1000);
    useGameStore.getState().startHand();
    useGameStore.setState({ stage: 'flop', board: ['As', 'Kd', '2c'], currentMaxBet: 0, pot: 40, currentPlayerIndex: 0 });
    while (useGameStore.getState().stage !== 'showdown') useGameStore.getState().playerFold();
    const archived = useHandHistoryStore.getState().hands[0];
    expect(archived?.board).toEqual(['As', 'Kd', '2c']);
    expect(archived?.actions.every((action) => action.street === 'preflop' || action.street === 'flop')).toBe(true);
    const kept = archived?.id;
    useGameStore.getState().startHand();
    expect(useHandHistoryStore.getState().hands.some((hand) => hand.id === kept)).toBe(true);
    expect(useHandHistoryStore.getState().pendingAutoOpenId).toBeNull();
    useGameStore.getState().leaveTable();
    expect(useHandHistoryStore.getState().hands.some((hand) => hand.id === kept)).toBe(true);
  });

  it('只留最近 20 手，存储不可写时内存档案还在', () => {
    const sample = useHandHistoryStore.getState().hands;
    expect(sample).toEqual([]);
    const base = {
      version: 1 as const,
      sessionId: 'cap',
      startedAt: 't',
      endedAt: 't',
      config: {
        version: 1 as const,
        levelId: 't',
        levelName: '测试',
        smallBlind: 5,
        bigBlind: 10,
        scenarioId: 'standard' as const,
        buyInBb: 100,
        buyIn: 1000,
        opponents: 'mixed' as const,
        npcs: [],
      },
      dealerIndex: 0,
      seats: [],
      board: [],
      actions: [],
      payouts: [],
      results: [],
      endKind: 'folds' as const,
    };
    for (let n = 1; n <= 21; n += 1) {
      useHandHistoryStore.getState().archive({ ...base, id: `cap:${n}`, handNumber: n });
    }
    expect(useHandHistoryStore.getState().hands.map((hand) => hand.handNumber)[0]).toBe(2);
    expect(useHandHistoryStore.getState().hands).toHaveLength(20);

    const storage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => { throw new Error('blocked'); },
        setItem: () => { throw new Error('blocked'); },
        removeItem: () => { throw new Error('blocked'); },
      },
    });
    useHandHistoryStore.getState().archive({ ...base, id: 'cap:22', handNumber: 22 });
    expect(useHandHistoryStore.getState().hands.some((hand) => hand.handNumber === 22)).toBe(true);
    if (storage) Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
