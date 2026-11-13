import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TableFelt } from '../components/TableFelt';
import type { Player } from '../store/gameStore';
import { roleAt } from './positions';

const tableSource = readFileSync(new URL('../components/GameTable.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const store = readFileSync(new URL('../store/gameStore.ts', import.meta.url), 'utf8');

function playersFor(size: number): Player[] {
  return Array.from({ length: size }, (_, seat) => ({
    id: seat === 0 ? 'human' : `ai_${seat - 1}`,
    name: seat === 0 ? '你 (Player)' : `对手${seat}`,
    isAI: seat !== 0,
    profileId: 'ai_0',
    chips: 200 - seat,
    cards: seat === 3 ? [] : ['As', 'Kd'],
    currentBet: seat === 1 ? 1 : seat === 2 ? 2 : 0,
    invested: 0,
    status: seat === 3 ? 'folded' : 'active',
    hasActed: false,
    canRaise: true,
  }));
}

describe('行动反馈界面', () => {
  it('4、6、9 人按数组顺序渲染座位、按钮和行动', () => {
    expect(tableSource).not.toContain('Folded');
    expect(tableSource).not.toContain('ALL-IN');
    expect(tableSource).toContain('TableFelt');
    expect(tableSource).toContain('liveActionSound');
    expect(tableSource).toContain('音效开');
    expect(app).toContain('primeActionAudio');
    expect(store).not.toContain('playActionCue');
    expect(store).not.toContain('liveActionSound');

    for (const size of [4, 6, 9] as const) {
      const players = playersFor(size);
      const markup = renderToStaticMarkup(React.createElement(TableFelt, {
        players,
        stage: 'preflop',
        pot: 3,
        board: [],
        bigBlind: 2,
        buttonIndex: 0,
        currentPlayerIndex: 4 % size,
        streetActions: [
          { actorId: players[1].id, stage: 'preflop', kind: 'post', to: 1 },
          { actorId: players[2].id, stage: 'preflop', kind: 'post', to: 2 },
          { actorId: 'ai_2', stage: 'preflop', kind: 'fold', to: null },
        ],
      }));
      const ids = [...markup.matchAll(/data-seat-id="([^"]+)"/g)].map((match) => match[1]);
      const roles = [...markup.matchAll(/data-role="([^"]+)"/g)].map((match) => match[1]);
      const tops = [...markup.matchAll(/top:([0-9.]+)%/g)].map((match) => Number(match[1]));
      expect(ids).toEqual(players.map((player) => player.id));
      expect(roles).toEqual(players.map((_, seat) => roleAt(seat, 0, players.map((player) => player.status)) ?? 'out'));
      expect(markup.split('♠').length - 1).toBe(1);
      expect(markup).toContain('>D</div>');
      expect(markup).toContain('data-current="true"');
      expect(markup).toContain('弃牌');
      expect(markup).toContain('Pot: $3');
      expect(markup).toContain('对手1');
      expect(tops[0]).toBeGreaterThan(tops[Math.floor(size / 2)]);
    }

    const shown = renderToStaticMarkup(React.createElement(TableFelt, {
      players: playersFor(4).map((player) => ({ ...player, status: 'active' as const, cards: ['Ah', 'Kd'] })),
      stage: 'showdown',
      pot: 10,
      board: ['2c', '3d', '4h', '5s', '6c'],
      bigBlind: 2,
      buttonIndex: 1,
      currentPlayerIndex: -1,
      streetActions: [],
    }));
    expect(shown.split('♥').length - 1).toBe(5);
    expect(shown).toContain('>2</div>');
  });
});
