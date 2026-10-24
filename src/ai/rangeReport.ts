import { createDeck } from '../utils/poker';
import { handKey } from './cards';
import { buildObservation } from './observation';
import { branchWeights, preflopBranches, type PreflopBranch } from './preflop';
import { PROFILES, RANGE_CONFIG_VERSION, type AIProfile } from './profiles';
import type { AIObservation, ObservationSource, SourcePlayer } from './types';

export interface ActionFreq {
  fold: number;
  check: number;
  call: number;
  raise: number;
  combos: number;
}

export interface RangeScenario {
  id: string;
  label: string;
  depthBb: number;
  /** 防守场景的开池尺度；开池场景为空。 */
  openBb: number | null;
  price: 'normal' | 'large' | 'high-risk';
}

export interface RangeRow {
  scenario: RangeScenario;
  profileId: AIProfile['id'];
  label: string;
  freq: ActionFreq;
}

const BB = 10;

function seat(id: string, extra: Partial<SourcePlayer> = {}): SourcePlayer {
  return {
    id,
    chips: extra.chips ?? 1000,
    currentBet: extra.currentBet ?? 0,
    invested: extra.invested ?? extra.currentBet ?? 0,
    status: extra.status ?? 'active',
    canRaise: true,
    ...extra,
  };
}

function stack(depthBb: number, posted: number): { chips: number; currentBet: number; invested: number } {
  const total = depthBb * BB;
  return { chips: total - posted, currentBet: posted, invested: posted };
}

export function allCombos(): Array<[string, string]> {
  const deck = createDeck();
  const combos: Array<[string, string]> = [];
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      if (handKey(deck[i], deck[j])) combos.push([deck[i], deck[j]]);
    }
  }
  return combos;
}

function observe(partial: Partial<ObservationSource>): AIObservation {
  const built = buildObservation({
    sessionId: 'range',
    handNumber: 1,
    decisionRevision: 1,
    stage: 'preflop',
    pot: 30,
    board: [],
    dealerIndex: 0,
    currentPlayerIndex: 0,
    currentMaxBet: BB,
    lastRaiseSize: BB,
    bigBlind: BB,
    streetActions: [],
    players: [],
    ...partial,
  });
  if (!built.ok) throw new Error(built.error);
  return built.observation;
}

function openSpot(heroSeat: number, depthBb: number, folded: number[]): AIObservation {
  const posted = [0, BB / 2, BB, 0];
  const players = [0, 1, 2, 3].map((index) => {
    const blind = posted[index];
    const money = stack(depthBb, blind);
    return seat(index === 0 ? 'human' : `ai_${index - 1}`, {
      ...money,
      status: folded.includes(index) ? 'folded' : 'active',
      ...(index === heroSeat ? { cards: ['As', 'Kd'] } : {}),
    });
  });
  return observe({
    currentPlayerIndex: heroSeat,
    currentMaxBet: BB,
    pot: BB + BB / 2,
    players,
    streetActions: [
      { actorId: players[1].id, stage: 'preflop', kind: 'post', to: BB / 2 },
      { actorId: players[2].id, stage: 'preflop', kind: 'post', to: BB },
    ],
  });
}

function defendSpot(heroSeat: number, openerSeat: number, openBb: number, depthBb: number, folded: number[]): AIObservation {
  const openTo = Math.round(openBb * BB);
  const posted = [0, BB / 2, BB, 0];
  const players = [0, 1, 2, 3].map((index) => {
    const put = index === openerSeat ? openTo : posted[index];
    const money = stack(depthBb, put);
    const status = folded.includes(index) ? 'folded' : 'active';
    return seat(index === 0 ? 'human' : `ai_${index - 1}`, {
      ...money,
      status,
      ...(index === heroSeat ? { cards: ['As', 'Kd'] } : {}),
    });
  });
  const pot = players.reduce((sum, player) => sum + player.invested, 0);
  return observe({
    currentPlayerIndex: heroSeat,
    currentMaxBet: openTo,
    lastRaiseSize: openTo - BB,
    pot,
    players,
    streetActions: [{ actorId: players[openerSeat].id, stage: 'preflop', kind: 'raise', to: openTo }],
  });
}

