import { describe, expect, it } from 'vitest';
import { PROFILES } from './profiles';
import {
  buildFrequencyReport,
  formatFrequencyReport,
  frequencyCell,
  type FrequencyCell,
} from './multiSeatReport';
import type { SeatRole } from '../game/positions';

const report = buildFrequencyReport();

function cell(tableSize: number, role: SeatRole, kind: FrequencyCell['kind'], profileId: FrequencyCell['profileId'], depthBb: number) {
  return frequencyCell(report.cells, tableSize, role, kind, profileId, depthBb);
}

function nonCore(tableSize: number, profileId: FrequencyCell['profileId'], depthBb: number) {
  const found = report.nonCore.find((item) => (
    item.tableSize === tableSize && item.role === 'UTG' && item.profileId === profileId && item.depthBb === depthBb
  ));
  if (!found) throw new Error(`缺少非核心 ${tableSize} ${profileId} ${depthBb}`);
  return found;
}

describe('多人桌范围频率', () => {
  it('按 1326 个真实组合计频，非核心组合排除 QQ+、AKs 和 AKo', () => {
    expect(report.cells.length).toBeGreaterThan(0);
    expect(report.cells.every((item) => item.combos === 1326)).toBe(true);
    expect(report.nonCore.every((item) => item.combos === 1292)).toBe(true);
  });

  it('同一价格下，前位非核心开池继续不宽于原 UTG', () => {
    for (const profile of Object.values(PROFILES)) {
      for (const depthBb of [40, 100, 200] as const) {
        const legacy = nonCore(4, profile.id, depthBb).continue;
        const early = nonCore(6, profile.id, depthBb).continue;
        const tight = nonCore(9, profile.id, depthBb).continue;
        expect(tight).toBeLessThanOrEqual(early + 1e-9);
        expect(early).toBeLessThanOrEqual(legacy + 1e-9);
      }
    }
  });

  it('中后位和面对 CO 的继续落在两个图表来源之间', () => {
    expect(report.bounds.length).toBeGreaterThan(0);
    for (const bound of report.bounds) {
      expect(bound.mixed).toBeGreaterThanOrEqual(bound.low - 1e-6);
      expect(bound.mixed).toBeLessThanOrEqual(bound.high + 1e-6);
      expect(bound.mixed).toBeCloseTo(bound.weighted, 6);
    }
  });

  it('按钮和盲注开池不随桌型收紧，大盲面对前位开池仍用原 UTG 列', () => {
    for (const role of ['BTN', 'SB', 'BB'] as const) {
      for (const profile of Object.values(PROFILES)) {
        for (const depthBb of [40, 100, 200] as const) {
          const four = cell(4, role, 'open', profile.id, depthBb);
          expect(cell(6, role, 'open', profile.id, depthBb).raise).toBeCloseTo(four.raise, 6);
          expect(cell(9, role, 'open', profile.id, depthBb).raise).toBeCloseTo(four.raise, 6);
        }
      }
    }
    for (const profile of Object.values(PROFILES)) {
      for (const depthBb of [40, 100, 200] as const) {
        const four = cell(4, 'BB', 'vs-open', profile.id, depthBb);
        expect(cell(6, 'BB', 'vs-open', profile.id, depthBb).continue).toBeCloseTo(four.continue, 6);
        expect(cell(9, 'BB', 'vs-open', profile.id, depthBb).continue).toBeCloseTo(four.continue, 6);
      }
    }
  });

  it('100bb 按钮开池保持松凶、稳健、保守的间隔', () => {
    for (const tableSize of [4, 6, 9] as const) {
      const aggro = cell(tableSize, 'BTN', 'open', 'ai_1', 100).raise;
      const solid = cell(tableSize, 'BTN', 'open', 'ai_0', 100).raise;
      const tight = cell(tableSize, 'BTN', 'open', 'ai_2', 100).raise;
      expect(aggro - solid).toBeGreaterThanOrEqual(0.05);
      expect(solid - tight).toBeGreaterThanOrEqual(0.05);
    }
  });

  it('需要时写出频率表', () => {
    const text = formatFrequencyReport(report.cells);
    expect(text).toContain('开池');
    expect(text).toContain('early-tight');
  });
});
