/** 手输金额的拒绝文案。空输入不能当成 0。 */
export const ILLEGAL_CHIP_AMOUNT_MESSAGE = '请输入合法的整数筹码金额';

export function chipAmountRangeMessage(min: number, max: number): string {
  return `请输入 ${min} 到 ${max} 之间的整数筹码`;
}

/** store 与外部动作共用：非安全整数和负数一律不能入账。0 仍交给原有尺寸归一。 */
export function isPayableChipAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export interface TypedRaiseConfirm {
  panelOpen: boolean;
  error: string | null;
  submit: number | null;
}

/**
 * 确认手输金额。保留原始字符串，先排除空白，再用 Number 转换。
 * 不使用 parseInt，也不把小数四舍五入成整数。
 */
export function confirmTypedRaise(raw: string, bounds: { min: number; max: number }): TypedRaiseConfirm {
  const reject = (error: string): TypedRaiseConfirm => ({ panelOpen: true, error, submit: null });
  if (raw.trim() === '') return reject(ILLEGAL_CHIP_AMOUNT_MESSAGE);
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value <= 0) return reject(ILLEGAL_CHIP_AMOUNT_MESSAGE);
  if (value < bounds.min || value > bounds.max) return reject(chipAmountRangeMessage(bounds.min, bounds.max));
  return { panelOpen: false, error: null, submit: value };
}
