export type SeatRole = 'BTN' | 'SB' | 'BB' | 'UTG' | 'UTG+1' | 'UTG+2' | 'LJ' | 'HJ' | 'CO';

/** 从本手按钮起，按座位递增。弃牌和全下仍占角色；坐出不占。 */
const ROLES_BY_COUNT: Record<number, readonly SeatRole[]> = {
  2: ['BTN', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'UTG'],
  5: ['BTN', 'SB', 'BB', 'HJ', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  7: ['BTN', 'SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'LJ', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO'],
};

export function rolesForCount(participantCount: number): readonly SeatRole[] | null {
  return ROLES_BY_COUNT[participantCount] ?? null;
}

export function nextSeat(start: number, count: number, accept: (seat: number) => boolean): number {
  if (count <= 0) return 0;
  let seat = ((start % count) + count) % count;
  for (let step = 0; step < count; step += 1) {
    seat = (seat + 1) % count;
    if (accept(seat)) return seat;
  }
  return ((start % count) + count) % count;
}

/** 本手参与座位，从真实按钮开始，沿座位号递增。 */
export function participantOrder(dealerIndex: number, statuses: readonly string[]): number[] {
  const count = statuses.length;
  if (count === 0) return [];
  const live = statuses.map((_, seat) => seat).filter((seat) => statuses[seat] !== 'sitting-out');
  if (live.length === 0) return [];
  const button = live.includes(dealerIndex)
    ? dealerIndex
    : nextSeat(dealerIndex, count, (seat) => live.includes(seat));
  const ordered: number[] = [];
  let seat = button;
  for (let step = 0; step < count && ordered.length < live.length; step += 1) {
    if (live.includes(seat)) ordered.push(seat);
    seat = (seat + 1) % count;
  }
  return ordered;
}

export function roleAt(seat: number, dealerIndex: number, statuses: readonly string[]): SeatRole | null {
  const ordered = participantOrder(dealerIndex, statuses);
  const index = ordered.indexOf(seat);
  if (index < 0) return null;
  return rolesForCount(ordered.length)?.[index] ?? null;
}

/** 全体在局时的角色。有坐出时用 roleAt，避免把空座位算进位置。 */
export function seatRole(seat: number, handDealerIndex: number, seatCount = 4): SeatRole | null {
  const count = Math.max(1, seatCount);
  return roleAt(seat, handDealerIndex, Array.from({ length: count }, () => 'active'));
}

export function roleLabel(role: SeatRole | null, participantCount?: number): string {
  if (role == null) return '坐出';
  if (role === 'BTN' && participantCount === 2) return '按钮/小盲';
  const labels: Record<SeatRole, string> = {
    BTN: '按钮',
    SB: '小盲',
    BB: '大盲',
    UTG: '枪口',
    'UTG+1': '枪口+1',
    'UTG+2': '枪口+2',
    LJ: '中位',
    HJ: '劫持位',
    CO: '关煞位',
  };
  return labels[role];
}

export function blindSeats(dealerIndex: number, statuses: readonly string[]): { button: number; sb: number; bb: number } | null {
  const ordered = participantOrder(dealerIndex, statuses);
  if (ordered.length < 2) return null;
  if (ordered.length === 2) return { button: ordered[0], sb: ordered[0], bb: ordered[1] };
  return { button: ordered[0], sb: ordered[1], bb: ordered[2] };
}

/** 翻前：三人及以上从大盲后开始，两人按钮先动。翻后：按钮后第一位仍可行动的人。 */
export function firstToAct(
  dealerIndex: number,
  statuses: readonly string[],
  street: 'preflop' | 'postflop',
): number | null {
  const ordered = participantOrder(dealerIndex, statuses);
  if (ordered.length === 0) return null;
  const active = (seat: number) => statuses[seat] === 'active';
  if (street === 'preflop' && ordered.length === 2) {
    return ordered.find(active) ?? null;
  }
  if (street === 'preflop' && ordered.length >= 3) {
    const afterBlind = [...ordered.slice(3), ...ordered.slice(0, 3)];
    return afterBlind.find(active) ?? null;
  }
  const afterButton = [...ordered.slice(1), ordered[0]];
  return afterButton.find(active) ?? null;
}

export function nextButtonIndex(
  dealerIndex: number,
  players: readonly { status: string; chips: number; isAI: boolean }[],
): number {
  return nextSeat(dealerIndex, players.length, (seat) => {
    const player = players[seat];
    if (!player || player.status === 'sitting-out') return false;
    if (player.isAI) return true;
    return player.chips > 0;
  });
}

export function stackText(chips: number, bigBlind: number): string {
  if (bigBlind <= 0) return `$${chips}`;
  const bb = chips / bigBlind;
  const pretty = Number.isInteger(bb) ? String(bb) : bb.toFixed(1);
  return `$${chips} · ${pretty}bb`;
}
