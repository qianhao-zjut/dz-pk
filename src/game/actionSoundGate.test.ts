import { describe, expect, it } from 'vitest';
import type { PublicAction, SeatStatus } from '../ai/types';
import { createActionSoundGate, YOUR_TURN_DELAY_MS, type SoundFrame } from './actionSoundGate';

function act(partial: Partial<PublicAction> & Pick<PublicAction, 'actorId' | 'kind'>): PublicAction {
  return { stage: 'preflop', to: null, ...partial };
}

function frame(partial: Partial<SoundFrame> & Pick<SoundFrame, 'streetActions'>): SoundFrame {
  return {
    handNumber: 1,
    stage: 'preflop',
    currentPlayerIndex: 0,
    currentPlayerId: 'ai_0',
    humanStatus: 'active',
    statuses: {},
    ...partial,
  };
}

function harness(initial: { enabled?: boolean; hidden?: boolean } = {}) {
  const played: string[] = [];
  let enabled = initial.enabled ?? true;
  let hidden = initial.hidden ?? false;
  const waiting: { ms: number; run: () => void }[] = [];
  const gate = createActionSoundGate({
    play: (cue) => { played.push(cue); },
    delay: (ms, run) => {
      const item = { ms, run };
      waiting.push(item);
      return () => {
        const index = waiting.indexOf(item);
        if (index >= 0) waiting.splice(index, 1);
      };
    },
    enabled: () => enabled,
    hidden: () => hidden,
  });
  return {
    played,
    gate,
    setEnabled: (value: boolean) => { enabled = value; },
    setHidden: (value: boolean) => { hidden = value; },
    flush: (ms = YOUR_TURN_DELAY_MS) => {
      const due = waiting.filter((item) => item.ms === ms);
      for (const item of due) {
        const index = waiting.indexOf(item);
        if (index >= 0) waiting.splice(index, 1);
        item.run();
      }
    },
    waiting: () => waiting.length,
  };
}

