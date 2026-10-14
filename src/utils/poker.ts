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

/** 牌型英文名 → 中文名 */
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
  'Royal Flush': '皇家同花顺',
};

/**
 * 评估一组牌（5~7张）的最佳牌型，返回中文名（日志与教学提示共用）
 */
export function handNameCN(cards: Card[]): string {
  const name = evaluateHand(cards).name;
  return HAND_NAME_CN[name] || name;
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
