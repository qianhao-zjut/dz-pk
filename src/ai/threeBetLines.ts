type RangeSpot = 'UTG' | 'BTN' | 'SB' | 'BB' | 'HU';

interface ChartSlice {
  fourBet: Record<RangeSpot, string[]>;
  callVsReraise: Record<RangeSpot, string[]>;
}

/** 面对一次完整 3bet 时，按自己当时的身份继续。4bet 与平跟分开。 */
export interface ThreeBetLine {
  call: string[];
  raise: string[];
  deepCall: string[];
  shortCall: string[];
}

export type ThreeBetRole = 'opener' | 'coldCaller' | 'cold';

export interface ThreeBetBook {
  opener: Record<RangeSpot, ThreeBetLine>;
  coldCaller: Record<RangeSpot, ThreeBetLine>;
  cold: Record<RangeSpot, ThreeBetLine>;
}

const SPOTS: RangeSpot[] = ['UTG', 'BTN', 'SB', 'BB', 'HU'];

function line(call: string[], raise: string[], deepCall: string[] = []): ThreeBetLine {
  return { call, raise, deepCall, shortCall: call };
}

function fill(spotLine: (spot: RangeSpot) => ThreeBetLine): Record<RangeSpot, ThreeBetLine> {
  return Object.fromEntries(SPOTS.map((spot) => [spot, spotLine(spot)])) as Record<RangeSpot, ThreeBetLine>;
}

/** 冷玩家沿用各风格原来的 4bet / 跟注再加注表，避免把开池者的宽继续套到还没入池的人。 */
function coldBook(chart: ChartSlice): Record<RangeSpot, ThreeBetLine> {
  return fill((spot) => line(chart.callVsReraise[spot], chart.fourBet[spot]));
}

const solidOpenerBtn = line(
  ['77+', 'A9s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'QJo', 'JTs', 'T9s', '98s', '87s', '76s'],
  ['QQ+', 'AKs'],
  ['65s', '54s', 'A5s', 'A8s'],
);

const aggroOpenerBtn = line(
  ['22+', 'A2s+', 'A8o+', 'K9s+', 'KTo+', 'Q9s+', 'QTo+', 'J9s+', 'JTo', 'T8s+', '97s+', '86s+', '76s', '65s', '54s'],
  ['TT+', 'AQs+', 'AKo'],
  ['A7o', 'K8s', 'Q8s', '64s', '43s'],
);

const tightOpenerBtn = line(
  ['88+', 'ATs+', 'AJo+', 'KQs', 'KQo', 'QJs'],
  ['QQ+', 'AKs'],
  ['77', 'A9s', 'JTs'],
);

const looseOpenerBtn = line(
  ['55+', 'A5s+', 'ATo+', 'KTs+', 'KJo+', 'QTs+', 'QJo', 'JTs', 'T9s', '98s', '87s', '76s', '65s'],
  ['QQ+', 'AKs', 'AKo'],
  ['44', 'A4s', 'K9s', '54s'],
);

function openerBook(
  button: ThreeBetLine,
  early: ThreeBetLine,
): Record<RangeSpot, ThreeBetLine> {
  return fill((spot) => (spot === 'BTN' || spot === 'HU' ? button : early));
}

export function threeBetBook(chart: ChartSlice, id: 'ai_0' | 'ai_1' | 'ai_2' | 'loose_passive'): ThreeBetBook {
  const cold = coldBook(chart);
  if (id === 'ai_1') {
    return {
      opener: openerBook(
        aggroOpenerBtn,
        line(['77+', 'ATs+', 'AJo+', 'KQs', 'KQo', 'QJs', 'JTs', 'T9s'], ['TT+', 'AQs+', 'AKo'], ['98s', '87s']),
      ),
      coldCaller: cold,
      cold,
    };
  }
  if (id === 'ai_2') {
    return {
      opener: openerBook(
        tightOpenerBtn,
        line(['TT+', 'AQs+', 'AKo', 'AJs', 'KQs'], ['QQ+', 'AKs']),
      ),
      coldCaller: cold,
      cold,
    };
  }
  if (id === 'loose_passive') {
    return {
      opener: openerBook(
        looseOpenerBtn,
        line(['77+', 'ATs+', 'AJo+', 'KQs', 'QJs', 'JTs', 'T9s'], ['QQ+', 'AKs', 'AKo'], ['98s', '87s']),
      ),
      coldCaller: fill((spot) => line(
        [...chart.callVsReraise[spot], '88', 'ATs', 'KQs', 'QJs', 'JTs'],
        ['KK+', 'AKs'],
      )),
      cold: fill(() => line(['TT+', 'AQs+', 'AKo', 'AJs', 'KQs'], ['KK+', 'AKs'])),
    };
  }
  return {
    opener: openerBook(
      solidOpenerBtn,
      line(['88+', 'ATs+', 'AJo+', 'KQs', 'QJs', 'JTs'], ['QQ+', 'AKs'], ['T9s', '98s']),
    ),
    coldCaller: cold,
    cold,
  };
}
