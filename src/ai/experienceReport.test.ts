import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { decide as decideBaseline } from './baseline/strategy';
import { profileFor as baselineProfile } from './baseline/profiles';
import { expandRangeToken, handKey } from './cards';
import { mulberry32 } from './rng';
import {
  resetNpcRuntimeForTests,
  setDecideOverrideForTests,
  setNpcDecisionRngForTests,
  setNpcLimits,
  setNpcYieldForTests,
} from './runtime';
import type { CompletedHand } from '../game/handRecord';
import { resetHandHistoryForTests, useHandHistoryStore } from '../store/handHistoryStore';
import { useGameStore } from '../store/gameStore';
import { setShuffleRngForTests } from '../utils/poker';

const SEED = 20261024;
const HANDS = 500;
const OPEN = new Set(['77+', 'ATs+', 'AJo+', 'KQs', 'KJs', 'QJs', 'JTs'].flatMap(expandRangeToken));
const CALL = new Set(['22+', 'A9s+', 'ATo+', 'KTs+', 'KQo', 'QJs', 'JTs', 'T9s', '98s'].flatMap(expandRangeToken));

interface Tally {
  hands: number;
  sawFlop: number;
  humanSawFlop: number;
  stealOpp: number;
  steals: number;
  defendOpp: number;
  defends: number;
  vpip: Record<string, { hands: number; voluntary: number }>;
}

function emptyTally(): Tally {
  return { hands: 0, sawFlop: 0, humanSawFlop: 0, stealOpp: 0, steals: 0, defendOpp: 0, defends: 0, vpip: {} };
}

function absorb(hand: CompletedHand, tally: Tally): void {
  tally.hands += 1;
  const sawFlop = hand.board.length >= 3;
  if (sawFlop) tally.sawFlop += 1;
  const humanFolded = hand.actions.some((action) => action.actorId === 'human' && action.street === 'preflop' && action.kind === 'fold');
  if (sawFlop && !humanFolded) tally.humanSawFlop += 1;
  const pre = hand.actions.filter((action) => action.street === 'preflop');
  const button = hand.seats.find((seat) => seat.role === 'BTN');
  const blind = hand.seats.find((seat) => seat.role === 'BB');
  const buttonAction = pre.find((action) => action.actorId === button?.id && action.kind !== 'post');
  if (buttonAction) {
    const earlier = pre.filter((action) => action.actionSeq < buttonAction.actionSeq);
    if (!earlier.some((action) => action.kind === 'raise' || action.kind === 'call')) {
      tally.stealOpp += 1;
      if (buttonAction.kind === 'raise') tally.steals += 1;
    }
  }
  const blindAction = pre.find((action) => action.actorId === blind?.id && action.kind !== 'post');
  if (blindAction && button) {
    const raises = pre.filter((action) => action.kind === 'raise' && action.actionSeq < blindAction.actionSeq);
    if (raises.length === 1 && raises[0]?.actorId === button.id) {
      tally.defendOpp += 1;
      if (blindAction.kind === 'call' || blindAction.kind === 'raise') tally.defends += 1;
    }
  }
  for (const seat of hand.seats) {
    const row = tally.vpip[seat.id] ?? { hands: 0, voluntary: 0 };
    row.hands += 1;
    if (pre.some((action) => action.actorId === seat.id && (action.kind === 'call' || action.kind === 'raise'))) row.voluntary += 1;
    tally.vpip[seat.id] = row;
  }
}

function humanAct(): void {
  const state = useGameStore.getState();
  const human = state.players[state.currentPlayerIndex];
  const toCall = Math.max(0, state.currentMaxBet - human.currentBet);
  const key = human.cards.length === 2 ? handKey(human.cards[0], human.cards[1]) : null;
  const bb = state.table?.bigBlind ?? 10;
  if (state.stage === 'preflop') {
    const raises = state.streetActions.filter((action) => action.stage === 'preflop' && action.kind === 'raise').length;
    if (toCall === 0) {
      if (key && OPEN.has(key) && human.canRaise) state.playerRaise(Math.max(state.currentMaxBet + state.lastRaiseSize, Math.round(2.5 * bb)));
      else state.playerCheck();
      return;
    }
    if (raises === 0 && key && OPEN.has(key) && human.canRaise) {
      state.playerRaise(Math.round(2.5 * bb));
      return;
    }
    if (key && CALL.has(key) && toCall <= 4 * bb) state.playerCall();
    else state.playerFold();
    return;
  }
  if (toCall === 0) state.playerCheck();
  else if (toCall <= Math.max(bb, Math.round(state.pot * 0.35))) state.playerCall();
  else state.playerFold();
}

