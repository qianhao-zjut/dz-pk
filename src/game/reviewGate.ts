export type ReviewAutoOpen = 'open' | 'drop' | 'wait';

/** 只决定这一次要不要展开。偏好本身不在这里保存。 */
export function reviewAutoOpenDecision(input: {
  pendingId: string | null;
  hand: { sessionId: string; handNumber: number } | null;
  stage: string;
  sessionId: string | null;
  handNumber: number;
}): ReviewAutoOpen {
  if (!input.pendingId || !input.hand) return 'wait';
  const sameHand = input.hand.sessionId === input.sessionId && input.hand.handNumber === input.handNumber;
  if (sameHand && input.stage === 'showdown') return 'open';
  if (!sameHand || input.stage === 'idle') return 'drop';
  return 'wait';
}