export function scenarios(): Array<{ scenario: RangeScenario; template: AIObservation }> {
  const depths = [40, 100, 200] as const;
  const rows: Array<{ scenario: RangeScenario; template: AIObservation }> = [];
  for (const depthBb of depths) {
    rows.push({
      scenario: { id: `open-btn-${depthBb}`, label: `BTN 首入池 ${depthBb}bb`, depthBb, openBb: null, price: 'normal' },
      template: openSpot(0, depthBb, [3]),
    });
    rows.push({
      scenario: { id: `open-utg-${depthBb}`, label: `UTG 首入池 ${depthBb}bb`, depthBb, openBb: null, price: 'normal' },
      template: openSpot(3, depthBb, []),
    });
  }
  for (const openBb of [2.5, 3] as const) {
    for (const depthBb of depths) {
      rows.push({
        scenario: { id: `bb-vs-btn-${openBb}-${depthBb}`, label: `BB 面对 BTN ${openBb}bb / ${depthBb}bb`, depthBb, openBb, price: 'normal' },
        template: defendSpot(2, 0, openBb, depthBb, [3, 1]),
      });
      rows.push({
        scenario: { id: `sb-vs-btn-${openBb}-${depthBb}`, label: `SB 面对 BTN ${openBb}bb / ${depthBb}bb`, depthBb, openBb, price: 'normal' },
        template: defendSpot(1, 0, openBb, depthBb, [3]),
      });
      rows.push({
        scenario: { id: `bb-vs-utg-${openBb}-${depthBb}`, label: `BB 面对 UTG ${openBb}bb / ${depthBb}bb`, depthBb, openBb, price: 'normal' },
        template: defendSpot(2, 3, openBb, depthBb, [0, 1]),
      });
      rows.push({
        scenario: { id: `bb-vs-sb-${openBb}-${depthBb}`, label: `BB 面对 SB ${openBb}bb / ${depthBb}bb`, depthBb, openBb, price: 'normal' },
        template: defendSpot(2, 1, openBb, depthBb, [0, 3]),
      });
      rows.push({
        scenario: { id: `sb-vs-utg-${openBb}-${depthBb}`, label: `SB 面对 UTG ${openBb}bb / ${depthBb}bb`, depthBb, openBb, price: 'normal' },
        template: defendSpot(1, 3, openBb, depthBb, [0]),
      });
      rows.push({
        scenario: { id: `btn-vs-utg-${openBb}-${depthBb}`, label: `BTN 面对 UTG ${openBb}bb / ${depthBb}bb`, depthBb, openBb, price: 'normal' },
        template: defendSpot(0, 3, openBb, depthBb, []),
      });
    }
  }
  rows.push({
    scenario: { id: 'bb-vs-btn-large', label: 'BB 面对 BTN 6bb / 100bb 大额', depthBb: 100, openBb: 6, price: 'large' },
    template: defendSpot(2, 0, 6, 100, [3, 1]),
  });
  rows.push({
    scenario: { id: 'bb-vs-btn-high', label: 'BB 面对 BTN 20bb / 100bb 高风险', depthBb: 100, openBb: 20, price: 'high-risk' },
    template: defendSpot(2, 0, 20, 100, [3, 1]),
  });
  return rows;
}

export function measure(template: AIObservation, profile: AIProfile, combos = allCombos()): ActionFreq {
  const totals = { fold: 0, check: 0, call: 0, raise: 0 };
  for (const cards of combos) {
    const weights = branchWeights(preflopBranches({ ...template, holeCards: cards }, profile));
    const sum = weights.fold + weights.check + weights.call + weights.raise;
    if (Math.abs(sum - 1) > 1e-9) {
      throw new Error(`${profile.id} ${cards.join('')} 动作权重 ${sum} 不是 1`);
    }
    totals.fold += weights.fold;
    totals.check += weights.check;
    totals.call += weights.call;
    totals.raise += weights.raise;
  }
  const combosN = combos.length;
  return {
    fold: totals.fold / combosN,
    check: totals.check / combosN,
    call: totals.call / combosN,
    raise: totals.raise / combosN,
    combos: combosN,
  };
}

