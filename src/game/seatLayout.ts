/** 座位 0 在底部，序号沿顺时针（画面上先向左）排列。 */
export function seatAnchor(seat: number, count: number): { x: number; y: number } {
  const total = Math.max(count, 1);
  const theta = (2 * Math.PI * seat) / total;
  const rx = total >= 9 ? 32 : total >= 6 ? 34 : 36;
  const ry = total >= 9 ? 36 : 34;
  return {
    x: 50 - rx * Math.sin(theta),
    y: 48 + ry * Math.cos(theta),
  };
}
