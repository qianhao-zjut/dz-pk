import { describe, it, expect } from 'vitest';
import { createDeck, shuffleDeck, evaluateHand, compareHands } from './poker';

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
});
