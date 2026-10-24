import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { expandRangeToken, handKey } from './cards';
import {
  CALIBRATION_SEED,
  CALIBRATION_SEED_REPEAT,
  jointFoldRates,
  renderJointFold,
  type JointFoldRow,
} from './calibrationReport';
import { PROFILES, RANGE_CONFIG_VERSION, profileFor } from './profiles';
import { continueRate, measureMatrix, measureOpenedContinue, rowBy } from './rangeReport';
import { mulberry32 } from './rng';
import {
  resetNpcRuntimeForTests,
  setNpcDecisionRngForTests,
  setNpcLimits,
  setNpcYieldForTests,
} from './runtime';
import type { NpcSeat } from '../game/sessionConfig';
import { resetHandHistoryForTests } from '../store/handHistoryStore';
import { useGameStore } from '../store/gameStore';
import { setShuffleRngForTests } from '../utils/poker';

const OLD_MIX: NpcSeat[] = [
  { id: 'ai_0', name: '德州老手', profileId: 'ai_0', style: '稳健' },
  { id: 'ai_1', name: '激进小伙', profileId: 'ai_1', style: '松凶' },
  { id: 'ai_2', name: '保守大叔', profileId: 'ai_2', style: '保守' },
];
const NEW_MIX: NpcSeat[] = [
  { id: 'ai_0', name: '德州老手', profileId: 'ai_0', style: '稳健' },
  { id: 'ai_1', name: '激进小伙', profileId: 'ai_1', style: '松凶' },
  { id: 'ai_2', name: '松跟玩家', profileId: 'loose_passive', style: '松跟' },
];
const OPEN = new Set(['77+', 'ATs+', 'AJo+', 'KQs', 'KJs', 'QJs', 'JTs'].flatMap(expandRangeToken));
const CALL = new Set(['22+', 'A9s+', 'ATo+', 'KTs+', 'KQo', 'QJs', 'JTs', 'T9s', '98s'].flatMap(expandRangeToken));

function profilesFor(mix: NpcSeat[]): Array<ReturnType<typeof profileFor>> {
  return mix.map((seat) => profileFor(seat.profileId));
}

describe('联合全弃', () => {
  it('新默认在两个种子和 2.5/3bb 下不超过参考上限，并分开旧组合', () => {
    const rows: JointFoldRow[] = [];
    for (const seed of [CALIBRATION_SEED, CALIBRATION_SEED_REPEAT]) {
      for (const openBb of [2.5, 3]) {
        for (const mix of [
          { name: '旧混合', seats: OLD_MIX },
          { name: '新默认', seats: NEW_MIX },
        ]) {
          for (const row of jointFoldRates(profilesFor(mix.seats), seed, openBb)) {
            rows.push({ ...row, seed, mix: mix.name, openBb });
          }
        }
      }
    }
    const caps = { UTG: 0.55, BTN: 0.45, SB: 0.6 };
    for (const row of rows) {
      expect(row.trials).toBeGreaterThanOrEqual(4998);
      expect(row.foldedOut + (row.trials - row.foldedOut)).toBe(row.trials);
      if (row.mix === '新默认') expect(row.rate).toBeLessThanOrEqual(caps[row.humanSeat]);
    }
    const text = [
      renderJointFold(rows),
      '新默认参考上限是 UTG 55%、BTN 45%、SB 60%。这是训练体验目标，不是每一手都翻牌的承诺。',
      '旧混合仍使用保守策略 ID ai_2，但稳健和松凶的范围已经是本轮校准后的范围。规格第 2 节的 68.71% / 46.12% / 78.07% 是改范围前的旧混合，不能和这里的旧身份行直接比成“只换了人”。',
      '',
    ].join('\n');
    expect(text).toContain('4998');
    expect(text).toContain(String(CALIBRATION_SEED));
    if (process.env.WRITE_CALIBRATION_REPORT === '1') {
      const matrix = measureMatrix();
      const lineFor = (scenarioId: string, profileId: 'ai_0' | 'ai_1' | 'ai_2' | 'loose_passive') => {
        const freq = rowBy(matrix, scenarioId, profileId).freq;
        return `${rowBy(matrix, scenarioId, profileId).label} 继续 ${(continueRate(freq) * 100).toFixed(2)}%（跟注 ${(freq.call * 100).toFixed(2)}% / 加注 ${(freq.raise * 100).toFixed(2)}%）`;
      };
      const spots = ['bb-vs-utg-2.5-100', 'bb-vs-btn-2.5-100', 'bb-vs-sb-2.5-100', 'sb-vs-btn-2.5-100', 'sb-vs-utg-2.5-100', 'btn-vs-utg-2.5-100'];
      const freqText = spots.map((spot) => (
        `### ${spot}\n${(['ai_0', 'ai_1', 'loose_passive', 'ai_2'] as const).map((id) => `- ${lineFor(spot, id)}`).join('\n')}`
      )).join('\n\n');
      const threeBet = (['ai_0', 'ai_1', 'ai_2', 'loose_passive'] as const).map((id) => {
        const freq = measureOpenedContinue(PROFILES[id], PROFILES[id].openMultiple * 4, 100);
        return `- ${PROFILES[id].label} 开池 ${PROFILES[id].openMultiple}bb 面对 ${PROFILES[id].openMultiple * 4}bb：继续 ${((freq.call + freq.raise) * 100).toFixed(2)}%（跟注 ${(freq.call * 100).toFixed(2)}% / 4bet ${(freq.raise * 100).toFixed(2)}%）`;
      }).join('\n');
      mkdirSync(new URL('../../docs/superpowers/reports/', import.meta.url), { recursive: true });
      writeFileSync(new URL('../../docs/superpowers/reports/2026-10-24-four-player-calibration.md', import.meta.url), [
        `# 四人桌 NPC 校准报告`,
        '',
        `配置版本 \`${RANGE_CONFIG_VERSION}\`。种子 ${CALIBRATION_SEED} 与 ${CALIBRATION_SEED_REPEAT}。四人桌，大盲 10。`,
        '',
        freqText,
        '',
        '## 按钮已开池组合面对约 4 倍 3bet',
        '',
        threeBet,
        '',
        text,
      ].join('\n'));
    }
  });
});

