import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expandRangeToken } from './cards';
import { eachDefendToken } from './defendLines';
import { PROFILES } from './profiles';
import { allCombos, continueRate, measureMatrix, renderRangeReport, rowBy } from './rangeReport';

const rows = measureMatrix();

function openRate(scenarioId: string, profileId: 'ai_0' | 'ai_1' | 'ai_2') {
  return rowBy(rows, scenarioId, profileId).freq.raise;
}

function keep(scenarioId: string, profileId: 'ai_0' | 'ai_1' | 'ai_2') {
  return continueRate(rowBy(rows, scenarioId, profileId).freq);
}

describe('1326 组合范围报告', () => {
  it('枚举完整牌组，且每个场景三种动作加过牌为 100%', () => {
    expect(allCombos()).toHaveLength(1326);
    for (const row of rows) {
      const sum = row.freq.fold + row.freq.check + row.freq.call + row.freq.raise;
      expect(sum).toBeCloseTo(1, 8);
      expect(row.freq.combos).toBe(1326);
    }
  });

  it('防守表里的记号都能展开', () => {
    for (const profile of Object.values(PROFILES)) {
      for (const token of eachDefendToken(profile.defend)) {
        expect(expandRangeToken(token).length).toBeGreaterThan(0);
      }
    }
  });

  it('100bb 按钮开池和盲注防守落在首版区间，风格间隔至少 5 个百分点', () => {
    const btn = {
      solid: openRate('open-btn-100', 'ai_0'),
      aggro: openRate('open-btn-100', 'ai_1'),
      tight: openRate('open-btn-100', 'ai_2'),
    };
    const bb = {
      solid: keep('bb-vs-btn-2.5-100', 'ai_0'),
      aggro: keep('bb-vs-btn-2.5-100', 'ai_1'),
      tight: keep('bb-vs-btn-2.5-100', 'ai_2'),
    };
    expect(btn.solid).toBeGreaterThanOrEqual(0.3);
    expect(btn.solid).toBeLessThanOrEqual(0.4);
    expect(btn.aggro).toBeGreaterThanOrEqual(0.4);
    expect(btn.aggro).toBeLessThanOrEqual(0.55);
    expect(btn.tight).toBeGreaterThanOrEqual(0.18);
    expect(btn.tight).toBeLessThanOrEqual(0.25);
    expect(btn.aggro - btn.solid).toBeGreaterThanOrEqual(0.05);
    expect(btn.solid - btn.tight).toBeGreaterThanOrEqual(0.05);

    expect(bb.solid).toBeGreaterThanOrEqual(0.35);
    expect(bb.solid).toBeLessThanOrEqual(0.5);
    expect(bb.aggro).toBeGreaterThanOrEqual(0.45);
    expect(bb.aggro).toBeLessThanOrEqual(0.6);
    expect(bb.tight).toBeGreaterThanOrEqual(0.2);
    expect(bb.tight).toBeLessThanOrEqual(0.35);
    expect(bb.aggro - bb.solid).toBeGreaterThanOrEqual(0.05);
    expect(bb.solid - bb.tight).toBeGreaterThanOrEqual(0.05);

    for (const id of ['ai_0', 'ai_1', 'ai_2'] as const) {
      const freq = rowBy(rows, 'bb-vs-btn-2.5-100', id).freq;
      expect(freq.call).toBeGreaterThan(0.03);
      expect(freq.raise).toBeGreaterThan(0.02);
    }
  });

  it('面对按钮和枪口的继续策略不同，小盲也不复制大盲', () => {
    for (const id of ['ai_0', 'ai_1', 'ai_2'] as const) {
      const vsBtn = keep('bb-vs-btn-2.5-100', id);
      const vsUtg = keep('bb-vs-utg-2.5-100', id);
      const sb = keep('sb-vs-btn-2.5-100', id);
      expect(Math.abs(vsBtn - vsUtg)).toBeGreaterThanOrEqual(0.03);
      expect(Math.abs(vsBtn - sb)).toBeGreaterThanOrEqual(0.02);
    }
  });

  it('40bb 比 100bb 更紧，200bb 不把短筹范围原样套用，大额和高风险继续率下降', () => {
    for (const id of ['ai_0', 'ai_1', 'ai_2'] as const) {
      const open40 = openRate('open-btn-40', id);
      const open100 = openRate('open-btn-100', id);
      const open200 = openRate('open-btn-200', id);
      expect(open40).toBeLessThan(open100);
      expect(open200).toBeGreaterThan(open100);

      const bb40 = keep('bb-vs-btn-2.5-40', id);
      const bb100 = keep('bb-vs-btn-2.5-100', id);
      const bb200 = keep('bb-vs-btn-2.5-200', id);
      expect(bb40).toBeLessThan(bb100);
      expect(bb200).toBeGreaterThan(bb100);
      expect(keep('bb-vs-btn-large', id)).toBeLessThan(0.12);
      expect(keep('bb-vs-btn-high', id)).toBeLessThan(keep('bb-vs-btn-large', id));
    }
  });

  it('报告文本带版本、分母和旧基线', () => {
    const text = renderRangeReport(rows);
    expect(text).toContain('2026-10-24.1');
    expect(text).toContain('1326');
    expect(text).toContain('23.68%');
    expect(text).toContain('BB 面对 BTN 2.5bb / 100bb');
    if (process.env.WRITE_RANGE_REPORT === '1') {
      writeFileSync(new URL('../../docs/superpowers/reports/2026-10-24-range-frequencies.md', import.meta.url), text);
    }
  });
});
