import React, { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { useBankrollStore } from '../store/bankrollStore';
import { CardUI } from './CardUI';
import { TeachingPanel } from './TeachingPanel';

export const GameTable: React.FC<{ onLeave: () => void }> = ({ onLeave }) => {
  const { 
    table, stage, pot, board, players, currentPlayerIndex, currentMaxBet, dealerIndex,
    startHand, playerFold, playerCheck, playerCall, playerRaise, leaveTable, actAI, gameLog, rebuy 
  } = useGameStore();
  
  const deductFunds = useBankrollStore(state => state.deductFunds);
  const addFunds = useBankrollStore(state => state.addFunds);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll game log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gameLog]);

  // AI Turn trigger
  useEffect(() => {
    if (stage !== 'idle' && stage !== 'showdown') {
      const p = players[currentPlayerIndex];
      if (p && p.isAI && p.status === 'active') {
        const timer = setTimeout(() => {
          actAI();
        }, 1500); // 1.5秒延迟，让玩家看清操作
        return () => clearTimeout(timer);
      }
    }
  }, [currentPlayerIndex, stage, players, actAI]);

  if (!table) return null;

  const human = players.find(p => p.id === 'human');
  const isHumanTurn = stage !== 'idle' && stage !== 'showdown' && players[currentPlayerIndex]?.id === 'human';

  const handleLeave = () => {
    const returnedChips = leaveTable();
    addFunds(returnedChips);
    onLeave();
  };

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-gray-900 text-white font-sans p-2 sm:p-4 gap-2 sm:gap-4 overflow-hidden">
      {/* 左侧/中央：主要牌桌区域 */}
      <div className="flex-1 flex flex-col relative bg-gray-800 rounded-2xl sm:rounded-3xl border-4 sm:border-8 border-gray-700 overflow-hidden shadow-2xl min-h-0">
        
        {/* 顶部：控制条 */}
        <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-center z-10">
          <div className="bg-black/50 px-4 py-2 rounded-full text-sm font-bold text-gray-300">
            {table.name} ({table.smallBlind}/{table.bigBlind})
          </div>
          <button onClick={handleLeave} className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-bold shadow-md transition-colors">
            站起离开
          </button>
        </div>

        {/* 牌桌渲染区 (无牌桌背景，纯净排版) */}
        <div className="flex-1 flex flex-col justify-between relative pt-16 p-2 sm:p-4 overflow-y-auto min-h-0">
          
          {/* 顶部：人类玩家 (你的位置) */}
          {human && (
            <div className="flex flex-col items-center z-20 mt-2 sm:mt-4">
              
              <div className={`px-4 sm:px-6 py-2 rounded-xl shadow-xl text-center border ${isHumanTurn ? 'bg-yellow-600 border-yellow-400 ring-4 ring-yellow-500/50' : 'bg-gray-800 border-gray-600'} mb-2`}>
                <div className="font-bold text-base sm:text-lg">{human.name}</div>
                <div className="text-green-400 font-mono text-base sm:text-lg">${human.chips}</div>
              </div>

              {/* 状态 / 下注 */}
              <div className="flex items-center space-x-2 mb-2 h-6">
                {players.findIndex(p => p.id === 'human') === dealerIndex && (
                  <div className="w-5 h-5 sm:w-6 sm:h-6 bg-white text-black rounded-full flex items-center justify-center text-xs font-bold shadow-md">D</div>
                )}
                {human.currentBet > 0 && <div className="px-3 py-1 bg-yellow-600/90 rounded-full text-xs sm:text-sm font-bold border border-yellow-400 shadow-lg">${human.currentBet}</div>}
                {human.status === 'folded' && <div className="px-2 bg-red-600/80 rounded text-xs">Folded</div>}
                {human.status === 'all-in' && <div className="px-2 bg-red-600/80 rounded text-xs font-bold">ALL-IN</div>}
              </div>

              {/* 卡牌 */}
              <div className="flex space-x-2 z-30">
                 {(human.status === 'active' || human.status === 'all-in') && human.cards.length > 0 ? (
                   human.cards.map((c, i) => <CardUI key={i} card={c} className="scale-75 sm:scale-100 hover:-translate-y-2 transition-transform shadow-2xl origin-top" />)
                 ) : (
                   <div className="h-24 sm:h-32 flex items-center text-gray-500 text-sm">等待发牌...</div>
                 )}
              </div>

            </div>
          )}

          {/* 中间：AI 1、公共牌、AI 3 */}
          <div className="flex justify-between items-center w-full px-8 sm:px-16 my-1 sm:my-2 flex-1 min-h-[150px]">
            
            {/* 左侧 AI (AI 0) */}
            {players.filter(p => p.isAI)[0] && (() => {
              const p = players.filter(p => p.isAI)[0];
              const pIdx = players.findIndex(player => player.id === p.id);
              const isDealer = pIdx === dealerIndex;
              const isCurrent = pIdx === currentPlayerIndex && stage !== 'idle' && stage !== 'showdown';
              
              return (
                <div className="flex flex-col items-center z-20 w-24 sm:w-32">
                  <div className={`px-2 sm:px-4 py-1 sm:py-2 rounded-lg mb-2 shadow-lg text-center w-full ${isCurrent ? 'bg-yellow-600 ring-4 ring-yellow-400' : 'bg-gray-800'}`}>
                    <div className="font-bold text-xs sm:text-sm truncate">{p.name}</div>
                    <div className="text-green-400 text-xs">${p.chips}</div>
                  </div>
                  
                  <div className="flex items-center space-x-1 sm:space-x-2 mb-2 h-6">
                    {isDealer && <div className="w-4 h-4 sm:w-5 sm:h-5 bg-white text-black rounded-full flex items-center justify-center text-[10px] font-bold shadow-md">D</div>}
                    {p.currentBet > 0 && <div className="px-1 sm:px-2 bg-yellow-600/80 rounded text-[10px] sm:text-xs font-bold border border-yellow-400">${p.currentBet}</div>}
                    {p.status === 'folded' && <div className="px-1 sm:px-2 bg-red-600/80 rounded text-[10px] sm:text-xs">Folded</div>}
                    {p.status === 'all-in' && <div className="px-1 sm:px-2 bg-red-600/80 rounded text-[10px] sm:text-xs font-bold">ALL-IN</div>}
                  </div>

                  <div className="flex space-x-1">
                    {p.status === 'active' || p.status === 'all-in' ? (
                       stage === 'showdown' ? (
                         p.cards.map((c, i) => <CardUI key={i} card={c} className="scale-[0.5] sm:scale-75 origin-top -mx-2 sm:-mx-0" />)
                       ) : (
                         <>
                           <CardUI className="scale-[0.5] sm:scale-75 origin-top -mx-2 sm:-mx-0" />
                           <CardUI className="scale-[0.5] sm:scale-75 origin-top -mx-2 sm:-mx-0" />
                         </>
                       )
                    ) : <div className="h-16"></div>}
                  </div>
                </div>
              );
            })()}

            {/* 中央：公共牌和底池 */}
            <div className="flex flex-col items-center justify-center space-y-4 sm:space-y-6 z-10 flex-1">
              <div className="bg-black/60 px-4 sm:px-6 py-1 sm:py-2 rounded-full border border-yellow-500/30 mb-2">
                <span className="text-yellow-400 font-bold text-lg sm:text-xl">Pot: ${pot}</span>
              </div>
              
              <div className="flex space-x-1 sm:space-x-2 h-24 sm:h-32 justify-center w-full">
                {stage !== 'idle' && stage !== 'preflop' && (
                  <>
                    {board.map((card, i) => (
                      <CardUI key={i} card={card} className="scale-[0.6] sm:scale-90 origin-center" />
                    ))}
                    {Array.from({ length: 5 - board.length }).map((_, i) => (
                      <div key={`empty-${i}`} className="w-14 h-24 sm:w-20 sm:h-32 rounded-xl border-2 border-dashed border-gray-600/50 scale-[0.6] sm:scale-90 flex-shrink-0"></div>
                    ))}
                  </>
                )}
                {(stage === 'idle' || stage === 'preflop') && (
                  <div className="flex space-x-1 sm:space-x-2 justify-center w-full">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={`empty-${i}`} className="w-14 h-24 sm:w-20 sm:h-32 rounded-xl border-2 border-dashed border-gray-600/50 scale-[0.6] sm:scale-90 flex-shrink-0"></div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 右侧 AI (AI 2) */}
            {players.filter(p => p.isAI)[2] && (() => {
              const p = players.filter(p => p.isAI)[2];
              const pIdx = players.findIndex(player => player.id === p.id);
              const isDealer = pIdx === dealerIndex;
              const isCurrent = pIdx === currentPlayerIndex && stage !== 'idle' && stage !== 'showdown';
              
              return (
                <div className="flex flex-col items-center z-20 w-24 sm:w-32">
                  <div className={`px-2 sm:px-4 py-1 sm:py-2 rounded-lg mb-2 shadow-lg text-center w-full ${isCurrent ? 'bg-yellow-600 ring-4 ring-yellow-400' : 'bg-gray-800'}`}>
                    <div className="font-bold text-xs sm:text-sm truncate">{p.name}</div>
                    <div className="text-green-400 text-xs">${p.chips}</div>
                  </div>
                  
                  <div className="flex items-center space-x-1 sm:space-x-2 mb-2 h-6">
                    {isDealer && <div className="w-4 h-4 sm:w-5 sm:h-5 bg-white text-black rounded-full flex items-center justify-center text-[10px] font-bold shadow-md">D</div>}
                    {p.currentBet > 0 && <div className="px-1 sm:px-2 bg-yellow-600/80 rounded text-[10px] sm:text-xs font-bold border border-yellow-400">${p.currentBet}</div>}
                    {p.status === 'folded' && <div className="px-1 sm:px-2 bg-red-600/80 rounded text-[10px] sm:text-xs">Folded</div>}
                    {p.status === 'all-in' && <div className="px-1 sm:px-2 bg-red-600/80 rounded text-[10px] sm:text-xs font-bold">ALL-IN</div>}
                  </div>

                  <div className="flex space-x-1">
                    {p.status === 'active' || p.status === 'all-in' ? (
                       stage === 'showdown' ? (
                         p.cards.map((c, i) => <CardUI key={i} card={c} className="scale-[0.5] sm:scale-75 origin-top -mx-2 sm:-mx-0" />)
                       ) : (
                         <>
                           <CardUI className="scale-[0.5] sm:scale-75 origin-top -mx-2 sm:-mx-0" />
                           <CardUI className="scale-[0.5] sm:scale-75 origin-top -mx-2 sm:-mx-0" />
                         </>
                       )
                    ) : <div className="h-16"></div>}
                  </div>
                </div>
              );
            })()}

          </div>

          {/* 底部：底部 AI (AI 1) */}
          <div className="flex justify-center z-20 mb-2 sm:mb-4">
            {players.filter(p => p.isAI)[1] && (() => {
              const p = players.filter(p => p.isAI)[1];
              const pIdx = players.findIndex(player => player.id === p.id);
              const isDealer = pIdx === dealerIndex;
              const isCurrent = pIdx === currentPlayerIndex && stage !== 'idle' && stage !== 'showdown';
              
              return (
                <div className="flex flex-col items-center z-20 w-32">
                  <div className="flex space-x-1 mb-2">
                    {p.status === 'active' || p.status === 'all-in' ? (
                       stage === 'showdown' ? (
                         p.cards.map((c, i) => <CardUI key={i} card={c} className="scale-[0.5] sm:scale-75 origin-bottom" />)
                       ) : (
                         <>
                           <CardUI className="scale-[0.5] sm:scale-75 origin-bottom" />
                           <CardUI className="scale-[0.5] sm:scale-75 origin-bottom" />
                         </>
                       )
                    ) : <div className="h-16"></div>}
                  </div>

                  <div className="flex items-center space-x-1 sm:space-x-2 mb-2 h-6">
                    {isDealer && <div className="w-4 h-4 sm:w-5 sm:h-5 bg-white text-black rounded-full flex items-center justify-center text-[10px] font-bold shadow-md">D</div>}
                    {p.currentBet > 0 && <div className="px-1 sm:px-2 bg-yellow-600/80 rounded text-[10px] sm:text-xs font-bold border border-yellow-400">${p.currentBet}</div>}
                    {p.status === 'folded' && <div className="px-1 sm:px-2 bg-red-600/80 rounded text-[10px] sm:text-xs">Folded</div>}
                    {p.status === 'all-in' && <div className="px-1 sm:px-2 bg-red-600/80 rounded text-[10px] sm:text-xs font-bold">ALL-IN</div>}
                  </div>

                  <div className={`px-2 sm:px-4 py-1 sm:py-2 rounded-lg shadow-lg text-center w-full ${isCurrent ? 'bg-yellow-600 ring-4 ring-yellow-400' : 'bg-gray-800'}`}>
                    <div className="font-bold text-xs sm:text-sm truncate">{p.name}</div>
                    <div className="text-green-400 text-xs">${p.chips}</div>
                  </div>
                </div>
              );
            })()}
          </div>

        </div>

        {/* 底部操作面板 */}
        <div className="bg-gray-900 p-2 sm:p-4 border-t border-gray-700 flex justify-center items-center flex-shrink-0 min-h-[5rem] sm:min-h-[6rem] z-30">
          {stage === 'idle' || stage === 'showdown' ? (
            <button 
              onClick={() => {
                if (human && human.chips === 0) {
                  if (window.confirm(`您已经破产！是否要从大厅资金中扣除 $${table.buyIn} 重新买入 (Rebuy)？\n点击确定重新买入，点击取消站起离开。`)) {
                    if (deductFunds(table.buyIn)) {
                      rebuy('human', table.buyIn);
                      startHand();
                    } else {
                      alert("大厅资金不足，无法重新买入！系统将让您强制离开牌桌。");
                      handleLeave();
                    }
                  } else {
                    handleLeave();
                  }
                } else {
                  startHand();
                }
              }}
              className={`px-8 py-3 rounded-xl font-bold text-lg shadow-lg transition-colors ${
                human && human.chips === 0 
                  ? 'bg-orange-600 hover:bg-orange-500 ring-4 ring-orange-500/50' 
                  : 'bg-blue-600 hover:bg-blue-500'
              }`}
            >
              {stage === 'showdown' 
                ? (human && human.chips === 0 ? `重新买入 $${table.buyIn} (Rebuy)` : '下一手 (Next Hand)') 
                : '开始游戏 (Deal)'}
            </button>
          ) : (
            <div className="flex flex-wrap justify-center gap-2 sm:gap-4">
              <button 
                onClick={playerFold}
                disabled={!isHumanTurn}
                className={`px-4 sm:px-6 py-2 rounded-xl font-bold transition-all ${isHumanTurn ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 text-gray-500'}`}
              >
                弃牌 (Fold)
              </button>
              
              {currentMaxBet === (human?.currentBet || 0) ? (
                <button 
                  onClick={playerCheck}
                  disabled={!isHumanTurn}
                  className={`px-4 sm:px-6 py-2 rounded-xl font-bold transition-all ${isHumanTurn ? 'bg-green-600 hover:bg-green-500' : 'bg-gray-700 text-gray-500'}`}
                >
                  过牌 (Check)
                </button>
              ) : (
                <button 
                  onClick={playerCall}
                  disabled={!isHumanTurn}
                  className={`px-4 sm:px-6 py-2 rounded-xl font-bold transition-all ${isHumanTurn ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-700 text-gray-500'}`}
                >
                  跟注 (Call ${currentMaxBet - (human?.currentBet || 0)})
                </button>
              )}
              
              <button 
                onClick={() => {
                  const raiseAmount = currentMaxBet === 0 ? table.bigBlind : currentMaxBet * 2;
                  playerRaise(raiseAmount);
                }}
                disabled={!isHumanTurn}
                className={`px-4 sm:px-6 py-2 rounded-xl font-bold transition-all ${isHumanTurn ? 'bg-purple-600 hover:bg-purple-500' : 'bg-gray-700 text-gray-500'}`}
              >
                加注 (Raise)
              </button>

              <button 
                onClick={() => {
                  if (human && window.confirm("确定要 All-in (全下) 吗？")) {
                    playerRaise(human.chips + human.currentBet);
                  }
                }}
                disabled={!isHumanTurn || (human && human.chips === 0)}
                className={`px-4 sm:px-6 py-2 rounded-xl font-bold transition-all ${isHumanTurn && human && human.chips > 0 ? 'bg-orange-600 hover:bg-orange-500' : 'bg-gray-700 text-gray-500'}`}
              >
                All-in
              </button>
            </div>
          )}
        </div>

      </div>

      {/* 右侧：教学辅助与日志面板 */}
      <div className="w-full lg:w-80 flex flex-col gap-4">
        {/* 日志面板 */}
        <div className="flex-1 bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden flex flex-col shadow-xl">
          <div className="bg-gray-900 p-3 border-b border-gray-700 font-bold text-gray-300">
            📝 对局日志
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2 text-sm text-gray-400 font-mono">
            {gameLog.length === 0 && <div className="text-center text-gray-600 mt-4">等待游戏开始...</div>}
            {gameLog.map((log, i) => (
              <div key={i} className={`${log.includes('---') ? 'text-blue-400 my-4' : ''} ${log.includes('赢') ? 'text-yellow-400 font-bold' : ''}`}>
                {log}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* 教学提示与图鉴（Module 6） */}
        <div className="h-64 lg:h-auto lg:flex-1">
          <TeachingPanel humanCards={human?.cards || []} boardCards={board} />
        </div>
      </div>

    </div>
  );
};
