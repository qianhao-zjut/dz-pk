import { handKey } from '../ai/cards';

const RANKS = '23456789TJQKA';

/** 翻前只描述牌类，不给没有依据的牌力分数。 */
export function describeHole(a: string, b: string): string {
  const key = handKey(a, b);
  if (!key) return '未知底牌';
  if (key.length === 2) {
    const high = key[0] === 'A' || key[0] === 'K';
    const middle = key[0] === 'Q' || key[0] === 'J' || key[0] === 'T';
    const kind = high ? '大口袋对子' : middle ? '中口袋对子' : '小口袋对子';
    return `${key}，${kind}`;
  }
  const suited = key.endsWith('s');
  const gap = RANKS.indexOf(key[0]) - RANKS.indexOf(key[1]);
  const broadway = 'AKQJT'.includes(key[0]) && 'AKQJT'.includes(key[1]);
  if (broadway) return suited ? `${key}，同花高张` : `${key}，非同花高张`;
  if (gap === 1) return suited ? `${key}，同花连张` : `${key}，非同花连张`;
  if (gap === 2) return suited ? `${key}，同花隔张` : `${key}，非同花隔张`;
  if (key[0] === 'A') return suited ? `${key}，同花 Ax` : `${key}，非同花 Ax`;
  return suited ? `${key}，同花杂牌` : `${key}，非同花杂牌`;
}
