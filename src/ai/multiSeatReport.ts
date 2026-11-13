import { handKey } from './cards';
import { buildObservation } from './observation';
import { branchWeights, chartBranches, preflopBranches } from './preflop';
import { isPositionCore, planForRole } from './preflopPosition';
import { PROFILES, type AIProfile, type RangeSpot } from './profiles';
import { roleAt, type SeatRole } from '../game/positions';
import type { AIObservation, ObservationSource, SourcePlayer } from './types';

const BB = 10;
const DEPTHS = [40, 100, 200] as const;
const SIZES = [4, 6, 9] as const;

export type FrequencyKind = 'open' | 'vs-open' | 'vs-3bet' | 'vs-co';

export interface FrequencyCell {
  tableSize: 4 | 6 | 9;
  role: SeatRole;
  bucket: string;
  kind: FrequencyKind;
  profileId: AIProfile['id'];
  label: string;
  depthBb: 40 | 100 | 200;
  raise: number;
  call: number;
  fold: number;
  check: number;
  continue: number;
  combos: number;
}

export interface SourceBound {
  tableSize: 4 | 6 | 9;
  role: SeatRole;
  kind: FrequencyKind;
  profileId: AIProfile['id'];
  depthBb: 40 | 100 | 200;
  mixed: number;
  low: number;
  high: number;
  weighted: number;
}

interface Spot {
  tableSize: 4 | 6 | 9;
  hero: number;
  role: SeatRole;
  bucket: string;
  kind: FrequencyKind;
}

function seat(id: string, extra: Partial<SourcePlayer> = {}): SourcePlayer {
  return {
    id,
    chips: extra.chips ?? 1000,
    currentBet: extra.currentBet ?? 0,
    invested: extra.invested ?? extra.currentBet ?? 0,
    status: extra.status ?? 'active',
    canRaise: true,
    ...extra,
  };
}

function observe(partial: Partial<ObservationSource>): AIObservation {
  const built = buildObservation({
    sessionId: 'multi-seat',
    handNumber: 1,
    decisionRevision: 1,
    stage: 'preflop',
    pot: 15,
    board: [],
    dealerIndex: 0,
    currentPlayerIndex: 0,
    currentMaxBet: BB,
    lastRaiseSize: BB,
    bigBlind: BB,
    streetActions: [],
    players: [],
    ...partial,
  });
  if (!built.ok) throw new Error(built.error);
  return built.observation;
}

function actionOrder(size: number): number[] {
  const order: number[] = [];
  for (let index = 3; index < size; index += 1) order.push(index);
  order.push(0, 1);
  return order;
}

function seatsBefore(size: number, hero: number): number[] {
  const order = actionOrder(size);
  const index = order.indexOf(hero);
  if (index < 0) return order;
  return order.slice(0, index);
}

function money(depthBb: number, posted: number): { chips: number; currentBet: number; invested: number } {
  const total = depthBb * BB;
  return { chips: total - posted, currentBet: posted, invested: posted };
}

function roleOf(size: number, index: number): SeatRole {
  const role = roleAt(index, 0, Array.from({ length: size }, () => 'active'));
  if (!role) throw new Error(`座位 ${index} 在 ${size} 人桌没有角色`);
  return role;
}

function spots(): Spot[] {
  const rows: Spot[] = [];
  for (const tableSize of SIZES) {
    for (let hero = 0; hero < tableSize; hero += 1) {
      const role = roleOf(tableSize, hero);
      const bucket = planForRole(role, tableSize).bucket ?? 'legacy';
      rows.push({ tableSize, hero, role, bucket, kind: 'open' });
      if (role !== 'UTG') rows.push({ tableSize, hero, role, bucket, kind: 'vs-open' });
      if (role !== 'BB') rows.push({ tableSize, hero, role, bucket, kind: 'vs-3bet' });
    }
    const co = actionOrder(tableSize).find((index) => roleOf(tableSize, index) === 'CO');
    if (co != null) {
      rows.push({ tableSize, hero: 2, role: 'BB', bucket: 'BB', kind: 'vs-co' });
    }
  }
  return rows;
}

