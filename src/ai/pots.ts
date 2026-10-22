export interface PotPlayer {
  id: string;
  invested: number;
  inHand: boolean;
}

export interface PotSlice {
  amount: number;
  eligibleIds: string[];
}

export interface PotRefund {
  playerId: string;
  amount: number;
}

export interface PotSplit {
  pots: PotSlice[];
  refunds: PotRefund[];
}

/**
 * 按累计投入切池。弃牌玩家的筹码留在池里，但没有资格。
 * 只有一人盖过的超额记为返还，不计入可争夺收益。
 * 余筹按精确分数，不模拟按钮左手边的 1 筹码分配。
 */
export function splitPots(players: readonly PotPlayer[]): PotSplit {
  const working = players.map((player) => ({ ...player }));
  const refunds: PotRefund[] = [];
  const contributors = working.filter((player) => player.invested > 0);
  if (contributors.length === 0) return { pots: [], refunds };
  if (contributors.length === 1) {
    refunds.push({ playerId: contributors[0].id, amount: contributors[0].invested });
    return { pots: [], refunds };
  }

  const maxInvested = Math.max(...contributors.map((player) => player.invested));
  const leaders = contributors.filter((player) => player.invested === maxInvested);
  if (leaders.length === 1) {
    const second = Math.max(
      ...contributors.filter((player) => player.invested < maxInvested).map((player) => player.invested),
    );
    const refund = maxInvested - second;
    if (refund > 0) {
      refunds.push({ playerId: leaders[0].id, amount: refund });
      const leader = working.find((player) => player.id === leaders[0].id);
      if (leader) leader.invested = second;
    }
  }

  const levels = [...new Set(working.map((player) => player.invested).filter((amount) => amount > 0))].sort((a, b) => a - b);
  const pots: PotSlice[] = [];
  let prev = 0;
  for (const level of levels) {
    const covered = working.filter((player) => player.invested >= level);
    const amount = (level - prev) * covered.length;
    prev = level;
    if (amount <= 0) continue;
    pots.push({
      amount,
      eligibleIds: covered.filter((player) => player.inHand).map((player) => player.id),
    });
  }
  return { pots, refunds };
}
