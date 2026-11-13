import type { RangeSpot } from './profiles';
import { roleAt, type SeatRole } from '../game/positions';

/** 图表来源仍是原来的五档。这不是求解器频率。 */
export type RangeBucket = 'legacy' | 'early' | 'early-tight' | 'middle' | 'late' | 'BTN' | 'SB' | 'BB' | 'HU';

export interface ChartWeight {
  spot: RangeSpot;
  weight: number;
}

export interface PositionPlan {
  role: SeatRole | null;
  bucket: RangeBucket | null;
  sources: ChartWeight[];
  /** 前位边缘继续保留系数。1 表示不再额外收紧。 */
  keep: number;
  participantCount: number;
}

const UTG_ONLY: ChartWeight[] = [{ spot: 'UTG', weight: 1 }];
const MIDDLE: ChartWeight[] = [{ spot: 'UTG', weight: 0.75 }, { spot: 'BTN', weight: 0.25 }];
const LATE: ChartWeight[] = [{ spot: 'UTG', weight: 0.4 }, { spot: 'BTN', weight: 0.6 }];

export function isPositionCore(key: string): boolean {
  if (key === 'AKs' || key === 'AKo') return true;
  return key.length === 2 && key[0] === key[1] && 'QKA'.includes(key[0]);
}

export function planForRole(role: SeatRole | null, participantCount: number): PositionPlan {
  if (role == null) return { role: null, bucket: null, sources: [], keep: 1, participantCount };
  if (participantCount <= 2) {
    return { role, bucket: 'HU', sources: [{ spot: 'HU', weight: 1 }], keep: 1, participantCount };
  }
  if (role === 'BTN' || role === 'SB' || role === 'BB') {
    return { role, bucket: role, sources: [{ spot: role, weight: 1 }], keep: 1, participantCount };
  }
  if (participantCount === 4 && role === 'UTG') {
    return { role, bucket: 'legacy', sources: UTG_ONLY, keep: 1, participantCount };
  }
  if (role === 'HJ' && participantCount >= 5 && participantCount <= 9) {
    return { role, bucket: 'middle', sources: MIDDLE, keep: 1, participantCount };
  }
  if (role === 'CO' && participantCount >= 5 && participantCount <= 9) {
    return { role, bucket: 'late', sources: LATE, keep: 1, participantCount };
  }
  const earlyTight = (participantCount === 8 && (role === 'UTG' || role === 'UTG+1'))
    || (participantCount === 9 && (role === 'UTG' || role === 'UTG+1' || role === 'UTG+2'));
  if (earlyTight) {
    return { role, bucket: 'early-tight', sources: UTG_ONLY, keep: 0.65, participantCount };
  }
  const early = (participantCount === 6 && role === 'UTG')
    || (participantCount === 7 && (role === 'UTG' || role === 'LJ'))
    || (participantCount === 8 && role === 'LJ')
    || (participantCount === 9 && role === 'LJ');
  if (early) {
    return { role, bucket: 'early', sources: UTG_ONLY, keep: 0.85, participantCount };
  }
  return { role, bucket: 'legacy', sources: UTG_ONLY, keep: 1, participantCount };
}

export function positionPlan(
  seat: number,
  dealerIndex: number,
  statuses: readonly string[],
): PositionPlan {
  const role = roleAt(seat, dealerIndex, statuses);
  const participantCount = statuses.filter((status) => status !== 'sitting-out').length;
  return planForRole(role, participantCount);
}

export function positionAssumption(plan: PositionPlan): string {
  if (!plan.role || !plan.bucket || plan.sources.length === 0) return '位置近似：坐出，不使用翻前图表';
  const sources = plan.sources.map((source) => `${source.spot} ${Math.round(source.weight * 100)}%`).join(' + ');
  return `位置近似：实际 ${plan.role}，分档 ${plan.bucket}，图表 ${sources}，前位保留 ${plan.keep}。这是启发式映射，不是 GTO 或求解器结果`;
}