async function playSample(mode: 'old' | 'new'): Promise<Tally> {
  resetHandHistoryForTests();
  resetNpcRuntimeForTests();
  setNpcYieldForTests(false);
  setNpcLimits({ samples: 8, timeBudgetMs: 15, batchSize: 8, overallTimeoutMs: 300 });
  setDecideOverrideForTests(mode === 'old'
    ? (obs, _profile, options) => decideBaseline(obs, baselineProfile(obs.actorId), options)
    : null);
  useGameStore.setState(useGameStore.getInitialState());
  useGameStore.getState().joinTable(
    { id: 'sim', name: '对照桌', smallBlind: 5, bigBlind: 10, buyIn: 1000, buyInBb: 100, opponents: 'mixed' },
    1000,
  );
  const tally = emptyTally();
  for (let hand = 0; hand < HANDS; hand += 1) {
    setShuffleRngForTests(mulberry32(SEED + hand));
    setNpcDecisionRngForTests(mulberry32(SEED + 1_000_000 + hand));
    useGameStore.getState().startHand();
    for (let guard = 0; guard < 80 && useGameStore.getState().stage !== 'showdown'; guard += 1) {
      const actor = useGameStore.getState().players[useGameStore.getState().currentPlayerIndex];
      if (!actor || actor.status !== 'active') break;
      if (actor.isAI) await useGameStore.getState().actAI();
      else humanAct();
    }
    expect(useGameStore.getState().stage).toBe('showdown');
    const archived = useHandHistoryStore.getState().hands.at(-1);
    expect(archived?.handNumber).toBe(hand + 1);
    if (archived) absorb(archived, tally);
  }
  return tally;
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return '无样本';
  return `${((part / whole) * 100).toFixed(1)}%（${part}/${whole}）`;
}

function render(oldStats: Tally, newStats: Tally): string {
  const line = (title: string, stats: Tally) => [
    `### ${title}`,
    `- 见到翻牌：${pct(stats.sawFlop, stats.hands)}`,
    `- 人类见到翻牌：${pct(stats.humanSawFlop, stats.hands)}`,
    `- 按钮无人开池时加注：${pct(stats.steals, stats.stealOpp)}`,
    `- 大盲面对按钮开池后继续：${pct(stats.defends, stats.defendOpp)}`,
    ...Object.entries(stats.vpip).map(([id, row]) => `- ${id} 主动入池（不含盲注）：${pct(row.voluntary, row.hands)}`),
  ].join('\n');
  return [
    '# 固定种子体验对照',
    '',
    `种子 ${SEED}，每种决策各 ${HANDS} 手，四人桌 $5/$10、100bb。发牌用 mulberry32(种子+手数)，决策和权益抽样用 mulberry32(种子+1000000+手数)，两条序列互不混用。`,
    '',
    '人类策略固定，不读取新旧 NPC 范围：翻前开池范围为 77+、ATs+、AJo+、KQs、KJs、QJs、JTs；无人加注时开到 2.5bb，面对加注时只在 22+、A9s+、ATo+、KTs+、KQo、QJs、JTs、T9s、98s 且跟注不超过 4bb 时跟注。翻后免费就过牌，跟注不超过一个大盲和当前池 35% 中的较大值。没有为了制造翻牌而强行跟注。',
    '',
    '旧决策是 802980b 的冻结启发式。新决策是本次范围和混合。两边都只抽 8 次翻后权益，用来比较体验，不代表长期胜率或最优策略。按钮开池和大盲防守把固定人类算进机会，所以低于范围报告里的纯 NPC 组合频率。试玩没有调用资金接口和云端日志。',
    '',
    line('旧 NPC', oldStats),
    '',
    line('新 NPC', newStats),
    '',
  ].join('\n');
}

afterEach(() => {
  setShuffleRngForTests(null);
  setNpcDecisionRngForTests(null);
  setDecideOverrideForTests(null);
  setNpcYieldForTests(null);
  resetNpcRuntimeForTests();
});

describe('固定种子体验', () => {
  it('对照 500 手旧决策和新决策', async () => {
    expect(typeof localStorage).toBe('undefined');
    const oldStats = await playSample('old');
    const newStats = await playSample('new');
    expect(oldStats.hands).toBe(HANDS);
    expect(newStats.hands).toBe(HANDS);
    expect(oldStats.stealOpp).toBeGreaterThan(0);
    expect(newStats.stealOpp).toBeGreaterThan(0);
    mkdirSync(new URL('../../docs/superpowers/reports/', import.meta.url), { recursive: true });
    writeFileSync(new URL('../../docs/superpowers/reports/2026-10-24-experience.md', import.meta.url), render(oldStats, newStats));
  }, 180000);
});
