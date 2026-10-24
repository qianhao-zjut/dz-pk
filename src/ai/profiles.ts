import { DEFEND, type DefendLine, type Spot } from './defendLines';
import { threeBetBook, type ThreeBetBook } from './threeBetLines';
import type { ProfileId } from './types';

/**
 * 四人桌范围和阈值都是启发式，不是已验证的最优解。
 * 四人桌 UTG 比九人桌 UTG 宽，不能把几何位置直接套进九人桌图表。
 */
export type RangeSpot = Spot;

export interface RangeChart {
  open: Record<RangeSpot, string[]>;
  /** 无人加注、但需要补齐盲注时的跟入范围。空列表表示不溜入。 */
  limpCall: Record<RangeSpot, string[]>;
  callVsRaise: Record<RangeSpot, string[]>;
  threeBet: Record<RangeSpot, string[]>;
  threeBetBluff: Record<RangeSpot, string[]>;
  fourBet: Record<RangeSpot, string[]>;
  callVsReraise: Record<RangeSpot, string[]>;
}

export interface AIProfile {
  id: ProfileId;
  label: string;
  /** 开池加到几个大盲。前面有平跟时再按人数加大，不随机改金额。 */
  openMultiple: number;
  /** 有位置时，再加注到当前最高注的几倍，每个冷跟再加 1 倍。 */
  reraiseInPosition: number;
  /** 无位置时更大。同一位置、尺度和冷跟人数得到同一金额。 */
  reraiseOutOfPosition: number;
  /** 占跟注额的比例。负数表示愿意跟一点负期望。 */
  callCushionFraction: number;
  valueEquity: number;
  strongEquity: number;
  bluffFrequency: number;
  threeBetBluffFrequency: number;
  betFraction: number;
  textureCaution: number;
  positionCaution: number;
  multiwayCaution: number;
  /** 大额档在原范围上再收紧。不在这里的手牌不能继续。 */
  largeContinue: string[];
  /** 高风险档的继续范围，比大额档更紧。 */
  highRiskContinue: string[];
  charts: RangeChart;
  /** 短筹开池，不直接套用深筹范围。 */
  shortOpen: Record<RangeSpot, string[]>;
  /** 深筹在标准开池上额外加入的牌。 */
  deepExtraOpen: Record<RangeSpot, string[]>;
  /** 按自己的位置，再按开池者位置。缺省时回退到 charts 里的统一防守。 */
  defend: Partial<Record<RangeSpot, Partial<Record<RangeSpot, DefendLine>>>>;
  /** 面对完整 3bet。开池者、冷跟者和尚未入池的人分开。 */
  vsThreeBet: ThreeBetBook;
}

const none: Record<RangeSpot, string[]> = { UTG: [], BTN: [], SB: [], BB: [], HU: [] };

