export type StreetName = 'preflop' | 'flop' | 'turn' | 'river';

export interface ShortcutInput {
  street: StreetName;
  bigBlind: number;
  pot: number;
  currentMaxBet: number;
  lastRaiseSize: number;
  heroBet: number;
  heroChips: number;
  canRaise: boolean;
  raiseCount: number;
  limpers: number;
  inPosition: boolean;
}

export interface Shortcut {
  id: string;
  label: string;
  raiseTo: number;
  added: number;
  allIn: boolean;
}

export interface ShortcutPlan {
  verb: '下注' | '加注';
  shortcuts: Shortcut[];
  defaultRaiseTo: number | null;
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
}

export function raiseVerb(street: StreetName, currentMaxBet: number): '下注' | '加注' {
  return street !== 'preflop' && currentMaxBet === 0 ? '下注' : '加注';
}

function bbLabel(multiple: number, bigBlind: number, amount: number, prefix: string): string {
  const exact = Math.abs(multiple * bigBlind - amount) < 0.001;
  const bbText = exact ? `${multiple}bb` : `约 ${multiple}bb`;
  return `${prefix}${bbText} · $${amount}`;
}

export function actionShortcuts(input: ShortcutInput): ShortcutPlan {
  const verb = raiseVerb(input.street, input.currentMaxBet);
  const maxRaiseTo = input.heroBet + Math.max(0, input.heroChips);
  const minRaiseTo = input.currentMaxBet === 0
    ? input.bigBlind
    : input.currentMaxBet + Math.max(input.lastRaiseSize, input.bigBlind);
  const empty = { verb, shortcuts: [], defaultRaiseTo: null, minRaiseTo: null, maxRaiseTo: null };
  if (!input.canRaise || input.heroChips <= 0 || maxRaiseTo <= input.currentMaxBet) return empty;

  const onlyAllIn = maxRaiseTo < minRaiseTo;
  const clamp = (target: number): { raiseTo: number; allIn: boolean } => {
    if (onlyAllIn || target >= maxRaiseTo) return { raiseTo: maxRaiseTo, allIn: true };
    return { raiseTo: Math.max(target, minRaiseTo), allIn: false };
  };

  const raw: Array<{ id: string; label: string; target: number }> = [{ id: 'min', label: '最小', target: minRaiseTo }];
  if (input.street === 'preflop' && input.raiseCount === 0) {
    const prefix = input.limpers > 0 ? '隔离 ' : '';
    for (const multiple of [2.5, 3, 3.5]) {
      raw.push({
        id: `open-${multiple}`,
        label: bbLabel(multiple, input.bigBlind, Math.round(multiple * input.bigBlind), prefix),
        target: Math.round(multiple * input.bigBlind),
      });
    }
  } else if (input.street === 'preflop') {
    for (const multiple of [3, 3.5, 4]) {
      const target = Math.round(input.currentMaxBet * multiple);
      raw.push({ id: `x-${multiple}`, label: `${multiple}× · 加到 $${target}`, target });
    }
  } else if (input.currentMaxBet === 0) {
    for (const [id, fraction, name] of [
      ['third', 1 / 3, '⅓池'],
      ['half', 1 / 2, '½池'],
      ['three-quarter', 3 / 4, '¾池'],
      ['pot', 1, '满池'],
    ] as const) {
      raw.push({ id, label: name, target: Math.max(input.bigBlind, Math.round(input.pot * fraction)) });
    }
  } else {
    const callCost = Math.min(input.heroChips, Math.max(0, input.currentMaxBet - input.heroBet));
    const priced = input.pot + callCost;
    for (const [id, fraction, name] of [
      ['third', 1 / 3, '⅓池'],
      ['half', 1 / 2, '½池'],
      ['three-quarter', 3 / 4, '¾池'],
      ['pot', 1, '满池'],
    ] as const) {
      raw.push({
        id,
        label: name,
        target: Math.round(input.currentMaxBet + fraction * priced),
      });
    }
  }

  const seen = new Set<number>();
  const shortcuts: Shortcut[] = [];
  for (const item of raw) {
    const clamped = clamp(item.target);
    if (seen.has(clamped.raiseTo)) continue;
    seen.add(clamped.raiseTo);
    const added = Math.max(0, clamped.raiseTo - input.heroBet);
    shortcuts.push({
      id: clamped.allIn ? `allin-${clamped.raiseTo}` : item.id,
      label: clamped.allIn ? `全下 $${clamped.raiseTo}` : item.label,
      raiseTo: clamped.raiseTo,
      added,
      allIn: clamped.allIn,
    });
  }

  const preferredId = input.street === 'preflop' && input.raiseCount === 0
    ? 'open-2.5'
    : input.street === 'preflop'
      ? (input.inPosition ? 'x-3' : 'x-3.5')
      : 'half';
  const preferred = shortcuts.find((item) => item.id === preferredId) ?? shortcuts.find((item) => item.id !== 'min') ?? shortcuts[0];
  return {
    verb,
    shortcuts,
    defaultRaiseTo: preferred?.raiseTo ?? null,
    minRaiseTo,
    maxRaiseTo,
  };
}
