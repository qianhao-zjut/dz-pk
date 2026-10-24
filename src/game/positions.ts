export type SeatRole = 'BTN' | 'SB' | 'BB' | 'UTG';

/** 四人桌按本手按钮固定角色。弃牌和结算后的按钮轮换都不改这手的名字。 */
export function seatRole(seat: number, handDealerIndex: number, seatCount = 4): SeatRole {
  const count = Math.max(1, seatCount);
  const offset = ((seat - handDealerIndex) % count + count) % count;
  if (offset === 0) return 'BTN';
  if (offset === 1) return 'SB';
  if (offset === 2) return 'BB';
  return 'UTG';
}

export function roleLabel(role: SeatRole): string {
  if (role === 'BTN') return '按钮';
  if (role === 'SB') return '小盲';
  if (role === 'BB') return '大盲';
  return '枪口';
}

export function stackText(chips: number, bigBlind: number): string {
  if (bigBlind <= 0) return `$${chips}`;
  const bb = chips / bigBlind;
  const pretty = Number.isInteger(bb) ? String(bb) : bb.toFixed(1);
  return `$${chips} · ${pretty}bb`;
}
