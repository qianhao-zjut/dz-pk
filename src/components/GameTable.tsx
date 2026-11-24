import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useBankrollStore } from '../store/bankrollStore';
import { useHandHistoryStore } from '../store/handHistoryStore';
import { AlertTriangle, Coins, GraduationCap, LogOut, PanelRightOpen, ScrollText, Spade, Volume2, VolumeX, X } from 'lucide-react';
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
  const settledHand = stage === 'showdown'
    ? [...hands].reverse().find((hand) => hand.sessionId === sessionId && hand.handNumber === handNumber) ?? null
    : null;
  
  const deductFunds = useBankrollStore(state => state.deductFunds);
  const addFunds = useBankrollStore(state => state.addFunds);
  const logBoxRef = useRef<HTMLDivElement>(null);

  // Modal 状态（替代原生 confirm/alert）
  const [showRebuyModal, setShowRebuyModal] = useState(false);
  const [showBrokeModal, setShowBrokeModal] = useState(false);
  const [showAllInModal, setShowAllInModal] = useState(false);

  // 加注尺寸面板（滑杆 + 快捷按钮）。手输金额保持原始字符串，确认时才转换。
  const [showRaisePanel, setShowRaisePanel] = useState(false);
  const [raiseText, setRaiseText] = useState('');
  const [raiseError, setRaiseError] = useState<string | null>(null);

  const [soundOn, setSoundOn] = useState(() => readSoundEnabled());
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  const [sideTab, setSideTab] = useState<'log' | 'teach'>('log');
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const syncSidebar = (event: MediaQueryListEvent) => setSidebarOpen(event.matches);
    media.addEventListener('change', syncSidebar);
    return () => media.removeEventListener('change', syncSidebar);
  }, []);
  useEffect(() => {
    if (!sidebarOpen || !window.matchMedia('(max-width: 1023px)').matches) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSidebarOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [sidebarOpen]);
  const openSidebar = (tab: 'log' | 'teach') => {
    setSideTab(tab);
    setSidebarOpen(true);
  };
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    writeSoundEnabled(next);
    if (next) primeActionAudio();
  };

  // 非本人回合即使面板状态尚未清理，也不展示加注控件。
  const isHumanTurnNow = stage !== 'idle' && stage !== 'showdown' && players[currentPlayerIndex]?.id === 'human';

  // 只滚动日志自己的容器，避免把整页从牌桌拉走
  useEffect(() => {
    const box = logBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
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
    <div className={`game-shell flex h-dvh min-h-[560px] flex-col overflow-hidden bg-[#0a110e] text-white lg:flex-row ${sidebarOpen ? 'sidebar-is-open' : ''}`}>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="relative z-30 flex h-[68px] shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#101815] px-3 shadow-md sm:px-5 lg:h-[74px]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#d9c16b55] bg-[#d9c16b12] text-[#e2c970]"><Spade size={21} fill="currentColor" /></div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-bold tracking-wide text-[#f1eee3] sm:text-base">{table.name.replace(/\s*\([^)]*\)/, '')}</h1>
                <span className="hidden rounded bg-[#d9c16b15] px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-[#d9c16b] sm:inline">练习室</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-[#8f9e94] sm:text-xs">
                <span>盲注 ${table.smallBlind}/${table.bigBlind}</span><span className="text-[#405148]">/</span><span>{sizeLabel || `${players.length} 人桌`}</span>
                {effective != null && <span className="hidden md:inline">· 有效 {stackText(effective, table.bigBlind)}</span>}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div className="mr-1 hidden items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-[#bbc5bb] xl:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#79ae78]" />第 {handNumber || '—'} 手</div>
            <button type="button" onClick={toggleSound} title={soundOn ? '音效开，点击关闭' : '音效关，点击打开'} aria-label={soundOn ? '音效开，点击关闭' : '音效关，点击打开'} className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-[#b5c0b6] transition hover:bg-white/10">
              {soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />}
            </button>
            <button type="button" onClick={() => openSidebar('teach')} title="教学提示" aria-label="打开教学提示" className="hidden h-9 w-9 place-items-center rounded-lg border border-white/10 text-[#b5c0b6] transition hover:bg-white/10 sm:grid"><GraduationCap size={18} /></button>
            <button type="button" onClick={() => setSidebarOpen(!sidebarOpen)} aria-expanded={sidebarOpen} aria-controls="table-sidebar" className={`flex h-9 items-center gap-2 rounded-lg border px-2.5 text-xs font-semibold transition sm:px-3 ${sidebarOpen ? 'border-[#d9c16b60] bg-[#d9c16b15] text-[#e5ce80]' : 'border-white/10 text-[#c1cbc2] hover:bg-white/10'}`}>
              <PanelRightOpen size={17} /><span className="hidden sm:inline">对局日志</span><span className="sm:hidden">日志</span>
            </button>
            <button type="button" onClick={handleLeave} title="站起离开" className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-xs font-semibold text-[#b9c0b9] transition hover:bg-[#a84c4220] hover:text-[#e79c8d] sm:px-3"><LogOut size={16} /><span className="hidden md:inline">离开</span></button>
          </div>
        </header>

        <TableFelt
          players={players}
          stage={stage}
          pot={pot}
          board={board}
          bigBlind={table.bigBlind}
          buttonIndex={buttonIndex}
          currentPlayerIndex={currentPlayerIndex}
          streetActions={streetActions}
          payouts={settledHand?.payouts ?? []}
        />

        {/* 底部操作面板 */}
        <div className="relative z-30 flex shrink-0 justify-center bg-gradient-to-t from-[#07140d] to-[#0b281a] px-2 py-3 sm:px-4 sm:py-4">
          {stage === 'idle' || stage === 'showdown' ? (
            <div className="control-dock flex w-full max-w-lg flex-wrap items-center justify-center gap-2 p-2.5 sm:gap-3 sm:p-3">
              <div className="mr-auto hidden pl-2 sm:block"><div className="text-[10px] text-[#738176]">你的手牌已准备好</div><div className="mt-0.5 text-xs font-bold text-[#344b3b]">{stage === 'showdown' ? '本手已结束' : '开始一手新的练习'}</div></div>
              <button onClick={() => latestHand && setManualReviewId(latestHand.id)} disabled={!latestHand} className="action-btn action-neutral">本手回顾</button>
              <button onClick={handleDealClick} className={`action-btn px-7 text-sm ${human && human.chips === 0 ? 'action-allin' : 'action-raise'}`}>
                {stage === 'showdown' ? (human && human.chips === 0 ? `重新买入 $${table.buyIn}` : '下一手') : '开始游戏'}
              </button>
            </div>
          ) : showRaisePanel && human && isHumanTurnNow ? (
            /* 加注尺寸面板：滑杆 + 快捷尺寸 + 确认/取消 */
            <div className="control-dock thin-scroll flex max-h-[42dvh] w-full max-w-xl flex-col items-center gap-2 overflow-y-auto p-3">
              <div className="flex items-baseline gap-2">
                <span className="text-sm text-[#5a685d]">{verb}到</span>
                <span className="text-2xl font-bold text-[#765f24]">${raiseText === '' ? '—' : raiseText}</span>
                <span className="text-xs text-[#7c867e]">(再投入 {addedPreview == null ? '—' : `$${addedPreview}`})</span>
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
                className="w-full accent-[#597f4d] disabled:opacity-40"
              />
              <div className="-mt-1 flex w-full justify-between text-[10px] text-[#7d877e]">
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
                      raiseText === String(shortcut.raiseTo) ? 'size-btn active' : 'size-btn hover:brightness-110'
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
                className="w-32 rounded border border-[#b9c2b8] bg-white px-2 py-1.5 text-center text-sm text-[#27382c]"
              />
              {raiseError && <p className="text-red-400 text-xs text-center">{raiseError}</p>}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => {
                    setShowRaisePanel(false);
                    setRaiseError(null);
                  }}
                  className="action-btn action-neutral"
                >
                  取消
                </button>
                <button
                  onClick={handleRaiseConfirm}
                  className="action-btn action-raise"
                >
                  确认{verb} {raiseText}
                </button>
              </div>
            </div>
          ) : (
            <div className="control-dock flex w-full max-w-2xl flex-col items-center gap-2 p-2.5 sm:p-3">
              <div className="flex w-full items-center justify-between gap-2 px-1">
                <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${isHumanTurn ? 'text-[#477544]' : 'text-[#778079]'}`}><span className={`h-1.5 w-1.5 rounded-full ${isHumanTurn ? 'bg-[#5c914c]' : 'bg-[#9ca49d]'}`} />{isHumanTurn ? '轮到你行动' : '等待其他玩家'}</span>
                <span className="truncate text-right text-[10px] text-[#788178]">{isHumanTurn && quote && quote.toCall > 0 ? quote.label : effective != null ? `有效 ${stackText(effective, table.bigBlind)}${humanRole ? ` · ${humanRole}` : ''}` : '观察牌桌，等待行动'}</span>
              </div>
              <div className="grid w-full grid-cols-4 gap-1.5 sm:gap-2">
                <button onClick={() => playerFold()} disabled={!isHumanTurn} className="action-btn action-fold px-1 sm:px-4"><span className="sm:hidden">弃牌</span><span className="hidden sm:inline">弃牌 Fold</span></button>
                {currentMaxBet === (human?.currentBet || 0) ? (
                  <button onClick={() => playerCheck()} disabled={!isHumanTurn} className="action-btn action-call px-1 sm:px-4"><span className="sm:hidden">过牌</span><span className="hidden sm:inline">过牌 Check</span></button>
                ) : (
                  <button onClick={() => playerCall()} disabled={!isHumanTurn} className="action-btn action-call px-1 sm:px-4">跟注 ${quote?.callCost ?? amountToCall}</button>
                )}
                <button onClick={openRaisePanel} disabled={!isHumanTurn || !human?.canRaise} className="action-btn action-raise px-1 sm:px-4">{verb}</button>
                <button onClick={() => setShowAllInModal(true)} disabled={!isHumanTurn || (human && human.chips === 0) || !human?.canRaise} className="action-btn action-allin px-1 sm:px-4">All-in</button>
              </div>
            </div>
          )}
        </div>

      </main>

      {sidebarOpen && <button type="button" aria-label="关闭侧边栏" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] lg:hidden" />}
      <aside id="table-sidebar" aria-label="对局辅助侧栏" className={`${sidebarOpen ? 'fixed inset-y-0 right-0 z-50 flex w-[min(88vw,360px)]' : 'hidden'} side-panel min-h-0 flex-col lg:static lg:z-20 lg:h-full lg:w-[clamp(280px,23vw,350px)] lg:shrink-0`}>
        <div className="flex h-[68px] shrink-0 items-center justify-between border-b border-white/10 px-4 lg:h-[74px]">
          <div><div className="text-sm font-bold text-[#ece9df]">牌桌助手</div><div className="mt-1 text-[10px] text-[#7f9084]">记录行动，也记录进步</div></div>
          <button type="button" onClick={() => setSidebarOpen(false)} aria-label="收起日志" className="grid h-9 w-9 place-items-center rounded-lg text-[#9ba99f] hover:bg-white/10"><X size={19} /></button>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-1 p-3">
          <button type="button" onClick={() => setSideTab('log')} className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold ${sideTab === 'log' ? 'bg-[#d9c16b18] text-[#e5cd7d]' : 'text-[#86958a] hover:bg-white/5'}`}><ScrollText size={15} />对局日志</button>
          <button type="button" onClick={() => setSideTab('teach')} className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold ${sideTab === 'teach' ? 'bg-[#d9c16b18] text-[#e5cd7d]' : 'text-[#86958a] hover:bg-white/5'}`}><GraduationCap size={16} />教学提示</button>
        </div>
        {sideTab === 'log' ? (
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
            <div className="mb-2 flex items-center justify-between text-[10px] text-[#738278]"><span>实时记录</span><span>{gameLog.length} 条</span></div>
            <div ref={logBoxRef} className="thin-scroll flex-1 overflow-y-auto pr-1 font-mono text-xs text-[#a7b4a9]">
              {gameLog.length === 0 && <div className="mt-16 text-center text-[#617067]">等待游戏开始...</div>}
              {gameLog.map((log, i) => <div key={i} className={`log-line ${log.includes('---') ? 'font-bold text-[#8eafbd]' : ''} ${log.includes('赢') ? 'font-bold text-[#e0c471]' : ''}`}>{log}</div>)}
            </div>
            <div className="mt-3 rounded-lg border border-white/5 bg-black/15 p-3 text-[10px] leading-relaxed text-[#6f8074]">日志仅展示公开行动，不会透露其他玩家的底牌。</div>
          </div>
        ) : (
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-3"><TeachingPanel humanCards={human?.cards || []} boardCards={board} role={humanRole} raiseCount={raiseCount} /></div>
        )}
      </aside>

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