/** 2026-10-24 调整前的开池范围。短筹继续用它，避免把 40bb 直接套成 200bb。 */
const solidShortOpen: RangeChart['open'] = spots(
  ['77+', 'ATs+', 'AJo+', 'KQs', 'KQo', 'QJs', 'JTs'],
  ['22+', 'A2s+', 'A9o+', 'K9s+', 'KTo+', 'Q9s+', 'QTo+', 'J9s+', 'JTo', 'T9s', '98s', '87s', '76s', '65s'],
  ['55+', 'A8s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'QJo', 'JTs', 'T9s'],
  ['55+', 'A8s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'QJo', 'JTs', 'T9s'],
  ['22+', 'A2s+', 'A8o+', 'K9s+', 'KTo+', 'Q9s+', 'J9s+', 'T9s', '98s', '87s', '76s'],
);
const aggroShortOpen: RangeChart['open'] = spots(
  ['55+', 'A9s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'QJo', 'JTs', 'T9s', '98s'],
  ['22+', 'A2s+', 'A2o+', 'K8s+', 'K9o+', 'Q8s+', 'Q9o+', 'J8s+', 'J9o+', 'T8s+', '97s+', '86s+', '75s+', '64s+', '54s'],
  ['22+', 'A2s+', 'A8o+', 'K8s+', 'KTo+', 'Q9s+', 'QTo+', 'J9s+', 'T9s', '98s', '87s', '76s'],
  ['22+', 'A2s+', 'A5o+', 'K7s+', 'KTo+', 'Q9s+', 'J9s+', 'T8s+', '97s+', '86s+', '75s+'],
  ['22+', 'A2s+', 'A2o+', 'K5s+', 'K9o+', 'Q8s+', 'J8s+', 'T8s+', '97s+', '86s+', '76s'],
);
const tightShortOpen: RangeChart['open'] = spots(
  ['TT+', 'AQs+', 'AKo'],
  ['77+', 'ATs+', 'AJo+', 'KQs', 'KQo', 'QJs'],
  ['99+', 'AQs+', 'AKo', 'KQs'],
  ['99+', 'AQs+', 'AKo', 'KQs'],
  ['77+', 'ATs+', 'AJo+', 'KQs', 'KQo'],
);

function spots(utg: string[], btn: string[], sb: string[], bb: string[], hu: string[]): Record<RangeSpot, string[]> {
  return { UTG: utg, BTN: btn, SB: sb, BB: bb, HU: hu };
}

const solidChart: RangeChart = {
  open: spots(
    ['77+', 'ATs+', 'AJo+', 'KQs', 'KQo', 'QJs', 'JTs'],
    ['22+', 'A2s+', 'A4o+', 'K7s+', 'K9o+', 'Q8s+', 'Q9o+', 'J8s+', 'J9o+', 'T8s+', 'T9o', '97s+', '98o', '86s+', '87o', '75s+', '76o', '65s', '64s', '54s'],
    ['55+', 'A8s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'QJo', 'JTs', 'T9s'],
    ['55+', 'A8s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'QJo', 'JTs', 'T9s'],
    ['22+', 'A2s+', 'A8o+', 'K9s+', 'KTo+', 'Q9s+', 'J9s+', 'T9s', '98s', '87s', '76s'],
  ),
  limpCall: spots(
    [],
    [],
    ['22+', 'A8s+', 'ATo+', 'KTs+', 'QTs+', 'JTs', 'T9s', '98s'],
    ['22+', 'A2s+', 'A8o+', 'K9s+', 'KTo+', 'Q9s+', 'J9s+', 'T8s+', '98s', '87s', '76s', '65s'],
    [],
  ),
  callVsRaise: spots(
    ['99+', 'AQs+', 'AKo', 'AJs', 'KQs'],
    ['77+', 'ATs+', 'AJo+', 'KQs', 'KQo', 'QJs', 'JTs'],
    ['88+', 'AQs+', 'AKo', 'KQs'],
    ['55+', 'A8s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'JTs', 'T9s', '98s'],
    ['66+', 'A9s+', 'ATo+', 'KTs+', 'KJo+', 'QJs', 'JTs'],
  ),
  threeBet: spots(
    ['TT+', 'AQs+', 'AKo'],
    ['99+', 'AJs+', 'AQo+', 'KQs'],
    ['TT+', 'AQs+', 'AKo', 'KQs'],
    ['99+', 'AJs+', 'AQo+', 'KQs'],
    ['88+', 'AJs+', 'AQo+', 'KQs'],
  ),
  threeBetBluff: none,
  fourBet: spots(['QQ+', 'AKs'], ['QQ+', 'AKs'], ['QQ+', 'AKs'], ['QQ+', 'AKs'], ['JJ+', 'AKs', 'AKo']),
  callVsReraise: spots(
    ['JJ', 'TT', 'AQs', 'AKo', 'AJs'],
    ['JJ', 'TT', 'AQs', 'AKo', 'AJs', 'KQs'],
    ['JJ', 'TT', 'AQs', 'AKo'],
    ['JJ', 'TT', '99', 'AQs', 'AKo', 'AJs', 'KQs'],
    ['TT', '99', 'AQs', 'AKo', 'AJs', 'KQs'],
  ),
};

const aggroChart: RangeChart = {
  open: spots(
    ['55+', 'A9s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'QJo', 'JTs', 'T9s', '98s'],
    ['22+', 'A2s+', 'A2o+', 'K2s+', 'K5o+', 'Q5s+', 'Q8o+', 'J7s+', 'J8o+', 'T7s+', 'T8o+', '96s+', '98o', '85s+', '87o', '74s+', '76o', '64s+', '65o', '53s+', '54o', '43s'],
    ['22+', 'A2s+', 'A8o+', 'K8s+', 'KTo+', 'Q9s+', 'QTo+', 'J9s+', 'T9s', '98s', '87s', '76s'],
    ['22+', 'A2s+', 'A5o+', 'K7s+', 'KTo+', 'Q9s+', 'J9s+', 'T8s+', '97s+', '86s+', '75s+'],
    ['22+', 'A2s+', 'A2o+', 'K5s+', 'K9o+', 'Q8s+', 'J8s+', 'T8s+', '97s+', '86s+', '76s'],
  ),
  limpCall: spots(
    [],
    [],
    ['22+', 'A2s+', 'A9o+', 'K9s+', 'Q9s+', 'J9s+', 'T9s', '98s', '87s', '76s'],
    ['22+', 'A2s+', 'A2o+', 'K2s+', 'K9o+', 'Q8s+', 'J8s+', 'T8s+', '97s+', '86s+', '76s', '65s'],
    [],
  ),
  callVsRaise: spots(
    ['77+', 'ATs+', 'AJo+', 'KQs', 'KQo', 'QJs'],
    ['55+', 'A8s+', 'A9o+', 'KTs+', 'KJo+', 'QTs+', 'JTs', 'T9s', '98s'],
    ['66+', 'A9s+', 'ATo+', 'KQs', 'KQo'],
    ['22+', 'A2s+', 'A9o+', 'K9s+', 'KTo+', 'Q9s+', 'J9s+', 'T9s', '98s', '87s'],
    ['44+', 'A4s+', 'A9o+', 'KTs+', 'KTo+', 'QTs+', 'JTs'],
  ),
  threeBet: spots(
    ['88+', 'AJs+', 'AQo+', 'KQs'],
    ['77+', 'ATs+', 'AJo+', 'KQs', 'KQo'],
    ['88+', 'AJs+', 'AQo+', 'KQs'],
    ['66+', 'A9s+', 'ATo+', 'KQs', 'KQo'],
    ['55+', 'A8s+', 'ATo+', 'KQs'],
  ),
  threeBetBluff: spots([], ['A5s', 'A4s', 'A3s', 'A2s'], ['A5s', 'A4s'], ['A5s', 'A4s'], ['A5s', 'A4s']),
  fourBet: spots(['JJ+', 'AKs', 'AKo'], ['TT+', 'AQs+', 'AKo'], ['JJ+', 'AKs', 'AKo'], ['TT+', 'AQs+', 'AKo'], ['99+', 'AJs+', 'AQo+']),
  callVsReraise: spots(
    ['TT', '99', 'AQs', 'AJs', 'KQs'],
    ['99', '88', 'AJs', 'ATs', 'KQs', 'QJs'],
    ['TT', '99', 'AQs', 'KQs'],
    ['88+', 'ATs+', 'AJo+', 'KQs'],
    ['77+', 'A9s+', 'AJo+', 'KQs'],
  ),
};

const looseShortOpen: RangeChart['open'] = spots(
  ['66+', 'ATs+', 'ATo+', 'KQs', 'KQo', 'QJs', 'JTs', 'T9s'],
  ['22+', 'A2s+', 'A7o+', 'K8s+', 'KTo+', 'Q9s+', 'QTo+', 'J9s+', 'JTo', 'T9s', '98s', '87s', '76s', '65s'],
  ['44+', 'A5s+', 'ATo+', 'K9s+', 'KJo+', 'QTs+', 'JTs', 'T9s', '98s'],
  ['44+', 'A5s+', 'ATo+', 'K9s+', 'KJo+', 'QTs+', 'JTs', 'T9s', '98s'],
  ['22+', 'A2s+', 'A7o+', 'K8s+', 'KTo+', 'Q9s+', 'J9s+', 'T9s', '98s', '87s', '76s'],
);

const looseChart: RangeChart = {
  open: spots(
    ['55+', 'A9s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'QJo', 'JTs', 'T9s', '98s'],
    ['22+', 'A2s+', 'A2o+', 'K5s+', 'K8o+', 'Q8s+', 'Q9o+', 'J8s+', 'J9o+', 'T8s+', '97s+', '86s+', '75s+', '65s', '64s', '54s'],
    ['22+', 'A2s+', 'A8o+', 'K8s+', 'KTo+', 'Q9s+', 'QTo+', 'J9s+', 'T9s', '98s', '87s', '76s', '65s'],
    ['22+', 'A2s+', 'A5o+', 'K7s+', 'KTo+', 'Q9s+', 'J9s+', 'T8s+', '97s+', '86s+', '75s+', '65s'],
    ['22+', 'A2s+', 'A5o+', 'K6s+', 'KTo+', 'Q8s+', 'J8s+', 'T8s+', '97s+', '86s+', '76s'],
  ),
  limpCall: spots(
    ['66+', 'A9s+', 'ATo+', 'KTs+', 'QTs+', 'JTs', 'T9s'],
    ['22+', 'A2s+', 'A8o+', 'K9s+', 'KTo+', 'Q9s+', 'J9s+', 'T9s', '98s', '87s'],
    ['22+', 'A2s+', 'A2o+', 'K5s+', 'K9o+', 'Q8s+', 'J8s+', 'T8s+', '97s+', '86s+', '76s', '65s', '54s'],
    ['22+', 'A2s+', 'A2o+', 'K2s+', 'K8o+', 'Q8s+', 'J8s+', 'T8s+', '97s+', '86s+', '76s', '65s', '54s'],
    [],
  ),
  callVsRaise: spots(
    ['55+', 'A8s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'JTs', 'T9s', '98s'],
    ['22+', 'A2s+', 'A8o+', 'K9s+', 'KTo+', 'Q9s+', 'J9s+', 'T9s', '98s', '87s', '76s'],
    ['44+', 'A5s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'JTs', 'T9s', '98s'],
    ['22+', 'A2s+', 'A5o+', 'K8s+', 'KTo+', 'Q9s+', 'J9s+', 'T8s+', '98s', '87s', '76s', '65s'],
    ['22+', 'A2s+', 'A7o+', 'K9s+', 'KTo+', 'Q9s+', 'J9s+', 'T9s', '98s'],
  ),
  threeBet: spots(
    ['QQ+', 'AKs', 'AKo'],
    ['JJ+', 'AQs+', 'AKo'],
    ['QQ+', 'AKs', 'AKo'],
    ['JJ+', 'AQs+', 'AKo', 'KQs'],
    ['TT+', 'AQs+', 'AKo'],
  ),
  threeBetBluff: none,
  fourBet: spots(['KK+', 'AKs'], ['QQ+', 'AKs', 'AKo'], ['KK+', 'AKs'], ['QQ+', 'AKs', 'AKo'], ['JJ+', 'AKs', 'AKo']),
  callVsReraise: spots(
    ['QQ', 'JJ', 'TT', 'AQs', 'AKo', 'AJs', 'KQs'],
    ['JJ', 'TT', '99', 'AQs', 'AJs', 'ATs', 'KQs', 'QJs', 'JTs'],
    ['JJ', 'TT', 'AQs', 'AKo', 'KQs'],
    ['TT', '99', '88', 'AQs', 'AJs', 'AKo', 'KQs', 'QJs'],
    ['TT', '99', 'AQs', 'AJs', 'KQs', 'QJs'],
  ),
};

const tightChart: RangeChart = {
  open: spots(
    ['TT+', 'AQs+', 'AKo'],
    ['44+', 'A4s+', 'A9o+', 'K9s+', 'KTo+', 'Q9s+', 'QTo+', 'J9s+', 'JTo', 'T9s', '98s', '87s', '76s'],
    ['99+', 'AQs+', 'AKo', 'KQs'],
    ['99+', 'AQs+', 'AKo', 'KQs'],
    ['77+', 'ATs+', 'AJo+', 'KQs', 'KQo'],
  ),
  limpCall: spots([], [], ['TT+', 'AQs+', 'AKo'], ['88+', 'ATs+', 'ATo+', 'KQs'], []),
  callVsRaise: spots(
    ['JJ+', 'AQs+', 'AKo'],
    ['TT+', 'AQs+', 'AKo', 'AJs', 'KQs'],
    ['JJ+', 'AQs+', 'AKo'],
    ['99+', 'AQs+', 'AKo', 'KQs'],
    ['TT+', 'AQs+', 'AKo'],
  ),
  threeBet: spots(['QQ+', 'AKs'], ['JJ+', 'AQs+', 'AKo'], ['QQ+', 'AKs'], ['QQ+', 'AQs+', 'AKo'], ['TT+', 'AQs+', 'AKo']),
  threeBetBluff: none,
  fourBet: spots(['KK+', 'AKs'], ['QQ+', 'AKs'], ['KK+', 'AKs'], ['QQ+', 'AKs'], ['QQ+', 'AKs']),
  callVsReraise: spots(['QQ', 'AKo'], ['JJ', 'AQs', 'AKo'], ['QQ', 'AKo'], ['JJ', 'QQ', 'AQs', 'AKo'], ['JJ', 'AQs', 'AKo']),
};

export const PROFILES: Record<ProfileId, AIProfile> = {
  ai_0: {
    id: 'ai_0',
    label: '稳健',
    openMultiple: 2.5,
    reraiseInPosition: 3,
    reraiseOutOfPosition: 3.5,
    callCushionFraction: 0,
    valueEquity: 0.62,
    strongEquity: 0.78,
    bluffFrequency: 0.08,
    threeBetBluffFrequency: 0,
    betFraction: 0.66,
    textureCaution: 0.03,
    positionCaution: 0.02,
    multiwayCaution: 0.03,
    largeContinue: ['TT+', 'AQs+', 'AKo'],
    highRiskContinue: ['QQ+', 'AKs', 'AKo'],
    charts: solidChart,
    shortOpen: solidShortOpen,
    deepExtraOpen: spots(['A9s', 'KJo'], ['A3o', 'A2o', 'K8o', 'Q8o', '43s'], [], [], []),
    defend: DEFEND.ai_0,
    vsThreeBet: threeBetBook(solidChart, 'ai_0'),
  },
  ai_1: {
    id: 'ai_1',
    label: '松凶',
    openMultiple: 3.5,
    reraiseInPosition: 3,
    reraiseOutOfPosition: 4,
    callCushionFraction: -0.05,
    valueEquity: 0.54,
    strongEquity: 0.7,
    bluffFrequency: 0.2,
    threeBetBluffFrequency: 0.5,
    betFraction: 0.8,
    textureCaution: 0,
    positionCaution: 0,
    multiwayCaution: 0,
    largeContinue: ['99+', 'AJs+', 'AQo+', 'KQs'],
    highRiskContinue: ['JJ+', 'AQs+', 'AKo'],
    charts: aggroChart,
    shortOpen: aggroShortOpen,
    deepExtraOpen: spots([], ['K4o', 'K3o', 'K2o', 'Q7o', '32s'], [], [], []),
    defend: DEFEND.ai_1,
    vsThreeBet: threeBetBook(aggroChart, 'ai_1'),
  },
  ai_2: {
    id: 'ai_2',
    label: '保守',
    openMultiple: 2.5,
    reraiseInPosition: 3,
    reraiseOutOfPosition: 3.5,
    callCushionFraction: 0.12,
    valueEquity: 0.72,
    strongEquity: 0.85,
    bluffFrequency: 0.03,
    threeBetBluffFrequency: 0,
    betFraction: 0.5,
    textureCaution: 0.08,
    positionCaution: 0.04,
    multiwayCaution: 0.06,
    largeContinue: ['JJ+', 'AQs+', 'AKo'],
    highRiskContinue: ['KK+', 'AKs'],
    charts: tightChart,
    shortOpen: tightShortOpen,
    deepExtraOpen: spots([], ['33', '22', 'A8s', 'A7s', 'A8o', 'K9o', '65s'], [], [], []),
    defend: DEFEND.ai_2,
    vsThreeBet: threeBetBook(tightChart, 'ai_2'),
  },
  loose_passive: {
    id: 'loose_passive',
    label: '松跟',
    openMultiple: 2.5,
    reraiseInPosition: 3,
    reraiseOutOfPosition: 3.5,
    callCushionFraction: -0.08,
    valueEquity: 0.58,
    strongEquity: 0.74,
    bluffFrequency: 0.04,
    threeBetBluffFrequency: 0.08,
    betFraction: 0.55,
    textureCaution: 0.02,
    positionCaution: 0.01,
    multiwayCaution: 0.01,
    largeContinue: ['TT+', 'AQs+', 'AKo'],
    highRiskContinue: ['QQ+', 'AKs', 'AKo'],
    charts: looseChart,
    shortOpen: looseShortOpen,
    deepExtraOpen: spots(['A9s', 'KJo', 'QJs'], ['A3o', 'K9o', 'Q9o', 'JTo', '43s'], ['A7o', 'K9o'], ['A4o', 'K8s'], []),
    defend: DEFEND.loose_passive,
    vsThreeBet: threeBetBook(looseChart, 'loose_passive'),
  },
};

export const RANGE_CONFIG_VERSION = '2026-10-24.2';

export function profileFor(id: string): AIProfile {
  return PROFILES[id as ProfileId] ?? PROFILES.ai_0;
}

export const HEURISTIC_ASSUMPTION = '范围、阈值和尺寸是可调整的启发式参数，不是已验证最优解';
export const PREFLOP_ASSUMPTION = '翻前使用起手牌类别和范围表，不把两张底牌送进五张牌评估器';
export const SHOWDOWN_ASSUMPTION = '跟注参考值假设本次投入后直接摊牌，不含未来下注或弃牌率';