interface FlopStats {
  dealt: number;
  tableFlop: number;
  humanFlop: number;
  humanOpen: number;
  openAllFold: number;
  openCall: number;
  openThreeBet: number;
  vpip: Record<string, { hands: number; voluntary: number }>;
}

function emptyStats(): FlopStats {
  return { dealt: 0, tableFlop: 0, humanFlop: 0, humanOpen: 0, openAllFold: 0, openCall: 0, openThreeBet: 0, vpip: {} };
}

function humanAct(): 'raise' | 'call' | 'fold' | 'check' {
  const state = useGameStore.getState();
  const human = state.players[state.currentPlayerIndex];
  const toCall = Math.max(0, state.currentMaxBet - human.currentBet);
  const key = human.cards.length === 2 ? handKey(human.cards[0], human.cards[1]) : null;
  const bb = state.table?.bigBlind ?? 10;
  const raises = state.streetActions.filter((action) => action.stage === 'preflop' && action.kind === 'raise').length;
  if (toCall === 0) {
    if (key && OPEN.has(key) && human.canRaise) {
      state.playerRaise(Math.max(state.currentMaxBet + state.lastRaiseSize, Math.round(2.5 * bb)));
      return 'raise';
    }
    state.playerCheck();
    return 'check';
  }
  if (raises === 0 && key && OPEN.has(key) && human.canRaise) {
    state.playerRaise(Math.round(2.5 * bb));
    return 'raise';
  }
  if (key && CALL.has(key) && toCall <= 4 * bb) {
    state.playerCall();
    return 'call';
  }
  state.playerFold();
  return 'fold';
}

async function playPreflopSample(mix: NpcSeat[], seed: number, hands: number, depthBb: number): Promise<FlopStats> {
  resetHandHistoryForTests();
  resetNpcRuntimeForTests();
  setNpcYieldForTests(false);
  setNpcLimits({ samples: 1, timeBudgetMs: 5, batchSize: 1, overallTimeoutMs: 50 });
  const buyIn = depthBb * 10;
  useGameStore.setState(useGameStore.getInitialState());
  useGameStore.getState().joinTable(
    {
      id: 'sim',
      name: '校准桌',
      smallBlind: 5,
      bigBlind: 10,
      buyIn,
      buyInBb: depthBb,
      opponents: 'mixed',
      npcs: mix,
      npcConfigVersion: '2026-10-24.2',
    },
    buyIn,
  );
  const stats = emptyStats();
  for (let hand = 0; hand < hands; hand += 1) {
    const players = useGameStore.getState().players.map((player) => ({
      ...player,
      chips: buyIn,
      cards: [] as string[],
      currentBet: 0,
      invested: 0,
      status: 'active' as const,
      hasActed: false,
      canRaise: true,
    }));
    useGameStore.setState({ players, dealerIndex: hand % 4, gameLog: [], board: [], pot: 0, stage: 'idle' });
    setShuffleRngForTests(mulberry32(seed + hand));
    setNpcDecisionRngForTests(mulberry32(seed + 1_000_003 + hand));
    useGameStore.getState().startHand();
    const dealt = useGameStore.getState().players.find((player) => player.id === 'human');
    const participated = !!dealt && dealt.cards.length === 2 && (dealt.status === 'active' || dealt.status === 'all-in');
    let humanFolded = false;
    let humanRaised = false;
    for (let guard = 0; guard < 24 && useGameStore.getState().stage === 'preflop'; guard += 1) {
      const actor = useGameStore.getState().players[useGameStore.getState().currentPlayerIndex];
      if (!actor || actor.status !== 'active') break;
      if (actor.id === 'human') {
        const action = humanAct();
        if (action === 'fold') humanFolded = true;
        if (action === 'raise') humanRaised = true;
      } else {
        await useGameStore.getState().actAI();
      }
    }
    if (!participated) continue;
    stats.dealt += 1;
    const after = useGameStore.getState();
    const flop = after.board.length >= 3;
    if (flop) stats.tableFlop += 1;
    const human = after.players.find((player) => player.id === 'human');
    if (flop && !humanFolded && human && (human.status === 'active' || human.status === 'all-in')) stats.humanFlop += 1;
    const pre = after.streetActions.filter((action) => action.stage === 'preflop');
    if (humanRaised) {
      const raiseIndex = pre.findIndex((action) => action.actorId === 'human' && action.kind === 'raise');
      const earlierRaise = raiseIndex > 0 && pre.slice(0, raiseIndex).some((action) => action.kind === 'raise');
      if (raiseIndex >= 0 && !earlierRaise) {
        stats.humanOpen += 1;
        const responses = pre.slice(raiseIndex + 1).filter((action) => action.kind === 'call' || action.kind === 'raise');
        if (responses.length === 0) stats.openAllFold += 1;
        else if (responses.some((action) => action.kind === 'raise')) stats.openThreeBet += 1;
        else stats.openCall += 1;
      }
    }
    for (const player of after.players) {
      const bucket = stats.vpip[player.id] ?? { hands: 0, voluntary: 0 };
      bucket.hands += 1;
      if (pre.some((action) => action.actorId === player.id && (action.kind === 'call' || action.kind === 'raise'))) bucket.voluntary += 1;
      stats.vpip[player.id] = bucket;
    }
  }
  return stats;
}

