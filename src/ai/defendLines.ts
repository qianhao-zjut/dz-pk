import type { ProfileId } from './types';

export type Spot = 'UTG' | 'BTN' | 'SB' | 'BB' | 'HU';

/** 面对一次开池时的继续方式。价值牌先全频再加注，中间牌再按 mixFrequency 混合。 */
export interface DefendLine {
  call: string[];
  value: string[];
  mix: string[];
  mixFrequency: number;
  bluff: string[];
  /** 仅有效筹码达到深筹时额外允许跟注。 */
  deepCall: string[];
  /** 短筹只允许这些牌平跟；价值再加注不受限。空列表表示短筹不平跟。 */
  shortFlat: string[];
}

export const SOLID_BB_MIX = 0.35;
export const AGGRO_BB_MIX = 0.55;
export const TIGHT_BB_MIX = 0.25;

type ByOpener = Partial<Record<Spot, DefendLine>>;

function line(partial: Omit<DefendLine, 'bluff' | 'deepCall' | 'shortFlat'> & Partial<DefendLine>): DefendLine {
  return {
    bluff: [],
    deepCall: [],
    shortFlat: [],
    ...partial,
  };
}

const solidShort = ['77+', 'A9s+', 'ATo+', 'KTs+', 'KJo+', 'QJs', 'JTs', 'T9s', '99+', 'AJs+', 'AQo+', 'KQs'];
const aggroShort = ['55+', 'A8s+', 'A9o+', 'KTs+', 'KJo+', 'QTs+', 'JTs', 'T9s', '66+', 'A9s+', 'ATo+', 'KQs'];
const tightShort = ['88+', 'ATs+', 'AJo+', 'KQs', 'TT+', 'AQs+', 'AKo'];

/** 按钮面对枪口开池：保留原有价格回归用的纯跟注/纯再加注，只把中间牌拆成混合。 */
const solidBtnVsUtg = line({
  value: ['TT+', 'AKs', 'AKo'],
  mix: ['99', 'AQs', 'AJs', 'AQo', 'KQs'],
  mixFrequency: 0.4,
  call: ['77+', 'ATs+', 'AJo+', 'KQo', 'QJs', 'JTs', 'T9s', '98s', '87s'],
  shortFlat: ['77+', 'ATs+', 'AJo+', 'KQs', 'KQo', 'QJs', 'JTs', 'T9s', '98s', 'TT+', 'AKs', 'AKo', '99'],
  deepCall: ['76s', '65s'],
});