function template(spot: Spot, depthBb: number): AIObservation {
  const { tableSize, hero, kind } = spot;
  const utg = 3;
  const co = actionOrder(tableSize).find((index) => roleOf(tableSize, index) === 'CO');
  if (kind === 'vs-co' && co == null) throw new Error(`${tableSize} 人桌没有 CO`);
  const opener = kind === 'vs-co' ? co! : utg;
  const openTo = 25;
  const threeTo = 80;
  const before = new Set(seatsBefore(tableSize, hero));
  const players = Array.from({ length: tableSize }, (_, index) => {
    let posted = index === 1 ? BB / 2 : index === 2 ? BB : 0;
    let status: SourcePlayer['status'] = 'active';
    if (kind === 'open' && before.has(index)) {
      status = 'folded';
      if (index !== 1) posted = 0;
    }
    if (kind === 'vs-open' || kind === 'vs-co') {
      if (index === opener) posted = openTo;
      else if (before.has(index)) {
        status = 'folded';
        if (index !== 1) posted = 0;
      }
    }
    if (kind === 'vs-3bet') {
      if (index === hero) posted = openTo;
      else if (index === 2) posted = threeTo;
      else {
        status = 'folded';
        if (index !== 1) posted = 0;
      }
    }
    const stack = money(depthBb, posted);
    return seat(`p${index}`, {
      ...stack,
      status,
      ...(index === hero ? { cards: ['As', 'Kd'] } : {}),
    });
  });
  const pot = players.reduce((sum, player) => sum + player.invested, 0);
  const streetActions: ObservationSource['streetActions'] = [];
  if (kind === 'vs-open' || kind === 'vs-co') {
    streetActions.push({ actorId: players[opener].id, stage: 'preflop', kind: 'raise', to: openTo });
  }
  if (kind === 'vs-3bet') {
    streetActions.push(
      { actorId: players[hero].id, stage: 'preflop', kind: 'raise', to: openTo },
      { actorId: players[2].id, stage: 'preflop', kind: 'raise', to: threeTo },
    );
  }
  return observe({
    currentPlayerIndex: hero,
    currentMaxBet: kind === 'vs-3bet' ? threeTo : kind === 'open' ? BB : openTo,
    lastRaiseSize: kind === 'vs-3bet' ? threeTo - openTo : kind === 'open' ? BB : openTo - BB,
    pot,
    players,
    streetActions,
  });
}

function measure(
  profile: AIProfile,
  combos: Array<[string, string]>,
  branchesFor: (cards: [string, string]) => ReturnType<typeof preflopBranches>,
): Pick<FrequencyCell, 'raise' | 'call' | 'fold' | 'check' | 'continue' | 'combos'> {
  const totals = { fold: 0, check: 0, call: 0, raise: 0 };
  for (const cards of combos) {
    const weights = branchWeights(branchesFor(cards));
    const sum = weights.fold + weights.check + weights.call + weights.raise;
    if (Math.abs(sum - 1) > 1e-6) throw new Error(`${profile.id} ${cards.join('')} 权重 ${sum}`);
    totals.fold += weights.fold;
    totals.check += weights.check;
    totals.call += weights.call;
    totals.raise += weights.raise;
  }
  const count = combos.length || 1;
  const raise = totals.raise / count;
  const call = totals.call / count;
  return {
    raise,
    call,
    fold: totals.fold / count,
    check: totals.check / count,
    continue: raise + call,
    combos: combos.length,
  };
}

function allCombos(): Array<[string, string]> {
  const ranks = '23456789TJQKA';
  const suits = 'shdc';
  const deck: string[] = [];
  for (const rank of ranks) for (const suit of suits) deck.push(rank + suit);
  const combos: Array<[string, string]> = [];
  for (let i = 0; i < deck.length; i += 1) {
    for (let j = i + 1; j < deck.length; j += 1) {
      if (handKey(deck[i], deck[j])) combos.push([deck[i], deck[j]]);
    }
  }
  return combos;
}

