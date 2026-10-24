import { RANGE_CONFIG_VERSION } from '../ai/profiles';
import type { ProfileId } from '../ai/types';

export type ScenarioId = 'standard' | 'short' | 'deep';
export type OpponentMix = 'mixed' | 'loose' | 'tight';
export type BuyInDepth = 40 | 100 | 200;

export interface TableConfig {
  id: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  buyIn: number;
  scenarioId?: ScenarioId;
  buyInBb?: number;
  opponents?: OpponentMix;
  npcs?: NpcSeat[];
  /** 新选择写入。旧配置缺这个字段时保持缺失。 */
  npcConfigVersion?: string;
}

export interface LevelOption {
  id: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
}

export interface NpcSeat {
  id: string;
  name: string;
  profileId: ProfileId;
  style: string;
}

export interface SessionSnapshot {
  version: 1;
  levelId: string;
  levelName: string;
  smallBlind: number;
  bigBlind: number;
  scenarioId: ScenarioId;
  buyInBb: number;
  buyIn: number;
  opponents: OpponentMix;
  npcs: NpcSeat[];
  npcConfigVersion?: string;
}

export const LEVELS: LevelOption[] = [
  { id: 't1', name: '新手桌 ($1/$2)', smallBlind: 1, bigBlind: 2 },
  { id: 't2', name: '常规桌 ($2/$5)', smallBlind: 2, bigBlind: 5 },
  { id: 't3', name: '高额桌 ($10/$20)', smallBlind: 10, bigBlind: 20 },
];

export const SCENARIOS: Array<{ id: ScenarioId; name: string; buyInBb: BuyInDepth; detail: string }> = [
  { id: 'standard', name: '标准翻后', buyInBb: 100, detail: '位置、防守和跟注价格' },
  { id: 'short', name: '短筹决策', buyInBb: 40, detail: '低 SPR、全下与继续范围' },
  { id: 'deep', name: '深筹练习', buyInBb: 200, detail: '位置、听牌和更多街的投入' },
];

const MIXED: NpcSeat[] = [
  { id: 'ai_0', name: '德州老手', profileId: 'ai_0', style: '稳健' },
  { id: 'ai_1', name: '激进小伙', profileId: 'ai_1', style: '松凶' },
  { id: 'ai_2', name: '松跟玩家', profileId: 'loose_passive', style: '松跟' },
];

const LOOSE: NpcSeat[] = [
  { id: 'ai_0', name: '松凶常客', profileId: 'ai_1', style: '松凶' },
  { id: 'ai_1', name: '施压玩家', profileId: 'ai_1', style: '松凶' },
  { id: 'ai_2', name: '激进小伙', profileId: 'ai_1', style: '松凶' },
];

const TIGHT: NpcSeat[] = [
  { id: 'ai_0', name: '保守大叔', profileId: 'ai_2', style: '保守' },
  { id: 'ai_1', name: '紧手玩家', profileId: 'ai_2', style: '保守' },
  { id: 'ai_2', name: '岩石玩家', profileId: 'ai_2', style: '保守' },
];

export function npcsFor(mix: OpponentMix): NpcSeat[] {
  const source = mix === 'loose' ? LOOSE : mix === 'tight' ? TIGHT : MIXED;
  return source.map((seat) => ({ ...seat }));
}

export function resolveBuyIn(bigBlind: number, depth: number): number {
  return Math.max(0, Math.round(bigBlind * depth));
}

export function bankrollAdvice(balance: number, buyIn: number): { canSit: boolean; advice: string | null } {
  if (buyIn <= 0) return { canSit: false, advice: '本次买入金额无效。' };
  if (balance < buyIn) return { canSit: false, advice: `资金不足以支付本次买入 $${buyIn}。` };
  const times = balance / buyIn;
  if (times < 30) {
    return {
      canSit: true,
      advice: `当前练习资金约可买入 ${times.toFixed(1)} 次。30 个买入是长期资金管理的常见参考，并非本次游戏的破产概率。此资金可在设置中调整。`,
    };
  }
  return { canSit: true, advice: null };
}

export function sessionFromTable(table: TableConfig): SessionSnapshot {
  const buyInBb = table.buyInBb ?? (table.bigBlind > 0 ? Math.round(table.buyIn / table.bigBlind) : 100);
  const opponents = table.opponents ?? 'mixed';
  const session: SessionSnapshot = {
    version: 1,
    levelId: table.id,
    levelName: table.name,
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
    scenarioId: table.scenarioId ?? 'standard',
    buyInBb,
    buyIn: table.buyIn,
    opponents,
    npcs: table.npcs ? table.npcs.map((seat) => ({ ...seat })) : npcsFor(opponents),
  };
  if (typeof table.npcConfigVersion === 'string') session.npcConfigVersion = table.npcConfigVersion;
  return session;
}

export function mixSummary(mix: OpponentMix): string {
  if (mix === 'loose') return '当前组合：三名松凶。';
  if (mix === 'tight') return '当前组合：三名保守。';
  return '当前组合：稳健、松凶、松跟。';
}

export function tableFromSelection(
  level: LevelOption,
  scenarioId: ScenarioId,
  buyInBb: BuyInDepth,
  opponents: OpponentMix,
): TableConfig {
  const buyIn = resolveBuyIn(level.bigBlind, buyInBb);
  return {
    id: level.id,
    name: level.name,
    smallBlind: level.smallBlind,
    bigBlind: level.bigBlind,
    buyIn,
    scenarioId,
    buyInBb,
    opponents,
    npcs: npcsFor(opponents),
    npcConfigVersion: RANGE_CONFIG_VERSION,
  };
}
