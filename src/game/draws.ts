const RANKS = '23456789TJQKA';
const SUITS = ['s', 'h', 'd', 'c'] as const;

export interface DrawReport {
  outs: string[];
  labels: string[];
  backdoor: string[];
  note: string;
}

function rankOf(card: string): number {
  return RANKS.indexOf(card[0]);
}

function hasStraight(ranks: readonly number[]): boolean {
  const vals = new Set(ranks);
  if (vals.has(12)) vals.add(-1);
  const sorted = [...vals].sort((a, b) => a - b);
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      run += 1;
      if (run >= 5) return true;
    } else if (sorted[i] !== sorted[i - 1]) run = 1;
  }
  return false;
}

function straightOutRanks(hero: readonly string[], board: readonly string[]): number[] {
  const heroRanks = hero.map(rankOf).filter((rank) => rank >= 0);
  const boardRanks = board.map(rankOf).filter((rank) => rank >= 0);
  const owned = new Set([...heroRanks, ...boardRanks]);
  if (hasStraight([...owned])) return [];
  const outs: number[] = [];
  for (let rank = 0; rank < RANKS.length; rank++) {
    const withCard = [...owned, rank];
    if (!hasStraight(withCard)) continue;
    if (hasStraight([...boardRanks, rank])) continue;
    outs.push(rank);
  }
  return outs;
}

/** 只根据本人底牌和已发公共牌。河牌不报未来出张，后门不计入下一张就能完成的 outs。 */
export function analyzeDraws(hole: readonly string[], board: readonly string[]): DrawReport {
  if (board.length >= 5 || board.length < 3 || hole.length !== 2) {
    return {
      outs: [],
      labels: [],
      backdoor: [],
      note: board.length >= 5 ? '河牌没有下一张出牌。' : '翻后才会提示听牌。',
    };
  }
  const seen = new Set([...hole, ...board]);
  const labels: string[] = [];
  const backdoor: string[] = [];
  const outSet = new Set<string>();

  const suitCount = new Map<string, number>();
  const heroSuits = new Map<string, number>();
  for (const card of [...hole, ...board]) suitCount.set(card[1], (suitCount.get(card[1]) ?? 0) + 1);
  for (const card of hole) heroSuits.set(card[1], (heroSuits.get(card[1]) ?? 0) + 1);
  for (const suit of SUITS) {
    const total = suitCount.get(suit) ?? 0;
    const own = heroSuits.get(suit) ?? 0;
    if (own <= 0 || total >= 5) continue;
    if (total === 4) {
      labels.push('同花听牌');
      for (const rank of RANKS) {
        const card = `${rank}${suit}`;
        if (!seen.has(card)) outSet.add(card);
      }
    } else if (total === 3 && board.length === 3) {
      backdoor.push('后门同花，下一张不能完成');
    }
  }

  const straightRanks = straightOutRanks(hole, board);
  if (straightRanks.length === 1) labels.push('卡顺');
  else if (straightRanks.length >= 2) {
    const span = Math.max(...straightRanks) - Math.min(...straightRanks);
    labels.push(span >= 4 ? '两头顺' : '卡顺');
  } else if (board.length === 3) {
    const heroRanks = hole.map(rankOf);
    const boardRanks = board.map(rankOf);
    const near = RANKS.split('').some((_, rank) => {
      const owned = new Set([...heroRanks, ...boardRanks, rank]);
      let run = 1;
      const vals = [...owned].sort((a, b) => a - b);
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] === vals[i - 1] + 1) run += 1;
        else if (vals[i] !== vals[i - 1]) run = 1;
        if (run >= 4 && heroRanks.some((item) => Math.abs(item - rank) <= 4)) return true;
      }
      return false;
    });
    if (near) backdoor.push('后门顺子，下一张不能完成');
  }
  for (const rank of straightRanks) {
    for (const suit of SUITS) {
      const card = `${RANKS[rank]}${suit}`;
      if (!seen.has(card)) outSet.add(card);
    }
  }

  const flush = labels.includes('同花听牌');
  const straight = labels.includes('两头顺') || labels.includes('卡顺');
  if (flush && straight) labels.push('组合听牌');
  const outs = [...outSet].sort();
  const note = outs.length > 0
    ? `成牌出张 ${outs.length} 张，不保证获胜。`
    : '没有下一张就能完成的个人听牌。';
  return { outs, labels, backdoor, note };
}
