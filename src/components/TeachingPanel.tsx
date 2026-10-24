import React, { useState } from 'react';
import type { Card } from '../utils/poker';
import { handNameCN } from '../utils/poker';
import { analyzeDraws } from '../game/draws';
import { describeHole } from '../game/holeText';
import { roleLabel, type SeatRole } from '../game/positions';

interface TeachingPanelProps {
  humanCards: Card[];
  boardCards: Card[];
  role: SeatRole | null;
  raiseCount: number;
}

const HAND_RANKINGS = [
  { name: '皇家同花顺 (Royal Flush)', desc: '同花色的 A,K,Q,J,10' },
  { name: '同花顺 (Straight Flush)', desc: '五张同花色相连的牌' },
  { name: '四条 (Four of a Kind)', desc: '四张同点数的牌' },
  { name: '葫芦 (Full House)', desc: '三条 + 一对' },
  { name: '同花 (Flush)', desc: '五张同花色的牌（不要求相连）' },
  { name: '顺子 (Straight)', desc: '五张相连的牌（不要求同花）' },
  { name: '三条 (Three of a Kind)', desc: '三张同点数的牌' },
  { name: '两对 (Two Pair)', desc: '两个不同点数的对子' },
  { name: '一对 (One Pair)', desc: '两张同点数的牌' },
  { name: '高牌 (High Card)', desc: '不符合以上任何牌型，比单张大小' },
];

export const TeachingPanel: React.FC<TeachingPanelProps> = ({ humanCards, boardCards, role, raiseCount }) => {
  const [openRankings, setOpenRankings] = useState(false);
  const [openHelp, setOpenHelp] = useState(false);
  let currentHandStr = '等待发牌...';
  let extra = '';

  if (humanCards.length === 2 && boardCards.length === 0) {
    const hole = describeHole(humanCards[0], humanCards[1]);
    const where = role ? `${roleLabel(role)} ${role}` : '位置未知';
    const context = raiseCount === 0 ? '还没有人开池' : raiseCount === 1 ? '面对一次开池或加注' : '面对再加注';
    currentHandStr = `${hole} · ${where}`;
    extra = context;
  } else if (humanCards.length > 0 && boardCards.length > 0) {
    currentHandStr = `当前最大成牌：${handNameCN([...humanCards, ...boardCards])}`;
    const draws = analyzeDraws(humanCards, boardCards);
    const drawText = draws.labels.length > 0 ? `${draws.labels.join('、')}。${draws.note}` : draws.note;
    const backdoor = draws.backdoor.length > 0 ? draws.backdoor.join(' ') : '';
    extra = [drawText, backdoor].filter(Boolean).join(' ');
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="p-4 rounded-xl shadow-lg border-2 bg-gray-800 border-blue-500/50 text-blue-300">
        <div className="font-bold text-sm text-gray-300 mb-1">实时牌力提示</div>
        <div className="text-lg font-bold text-white">{currentHandStr}</div>
        {extra && <p className="text-sm text-gray-300 mt-2">{extra}</p>}
        {role && humanCards.length === 2 && boardCards.length === 0 && (
          <p className="text-xs text-gray-500 mt-2">范围提示只说明牌类和位置，不代表这手一定该跟或该弃。</p>
        )}
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 shadow-lg">
        <button onClick={() => setOpenHelp((value) => !value)} className="w-full text-left p-3 font-bold text-gray-300">
          {openHelp ? '收起记法' : '牌面记法'}
        </button>
        {openHelp && (
          <p className="px-3 pb-3 text-xs text-gray-400">点数 2-9、T、J、Q、K、A。花色 s=黑桃、h=红桃、d=方块、c=梅花。例如 Ah 是红桃 A。</p>
        )}
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden flex flex-col shadow-lg">
        <button onClick={() => setOpenRankings((value) => !value)} className="bg-gray-900 p-3 border-b border-gray-700 font-bold text-gray-300 text-left">
          {openRankings ? '收起牌型图鉴' : '牌型图鉴（默认折叠）'}
        </button>
        {openRankings && (
          <div className="p-2 space-y-1 max-h-64 overflow-y-auto">
            {HAND_RANKINGS.map((rank) => (
              <div key={rank.name} className="p-2 text-sm">
                <div className="font-bold text-gray-200">{rank.name}</div>
                <div className="text-xs text-gray-500">{rank.desc}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
