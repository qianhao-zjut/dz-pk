import { describe, expect, it } from 'vitest';
import type { PublicAction } from '../ai/types';
import { seatActionLabel } from './seatActionLabel';

function act(partial: Partial<PublicAction> & Pick<PublicAction, 'actorId' | 'kind'>): PublicAction {
  return {
    stage: 'flop',
    to: null,
    ...partial,
  };
}

describe('seatActionLabel', () => {
  it('过牌、跟注、弃牌和全下', () => {
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_0', kind: 'check' })])).toBe('过牌');
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_0', kind: 'call' })])).toBe('跟注');
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_0', kind: 'fold' })])).toBe('弃牌');
    expect(seatActionLabel('ai_0', 'folded', 'turn', [act({ actorId: 'ai_0', stage: 'flop', kind: 'check' })])).toBe('弃牌');
    expect(seatActionLabel('ai_0', 'all-in', 'turn', [act({ actorId: 'ai_0', stage: 'flop', kind: 'raise', to: 40 })])).toBe('全下');
  });

  it('跟注不写金额', () => {
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_0', kind: 'call' })])).not.toContain('$');
  });

  it('翻后第一次下注，翻前和面对下注时叫加注到', () => {
    const open = act({ actorId: 'ai_0', kind: 'raise', to: 10 });
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_1', kind: 'check' }), open])).toBe('下注 $10');
    const raised = act({ actorId: 'ai_0', kind: 'raise', to: 40 });
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_1', kind: 'raise', to: 10 }), raised])).toBe('加注到 $40');
    const pre = act({ actorId: 'human', stage: 'preflop', kind: 'raise', to: 30 });
    expect(seatActionLabel('human', 'active', 'preflop', [
      act({ actorId: 'ai_0', stage: 'preflop', kind: 'post', to: 5 }),
      pre,
    ])).toBe('加注到 $30');
  });

  it('同一人再次行动后只留最新一条', () => {
    const bet = act({ actorId: 'ai_0', kind: 'raise', to: 10 });
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_0', kind: 'check' }), bet])).toBe('下注 $10');
  });

  it('盲注没有标签，换街和摊牌清掉金额类标签', () => {
    expect(seatActionLabel('ai_0', 'active', 'preflop', [act({ actorId: 'ai_0', stage: 'preflop', kind: 'post', to: 5 })])).toBeNull();
    expect(seatActionLabel('ai_0', 'active', 'turn', [act({ actorId: 'ai_0', stage: 'flop', kind: 'check' })])).toBeNull();
    expect(seatActionLabel('ai_0', 'active', 'showdown', [act({ actorId: 'ai_0', stage: 'river', kind: 'check' })])).toBeNull();
    expect(seatActionLabel('ai_1', 'folded', 'showdown', [act({ actorId: 'ai_1', stage: 'flop', kind: 'fold' })])).toBe('弃牌');
  });

  it('非法加注额只留动词', () => {
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_0', kind: 'raise', to: null })])).toBe('下注');
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_0', kind: 'raise', to: 1.5 })])).toBe('下注');
    expect(seatActionLabel('ai_0', 'active', 'flop', [act({ actorId: 'ai_1', kind: 'call' }), act({ actorId: 'ai_0', kind: 'raise', to: 0 })])).toBe('加注');
  });

  it('不显示别人的行动', () => {
    expect(seatActionLabel('human', 'active', 'flop', [act({ actorId: 'ai_0', kind: 'check' })])).toBeNull();
  });
});
