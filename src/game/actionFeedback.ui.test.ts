import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const table = readFileSync(new URL('../components/GameTable.tsx', import.meta.url), 'utf8');

describe('行动反馈界面', () => {
  it('四个座位共用中文行动行，不再写英文弃牌和全下', () => {
    expect(table).not.toContain('Folded');
    expect(table).not.toContain('ALL-IN');
    expect(table).toContain('seatActionLabel');
    expect(table.match(/<SeatActionLine/g)).toHaveLength(4);
  });
});