export function buildFrequencyReport(): { cells: FrequencyCell[]; bounds: SourceBound[]; nonCore: FrequencyCell[] } {
  const combos = allCombos();
  const nonCore = combos.filter((cards) => {
    const key = handKey(cards[0], cards[1]);
    return key != null && !isPositionCore(key);
  });
  const cells: FrequencyCell[] = [];
  const bounds: SourceBound[] = [];
  const nonCoreCells: FrequencyCell[] = [];
  for (const spot of spots()) {
    for (const depthBb of DEPTHS) {
      const obs = template(spot, depthBb);
      for (const profile of Object.values(PROFILES)) {
        const freq = measure(profile, combos, (cards) => preflopBranches({ ...obs, holeCards: cards }, profile));
        cells.push({
          tableSize: spot.tableSize,
          role: spot.role,
          bucket: spot.bucket,
          kind: spot.kind,
          profileId: profile.id,
          label: profile.label,
          depthBb,
          ...freq,
        });
        if (spot.kind === 'open' && spot.role === 'UTG') {
          nonCoreCells.push({
            tableSize: spot.tableSize,
            role: spot.role,
            bucket: spot.bucket,
            kind: spot.kind,
            profileId: profile.id,
            label: profile.label,
            depthBb,
            ...measure(profile, nonCore, (cards) => preflopBranches({ ...obs, holeCards: cards }, profile)),
          });
        }
        const heroMix = spot.bucket === 'middle' || spot.bucket === 'late';
        const openerMix = spot.kind === 'vs-co';
        if (heroMix || openerMix) {
          const leftSpot: RangeSpot = openerMix ? 'BB' : 'UTG';
          const rightSpot: RangeSpot = 'BTN';
          const leftWeight = openerMix ? 0.4 : spot.bucket === 'middle' ? 0.75 : 0.4;
          const openerSpot: RangeSpot | null = spot.kind === 'vs-open' || spot.kind === 'vs-co' ? (openerMix ? null : 'UTG') : null;
          const left = measure(profile, combos, (cards) => chartBranches(
            { ...obs, holeCards: cards },
            profile,
            leftSpot,
            openerMix ? 'UTG' : openerSpot,
          ));
          const right = measure(profile, combos, (cards) => chartBranches(
            { ...obs, holeCards: cards },
            profile,
            openerMix ? 'BB' : rightSpot,
            openerMix ? 'BTN' : openerSpot,
          ));
          bounds.push({
            tableSize: spot.tableSize,
            role: spot.role,
            kind: spot.kind,
            profileId: profile.id,
            depthBb,
            mixed: freq.continue,
            low: Math.min(left.continue, right.continue),
            high: Math.max(left.continue, right.continue),
            weighted: leftWeight * left.continue + (1 - leftWeight) * right.continue,
          });
        }
      }
    }
  }
  return { cells, bounds, nonCore: nonCoreCells };
}

export function frequencyCell(
  cells: readonly FrequencyCell[],
  tableSize: number,
  role: SeatRole,
  kind: FrequencyKind,
  profileId: AIProfile['id'],
  depthBb: number,
): FrequencyCell {
  const found = cells.find((cell) => (
    cell.tableSize === tableSize
    && cell.role === role
    && cell.kind === kind
    && cell.profileId === profileId
    && cell.depthBb === depthBb
  ));
  if (!found) throw new Error(`缺少 ${tableSize} ${role} ${kind} ${profileId} ${depthBb}`);
  return found;
}

function pct(value: number): string {
  return (value * 100).toFixed(1);
}

const KIND_LABEL: Record<FrequencyKind, string> = {
  open: '开池',
  'vs-open': '面对UTG 2.5bb',
  'vs-3bet': '开池者面对8bb 3bet',
  'vs-co': '面对CO 2.5bb',
};

export function formatFrequencyReport(cells: readonly FrequencyCell[]): string {
  const lines = [
    '| 桌 | 场景 | 角色 | 分档 | 风格 | 40bb加注 | 40bb继续 | 100bb加注 | 100bb继续 | 200bb加注 | 200bb继续 |',
    '|---|---|---|---|---|---:|---:|---:|---:|---:|---:|',
  ];
  const profiles = Object.values(PROFILES);
  const seen = new Set<string>();
  for (const cell of cells) {
    const key = `${cell.tableSize}|${cell.kind}|${cell.role}|${cell.profileId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const at = (depth: 40 | 100 | 200) => frequencyCell(cells, cell.tableSize, cell.role, cell.kind, cell.profileId, depth);
    const a = at(40);
    const b = at(100);
    const c = at(200);
    lines.push(`| ${cell.tableSize} | ${KIND_LABEL[cell.kind]} | ${cell.role} | ${cell.bucket} | ${profiles.find((profile) => profile.id === cell.profileId)?.label ?? cell.profileId} | ${pct(a.raise)} | ${pct(a.continue)} | ${pct(b.raise)} | ${pct(b.continue)} | ${pct(c.raise)} | ${pct(c.continue)} |`);
  }
  return lines.join('\n');
}
