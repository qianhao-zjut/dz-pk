import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useBankrollStore } from '../store/bankrollStore';
import { useHandHistoryStore } from '../store/handHistoryStore';
import { AlertTriangle, Coins } from 'lucide-react';
import { TableFelt } from './TableFelt';
import { TeachingPanel } from './TeachingPanel';
import { HandReview } from './HandReview';
import { confirmTypedRaise } from '../game/chipAmount';
import { quoteCall } from '../game/priceQuote';
import { actionShortcuts, raiseVerb, type StreetName } from '../game/shortcuts';
import { roleAt, stackText } from '../game/positions';
import { tableSizeLabel } from '../game/sessionConfig';
import { reviewAutoOpenDecision } from '../game/reviewGate';
import { liveActionSound, primeActionAudio } from '../game/actionSound';
import { readSoundEnabled, writeSoundEnabled } from '../game/soundPreference';

export const GameTable: React.FC<{ onLeave: () => void }> = ({ onLeave }) => {
  const {
    table, stage, pot, board, players, currentPlayerIndex, currentMaxBet, lastRaiseSize, dealerIndex,
    handDealerIndex, streetActions, sessionId, handNumber,
    startHand, playerFold, playerCheck, playerCall, playerRaise, leaveTable, actAI, gameLog, rebuy
  } = useGameStore();
  const hands = useHandHistoryStore((state) => state.hands);
  const pendingAutoOpenId = useHandHistoryStore((state) => state.pendingAutoOpenId);
  const consumeAutoOpen = useHandHistoryStore((state) => state.consumeAutoOpen);
  const [manualReviewId, setManualReviewId] = useState<string | null>(null);
  const pendingHand = hands.find((item) => item.id === pendingAutoOpenId) ?? null;
  const autoDecision = reviewAutoOpenDecision({
    pendingId: pendingAutoOpenId,
    hand: pendingHand,
    stage,
    sessionId,
    handNumber,
  });
  const reviewId = manualReviewId ?? (autoDecision === 'open' ? pendingAutoOpenId : null);
  
  const deductFunds = useBankrollStore(state => state.deductFunds);
  const addFunds = useBankrollStore(state => state.addFunds);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Modal 状态（替代原生 confirm/alert）
  const [showRebuyModal, setShowRebuyModal] = useState(false);
  const [showBrokeModal, setShowBrokeModal] = useState(false);
  const [showAllInModal, setShowAllInModal] = useState(false);

  // 加注尺寸面板（滑杆 + 快捷按钮）。手输金额保持原始字符串，确认时才转换。
  const [showRaisePanel, setShowRaisePanel] = useState(false);
  const [raiseText, setRaiseText] = useState('');
  const [raiseError, setRaiseError] = useState<string | null>(null);

  const [soundOn, setSoundOn] = useState(() => readSoundEnabled());
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    writeSoundEnabled(next);
    if (next) primeActionAudio();
  };

  // 轮到别人行动时自动收起加注面板
  const isHumanTurnNow = stage !== 'idle' && stage !== 'showdown' && players[currentPlayerIndex]?.id === 'human';
  useEffect(() => {
    if (!isHumanTurnNow) setShowRaisePanel(false);
  }, [isHumanTurnNow]);

  // Auto-scroll game log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gameLog]);

  useEffect(() => {
    const statuses: Record<string, typeof players[number]['status']> = {};
    for (const player of players) statuses[player.id] = player.status;
    const humanPlayer = players.find((player) => player.id === 'human') ?? null;
    return liveActionSound.onFrame({
      handNumber,
      stage,
      streetActions,
      currentPlayerIndex,
      currentPlayerId: players[currentPlayerIndex]?.id ?? null,
      humanStatus: humanPlayer?.status ?? null,
      statuses,
    });
  }, [handNumber, stage, streetActions, players, currentPlayerIndex]);

  useEffect(() => {
    if (autoDecision === 'drop' && pendingAutoOpenId) consumeAutoOpen(pendingAutoOpenId);
  }, [autoDecision, pendingAutoOpenId, consumeAutoOpen]);

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

  // 加注尺寸计算（口径：加注到的总额）
  const humanTotal = (human?.chips || 0) + (human?.currentBet || 0);
  // 最小加注目标：本街没人下注时为 1BB（最小下注）；有人下注时为 min-raise
  const minRaiseTarget = currentMaxBet === 0 ? table.bigBlind : currentMaxBet + lastRaiseSize;
  const raiseMin = Math.min(minRaiseTarget, humanTotal); // 筹码不足最小加注时只能 All-in
  const raiseMax = humanTotal;
  const amountToCall = Math.max(0, currentMaxBet - (human?.currentBet || 0));
  const buttonIndex = handNumber > 0 ? handDealerIndex : dealerIndex;
  const humanSeat = players.findIndex((player) => player.id === 'human');
  const statuses = players.map((player) => player.status);
  const humanRole = humanSeat >= 0 ? roleAt(humanSeat, buttonIndex, statuses) : null;
  const sizeLabel = tableSizeLabel(table.tableSize ?? players.length);
  const bettingStreet = (stage === 'preflop' || stage === 'flop' || stage === 'turn' || stage === 'river') ? stage : 'preflop';
  const raiseCount = streetActions.filter((action) => action.stage === stage && action.kind === 'raise').length;
  const limpers = players.filter((player, seat) => (
    player.id !== 'human'
    && player.currentBet >= table.bigBlind
    && roleAt(seat, buttonIndex, statuses) !== 'BB'
    && player.status !== 'folded'
    && player.status !== 'sitting-out'
  )).length;
  const activeSeats = players.map((player, seat) => ({ seat, status: player.status })).filter((player) => player.status === 'active');
  const order = (seat: number) => ((seat - buttonIndex - 1) % players.length + players.length) % players.length;
  const heroInPosition = humanSeat >= 0 && activeSeats.length > 0 && order(humanSeat) === Math.max(...activeSeats.map((player) => order(player.seat)));
  const plan = actionShortcuts({
    street: bettingStreet as StreetName,
    bigBlind: table.bigBlind,
    pot,
    currentMaxBet,
    lastRaiseSize,
    heroBet: human?.currentBet ?? 0,
    heroChips: human?.chips ?? 0,
    canRaise: Boolean(human?.canRaise),
    raiseCount,
    limpers,
    inPosition: heroInPosition,
  });
  const verb = raiseVerb(bettingStreet, currentMaxBet);
  const quote = human ? quoteCall(human, currentMaxBet, players, pot) : null
  const opponentsLeft = players.filter((player) => player.id !== 'human' && player.status !== 'folded' && player.status !== 'sitting-out');
  const effective = human && opponentsLeft.length > 0
    ? Math.min(human.chips + human.currentBet, ...opponentsLeft.map((player) => player.chips + player.currentBet))
    : null;
  const latestHand = [...hands].reverse().find((hand) => hand.sessionId === sessionId) ?? null;

  const openRaisePanel = () => {
    setRaiseText(String(plan.defaultRaiseTo ?? raiseMin));
    setRaiseError(null);
    setShowRaisePanel(true);
  };

  const trimmedRaise = raiseText.trim();
  const preview = trimmedRaise === '' ? null : Number(trimmedRaise);
  const previewFinite = preview != null && Number.isFinite(preview) ? preview : null;
  const addedPreview = previewFinite == null ? null : Math.max(0, previewFinite - (human?.currentBet || 0));
  const sliderValue = previewFinite != null && previewFinite >= raiseMin && previewFinite <= raiseMax
    ? previewFinite
    : raiseMin;

  const handleRaiseConfirm = () => {
    const result = confirmTypedRaise(raiseText, { min: raiseMin, max: raiseMax });
    if (result.submit == null) {
      setRaiseError(result.error);
      setShowRaisePanel(true);
      return;
    }
    playerRaise(result.submit);
    setRaiseError(null);
    setShowRaisePanel(false);
  };

  const handleLeave = () => {
    const returnedChips = leaveTable();
    addFunds(returnedChips);
    onLeave();
  };

  // 点击 Deal / Next Hand：破产时弹 Rebuy 确认框
  const handleDealClick = () => {
    if (human && human.chips === 0) {
      setShowRebuyModal(true);
    } else {
      setManualReviewId(null);
      startHand();
    }
  };

  // Rebuy 确认：扣款成功则重新买入并发牌，失败则提示资金不足
  const handleRebuyConfirm = () => {
    setShowRebuyModal(false);
    if (deductFunds(table.buyIn)) {
      rebuy('human', table.buyIn);
      startHand();
    } else {
      setShowBrokeModal(true);
    }
  };

  // Rebuy 取消：直接站起离开
  const handleRebuyCancel = () => {
    setShowRebuyModal(false);
    handleLeave();
  };

  // 资金不足：确认后强制离开
  const handleBrokeLeave = () => {
    setShowBrokeModal(false);
    handleLeave();
  };

  // All-in 确认
  const handleAllInConfirm = () => {
    setShowAllInModal(false);
    if (human) {
      playerRaise(human.chips + human.currentBet);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row min-h-screen lg:h-screen bg-gray-900 text-white font-sans p-2 sm:p-4 gap-2 sm:gap-4 overflow-y-auto lg:overflow-hidden">
      {/* 左侧/中央：主要牌桌区域 */}
      <div className="flex-1 flex flex-col relative bg-gray-800 rounded-2xl sm:rounded-3xl border-4 sm:border-8 border-gray-700 shadow-2xl min-h-[42rem] lg:min-h-0">
        
        {/* 顶部：控制条 */}
        <div className="relative z-10 w-full p-3 sm:p-4 flex flex-wrap justify-between items-center gap-2">
          <div className="bg-black/50 px-4 py-2 rounded-full text-sm font-bold text-gray-300">
            {table.name} ({table.smallBlind}/{table.bigBlind}){sizeLabel ? ` · ${sizeLabel}` : ''}{effective != null ? ` · 有效 ${stackText(effective, table.bigBlind)}` : ''}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={toggleSound} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-bold shadow-md transition-colors">
              {soundOn ? '音效开' : '音效关'}
            </button>
            <button onClick={handleLeave} className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-bold shadow-md transition-colors">
              站起离开
            </button>
          </div>
        </div>

        <TableFelt
          players={players}
          stage={stage}
          pot={pot}
          board={board}
          bigBlind={table.bigBlind}
          buttonIndex={buttonIndex}
          currentPlayerIndex={currentPlayerIndex}
          streetActions={streetActions}
        />

        {/* 底部操作面板 */}
        <div className="bg-gray-900 p-2 sm:p-4 border-t border-gray-700 flex justify-center items-center flex-shrink-0 min-h-[5rem] sm:min-h-[6rem] z-30">
          {stage === 'idle' || stage === 'showdown' ? (
            <div className="flex flex-wrap justify-center gap-2">
              <button
                onClick={() => latestHand && setManualReviewId(latestHand.id)}
                disabled={!latestHand}
                className="px-5 py-3 rounded-xl font-bold bg-gray-700 disabled:text-gray-500"
              >
                本手回顾
              </button>
              <button
                onClick={handleDealClick}
                className={`px-8 py-3 rounded-xl font-bold text-lg shadow-lg transition-colors ${
                  human && human.chips === 0 
                    ? 'bg-orange-600 hover:bg-orange-500 ring-4 ring-orange-500/50' 
                    : 'bg-blue-600 hover:bg-blue-500'
                }`}
              >
                {stage === 'showdown' 
                  ? (human && human.chips === 0 ? `重新买入 $${table.buyIn}` : '下一手') 
                  : '开始游戏'}
              </button>
            </div>
          ) : showRaisePanel && human ? (
            /* 加注尺寸面板：滑杆 + 快捷尺寸 + 确认/取消 */
            <div className="flex flex-col items-center gap-2 w-full max-w-md px-2">
              <div className="flex items-baseline gap-2">
                <span className="text-gray-300 text-sm">{verb}到</span>
                <span className="text-yellow-400 font-bold text-2xl">${raiseText === '' ? '—' : raiseText}</span>
                <span className="text-gray-500 text-xs">(再投入 {addedPreview == null ? '—' : `$${addedPreview}`})</span>
              </div>

              <input
                type="range"
                min={raiseMin}
                max={raiseMax}
                step={1}
                value={sliderValue}
                disabled={raiseMin >= raiseMax}
                onChange={(e) => {
                  setRaiseText(e.target.value);
                  setRaiseError(null);
                }}
                className="w-full accent-purple-500 disabled:opacity-40"
              />
              <div className="flex justify-between w-full text-[10px] text-gray-500 -mt-1">
                <span>Min ${raiseMin}</span>
                <span>All-in ${raiseMax}</span>
              </div>

              <div className="flex flex-wrap justify-center gap-2">
                {plan.shortcuts.map((shortcut) => (
                  <button
                    key={shortcut.id}
                    onClick={() => {
                      setRaiseText(String(shortcut.raiseTo));
                      setRaiseError(null);
                    }}
                    className={`px-3 py-1 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                      raiseText === String(shortcut.raiseTo) ? 'bg-purple-600 ring-2 ring-purple-400' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                    }`}
                  >
                    {shortcut.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={raiseText}
                onChange={(event) => {
                  setRaiseText(event.target.value);
                  setRaiseError(null);
                }}
                className="w-28 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
              />
              {raiseError && <p className="text-red-400 text-xs text-center">{raiseError}</p>}

              <div className="flex gap-3 mt-1">
                <button
                  onClick={() => {
                    setShowRaisePanel(false);
                    setRaiseError(null);
                  }}
                  className="px-4 sm:px-6 py-2 rounded-xl font-bold bg-gray-700 hover:bg-gray-600 transition-all"
                >
                  取消
                </button>
                <button
                  onClick={handleRaiseConfirm}
                  className="px-4 sm:px-6 py-2 rounded-xl font-bold bg-purple-600 hover:bg-purple-500 transition-all"
                >
                  确认{verb} {raiseText}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
            {isHumanTurn && quote && quote.toCall > 0 && (
              <p className="text-xs text-gray-300 text-center max-w-xl">{quote.label}</p>
            )}
            {isHumanTurn && effective != null && (
              <p className="text-[11px] text-gray-500">有效筹码 {stackText(effective, table.bigBlind)}{humanRole ? ` · ${humanRole}` : ''}</p>
            )}
            <div className="flex flex-wrap justify-center gap-2 sm:gap-4">
              <button
                onClick={() => playerFold()}
                disabled={!isHumanTurn}
                className={`px-4 sm:px-6 py-2 rounded-xl font-bold transition-all ${isHumanTurn ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 text-gray-500'}`}
              >
                弃牌 (Fold)
              </button>
              
              {currentMaxBet === (human?.currentBet || 0) ? (
                <button 
                  onClick={() => playerCheck()}
                  disabled={!isHumanTurn}
                  className={`px-4 sm:px-6 py-2 rounded-xl font-bold transition-all ${isHumanTurn ? 'bg-green-600 hover:bg-green-500' : 'bg-gray-700 text-gray-500'}`}
                >
                  过牌 (Check)
                </button>
              ) : (
                <button 
                  onClick={() => playerCall()}
                  disabled={!isHumanTurn}
                  className={`px-4 sm:px-6 py-2 rounded-xl font-bold transition-all ${isHumanTurn ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-700 text-gray-500'}`}
                >
                  跟注 ${quote?.callCost ?? amountToCall}
                </button>
              )}
              
              <button
                onClick={openRaisePanel}
                disabled={!isHumanTurn || !human?.canRaise}
                className={`px-4 sm:px-6 py-2 rounded-xl font-bold transition-all ${isHumanTurn && human?.canRaise ? 'bg-purple-600 hover:bg-purple-500' : 'bg-gray-700 text-gray-500'}`}
              >
                {verb}
              </button>

              <button
                onClick={() => setShowAllInModal(true)}
                disabled={!isHumanTurn || (human && human.chips === 0) || !human?.canRaise}
                className={`px-4 sm:px-6 py-2 rounded-xl font-bold transition-all ${isHumanTurn && human && human.chips > 0 && human.canRaise ? 'bg-orange-600 hover:bg-orange-500' : 'bg-gray-700 text-gray-500'}`}
              >
                All-in
              </button>
            </div>
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
        <div className="h-48 overflow-y-auto lg:h-auto lg:flex-1">
          <TeachingPanel
            humanCards={human?.cards || []}
            boardCards={board}
            role={humanRole}
            raiseCount={raiseCount}
          />
        </div>
      </div>

      {reviewId && (
        <HandReview
          handId={reviewId}
          onClose={() => {
            if (reviewId === pendingAutoOpenId) consumeAutoOpen(pendingAutoOpenId);
            setManualReviewId(null);
          }}
        />
      )}

      {/* Rebuy 确认 Modal */}
      {showRebuyModal && (
        <TableModal
          icon={<Coins size={32} className="mr-3" />}
          iconClass="text-yellow-500"
          title="重新买入 (Rebuy)"
          message={`您的筹码已耗尽。是否从大厅资金中扣除 $${table.buyIn} 重新买入？`}
          confirmText={`重新买入 $${table.buyIn}`}
          confirmClass="bg-orange-600 hover:bg-orange-500"
          onConfirm={handleRebuyConfirm}
          cancelText="站起离开"
          onCancel={handleRebuyCancel}
        />
      )}

      {/* 资金不足提示 Modal */}
      {showBrokeModal && (
        <TableModal
          icon={<AlertTriangle size={32} className="mr-3" />}
          iconClass="text-red-500"
          title="资金不足"
          message="大厅资金不足，无法重新买入。您将离开牌桌。"
          confirmText="离开牌桌"
          confirmClass="bg-red-600 hover:bg-red-500"
          onConfirm={handleBrokeLeave}
        />
      )}

      {/* All-in 确认 Modal */}
      {showAllInModal && human && (
        <TableModal
          icon={<AlertTriangle size={32} className="mr-3" />}
          iconClass="text-orange-500"
          title="All-in 确认"
          message={`确定要全下所有筹码 ($${human.chips + human.currentBet}) 吗？`}
          confirmText="全下 (All-in)"
          confirmClass="bg-orange-600 hover:bg-orange-500"
          onConfirm={handleAllInConfirm}
          cancelText="取消"
          onCancel={() => setShowAllInModal(false)}
        />
      )}

    </div>
  );
};

interface TableModalProps {
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  message: string;
  confirmText: string;
  confirmClass: string;
  onConfirm: () => void;
  cancelText?: string;
  onCancel?: () => void;
}

// 深色确认弹窗（与大厅 Modal 风格一致，替代原生 confirm/alert）
const TableModal: React.FC<TableModalProps> = ({
  icon, iconClass, title, message, confirmText, confirmClass, onConfirm, cancelText, onCancel,
}) => (
  <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
    <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full border border-gray-700 shadow-2xl">
      <div className={`flex items-center mb-4 ${iconClass}`}>
        {icon}
        <h2 className="text-2xl font-bold">{title}</h2>
      </div>
      <p className="text-gray-300 leading-relaxed mb-8">{message}</p>
      <div className="flex space-x-4">
        {cancelText && onCancel && (
          <button
            onClick={onCancel}
            className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold transition-colors"
          >
            {cancelText}
          </button>
        )}
        <button
          onClick={onConfirm}
          className={`flex-1 py-3 rounded-xl font-bold transition-colors ${confirmClass}`}
        >
          {confirmText}
        </button>
      </div>
    </div>
  </div>
);
