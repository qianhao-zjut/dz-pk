import type { PublicAction, SeatStatus, TableStage } from '../ai/types';
import { isBettingStage } from '../ai/types';
import { isOpeningBet } from './seatActionLabel';

export const YOUR_TURN_DELAY_MS = 200;

export type ActionCue = 'check' | 'fold' | 'call' | 'bet' | 'raise' | 'all-in' | 'your-turn';

export interface SoundFrame {
  handNumber: number;
  stage: TableStage;
  streetActions: readonly PublicAction[];
  currentPlayerIndex: number;
  currentPlayerId: string | null;
  humanStatus: SeatStatus | null;
  statuses: Readonly<Record<string, SeatStatus>>;
}

export function cueForAction(
  action: PublicAction,
  status: SeatStatus,
  streetActions: readonly PublicAction[],
): ActionCue | null {
  if (action.kind === 'post') return null;
  if (status === 'all-in') return 'all-in';
  if (action.kind === 'fold' || status === 'folded') return 'fold';
  if (action.kind === 'check') return 'check';
  if (action.kind === 'call') return 'call';
  if (action.kind === 'raise') return isOpeningBet(action, streetActions) ? 'bet' : 'raise';
  return null;
}

export function createActionSoundGate(deps: {
  play: (cue: ActionCue) => void;
  delay: (ms: number, run: () => void) => () => void;
  enabled: () => boolean;
  hidden: () => boolean;
}): { onFrame: (frame: SoundFrame) => () => void } {
  let handNumber = -1;
  let playedThrough = 0;
  let committedKey: string | null = null;
  let delayedKey: string | null = null;
  let cancelTimer: (() => void) | null = null;
  let latestKey: string | null = null;

  const disarm = () => {
    if (!cancelTimer) return;
    cancelTimer();
    cancelTimer = null;
  };

  const onFrame = (frame: SoundFrame) => {
    disarm();
    if (frame.handNumber !== handNumber || frame.streetActions.length < playedThrough) {
      handNumber = frame.handNumber;
      playedThrough = frame.streetActions.length;
      committedKey = null;
      delayedKey = null;
    }

    const heard: ActionCue[] = [];
    for (const action of frame.streetActions.slice(playedThrough)) {
      const cue = cueForAction(action, frame.statuses[action.actorId] ?? 'active', frame.streetActions);
      if (!cue) continue;
      heard.push(cue);
      if (deps.enabled() && !deps.hidden()) deps.play(cue);
    }
    playedThrough = frame.streetActions.length;

    const yourTurn = frame.currentPlayerId === 'human'
      && frame.humanStatus === 'active'
      && isBettingStage(frame.stage);
    const key = `${frame.handNumber}:${frame.currentPlayerIndex}:${frame.streetActions.length}`;
    latestKey = yourTurn ? key : null;

    if (yourTurn && committedKey !== key) {
      const wait = heard.length > 0 || delayedKey === key;
      if (heard.length > 0) delayedKey = key;
      const fire = () => {
        cancelTimer = null;
        if (committedKey === key || latestKey !== key) return;
        if (deps.enabled() && !deps.hidden()) deps.play('your-turn');
        committedKey = key;
        if (delayedKey === key) delayedKey = null;
      };
      if (wait) cancelTimer = deps.delay(YOUR_TURN_DELAY_MS, fire);
      else fire();
    } else if (!yourTurn) {
      delayedKey = null;
    }

    return disarm;
  };

  return { onFrame };
}
