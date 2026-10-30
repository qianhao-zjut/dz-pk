import type { PublicAction, SeatStatus, TableStage } from '../ai/types';
import { isBettingStage } from '../ai/types';

export function isOpeningBet(action: PublicAction, streetActions: readonly PublicAction[]): boolean {
  if (action.kind !== 'raise' || action.stage === 'preflop') return false;
  const index = streetActions.indexOf(action);
  if (index < 0) return false;
  return !streetActions.slice(0, index).some((item) => (
    item.stage === action.stage && (item.kind === 'post' || item.kind === 'call' || item.kind === 'raise')
  ));
}

function raiseText(action: PublicAction, streetActions: readonly PublicAction[]): string {
  const opening = isOpeningBet(action, streetActions);
  const verb = opening ? '下注' : '加注';
  const amount = typeof action.to === 'number' && Number.isSafeInteger(action.to) && action.to > 0
    ? `$${action.to}`
    : null;
  if (!amount) return verb;
  return opening ? `下注 ${amount}` : `加注到 ${amount}`;
}

export function seatActionLabel(
  actorId: string,
  status: SeatStatus,
  stage: TableStage,
  streetActions: readonly PublicAction[],
): string | null {
  if (status === 'folded') return '弃牌';
  if (status === 'all-in') return '全下';
  if (!isBettingStage(stage)) return null;
  const mine = streetActions.filter((action) => action.actorId === actorId && action.stage === stage && action.kind !== 'post');
  const last = mine[mine.length - 1];
  if (!last) return null;
  if (last.kind === 'check') return '过牌';
  if (last.kind === 'call') return '跟注';
  if (last.kind === 'fold') return '弃牌';
  if (last.kind === 'raise') return raiseText(last, streetActions);
  return null;
}
