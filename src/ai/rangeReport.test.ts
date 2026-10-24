import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expandRangeToken } from './cards';
import { eachDefendToken } from './defendLines';
import { PROFILES, profileFor } from './profiles';
import { allCombos, continueRate, measureMatrix, measureOpenedContinue, renderRangeReport, rowBy } from './rangeReport';

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

    expect(bb.solid).toBeGreaterThanOrEqual(0.4);
    expect(bb.solid).toBeLessThanOrEqual(0.55);
    expect(bb.aggro).toBeGreaterThanOrEqual(0.5);
    expect(bb.aggro).toBeLessThanOrEqual(0.65);
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

  it('100bb 大盲面对枪口和小盲落在新区间，松跟以平跟为主', () => {
    const spots = ['bb-vs-utg-2.5-100', 'bb-vs-btn-2.5-100', 'bb-vs-sb-2.5-100'] as const;
    const bands = {
      'bb-vs-utg-2.5-100': { solid: [0.25, 0.4], aggro: [0.3, 0.45], loose: [0.4, 0.55] },
      'bb-vs-btn-2.5-100': { solid: [0.4, 0.55], aggro: [0.5, 0.65], loose: [0.55, 0.7] },
      'bb-vs-sb-2.5-100': { solid: [0.35, 0.5], aggro: [0.45, 0.6], loose: [0.5, 0.65] },
    };
    for (const spot of spots) {
      const solid = keep(spot, 'ai_0');
      const aggro = keep(spot, 'ai_1');
      const loose = continueRate(rowBy(rows, spot, 'loose_passive').freq);
      const band = bands[spot];
      expect(solid).toBeGreaterThanOrEqual(band.solid[0]);
      expect(solid).toBeLessThanOrEqual(band.solid[1]);
      expect(aggro).toBeGreaterThanOrEqual(band.aggro[0]);
      expect(aggro).toBeLessThanOrEqual(band.aggro[1]);
      expect(loose).toBeGreaterThanOrEqual(band.loose[0]);
      expect(loose).toBeLessThanOrEqual(band.loose[1]);
      expect(aggro - solid).toBeGreaterThanOrEqual(0.05);
      expect(loose).toBeGreaterThanOrEqual(aggro);
      const looseFreq = rowBy(rows, spot, 'loose_passive').freq;
      const aggroFreq = rowBy(rows, spot, 'ai_1').freq;
      expect(looseFreq.call / (looseFreq.call + looseFreq.raise)).toBeGreaterThanOrEqual(0.7);
      expect(aggroFreq.raise - looseFreq.raise).toBeGreaterThanOrEqual(0.05);
    }
    expect(profileFor('loose_passive').id).toBe('loose_passive');
    expect(profileFor('missing').id).toBe('ai_0');
  });

  it('100bb 按钮已开池组合面对约 4 倍普通 3bet，稳健和松凶继续 30% 到 50%', () => {
    for (const id of ['ai_0', 'ai_1'] as const) {
      const freq = measureOpenedContinue(PROFILES[id], PROFILES[id].openMultiple * 4, 100);
      const keepRate = freq.call + freq.raise;
      expect(keepRate).toBeGreaterThanOrEqual(0.3);
      expect(keepRate).toBeLessThanOrEqual(0.5);
      expect(freq.call).toBeGreaterThan(0);
      expect(freq.raise).toBeGreaterThan(0);
    }
    const short = measureOpenedContinue(PROFILES.ai_0, 10, 40);
    const deep = measureOpenedContinue(PROFILES.ai_0, 10, 200);
    expect(short.call + short.raise).toBeLessThan(measureOpenedContinue(PROFILES.ai_0, 10, 100).call + measureOpenedContinue(PROFILES.ai_0, 10, 100).raise);
    expect(deep.call + deep.raise).toBeGreaterThan(0);
  });

  it('报告文本带版本、分母和旧基线', () => {
    const text = renderRangeReport(rows);
    expect(text).toContain('2026-10-24.2');
    expect(text).toContain('1326');
    expect(text).toContain('23.68%');
    expect(text).toContain('BB 面对 BTN 2.5bb / 100bb');
    if (process.env.WRITE_RANGE_REPORT === '1') {
      writeFileSync(new URL('../../docs/superpowers/reports/2026-10-24-range-frequencies.md', import.meta.url), text);
    }
  });
});