const aggroBtnVsUtg = line({
  value: ['99+', 'AQs+', 'AKo'],
  mix: ['77', '88', 'ATs', 'AJs', 'AJo', 'KQs', 'KQo'],
  mixFrequency: 0.6,
  bluff: ['A5s', 'A4s', 'A3s', 'A2s'],
  call: ['55+', 'A9s', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'JTs', 'T9s', '98s'],
  shortFlat: ['55+', 'A9s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'JTs', 'T9s', '98s', '77+', '99+', 'AQs+', 'AKo'],
  deepCall: ['87s', '76s'],
});

const solidBbVsBtn = line({
  value: ['99+', 'AJs+', 'AQo+', 'KQs'],
  mix: ['22+', 'A2s+', 'A9o+', 'K9s+', 'KTo+', 'Q9s+', 'QTo+', 'J9s+', 'T9s', '98s'],
  mixFrequency: SOLID_BB_MIX,
  call: [
    'A2o+', 'K8s', 'K7s', 'K6s', 'K9o', 'K8o', 'K7o', 'Q8s', 'Q7s', 'Q9o', 'Q8o',
    'J8s', 'J7s', 'J9o', 'J8o', 'T8s', 'T7s', 'T9o', 'T8o', '97s', '96s', '87s', '86s',
    '76s', '75s', '65s', '64s', '54s', '53s', '43s', '98o', '87o', '76o', '85s', '74s', '63s',
  ],
  shortFlat: solidShort,
  deepCall: ['32s', '42s', '52s', 'K5o', 'Q6o', 'J6o'],
});

const solidBbVsUtg = line({
  value: ['TT+', 'AQs+', 'AKo'],
  mix: ['77+', 'A9s+', 'AJo+', 'KQs', 'KQo', 'QJs', 'JTs'],
  mixFrequency: 0.2,
  call: ['55+', 'A8s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'T9s', '98s'],
  shortFlat: ['88+', 'ATs+', 'ATo+', 'KQs', 'QJs', 'JTs', 'TT+', 'AQs+', 'AKo'],
  deepCall: ['87s', '76s'],
});

const solidBbVsSb = line({
  value: ['99+', 'AJs+', 'AQo+', 'KQs'],
  mix: ['55+', 'A8s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'JTs', 'T9s'],
  mixFrequency: 0.3,
  call: ['22+', 'A2s+', 'A8o+', 'K9s+', 'KTo+', 'Q9s+', 'QTo+', 'J9s+', '98s', '87s', '76s'],
  shortFlat: solidShort,
  deepCall: ['65s', '54s'],
});

const aggroBbVsBtn = line({
  value: ['66+', 'A8s+', 'A9o+', 'KQs', 'KQo'],
  mix: ['22+', 'A2s+', 'A2o+', 'K5s+', 'K8o+', 'Q8s+', 'Q9o+', 'J8s+', 'J9o+', 'T8s+', 'T9o', '97s+', '98o', '86s+', '87o', '75s+', '76o', '65s', '64s', '54s'],
  mixFrequency: AGGRO_BB_MIX,
  call: [
    'K2s', 'K3s', 'K4s', 'K5o', 'K6o', 'K7o', 'Q2s', 'Q3s', 'Q4s', 'Q5s', 'Q6s', 'Q7s',
    'Q7o', 'Q8o', 'J7s', 'J7o', 'J8o', 'T7s', 'T7o', 'T8o', '96s', '85o', '43s', '53s', '63s',
  ],
  shortFlat: aggroShort,
  deepCall: ['32s', '42s', 'K2o', 'K3o', 'Q5o', 'J6o'],
});

const aggroBbVsUtg = line({
  value: ['88+', 'ATs+', 'AJo+', 'KQs'],
  mix: ['55+', 'A5s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'JTs', 'T9s', '98s'],
  mixFrequency: 0.45,
  call: ['22+', 'A2s+', 'A9o+', 'K9s+', 'KTo+', 'Q9s+', 'QJo', 'J9s+', '87s', '76s'],
  bluff: ['A5s', 'A4s'],
  shortFlat: aggroShort,
  deepCall: ['65s', '54s'],
});

const aggroBbVsSb = line({
  value: ['77+', 'A9s+', 'ATo+', 'KQs', 'KQo'],
  mix: ['22+', 'A2s+', 'A5o+', 'K8s+', 'KTo+', 'Q9s+', 'QTo+', 'J9s+', 'T9s', '98s', '87s'],
  mixFrequency: 0.5,
  call: ['K9o', 'Q9o', 'J9o', 'T8s', '76s', '65s', '98o'],
  shortFlat: aggroShort,
  deepCall: ['54s', '64s'],
});

const tightBbVsBtn = line({
  value: ['TT+', 'AQs+', 'AKo'],
  mix: ['77+', 'A9s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'JTs', 'T9s'],
  mixFrequency: TIGHT_BB_MIX,
  call: ['22+', 'A2s+', 'A7o+', 'K9s', 'KTo', 'Q9s', 'QJo', 'J9s', '98s', '87s', '76s', '65s'],
  shortFlat: tightShort,
  deepCall: ['54s', 'T8s', '97s'],
});

const tightBbVsUtg = line({
  value: ['JJ+', 'AQs+', 'AKo'],
  mix: ['99+', 'AJs+', 'AQo+', 'KQs'],
  mixFrequency: 0.15,
  call: ['88+', 'ATs+', 'AJo+', 'KJs', 'QJs', 'JTs'],
  shortFlat: ['TT+', 'AQs+', 'AKo', 'JJ+', 'AJs+'],
  deepCall: ['T9s'],
});

const tightBbVsSb = line({
  value: ['TT+', 'AQs+', 'AKo'],
  mix: ['88+', 'ATs+', 'AJo+', 'KQs'],
  mixFrequency: 0.2,
  call: ['55+', 'A8s+', 'ATo+', 'KTs+', 'KJo', 'QTs+', 'JTs', 'T9s'],
  shortFlat: tightShort,
  deepCall: ['98s'],
});

const solidSbVsBtn = line({
  value: ['TT+', 'AQs+', 'AKo', 'KQs'],
  mix: ['77+', 'A9s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'JTs', 'T9s'],
  mixFrequency: 0.4,
  call: ['55+', 'A5s+', 'A9o+', 'K9s+', 'Q9s+', '98s', '87s', '76s'],
  shortFlat: solidShort,
  deepCall: ['65s', '54s'],
});

const solidSbVsUtg = line({
  value: ['JJ+', 'AQs+', 'AKo'],
  mix: ['99+', 'AJs+', 'AQo+', 'KQs'],
  mixFrequency: 0.25,
  call: ['88+', 'ATs+', 'AJo+', 'KJs', 'QJs', 'JTs'],
  shortFlat: ['TT+', 'AQs+', 'AKo', '99+', 'AJs+'],
  deepCall: ['T9s'],
});

const aggroSbVsBtn = line({
  value: ['77+', 'ATs+', 'AJo+', 'KQs', 'KQo'],
  mix: ['22+', 'A2s+', 'A8o+', 'K9s+', 'KTo+', 'Q9s+', 'QTo+', 'J9s+', 'T9s', '98s', '87s', '76s'],
  mixFrequency: 0.6,
  call: ['A5o+', 'K8s', 'Q8s', 'J8s', 'T8s', '65s', '98o'],
  bluff: ['A5s', 'A4s'],
  shortFlat: aggroShort,
  deepCall: ['54s', '64s'],
});

const aggroSbVsUtg = line({
  value: ['99+', 'AJs+', 'AQo+', 'KQs'],
  mix: ['66+', 'A9s+', 'ATo+', 'KTs+', 'KJo+', 'QJs', 'JTs'],
  mixFrequency: 0.5,
  call: ['55+', 'A5s+', 'KQs', 'QTs', 'T9s', '98s'],
  shortFlat: aggroShort,
  deepCall: ['87s'],
});

const tightSbVsBtn = line({
  value: ['JJ+', 'AQs+', 'AKo'],
  mix: ['99+', 'ATs+', 'AJo+', 'KQs'],
  mixFrequency: 0.3,
  call: ['77+', 'A9s+', 'ATo+', 'KJs', 'QJs', 'JTs', 'T9s'],
  shortFlat: tightShort,
  deepCall: ['98s'],
});

const tightSbVsUtg = line({
  value: ['QQ+', 'AKs', 'AKo'],
  mix: ['JJ+', 'AQs'],
  mixFrequency: 0.2,
  call: ['TT+', 'AJs+', 'AQo+', 'KQs'],
  shortFlat: ['QQ+', 'AKs', 'AKo', 'JJ+'],
  deepCall: [],
});

function pack(bb: ByOpener, sb: ByOpener, btn?: ByOpener): Partial<Record<Spot, ByOpener>> {
  return { BB: bb, SB: sb, ...(btn ? { BTN: btn } : {}) };
}

export const DEFEND: Record<ProfileId, Partial<Record<Spot, ByOpener>>> = {
  ai_0: pack(
    { BTN: solidBbVsBtn, UTG: solidBbVsUtg, SB: solidBbVsSb },
    { BTN: solidSbVsBtn, UTG: solidSbVsUtg },
    { UTG: solidBtnVsUtg },
  ),
  ai_1: pack(
    { BTN: aggroBbVsBtn, UTG: aggroBbVsUtg, SB: aggroBbVsSb },
    { BTN: aggroSbVsBtn, UTG: aggroSbVsUtg },
    { UTG: aggroBtnVsUtg },
  ),
  ai_2: pack(
    { BTN: tightBbVsBtn, UTG: tightBbVsUtg, SB: tightBbVsSb },
    { BTN: tightSbVsBtn, UTG: tightSbVsUtg },
  ),
};

export function eachDefendToken(charts: Partial<Record<Spot, ByOpener>>): string[] {
  const tokens: string[] = [];
  for (const byHero of Object.values(charts)) {
    if (!byHero) continue;
    for (const row of Object.values(byHero)) {
      if (!row) continue;
      tokens.push(...row.call, ...row.value, ...row.mix, ...row.bluff, ...row.deepCall, ...row.shortFlat);
    }
  }
  return tokens;
}
