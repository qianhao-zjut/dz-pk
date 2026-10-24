import { createDeck } from '../utils/poker';
import { buildObservation } from './observation';
import { decide } from './strategy';
import type { AIProfile } from './profiles';
import { mulberry32 } from './rng';
import type { PublicAction, SourcePlayer } from './types';

export const CALIBRATION_SEED = 20261024;
export const CALIBRATION_SEED_REPEAT = 20261025;
export const JOINT_FOLD_TRIALS = 4998;

const BB = 10;
const SB = 5;
const TOTAL = 100 * BB;

export type HumanSeat = 'UTG' | 'BTN' | 'SB';

const SEAT_INDEX: Record<HumanSeat, number> = { BTN: 0, SB: 1, UTG: 3 };

export interface JointFoldRow {
  seed: number;
  mix: string;
  openBb: number;
  humanSeat: HumanSeat;
  trials: number;
  foldedOut: number;
  rate: number;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  items.forEach((item, index) => {
    for (const rest of permutations(items.filter((_, itemIndex) => itemIndex !== index))) {
      out.push([item, ...rest]);
    }
  });
  return out;
}

function shuffle(deck: string[], rng: () => number): string[] {
  const next = [...deck];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function responders(humanSeat: HumanSeat): number[] {
  if (humanSeat === 'UTG') return [0, 1, 2];
  if (humanSeat === 'BTN') return [1, 2];
  return [2];
}

function foldedBefore(humanSeat: HumanSeat): number[] {
  if (humanSeat === 'BTN') return [3];
  if (humanSeat === 'SB') return [3, 0];
  return [];
}

/** 人类随机底牌固定开池，前置弃牌按题设给定。任一 call/raise 即停止这次直接偷盲统计。 */
export function jointFoldRates(
  profiles: readonly AIProfile[],
  seed: number,
  openBb: number,
  trials = JOINT_FOLD_TRIALS,
): Array<Omit<JointFoldRow, 'mix' | 'seed' | 'openBb'> & { humanSeat: HumanSeat }> {
  const seats: HumanSeat[] = ['UTG', 'BTN', 'SB'];
  const orders = permutations(profiles);
  if (trials % orders.length !== 0) throw new Error(`试验次数 ${trials} 不能被 ${orders.length} 种座位分配整除`);
  const perOrder = trials / orders.length;
  const dealRng = mulberry32(seed);
  const decisionRng = mulberry32(seed + 1_000_003);
  const openTo = Math.round(openBb * BB);
  const rows = seats.map((humanSeat) => ({ humanSeat, trials, foldedOut: 0 }));
  for (const humanSeat of seats) {
    const row = rows.find((item) => item.humanSeat === humanSeat);
    if (!row) continue;
    const npcSeats = [0, 1, 2, 3].filter((seat) => seat !== SEAT_INDEX[humanSeat]);
    for (const order of orders) {
      for (let trial = 0; trial < perOrder; trial += 1) {
        const deck = shuffle(createDeck(), dealRng);
        const holes: Array<[string, string]> = [[], [], [], []].map(() => [deck.pop()!, deck.pop()!]) as Array<[string, string]>;
        const profileBySeat = new Map<number, AIProfile>();
        npcSeats.forEach((seat, index) => profileBySeat.set(seat, order[index]));
        if (allFolded(humanSeat, holes, profileBySeat, openTo, decisionRng)) row.foldedOut += 1;
      }
    }
  }
  return rows.map((row) => ({ ...row, rate: row.foldedOut / row.trials }));
}

function allFolded(
  humanSeat: HumanSeat,
  holes: Array<[string, string]>,
  profileBySeat: Map<number, AIProfile>,
  openTo: number,
  rng: () => number,
): boolean {
  const human = SEAT_INDEX[humanSeat];
  const folded = new Set(foldedBefore(humanSeat));
  const invested = [0, SB, BB, 0];
  invested[human] = openTo;
  const actions: PublicAction[] = [
    { actorId: 'ai_sb', stage: 'preflop', kind: 'post', to: SB },
    { actorId: 'ai_bb', stage: 'preflop', kind: 'post', to: BB },
  ];
  for (const seat of folded) {
    actions.push({ actorId: actorId(seat), stage: 'preflop', kind: 'fold', to: null });
  }
  actions.push({ actorId: actorId(human), stage: 'preflop', kind: 'raise', to: openTo });
  for (const seat of responders(humanSeat)) {
    if (folded.has(seat)) continue;
    const players: SourcePlayer[] = [0, 1, 2, 3].map((index) => {
      const put = folded.has(index) ? 0 : invested[index];
      const inHand = !folded.has(index);
      return {
        id: actorId(index),
        chips: inHand ? TOTAL - put : TOTAL,
        currentBet: inHand ? put : 0,
        invested: inHand ? put : 0,
        status: inHand ? 'active' : 'folded',
        canRaise: true,
        ...(index === seat ? { cards: holes[index] } : {}),
      };
    });
    const built = buildObservation({
      sessionId: 'calibration',
      handNumber: 1,
      decisionRevision: 1,
      stage: 'preflop',
      pot: invested.reduce((sum, amount, index) => sum + (folded.has(index) ? 0 : amount), 0),
      board: [],
      dealerIndex: 0,
      currentPlayerIndex: seat,
      currentMaxBet: openTo,
      lastRaiseSize: openTo - BB,
      bigBlind: BB,
      streetActions: actions,
      players,
    });
    if (!built.ok) throw new Error(built.error);
    const profile = profileBySeat.get(seat);
    if (!profile) throw new Error(`座位 ${seat} 没有策略`);
    const move = decide(built.observation, profile, { rng }).decision.move;
    if (move.action !== 'fold') return false;
    folded.add(seat);
    invested[seat] = 0;
    actions.push({ actorId: actorId(seat), stage: 'preflop', kind: 'fold', to: null });
  }
  return true;
}

function actorId(seat: number): string {
  if (seat === 0) return 'human';
  if (seat === 1) return 'ai_sb';
  if (seat === 2) return 'ai_bb';
  return 'ai_utg';
}

export function renderJointFold(rows: JointFoldRow[]): string {
  const lines = [
    '# 四人桌联合全弃',
    '',
    '人类底牌随机且不筛开池范围，固定开到指定尺度。前置位置弃牌是题设，不按那些牌的牌力重判。完整不放回发牌。三种策略在其余座位的 6 种分配各占同样次数。任一对手 call 或 raise 就记为这次直接偷盲失败。',
    '',
    '| 种子 | 组合 | 开池 | 人类位置 | 全弃 | 分母 |',
    '| ---: | --- | ---: | --- | ---: | ---: |',
  ];
  for (const row of rows) {
    lines.push(`| ${row.seed} | ${row.mix} | ${row.openBb}bb | ${row.humanSeat} | ${(row.rate * 100).toFixed(2)}% | ${row.foldedOut}/${row.trials} |`);
  }
  lines.push('');
  return lines.join('\n');
}