describe('actionSoundGate', () => {
  const posts = [
    act({ actorId: 'ai_0', kind: 'post', to: 5 }),
    act({ actorId: 'ai_1', kind: 'post', to: 10 }),
  ];

  it('盲注不响，之后的行动按种类响一次', () => {
    const box = harness();
    box.gate.onFrame(frame({ streetActions: posts, statuses: { ai_0: 'active', ai_1: 'active' } }));
    expect(box.played).toEqual([]);
    const check = act({ actorId: 'ai_2', stage: 'flop', kind: 'check' });
    const withCheck = [...posts, check];
    box.gate.onFrame(frame({
      stage: 'flop',
      streetActions: withCheck,
      statuses: { ai_0: 'active', ai_1: 'active', ai_2: 'active' },
    }));
    expect(box.played).toEqual(['check']);
    box.gate.onFrame(frame({ stage: 'flop', streetActions: withCheck, statuses: { ai_2: 'active' } }));
    expect(box.played).toEqual(['check']);
  });

  it('跟注、下注、加注、弃牌和全下用不同声音', () => {
    const box = harness();
    box.gate.onFrame(frame({ streetActions: [] }));
    const call = act({ actorId: 'ai_0', stage: 'flop', kind: 'call' });
    const bet = act({ actorId: 'ai_1', stage: 'flop', kind: 'raise', to: 10 });
    const raised = act({ actorId: 'ai_2', stage: 'flop', kind: 'raise', to: 40 });
    const folded = act({ actorId: 'human', stage: 'turn', kind: 'fold' });
    const jammed = act({ actorId: 'ai_0', stage: 'river', kind: 'call' });
    const statuses: Record<string, SeatStatus> = {
      ai_0: 'active', ai_1: 'active', ai_2: 'active', human: 'folded',
    };
    box.gate.onFrame(frame({ stage: 'flop', streetActions: [call], statuses }));
    box.gate.onFrame(frame({ stage: 'flop', streetActions: [call, bet], statuses }));
    box.gate.onFrame(frame({ stage: 'flop', streetActions: [call, bet, raised], statuses }));
    box.gate.onFrame(frame({ stage: 'turn', streetActions: [call, bet, raised, folded], statuses }));
    box.gate.onFrame(frame({
      stage: 'river',
      streetActions: [call, bet, raised, folded, jammed],
      statuses: { ...statuses, ai_0: 'all-in' },
    }));
    expect(box.played).toEqual(['call', 'bet', 'raise', 'fold', 'all-in']);
  });

  it('同一帧的多条行动按顺序播放', () => {
    const box = harness();
    box.gate.onFrame(frame({ streetActions: [] }));
    box.gate.onFrame(frame({
      stage: 'flop',
      streetActions: [
        act({ actorId: 'ai_0', stage: 'flop', kind: 'check' }),
        act({ actorId: 'ai_1', stage: 'flop', kind: 'fold' }),
      ],
      statuses: { ai_0: 'active', ai_1: 'folded' },
    }));
    expect(box.played).toEqual(['check', 'fold']);
  });

  it('静音、隐藏和换手都不补播', () => {
    const check = act({ actorId: 'ai_0', stage: 'flop', kind: 'check' });
    const quiet = harness({ enabled: false });
    quiet.gate.onFrame(frame({ streetActions: [] }));
    quiet.gate.onFrame(frame({ stage: 'flop', streetActions: [check], statuses: { ai_0: 'active' } }));
    quiet.setEnabled(true);
    quiet.gate.onFrame(frame({ stage: 'flop', streetActions: [check], statuses: { ai_0: 'active' } }));
    expect(quiet.played).toEqual([]);

    const away = harness({ hidden: true });
    away.gate.onFrame(frame({ streetActions: [] }));
    away.gate.onFrame(frame({ stage: 'flop', streetActions: [check], statuses: { ai_0: 'active' } }));
    away.setHidden(false);
    away.gate.onFrame(frame({ stage: 'flop', streetActions: [check], statuses: { ai_0: 'active' } }));
    expect(away.played).toEqual([]);

    const next = harness();
    next.gate.onFrame(frame({ streetActions: [] }));
    next.gate.onFrame(frame({ stage: 'flop', streetActions: [check], statuses: { ai_0: 'active' } }));
    expect(next.played).toEqual(['check']);
    next.gate.onFrame(frame({ handNumber: 2, streetActions: posts }));
    expect(next.played).toEqual(['check']);
  });

  it('对手行动后轮到你时，提示音晚 200 毫秒，并且只响一次', () => {
    const box = harness();
    box.gate.onFrame(frame({ streetActions: posts, currentPlayerId: 'ai_0' }));
    const stop = box.gate.onFrame(frame({
      streetActions: [...posts, act({ actorId: 'ai_2', kind: 'fold' })],
      currentPlayerIndex: 3,
      currentPlayerId: 'human',
      statuses: { ai_2: 'folded', human: 'active' },
    }));
    expect(box.played).toEqual(['fold']);
    stop();
    box.gate.onFrame(frame({
      streetActions: [...posts, act({ actorId: 'ai_2', kind: 'fold' })],
      currentPlayerIndex: 3,
      currentPlayerId: 'human',
      statuses: { ai_2: 'folded', human: 'active' },
    }));
    expect(box.played).toEqual(['fold']);
    box.flush();
    expect(box.played).toEqual(['fold', 'your-turn']);
    box.flush();
    expect(box.played).toEqual(['fold', 'your-turn']);
  });

  it('延迟提示在静音、隐藏或轮转失效时不响', () => {
    const muted = harness();
    muted.gate.onFrame(frame({ streetActions: posts }));
    muted.gate.onFrame(frame({
      streetActions: [...posts, act({ actorId: 'ai_2', kind: 'fold' })],
      currentPlayerId: 'human',
      currentPlayerIndex: 3,
      statuses: { ai_2: 'folded' },
    }));
    muted.setEnabled(false);
    muted.flush();
    expect(muted.played).toEqual(['fold']);

    const hidden = harness();
    hidden.gate.onFrame(frame({ streetActions: posts }));
    hidden.gate.onFrame(frame({
      streetActions: [...posts, act({ actorId: 'ai_2', kind: 'fold' })],
      currentPlayerId: 'human',
      currentPlayerIndex: 3,
      statuses: { ai_2: 'folded' },
    }));
    hidden.setHidden(true);
    hidden.flush();
    expect(hidden.played).toEqual(['fold']);

    const left = harness();
    left.gate.onFrame(frame({ streetActions: posts }));
    const cancel = left.gate.onFrame(frame({
      streetActions: [...posts, act({ actorId: 'ai_2', kind: 'fold' })],
      currentPlayerId: 'human',
      currentPlayerIndex: 3,
      statuses: { ai_2: 'folded' },
    }));
    cancel();
    left.gate.onFrame(frame({
      streetActions: [...posts, act({ actorId: 'ai_2', kind: 'fold' }), act({ actorId: 'human', kind: 'call' })],
      currentPlayerId: 'ai_0',
      currentPlayerIndex: 0,
      statuses: { ai_2: 'folded', human: 'active' },
    }));
    left.flush();
    expect(left.played).toEqual(['fold', 'call']);
  });

  it('开局轮到你时立即提示，本人行动后不再提示自己', () => {
    const box = harness();
    box.gate.onFrame(frame({
      streetActions: posts,
      currentPlayerId: 'human',
      currentPlayerIndex: 2,
    }));
    expect(box.played).toEqual(['your-turn']);
    box.gate.onFrame(frame({
      streetActions: [...posts, act({ actorId: 'human', kind: 'call' })],
      currentPlayerId: 'ai_0',
      currentPlayerIndex: 0,
      statuses: { human: 'active' },
    }));
    box.flush();
    expect(box.played).toEqual(['your-turn', 'call']);
  });
});
