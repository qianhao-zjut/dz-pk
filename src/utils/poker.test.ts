import { describe, it, expect } from 'vitest';
import { createDeck, shuffleDeck, evaluateHand, compareHands, handNameCN } from './poker';

describe('Poker Logic', () => {
  it('should create a standard 52-card deck', () => {
    const deck = createDeck();
    expect(deck.length).toBe(52);
    
    // Check for uniqueness
    const uniqueCards = new Set(deck);
    expect(uniqueCards.size).toBe(52);
    
    // Check some specific cards
    expect(deck).toContain('As');
    expect(deck).toContain('2c');
    expect(deck).toContain('Th');
    expect(deck).toContain('Kd');
  });

  it('should shuffle the deck', () => {
    const deck1 = createDeck();
    const deck2 = shuffleDeck(createDeck());
    
    expect(deck2.length).toBe(52);
    // Probability of the first 5 cards being exactly the same after shuffle is extremely low
    const isSameOrder = deck1.slice(0, 5).join(',') === deck2.slice(0, 5).join(',');
    expect(isSameOrder).toBe(false);
  });

  it('should correctly evaluate hand types', () => {
    // Royal Flush
    const royalFlush = evaluateHand(['As', 'Ks', 'Qs', 'Js', 'Ts']);
    expect(royalFlush.descr).toBe('Royal Flush');

    // Full House
    const fullHouse = evaluateHand(['As', 'Ac', 'Ah', 'Ks', 'Kc']);
    expect(fullHouse.name).toBe('Full House');

    // High Card
    const highCard = evaluateHand(['As', 'Kc', 'Qh', 'Jd', '9s']);
    expect(highCard.name).toBe('High Card');
  });

  it('should evaluate best 5 cards out of 7 correctly', () => {
    // 7 cards: Two Pair (Aces and Kings) vs Three of a kind (Aces)
    // Board: Ah, Ac, Kd, Ks, 2c
    // Hand: As, 3d -> Three Aces
    const threeOfAKind = evaluateHand(['Ah', 'Ac', 'Kd', 'Ks', '2c', 'As', '3d']);
    expect(threeOfAKind.name).toBe('Full House'); // Aces full of Kings!
  });

  it('should correctly compare two hands', () => {
    const hand1 = ['As', 'Ks', 'Qs', 'Js', 'Ts']; // Royal Flush
    const hand2 = ['Ah', 'Ac', 'Ad', 'As', 'Kc']; // Four of a Kind

    expect(compareHands(hand1, hand2)).toBe(1); // hand1 wins
    expect(compareHands(hand2, hand1)).toBe(-1); // hand2 loses
    
    // Tie
    const tie1 = ['As', 'Ks', 'Qs', 'Js', 'Ts'];
    const tie2 = ['Ah', 'Kh', 'Qh', 'Jh', 'Th'];
    expect(compareHands(tie1, tie2)).toBe(0);
  });

  it('should describe hands in Chinese with the ranks that break ties', () => {
    expect(handNameCN(['As', 'Ks', 'Qs', 'Js', 'Ts'])).toBe('皇家同花顺');
    expect(handNameCN(['Kh', 'Qh', 'Jh', 'Th', '9h'])).toBe('同花顺，K 高');
    expect(handNameCN(['As', '2s', '3s', '4s', '5s'])).toBe('同花顺，5 高');
    expect(handNameCN(['Ah', '2d', '3c', '4s', '5h'])).toBe('顺子，5 高');
    expect(handNameCN(['As', 'Ah', 'Ad', 'Ac', 'Kc'])).toBe('四条，A');
    expect(handNameCN(['Ts', 'Th', 'Td', 'Tc', '2c'])).toBe('四条，10');
    expect(handNameCN(['As', 'Ac', 'Ah', 'Ks', 'Kc'])).toBe('葫芦，A 带 K');
    expect(handNameCN(['As', 'Ks', 'Qs', 'Js', '9s'])).toBe('同花，A 高');
    expect(handNameCN(['Kh', 'Qd', 'Jc', 'Ts', '9h'])).toBe('顺子，K 高');
    expect(handNameCN(['As', 'Ah', 'Ad', 'Kc', 'Qh'])).toBe('三条，A');
    expect(handNameCN(['9s', '9h', '5d', '5c', 'Ah'])).toBe('两对，9 和 5');
    expect(handNameCN(['As', 'Ah', 'Kd', 'Qc', 'Jh'])).toBe('一对，A');
    expect(handNameCN(['As', 'Kc', 'Qh', 'Jd', '9s'])).toBe('高牌，A');
  });
});
