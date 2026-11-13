import { describe, expect, it } from 'vitest';
import {
  blindSeats,
  firstToAct,
  participantOrder,
  roleAt,
  roleLabel,
  rolesForCount,
  seatRole,
} from './positions';

const active = (count: number, sittingOut: number[] = []): string[] => (
  Array.from({ length: count }, (_, seat) => (sittingOut.includes(seat) ? 'sitting-out' : 'active'))
);

describe('本手位置', () => {
  it('2 到 9 人从按钮起的角色与规格一致，四人枪口仍叫 UTG', () => {
    expect(rolesForCount(2)).toEqual(['BTN', 'BB']);
    expect(rolesForCount(3)).toEqual(['BTN', 'SB', 'BB']);
    expect(rolesForCount(4)).toEqual(['BTN', 'SB', 'BB', 'UTG']);
    expect(rolesForCount(5)).toEqual(['BTN', 'SB', 'BB', 'HJ', 'CO']);
    expect(rolesForCount(6)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']);
    expect(rolesForCount(7)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO']);
    expect(rolesForCount(8)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'LJ', 'HJ', 'CO']);
    expect(rolesForCount(9)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO']);
    expect(seatRole(3, 0, 4)).toBe('UTG');
    expect(roleLabel('CO')).toBe('关煞位');
    expect(roleLabel('BTN', 2)).toBe('按钮/小盲');
    expect(roleLabel(null)).toBe('坐出');
  });

  it('按钮轮换和坐出都按参与者重排，弃牌不改变角色', () => {
    for (const count of [4, 6, 9]) {
      for (let dealer = 0; dealer < count; dealer += 1) {
        const statuses = active(count);
        const ordered = participantOrder(dealer, statuses);
        expect(ordered[0]).toBe(dealer);
        expect(rolesForCount(count)?.map((_, index) => roleAt(ordered[index], dealer, statuses))).toEqual(rolesForCount(count));
        const blinds = blindSeats(dealer, statuses);
        expect(blinds).toEqual({
          button: ordered[0],
          sb: count === 2 ? ordered[0] : ordered[1],
          bb: count === 2 ? ordered[1] : ordered[2],
        });
        expect(firstToAct(dealer, statuses, 'preflop')).toBe(ordered[count === 2 ? 0 : 3] ?? ordered[0]);
        expect(firstToAct(dealer, statuses, 'postflop')).toBe(ordered[1]);
      }
    }

    const folded = active(9);
    folded[4] = 'folded';
    folded[8] = 'all-in';
    expect(participantOrder(0, folded)).toHaveLength(9);
    expect(roleAt(3, 0, folded)).toBe('UTG');
    expect(roleAt(8, 0, folded)).toBe('CO');

    const sitting = active(6, [1]);
    expect(participantOrder(0, sitting)).toEqual([0, 2, 3, 4, 5]);
    expect(roleAt(1, 0, sitting)).toBeNull();
    expect(roleAt(2, 0, sitting)).toBe('SB');
    expect(roleAt(5, 0, sitting)).toBe('CO');
    expect(blindSeats(0, sitting)).toEqual({ button: 0, sb: 2, bb: 3 });
  });

  it('短盲全下仍占位置但不行动，真正两人按钮兼小盲', () => {
    const statuses = active(6);
    statuses[1] = 'all-in';
    expect(roleAt(1, 0, statuses)).toBe('SB');
    expect(firstToAct(0, statuses, 'preflop')).toBe(3);
    expect(firstToAct(0, statuses, 'postflop')).toBe(2);

    const heads = active(4, [1, 2]);
    expect(participantOrder(0, heads)).toEqual([0, 3]);
    expect(blindSeats(0, heads)).toEqual({ button: 0, sb: 0, bb: 3 });
    expect(firstToAct(0, heads, 'preflop')).toBe(0);
    expect(firstToAct(0, heads, 'postflop')).toBe(3);
    expect(roleAt(0, 0, heads)).toBe('BTN');
    expect(roleAt(3, 0, heads)).toBe('BB');
  });
});
