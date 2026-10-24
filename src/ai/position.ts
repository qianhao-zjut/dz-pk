import type { AIObservation } from './types';

/** 从按钮下一位起绕桌，最后一个仍可行动的玩家才有位置。 */
export function inPosition(obs: AIObservation): boolean {
  const count = obs.players.length;
  if (count === 0) return false;
  const active = obs.players.filter((player) => player.status === 'active');
  if (!active.some((player) => player.seat === obs.actorSeat)) return false;
  const order = (seat: number) => ((seat - obs.dealerIndex - 1) % count + count) % count;
  const last = Math.max(...active.map((player) => order(player.seat)));
  return order(obs.actorSeat) === last;
}
