import { describe, expect, it } from 'vitest';
import { ILLEGAL_CHIP_AMOUNT_MESSAGE, chipAmountRangeMessage, confirmTypedRaise } from './chipAmount';

const bounds = { min: 4, max: 200 };
const unsafe = Number.MAX_SAFE_INTEGER + 1;

describe('GameTable 手输金额确认', () => {
  it('空字符串和纯空白不能当成 0', () => {
    for (const raw of ['', ' ', '\n', '\t', '  \t  ']) {
      expect(confirmTypedRaise(raw, bounds)).toEqual({
        panelOpen: true,
        error: ILLEGAL_CHIP_AMOUNT_MESSAGE,
        submit: null,
      });
    }
  });

  it('小数、负数、NaN、无穷和不安全整数都拒绝，面板保持打开', () => {
    const rejected = ['6.5', '8.9', '-1', '-6.5', '0', 'NaN', 'Infinity', '+Infinity', '-Infinity', String(unsafe)];
    for (const raw of rejected) {
      const result = confirmTypedRaise(raw, bounds);
      expect(result.panelOpen).toBe(true);
      expect(result.submit).toBeNull();
      expect(result.error).toBe(ILLEGAL_CHIP_AMOUNT_MESSAGE);
    }
    expect(confirmTypedRaise('6.5', bounds).submit).not.toBe(6);
    expect(confirmTypedRaise('6.5', bounds).submit).not.toBe(7);
    expect(confirmTypedRaise('8.9', bounds).submit).not.toBe(8);
  });

  it('超出当前合法区间时提示上下限，不提交', () => {
    expect(confirmTypedRaise('3', bounds)).toEqual({
      panelOpen: true,
      error: chipAmountRangeMessage(4, 200),
      submit: null,
    });
    expect(confirmTypedRaise('201', bounds)).toEqual({
      panelOpen: true,
      error: chipAmountRangeMessage(4, 200),
      submit: null,
    });
  });

  it('合法整数可以提交并关闭面板', () => {
    expect(confirmTypedRaise('6', bounds)).toEqual({ panelOpen: false, error: null, submit: 6 });
    expect(confirmTypedRaise('7', bounds)).toEqual({ panelOpen: false, error: null, submit: 7 });
    expect(confirmTypedRaise('  4  ', bounds)).toEqual({ panelOpen: false, error: null, submit: 4 });
    expect(confirmTypedRaise('200', bounds)).toEqual({ panelOpen: false, error: null, submit: 200 });
  });

  it('短码唯一合法全下目标可以提交，其它整数提示区间', () => {
    const allIn = { min: 50, max: 50 };
    expect(confirmTypedRaise('50', allIn)).toEqual({ panelOpen: false, error: null, submit: 50 });
    expect(confirmTypedRaise('49', allIn)).toEqual({
      panelOpen: true,
      error: chipAmountRangeMessage(50, 50),
      submit: null,
    });
  });
});
