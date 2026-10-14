import React, { useState } from 'react';
import { useBankrollStore } from '../store/bankrollStore';
import { Coins, AlertTriangle, Play, RotateCcw, Settings } from 'lucide-react';

export interface TableConfig {
  id: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  buyIn: number;
}

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

  const handleJoinClick = (table: TableConfig) => {
    // 30 Buy-in rule: you should have at least 30x the buy-in to play safely
    const requiredBankroll = table.buyIn * 30;
    
    if (balance < table.buyIn) {
      setWarning({
        show: true,
        message: `您的资金不足以支付该桌的买入 ($${table.buyIn})。`,
      });
      return;
    }

    if (balance < requiredBankroll) {
      setWarning({
        show: true,
        message: `【越级警告】标准的资金管理(30买入原则)建议您至少拥有 $${requiredBankroll} 才能挑战此级别。您当前资金承受破产的风险极高！是否执意进入？`,
        table,
      });
    } else {
      onJoinTable(table);
    }
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

        {/* Tables */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TABLES.map((table) => (
            <div key={table.id} className="bg-gray-800 rounded-2xl p-6 border border-gray-700 hover:border-blue-500 transition-all shadow-lg flex flex-col">
              <h3 className="text-xl font-bold text-white mb-4">{table.name}</h3>
              <div className="space-y-2 mb-6 text-gray-300">
                <div className="flex justify-between">
                  <span>盲注 (SB/BB):</span>
                  <span className="font-mono">${table.smallBlind}/${table.bigBlind}</span>
                </div>
                <div className="flex justify-between">
                  <span>买入 (Buy-in):</span>
                  <span className="font-mono">${table.buyIn}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-500 mt-4">
                  <span>建议安全资金:</span>
                  <span className="font-mono">${table.buyIn * 30}</span>
                </div>
              </div>
              <button
                onClick={() => handleJoinClick(table)}
                className="mt-auto w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold flex justify-center items-center transition-colors"
              >
                <Play size={18} className="mr-2" /> 入座 (Sit Down)
              </button>
            </div>
          ))}
        </div>

        {/* Warning Modal */}
        {warning.show && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full border border-red-900 shadow-2xl">
              <div className="flex items-center text-red-500 mb-4">
                <AlertTriangle size={32} className="mr-3" />
                <h2 className="text-2xl font-bold">资金管理警告</h2>
              </div>
              <p className="text-gray-300 leading-relaxed mb-8">{warning.message}</p>
              
              <div className="flex space-x-4">
                <button 
                  onClick={() => setWarning({ show: false, message: '' })}
                  className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold transition-colors"
                >
                  听劝，退回
                </button>
                {warning.table && (
                  <button 
                    onClick={confirmJoin}
                    className="flex-1 py-3 bg-red-600 hover:bg-red-500 rounded-xl font-bold transition-colors"
                  >
                    执意进入
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
