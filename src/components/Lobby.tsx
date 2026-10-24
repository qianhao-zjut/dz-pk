import React, { useState } from 'react';
import { useBankrollStore } from '../store/bankrollStore';
import { useHandHistoryStore } from '../store/handHistoryStore';
import { retryFailedHandReviews, useHandReviewSyncStatus } from '../store/handReviewSync';
import { bankrollAdvice, LEVELS, mixSummary, SCENARIOS, tableFromSelection, type BuyInDepth, type OpponentMix, type ScenarioId, type TableConfig } from '../game/sessionConfig';
import { HandReview } from './HandReview';
import { Coins, AlertTriangle, Play, RotateCcw, Settings } from 'lucide-react';

export type { TableConfig };

export const TABLES: TableConfig[] = [
  { id: 't1', name: '新手桌 ($1/$2)', smallBlind: 1, bigBlind: 2, buyIn: 200 },
  { id: 't2', name: '常规桌 ($2/$5)', smallBlind: 2, bigBlind: 5, buyIn: 500 },
  { id: 't3', name: '高额桌 ($10/$20)', smallBlind: 10, bigBlind: 20, buyIn: 2000 },
];

export const Lobby: React.FC<{ onJoinTable: (table: TableConfig) => void }> = ({ onJoinTable }) => {
  const { balance, resetBankroll, setBankroll } = useBankrollStore();
  const [warning, setWarning] = useState<{show: boolean; message: string; table?: TableConfig}>({ show: false, message: '' });
  const [showSetBankrollModal, setShowSetBankrollModal] = useState(false);
  const [bankrollInput, setBankrollInput] = useState(balance.toString());
  const [bankrollError, setBankrollError] = useState('');
  const [scenarioId, setScenarioId] = useState<ScenarioId>('standard');
  const [depth, setDepth] = useState<BuyInDepth>(100);
  const [opponents, setOpponents] = useState<OpponentMix>('mixed');
  const [reviewId, setReviewId] = useState<string | null>(null);
  const hands = useHandHistoryStore((state) => state.hands);
  const autoOpenReview = useHandHistoryStore((state) => state.autoOpenReview);
  const setAutoOpenReview = useHandHistoryStore((state) => state.setAutoOpenReview);
  const syncPending = useHandReviewSyncStatus((state) => state.pendingCount);
  const syncFailed = useHandReviewSyncStatus((state) => state.failedCount);
  const syncPersist = useHandReviewSyncStatus((state) => state.persistAvailable);

  const handleSetBankrollClick = () => {
    setBankrollInput(balance.toString());
    setBankrollError('');
    setShowSetBankrollModal(true);
  };

  const submitSetBankroll = () => {
    const amount = parseInt(bankrollInput, 10);
    if (!isNaN(amount) && amount >= 0) {
      setBankroll(amount);
      setShowSetBankrollModal(false);
    } else {
      setBankrollError('请输入有效的金额（0 或正整数）');
    }
  };

  const handleJoinClick = (levelId: string) => {
    const level = LEVELS.find((item) => item.id === levelId);
    if (!level) return;
    const table = tableFromSelection(level, scenarioId, depth, opponents);
    const advice = bankrollAdvice(balance, table.buyIn);
    if (!advice.canSit || advice.advice) {
      setWarning({ show: true, message: advice.advice ?? '现在不能入座。', table: advice.canSit ? table : undefined });
      return;
    }
    onJoinTable(table);
  };

  const confirmJoin = () => {
    if (warning.table) {
      onJoinTable(warning.table);
    }
    setWarning({ show: false, message: '' });
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8 flex flex-col items-center">
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="flex justify-between items-center bg-gray-800 p-6 rounded-2xl shadow-xl mb-8 border border-gray-700">
          <div>
            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600 mb-2">
              Texas Holdem Trainer
            </h1>
            <p className="text-gray-400">单人德州扑克与资金管理练习工具</p>
          </div>
          <div className="flex flex-col items-end">
            <div className="flex items-center space-x-3 text-2xl font-mono text-green-400 bg-gray-900 px-6 py-3 rounded-xl border border-gray-700 shadow-inner">
              <Coins className="text-yellow-500" size={28} />
              <span>${balance.toLocaleString()}</span>
            </div>
            <div className="flex space-x-4 mt-3">
              <button 
                onClick={handleSetBankrollClick}
                className="text-sm text-gray-400 hover:text-white flex items-center transition-colors"
              >
                <Settings size={14} className="mr-1" /> 设置资金
              </button>
              {balance < 200 && (
                <button 
                  onClick={resetBankroll}
                  className="text-sm text-gray-400 hover:text-white flex items-center transition-colors"
                >
                  <RotateCcw size={14} className="mr-1" /> 破产重置
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4 mb-6 border border-gray-700 space-y-3">
          <div className="flex flex-wrap gap-2">
            {SCENARIOS.map((item) => (
              <button
                key={item.id}
                onClick={() => { setScenarioId(item.id); setDepth(item.buyInBb); }}
                className={`px-3 py-2 rounded-lg text-sm ${scenarioId === item.id ? 'bg-blue-600' : 'bg-gray-700'}`}
              >
                {item.name} · {item.buyInBb}bb
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {([40, 100, 200] as BuyInDepth[]).map((item) => (
              <button key={item} onClick={() => setDepth(item)} className={`px-3 py-1 rounded-lg ${depth === item ? 'bg-yellow-600' : 'bg-gray-700'}`}>
                买入 {item}bb
              </button>
            ))}
            {(['mixed', 'loose', 'tight'] as OpponentMix[]).map((item) => (
              <button key={item} onClick={() => setOpponents(item)} className={`px-3 py-1 rounded-lg ${opponents === item ? 'bg-green-700' : 'bg-gray-700'}`}>
                {item === 'mixed' ? '混合对手' : item === 'loose' ? '偏松对手' : '偏紧对手'}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">深度是开局推荐值，打过几手后有效筹码会变化。改变这里的选项不会扣钱。</p>
          <p className="text-xs text-gray-300">{mixSummary(opponents)}</p>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={autoOpenReview} onChange={(event) => setAutoOpenReview(event.target.checked)} />
            每手结束自动展开回顾
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {LEVELS.map((level) => {
            const table = tableFromSelection(level, scenarioId, depth, opponents);
            const times = table.buyIn > 0 ? balance / table.buyIn : 0;
            return (
            <div key={level.id} className="bg-gray-800 rounded-2xl p-6 border border-gray-700 hover:border-blue-500 transition-all shadow-lg flex flex-col">
              <h3 className="text-xl font-bold text-white mb-4">{level.name}</h3>
              <div className="space-y-2 mb-6 text-gray-300">
                <div className="flex justify-between">
                  <span>盲注 (SB/BB):</span>
                  <span className="font-mono">${level.smallBlind}/${level.bigBlind}</span>
                </div>
                <div className="flex justify-between">
                  <span>本次买入:</span>
                  <span className="font-mono">${table.buyIn} · {depth}bb</span>
                </div>
                <div className="flex justify-between text-sm text-gray-500 mt-4">
                  <span>约可买入:</span>
                  <span className="font-mono">{times.toFixed(1)} 次</span>
                </div>
              </div>
              <button
                onClick={() => handleJoinClick(level.id)}
                className="mt-auto w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold flex justify-center items-center transition-colors"
              >
                <Play size={18} className="mr-2" /> 入座 (Sit Down)
              </button>
            </div>
            );
          })}
        </div>

        <div className="mt-6 bg-gray-800 rounded-2xl p-4 border border-gray-700">
          <div className="font-bold mb-3">最近手牌</div>
          {(syncPending > 0 || syncFailed > 0 || !syncPersist) && (
            <div className="mb-3 text-xs text-gray-400 flex flex-wrap items-center gap-2">
              {!syncPersist && <span className="text-amber-400">回顾同步无法持久化（仅本会话内存）</span>}
              {syncPending > 0 && <span>待同步 {syncPending} 手</span>}
              {syncFailed > 0 && (
                <>
                  <span className="text-red-400">同步失败 {syncFailed} 手</span>
                  <button
                    type="button"
                    onClick={() => { void retryFailedHandReviews(); }}
                    className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
                  >
                    重试
                  </button>
                </>
              )}
            </div>
          )}
          {hands.length === 0 && <p className="text-sm text-gray-500">还没有已完成的手牌。</p>}
          <div className="space-y-2">
            {[...hands].reverse().map((hand) => (
              <button key={hand.id} onClick={() => setReviewId(hand.id)} className="w-full text-left px-3 py-2 rounded-lg bg-gray-900 hover:bg-gray-700 text-sm">
                第 {hand.handNumber} 手 · {hand.config.levelName} · {hand.config.buyInBb}bb · {hand.endKind === 'folds' ? '弃牌结束' : '摊牌'}
              </button>
            ))}
          </div>
        </div>
        {reviewId && <HandReview handId={reviewId} onClose={() => setReviewId(null)} />}

        {/* Warning Modal */}
        {warning.show && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full border border-red-900 shadow-2xl">
              <div className="flex items-center text-red-500 mb-4">
                <AlertTriangle size={32} className="mr-3" />
                <h2 className="text-2xl font-bold">{warning.table ? '买入提示' : '资金不足'}</h2>
              </div>
              <p className="text-gray-300 leading-relaxed mb-8">{warning.message}</p>
              
              <div className="flex space-x-4">
                <button 
                  onClick={() => setWarning({ show: false, message: '' })}
                  className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold transition-colors"
                >
                  {warning.table ? '先不进入' : '知道了'}
                </button>
                {warning.table && (
                  <button 
                    onClick={confirmJoin}
                    className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold transition-colors"
                  >
                    仍然入座
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Set Bankroll Modal */}
        {showSetBankrollModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full border border-gray-700 shadow-2xl">
              <div className="flex items-center text-blue-400 mb-4">
                <Settings size={32} className="mr-3" />
                <h2 className="text-2xl font-bold">设置总资金</h2>
              </div>
              <p className="text-gray-300 mb-6">请输入你想设定的新总资金金额：</p>
              
              <input
                type="number"
                value={bankrollInput}
                onChange={(e) => { setBankrollInput(e.target.value); setBankrollError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') submitSetBankroll(); }}
                className={`w-full bg-gray-900 border rounded-xl px-4 py-3 text-white font-mono text-xl focus:outline-none ${bankrollError ? 'border-red-500 focus:border-red-500' : 'border-gray-600 focus:border-blue-500'}`}
                autoFocus
              />
              <div className="h-5 mt-1 mb-2">
                {bankrollError && <p className="text-red-400 text-sm leading-5">{bankrollError}</p>}
              </div>

              <div className="flex space-x-4">
                <button 
                  onClick={() => setShowSetBankrollModal(false)}
                  className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={submitSetBankroll}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold transition-colors"
                >
                  保存设置
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
