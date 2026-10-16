import { Hand } from 'pokersolver';

export type Suit = 's' | 'h' | 'd' | 'c';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
export type Card = string; // e.g., "As", "Th"

export const SUITS: Suit[] = ['s', 'h', 'd', 'c'];
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

/**
 * 创建一副全新的52张扑克牌
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

/**
 * 随机洗牌（Fisher-Yates 洗牌算法）
 */
export function shuffleDeck(deck: Card[]): Card[] {
  const newDeck = [...deck];
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
}

/**
 * 评估手牌大小（返回包含牌型名称描述的对象）
 * @param cards 5到7张牌的数组
 */
export function evaluateHand(cards: Card[]): Hand {
  return Hand.solve(cards);
}

/**
 * pokersolver 的 descr 里，点数来自 Card.toString().slice(0, -1)：
 * T 已经写成 10，花色字母在同花 / 同花顺里另接在点数后面。
 */
const RANK = '10|[2-9AJQK]';

/** descr 对不上时，退回大类中文名（皇家同花顺的 name 仍是 Straight Flush，不能走这里） */
const HAND_NAME_CN: Record<string, string> = {
  'High Card': '高牌',
  'Pair': '一对',
  'Two Pair': '两对',
  'Three of a Kind': '三条',
  'Straight': '顺子',
  'Flush': '同花',
  'Full House': '葫芦',
  'Four of a Kind': '四条',
  'Straight Flush': '同花顺',
};

/**
 * 把 pokersolver 的 Hand.descr 翻成带点数的短中文。
 * 皇家同花顺的 name 也是 Straight Flush，必须以 descr 为准。
 */
function formatDescrCN(descr: string): string | null {
  if (descr === 'Royal Flush') return '皇家同花顺';

  const straightFlush = descr.match(new RegExp(`^Straight Flush, (${RANK})[shdc] High$`));
  if (straightFlush) return `同花顺，${straightFlush[1]} 高`;

  const four = descr.match(new RegExp(`^Four of a Kind, (${RANK})'s$`));
  if (four) return `四条，${four[1]}`;

  const fullHouse = descr.match(new RegExp(`^Full House, (${RANK})'s over (${RANK})'s$`));
  if (fullHouse) return `葫芦，${fullHouse[1]} 带 ${fullHouse[2]}`;

  const flush = descr.match(new RegExp(`^Flush, (${RANK})[shdc] High$`));
  if (flush) return `同花，${flush[1]} 高`;

  const straight = descr.match(new RegExp(`^Straight, (${RANK}) High$`));
  if (straight) return `顺子，${straight[1]} 高`;

  const trips = descr.match(new RegExp(`^Three of a Kind, (${RANK})'s$`));
  if (trips) return `三条，${trips[1]}`;

  const twoPair = descr.match(new RegExp(`^Two Pair, (${RANK})'s & (${RANK})'s$`));
  if (twoPair) return `两对，${twoPair[1]} 和 ${twoPair[2]}`;

  const pair = descr.match(new RegExp(`^Pair, (${RANK})'s$`));
  if (pair) return `一对，${pair[1]}`;

  const high = descr.match(new RegExp(`^(${RANK}) High$`));
  if (high) return `高牌，${high[1]}`;

  return null;
}

/**
 * 评估一组牌（5~7张）的最佳牌型，返回中文名（日志与教学提示共用）
 */
export function handNameCN(cards: Card[]): string {
  const hand = evaluateHand(cards);
  return formatDescrCN(hand.descr) ?? (HAND_NAME_CN[hand.name] || hand.name);
}

/**
 * 比较两手牌的大小
 * @returns 1 if hand1 wins, -1 if hand2 wins, 0 if tie
 */
export function compareHands(hand1: Card[], hand2: Card[]): number {
  const h1 = Hand.solve(hand1);
  const h2 = Hand.solve(hand2);
  const winners = Hand.winners([h1, h2]);
  
  if (winners.length === 2) {
    return 0; // 平局
  }
  return winners[0] === h1 ? 1 : -1;
}
