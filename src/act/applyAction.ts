import { isPayableChipAmount } from '../game/chipAmount';
import { useGameStore } from '../store/gameStore';

export type ActName = 'fold' | 'check' | 'call' | 'raise' | 'allin' | 'deal' | 'rebuy';

export type ActError =
  | 'no_table'
  | 'not_your_turn'
  | 'illegal_action'
  | 'hand_in_progress'
  | 'need_rebuy'
  | 'insufficient_funds'
  | 'bad_action'
  | 'bad_amount';

export interface ActCommand {
  id?: string;
  action: string;
  to?: number;
}

export interface ActResult {
  ok: boolean;
  action?: string;
  error?: ActError;
}

const BETTING = new Set<ActName>(['fold', 'check', 'call', 'raise', 'allin']);
const BETWEEN = new Set<ActName>(['deal', 'rebuy']);

function fail(action: string, error: ActError): ActResult {
  return { ok: false, action, error };
}

/** 按牌桌上的按钮规则执行一条外部动作。扣款由调用方提供。 */
export function applyExternalAction(
  cmd: ActCommand,
  deductFunds: (amount: number) => boolean,
): ActResult {
  const action = cmd.action;
  if (!BETTING.has(action as ActName) && !BETWEEN.has(action as ActName)) {
    return fail(action, 'bad_action');
  }

  const s = useGameStore.getState();
  if (!s.table) return fail(action, 'no_table');
  const human = s.players.find((p) => p.id === 'human');
  if (!human) return fail(action, 'no_table');

  const inHand = s.stage === 'preflop' || s.stage === 'flop' || s.stage === 'turn' || s.stage === 'river';

  if (action === 'deal' || action === 'rebuy') {
    if (inHand) return fail(action, 'hand_in_progress');
    if (action === 'deal') {
      if (human.chips === 0) return fail(action, 'need_rebuy');
      s.startHand();
      return { ok: true, action };
    }
    if (human.chips > 0) return fail(action, 'illegal_action');
    if (!deductFunds(s.table.buyIn)) return fail(action, 'insufficient_funds');
    s.rebuy('human', s.table.buyIn);
    s.startHand();
    return { ok: true, action };
  }

  const actor = s.players[s.currentPlayerIndex];
  const isHumanTurn = inHand && actor?.id === 'human' && actor.status === 'active';
  if (!isHumanTurn) return fail(action, 'not_your_turn');

  if (action === 'fold') {
    s.playerFold();
    return { ok: true, action };
  }
  if (action === 'check') {
    if (s.currentMaxBet !== human.currentBet) return fail(action, 'illegal_action');
    s.playerCheck();
    return { ok: true, action };
  }
  if (action === 'call') {
    if (s.currentMaxBet === human.currentBet) return fail(action, 'illegal_action');
    s.playerCall();
    return { ok: true, action };
  }
  if (!human.canRaise || human.chips <= 0) return fail(action, 'illegal_action');
  const raiseTo = action === 'allin' ? human.chips + human.currentBet : cmd.to;
  if (!isPayableChipAmount(raiseTo)) return fail(action, 'bad_amount');
  if (!s.playerRaise(raiseTo)) return fail(action, 'bad_amount');
  return { ok: true, action };
}
