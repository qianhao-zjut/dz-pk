import React from 'react';
import type { Card } from '../utils/poker';
import { evaluateHand } from '../utils/poker';

interface TeachingPanelProps {
  humanCards: Card[];
  boardCards: Card[];
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

export const TeachingPanel: React.FC<TeachingPanelProps> = ({ humanCards, boardCards }) => {
  let currentHandStr = '等待发牌...';
  let isStrongHand = false;

  if (humanCards.length > 0) {
    if (boardCards.length === 0) {
      currentHandStr = '翻前底牌 (Hole Cards)';
    } else {
      const evaluation = evaluateHand([...humanCards, ...boardCards]);
      // 翻译为中文提示
      const translatedMap: Record<string, string> = {
        'High Card': '高牌',
        'Pair': '一对',
        'Two Pair': '两对',
        'Three of a Kind': '三条',
        'Straight': '顺子',
        'Flush': '同花',
        'Full House': '葫芦',
        'Four of a Kind': '四条',
        'Straight Flush': '同花顺',
        'Royal Flush': '皇家同花顺'
      };
      const engName = evaluation.name;
      currentHandStr = `当前最大成牌：${translatedMap[engName] || engName}`;
      
      // 高牌和一对不算特别强，两对及以上给个高亮
      if (engName !== 'High Card' && engName !== 'Pair') {
        isStrongHand = true;
      }
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* 实时牌力提示 */}
      <div className={`p-4 rounded-xl shadow-lg border-2 transition-all ${
        isStrongHand 
          ? 'bg-yellow-900/40 border-yellow-500 text-yellow-300' 
          : 'bg-gray-800 border-blue-500/50 text-blue-300'
      }`}>
        <div className="flex items-center space-x-2 mb-1">
          <span className="text-xl">🎯</span>
          <span className="font-bold text-sm text-gray-300">实时牌力提示</span>
        </div>
        <div className="text-lg font-bold">
          {currentHandStr}
        </div>
      </div>

      {/* 牌型图鉴 */}
      <div className="flex-1 bg-gray-800 rounded-xl border border-gray-700 overflow-hidden flex flex-col shadow-lg">
        <div className="bg-gray-900 p-3 border-b border-gray-700 font-bold text-gray-300 flex items-center">
          <span>📚 牌型大小图鉴 (大到小)</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {HAND_RANKINGS.map((rank, idx) => (
            <div key={idx} className="p-2 hover:bg-gray-700 rounded transition-colors text-sm">
              <div className="font-bold text-gray-200">{rank.name}</div>
              <div className="text-xs text-gray-500">{rank.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