afterEach(() => {
  setShuffleRngForTests(null);
  setNpcDecisionRngForTests(null);
  setNpcYieldForTests(null);
  resetNpcRuntimeForTests();
});

describe('固定人类见翻牌', () => {
  it('100bb 新默认高于同口径旧混合，两个种子各 2000 手', async () => {
    const hands = 2000;
    const samples: Array<{ seed: number; mix: string; depth: number; stats: FlopStats }> = [];
    for (const seed of [CALIBRATION_SEED, CALIBRATION_SEED_REPEAT]) {
      const oldStats = await playPreflopSample(OLD_MIX, seed, hands, 100);
      const newStats = await playPreflopSample(NEW_MIX, seed, hands, 100);
      expect(oldStats.dealt).toBe(hands);
      expect(newStats.dealt).toBe(hands);
      expect(newStats.humanFlop / newStats.dealt).toBeGreaterThan(oldStats.humanFlop / oldStats.dealt);
      samples.push({ seed, mix: '旧混合', depth: 100, stats: oldStats }, { seed, mix: '新默认', depth: 100, stats: newStats });
    }
    for (const depth of [40, 200]) {
      const stats = await playPreflopSample(NEW_MIX, CALIBRATION_SEED, 1000, depth);
      expect(stats.dealt).toBe(1000);
      samples.push({ seed: CALIBRATION_SEED, mix: '新默认', depth, stats });
    }
    const lines = samples.map((sample) => {
      const seen = sample.stats.humanFlop / sample.stats.dealt;
      const vpip = Object.entries(sample.stats.vpip).map(([id, row]) => (
        `${id} 主动入池 ${row.hands > 0 ? ((row.voluntary / row.hands) * 100).toFixed(2) : '0.00'}%（${row.voluntary}/${row.hands}）`
      )).join('，');
      return `${sample.seed} ${sample.mix} ${sample.depth}bb 本人见翻牌 ${(seen * 100).toFixed(2)}%（${sample.stats.humanFlop}/${sample.stats.dealt}），全桌翻牌 ${sample.stats.tableFlop}/${sample.stats.dealt}，开池 ${sample.stats.humanOpen} 后全弃 ${sample.stats.openAllFold}、跟注 ${sample.stats.openCall}、再加注 ${sample.stats.openThreeBet}。${vpip}`;
    });
    expect(lines.join('\n')).toContain('本人见翻牌');
    if (process.env.WRITE_CALIBRATION_REPORT === '1') {
      writeFileSync(
        new URL('../../docs/superpowers/reports/2026-10-24-four-player-calibration.md', import.meta.url),
        `\n## 固定人类纯翻前见翻牌\n\n分母是本人拿到两张牌并实际参与的手。见翻牌还要求翻牌发出时本人未弃牌且仍为 active 或 all-in。每手把筹码恢复到买入深度，按钮按手数轮转。40bb 和 200bb 是诊断样本。15% 只作体验参考。\n\n${lines.join('\n\n')}\n`,
        { flag: 'a' },
      );
    }
  }, 180000);
});
