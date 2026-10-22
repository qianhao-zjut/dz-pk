import { createDeck } from '../utils/poker';
import type { BettingStage, ObservationError } from './types';

const RANKS = '23456789TJQKA';
const BOARD_LENGTH: Record<BettingStage, number> = {
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
};

export function isCard(card: string): boolean {
  return /^[2-9TJQKA][shdc]$/.test(card);
}

export function boardLengthFor(stage: BettingStage): number {
  return BOARD_LENGTH[stage];
}

/** 标准起手牌写法：对子 AA，同花 AKs，不同花 AKo。无效输入返回 null。 */
export function handKey(a: string, b: string): string | null {
  if (!isCard(a) || !isCard(b) || a === b) return null;
  if (a[0] === b[0]) return a[0] + b[0];
  const left = RANKS.indexOf(a[0]);
  const right = RANKS.indexOf(b[0]);
  const hi = left > right ? a[0] : b[0];
  const lo = left > right ? b[0] : a[0];
  return hi + lo + (a[1] === b[1] ? 's' : 'o');
}

export function unknownCards(hole: readonly string[], board: readonly string[]): string[] {
  const used = new Set([...hole, ...board]);
  return createDeck().filter((card) => !used.has(card));
}

export function cardProblem(
  hole: readonly string[],
  board: readonly string[],
  stage: BettingStage,
  opponentCount: number,
): ObservationError | null {
  if (hole.length !== 2) return 'bad-hole-count';
  if (board.length !== BOARD_LENGTH[stage]) return 'bad-board-count';
  const seen = new Set<string>();
  for (const card of [...hole, ...board]) {
    if (!isCard(card)) return 'bad-card';
    if (seen.has(card)) return 'duplicate-card';
    seen.add(card);
  }
  const need = opponentCount * 2 + (5 - board.length);
  if (unknownCards(hole, board).length < need) return 'not-enough-cards';
  return null;
}

/** 77+、ATs+、AKo 这种范围记号。写错的记号直接抛出，避免静默漏牌。 */
export function expandRangeToken(token: string): string[] {
  const plus = token.endsWith('+');
  const body = plus ? token.slice(0, -1) : token;
  if (body.length === 2 && body[0] === body[1] && RANKS.includes(body[0])) {
    if (!plus) return [body];
    const start = RANKS.indexOf(body[0]);
    const pairs: string[] = [];
    for (let i = start; i < RANKS.length; i++) pairs.push(RANKS[i] + RANKS[i]);
    return pairs;
  }
  const matched = /^([2-9TJQKA])([2-9TJQKA])([so])$/.exec(body);
  if (!matched) throw new Error(`无法识别的范围记号 ${token}`);
  const hi = RANKS.indexOf(matched[1]);
  const lo = RANKS.indexOf(matched[2]);
  if (lo < 0 || hi < 0 || lo >= hi) throw new Error(`无法识别的范围记号 ${token}`);
  if (!plus) return [body];
  const hands: string[] = [];
  for (let i = lo; i < hi; i++) hands.push(RANKS[hi] + RANKS[i] + matched[3]);
  return hands;
}

const rangeCache = new Map<string, Set<string>>();

export function rangeContains(tokens: readonly string[], key: string): boolean {
  const cacheKey = tokens.join(',');
  let set = rangeCache.get(cacheKey);
  if (!set) {
    set = new Set<string>();
    for (const token of tokens) {
      for (const hand of expandRangeToken(token)) set.add(hand);
    }
    rangeCache.set(cacheKey, set);
  }
  return set.has(key);
}

/** 短码只允许用强牌全下，避免“在开池范围内就全下”。 */
export function isPremiumHand(key: string): boolean {
  if (/^(.)\1$/.test(key)) return RANKS.indexOf(key[0]) >= RANKS.indexOf('T');
  return key === 'AKs' || key === 'AKo' || key === 'AQs';
}