export function measureMatrix(): RangeRow[] {
  const combos = allCombos();
  const rows: RangeRow[] = [];
  for (const item of scenarios()) {
    for (const profile of Object.values(PROFILES)) {
      rows.push({
        scenario: item.scenario,
        profileId: profile.id,
        label: profile.label,
        freq: measure(item.template, profile, combos),
      });
    }
  }
  return rows;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export function renderRangeReport(rows: RangeRow[]): string {
  const lines = [
    '# 翻前范围频率',
    '',
    `配置版本：\`${RANGE_CONFIG_VERSION}\``,
    '',
    '四人桌、无已知对手牌阻挡，按 1326 个实体组合统计。混合动作按权重计入，不是单次抽样。开池分母是该位置前面无人自愿入池；防守分母是该位置面对指定开池。弃牌、过牌、跟注、加注合计 100%。100bb 的按钮开池、大盲面对枪口/按钮/小盲是本轮验收场景。40bb 收紧平跟和投机开池；200bb 多开一些深筹牌。大额和全下仍走价格护栏。',
    '',
    '旧基线来自规格第 2 节（100bb、BTN 开池 / BB 面对 BTN 正常开池），不是本文件重跑旧代码：',
    '',
    '| 风格 | 旧 BTN 开池 | 旧 BB 跟注 | 旧 BB 再加注 | 旧 BB 总继续 |',
    '| --- | ---: | ---: | ---: | ---: |',
    '| 稳健 | 23.68% | 8.45% | 5.73% | 14.18% |',
    '| 激进 | 35.44% | 9.65% | 10.71% | 20.36% |',
    '| 保守 | 9.05% | 1.66% | 2.87% | 4.52% |',
    '',
    '| 场景 | 风格 | 弃牌 | 过牌 | 跟注 | 加注 | 继续 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const row of rows) {
    const continueRate = row.freq.call + row.freq.raise;
    lines.push(`| ${row.scenario.label} | ${row.label} | ${pct(row.freq.fold)} | ${pct(row.freq.check)} | ${pct(row.freq.call)} | ${pct(row.freq.raise)} | ${pct(continueRate)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

export function rowBy(rows: RangeRow[], scenarioId: string, profileId: AIProfile['id']): RangeRow {
  const found = rows.find((row) => row.scenario.id === scenarioId && row.profileId === profileId);
  if (!found) throw new Error(`缺少 ${scenarioId} ${profileId}`);
  return found;
}

export function continueRate(freq: ActionFreq): number {
  return freq.call + freq.raise;
}

/** 分母是该风格在按钮实际会开池的组合权重，不是全部 1326。 */
export function measureOpenedContinue(
  profile: AIProfile,
  threeBb: number,
  depthBb: number,
  combos = allCombos(),
): ActionFreq {
  const openBb = profile.openMultiple;
  const openTo = Math.round(openBb * BB);
  const threeTo = Math.round(threeBb * BB);
  const total = depthBb * BB;
  const posted = [0, BB / 2, BB, 0];
  const players = [0, 1, 2, 3].map((index) => {
    const put = index === 0 ? openTo : index === 2 ? threeTo : posted[index];
    const money = stack(depthBb, 0);
    const status = index === 1 || index === 3 ? 'folded' as const : 'active' as const;
    return seat(index === 0 ? 'human' : `ai_${index - 1}`, {
      chips: index === 0 ? total - openTo : index === 2 ? total - threeTo : money.chips,
      currentBet: status === 'folded' ? 0 : put,
      invested: status === 'folded' ? 0 : put,
      status,
      ...(index === 0 ? { cards: ['As', 'Kd'] as [string, string] } : {}),
    });
  });
  const facing = observe({
    currentPlayerIndex: 0,
    currentMaxBet: threeTo,
    lastRaiseSize: Math.max(BB, threeTo - openTo),
    pot: openTo + threeTo + BB / 2,
    players,
    streetActions: [
      { actorId: 'human', stage: 'preflop', kind: 'raise', to: openTo },
      { actorId: 'ai_1', stage: 'preflop', kind: 'raise', to: threeTo },
    ],
  });
  const opening = openSpot(0, depthBb, [3]);
  const totals = { fold: 0, check: 0, call: 0, raise: 0, denom: 0 };
  for (const cards of combos) {
    const openWeights = branchWeights(preflopBranches({ ...opening, holeCards: cards }, profile));
    const opened = openWeights.raise;
    if (opened <= 0) continue;
    const weights = branchWeights(preflopBranches({ ...facing, holeCards: cards }, profile));
    totals.denom += opened;
    totals.fold += opened * weights.fold;
    totals.check += opened * weights.check;
    totals.call += opened * weights.call;
    totals.raise += opened * weights.raise;
  }
  const denom = totals.denom || 1;
  return {
    fold: totals.fold / denom,
    check: totals.check / denom,
    call: totals.call / denom,
    raise: totals.raise / denom,
    combos: combos.length,
  };
}

/** 供报告断言确认分支权重可以被外部复用。 */
export function weightsOf(branches: readonly PreflopBranch[]) {
  return branchWeights(branches);
}
