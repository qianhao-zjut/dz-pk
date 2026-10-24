import { create } from 'zustand';
import { emptyLive, liveTurnFrom } from '../ai/executor';
import type { NpcActionContext } from '../ai/npcContext';
import { toNpcSource } from '../ai/observation';
import { profileFor } from '../ai/profiles';
import { getNpcLimits, invalidateNpcRuntime, npcDecisionRng, npcYieldBetweenBatches, runNpcDecision } from '../ai/runtime';
import type { PublicAction } from '../ai/types';
import { isBettingStage } from '../ai/types';
import { isPayableChipAmount } from '../game/chipAmount';
import { handId, type LiveHand, type PotPayout, type RecordedAction } from '../game/handRecord';
import { seatRole } from '../game/positions';
import { sessionFromTable } from '../game/sessionConfig';
import { raiseVerb } from '../game/shortcuts';
import type { Card } from '../utils/poker';
import { createDeck, shuffleDeck, compareHands, handNameCN } from '../utils/poker';
import type { TableConfig } from '../components/Lobby';
import { useHandHistoryStore } from './handHistoryStore';

export type GameStage = 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type PlayerStatus = 'active' | 'folded' | 'all-in' | 'sitting-out';

export interface Player {
  id: string;
  name: string;
  isAI: boolean;
  profileId?: string;
  chips: number;
  cards: Card[];
  currentBet: number;
  // 本手累计投入（盲注 + 各街下注）。新手清零，换街不清
  invested: number;
  status: PlayerStatus;
  hasActed: boolean;
  // 当前是否允许加注（面对不完整 All-in 时，已行动过的玩家只能跟注/弃牌）
  canRaise: boolean;
}

interface GameState {
  // Config
  table: TableConfig | null;
  
  // State
  stage: GameStage;
  pot: number;
  board: Card[];
  deck: Card[];
  
  players: Player[];
  dealerIndex: number;
  /** 本手按钮。结算时 dealerIndex 会提前轮到下一手，展示和回顾用这个。 */
  handDealerIndex: number;
  liveHand: LiveHand | null;
  currentPlayerIndex: number;
  currentMaxBet: number;
  // 上一次完整加注的增量（决定最小加注额 = currentMaxBet + lastRaiseSize）
  // 每街重置为大盲；翻前初始化为大盲（首次加注至少 2BB）
  lastRaiseSize: number;
  
  // History/Log for teaching purposes
  gameLog: string[];
  // 手牌编号（每 startHand 递增，仅用于日志标注，不保存历史）
  handNumber: number;
  // 入座会话 id（joinTable 时生成）。日志推送以此区分会话：handNumber 每次入座会重置，
  // 必须 sessionId + handNumber 才能全局唯一地定位一手牌
  sessionId: string | null;
  // 单调递增。影响决策的牌局变化都加一；只追加日志不加。
  decisionRevision: number;
  // 本手公开动作。换街保留并带街标记，新手重置。不含底牌。
  streetActions: PublicAction[];

  // Actions
  joinTable: (table: TableConfig, humanBuyIn: number) => void;
  leaveTable: () => number; // returns chips to bankroll
  startHand: () => void;
  
  // Player actions
  playerFold: (npc?: NpcActionContext) => void;
  playerCall: (npc?: NpcActionContext) => void;
  playerCheck: (npc?: NpcActionContext) => void;
  playerRaise: (totalBetAmount: number, npc?: NpcActionContext) => boolean;
  
  // Internal engine
  advanceTurn: () => void;
  advanceStage: () => void;
  handleShowdown: () => void;
  logAction: (msg: string) => void;
  actAI: () => Promise<void>;
  rebuy: (playerId: string, amount: number) => void;
}

export const useGameStore = create<GameState>((set, get) => {
  const commit = (partial: Partial<GameState>) => {
    set({ ...partial, decisionRevision: get().decisionRevision + 1 });
  };
  const note = (action: PublicAction | null, partial: Partial<GameState>) => {
    commit({
      ...partial,
      streetActions: action ? [...get().streetActions, action] : get().streetActions,
    });
  };
  const record = (
    kind: RecordedAction['kind'],
    actor: Player,
    extra: {
      amountAdded: number;
      raiseTo: number | null;
      raiseIncrement: number | null;
      allIn: boolean;
      npc?: NpcActionContext;
    },
  ) => {
    const live = get().liveHand;
    const stage = get().stage;
    if (!live || !isBettingStage(stage)) return;
    const toCall = Math.max(0, get().currentMaxBet - actor.currentBet);
    live.actions.push({
      actionSeq: live.actions.length + 1,
      actorId: actor.id,
      street: stage,
      kind,
      board: [...get().board],
      potBefore: get().pot,
      currentBetBefore: actor.currentBet,
      currentMaxBetBefore: get().currentMaxBet,
      callCost: Math.min(Math.max(0, actor.chips), toCall),
      amountAdded: extra.amountAdded,
      raiseTo: extra.raiseTo,
      raiseIncrement: extra.raiseIncrement,
      allIn: extra.allIn,
      npc: extra.npc ? { ...extra.npc, assumptions: [...extra.npc.assumptions] } : null,
    });
  };

  return {
  table: null,
  stage: 'idle',
  pot: 0,
  board: [],
  deck: [],
  players: [],
  dealerIndex: 0,
  handDealerIndex: 0,
  liveHand: null,
  currentPlayerIndex: -1,
  currentMaxBet: 0,
  lastRaiseSize: 0,
  gameLog: [],
  handNumber: 0,
  sessionId: null,
  decisionRevision: 0,
  streetActions: [],

  logAction: (msg: string) => {
    set((state) => ({ gameLog: [...state.gameLog, msg] }));
  },

  joinTable: (table: TableConfig, humanBuyIn: number) => {
    invalidateNpcRuntime();
    useHandHistoryStore.getState().cancelPending();
    const session = sessionFromTable({ ...table, buyIn: humanBuyIn });
    const newPlayers: Player[] = [
      { id: 'human', name: '你 (Player)', isAI: false, chips: humanBuyIn, cards: [], currentBet: 0, invested: 0, status: 'active', hasActed: false, canRaise: true },
    ];
    session.npcs.forEach((npc) => {
      newPlayers.push({
        id: npc.id,
        name: npc.name,
        isAI: true,
        profileId: npc.profileId,
        chips: humanBuyIn,
        cards: [],
        currentBet: 0,
        invested: 0,
        status: 'active',
        hasActed: false,
        canRaise: true,
      });
    });

    commit({
      table: { ...table, buyIn: humanBuyIn, scenarioId: session.scenarioId, buyInBb: session.buyInBb, opponents: session.opponents, npcs: session.npcs },
      players: newPlayers,
      dealerIndex: 0,
      handDealerIndex: 0,
      liveHand: null,
      stage: 'idle',
      handNumber: 0,
      sessionId: new Date().toISOString(),
      streetActions: [],
      gameLog: [`你坐下了 ${table.name} 牌桌，买入 $${humanBuyIn}`]
    });
  },

  leaveTable: () => {
    invalidateNpcRuntime();
    useHandHistoryStore.getState().cancelPending();
    const { players } = get();
    const human = players.find(p => p.id === 'human');
    const returnedChips = human ? human.chips : 0;
    
    commit({
      table: null,
      stage: 'idle',
      players: [],
      pot: 0,
      board: [],
      handNumber: 0,
      handDealerIndex: 0,
      liveHand: null,
      sessionId: null,
      streetActions: [],
      gameLog: []
    });
    
    return returnedChips;
  },

  startHand: () => {
    invalidateNpcRuntime();
    useHandHistoryStore.getState().cancelPending();
    const { players, dealerIndex, table, handNumber, sessionId } = get();
    if (!table) return;
    const activeSession = sessionId ?? new Date().toISOString();

    const deck = shuffleDeck(createDeck());
    // 重买日志先收集到局部数组，避免被下面的 gameLog 重置吞掉
    const rebuyLogs: string[] = [];
    const updatedPlayers = players.map(p => {
      // AI 破产自动重买
      let chips = p.chips;
      if (p.isAI && chips === 0) {
        chips = table.buyIn;
        rebuyLogs.push(`${p.name} 自动重新买入 $${chips}`);
      }
      return {
        ...p,
        chips,
        cards: [] as Card[],
        currentBet: 0,
        invested: 0,
        status: chips > 0 ? 'active' : 'sitting-out' as PlayerStatus,
        hasActed: false,
        canRaise: true
      };
    });

    // 发牌 (每人2张)
    for (let i = 0; i < 2; i++) {
      updatedPlayers.forEach(p => {
        if (p.status === 'active') {
          p.cards.push(deck.pop()!);
        }
      });
    }

    // 盲注逻辑 (简化处理，假设4人都在)
    const sbIndex = (dealerIndex + 1) % updatedPlayers.length;
    const bbIndex = (dealerIndex + 2) % updatedPlayers.length;
    const chipsBefore = updatedPlayers.map((player) => player.chips);
    let pot = 0;

    const postBlind = (index: number, amount: number) => {
      const player = updatedPlayers[index];
      player.chips -= amount;
      player.currentBet = amount;
      player.invested += amount;
      if (amount > 0 && player.chips === 0) {
        player.status = 'all-in';
      }
    };

    const sbAmount = Math.min(updatedPlayers[sbIndex].chips, table.smallBlind);
    postBlind(sbIndex, sbAmount);
    pot += sbAmount;

    const bbAmount = Math.min(updatedPlayers[bbIndex].chips, table.bigBlind);
    postBlind(bbIndex, bbAmount);
    pot += bbAmount;

    // 枪口下(UTG)先行动；已经全下的盲注位不再轮到
    let utgIndex = (dealerIndex + 3) % updatedPlayers.length;
    let seek = 0;
    while (updatedPlayers[utgIndex].status !== 'active' && seek < updatedPlayers.length) {
      utgIndex = (utgIndex + 1) % updatedPlayers.length;
      seek++;
    }

    // 日志素材：带入筹码（盲注已扣，故加回 currentBet）、人类底牌
    const human = updatedPlayers.find(p => p.id === 'human');
    const stacksInfo = updatedPlayers
      .filter(p => p.status !== 'sitting-out')
      .map(p => `${p.name} $${p.chips + p.currentBet}`)
      .join(' / ');
    const blindAction = (index: number, amount: number, potBefore: number, seq: number): RecordedAction => ({
      actionSeq: seq,
      actorId: updatedPlayers[index].id,
      street: 'preflop',
      kind: 'post',
      board: [],
      potBefore,
      currentBetBefore: 0,
      currentMaxBetBefore: 0,
      callCost: 0,
      amountAdded: amount,
      raiseTo: amount,
      raiseIncrement: null,
      allIn: updatedPlayers[index].status === 'all-in',
      npc: null,
    });
    const liveHand: LiveHand = {
      sessionId: activeSession,
      handNumber: handNumber + 1,
      startedAt: new Date().toISOString(),
      config: sessionFromTable(table),
      dealerIndex,
      seats: updatedPlayers.map((player, seat) => ({
        id: player.id,
        name: player.name,
        profileId: player.profileId ?? null,
        style: player.profileId ? profileFor(player.profileId).label : null,
        role: seatRole(seat, dealerIndex, updatedPlayers.length),
        chipsBefore: chipsBefore[seat],
        holeCards: [...player.cards],
      })),
      actions: [
        blindAction(sbIndex, sbAmount, 0, 1),
        blindAction(bbIndex, bbAmount, sbAmount, 2),
      ],
    };

    commit({
      stage: 'preflop',
      deck,
      board: [],
      players: updatedPlayers,
      pot,
      handDealerIndex: dealerIndex,
      liveHand,
      // 要跟的注是实际盲注里较大的那个；短码不足一个大盲时不能把最高注抬到大盲
      currentMaxBet: Math.max(sbAmount, bbAmount),
      lastRaiseSize: table.bigBlind,
      currentPlayerIndex: utgIndex,
      handNumber: handNumber + 1,
      sessionId: activeSession,
      streetActions: [
        { actorId: updatedPlayers[sbIndex].id, stage: 'preflop', kind: 'post', to: sbAmount },
        { actorId: updatedPlayers[bbIndex].id, stage: 'preflop', kind: 'post', to: bbAmount },
      ],
      gameLog: [
        `--- 第 ${handNumber + 1} 手牌开始 (庄家: ${updatedPlayers[dealerIndex].name}) ---`,
        ...rebuyLogs,
        `${updatedPlayers[sbIndex].name} 下小盲 $${sbAmount}, ${updatedPlayers[bbIndex].name} 下大盲 $${bbAmount}`,
        `带入筹码: ${stacksInfo}`,
        ...(human && (human.status === 'active' || human.status === 'all-in') ? [`你的底牌: ${human.cards.join(' ')}`] : [])
      ]
    });
  },

  playerFold: (npc) => {
    const { players, currentPlayerIndex, stage } = get();
    const p = players[currentPlayerIndex];
    record('fold', p, { amountAdded: 0, raiseTo: null, raiseIncrement: null, allIn: false, npc });
    
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex] = { ...p, status: 'folded', hasActed: true };
    
    get().logAction(`${p.name} 弃牌 (Fold)`);
    note(isBettingStage(stage) ? { actorId: p.id, stage, kind: 'fold', to: null } : null, { players: newPlayers });
    get().advanceTurn();
  },

  playerCall: (npc) => {
    const { players, currentPlayerIndex, currentMaxBet, pot } = get();
    const p = players[currentPlayerIndex];
    const amountToCall = Math.max(0, currentMaxBet - p.currentBet);
    
    // 如果筹码不够跟注，则是All-in
    const actualCall = Math.min(p.chips, amountToCall);
    record('call', p, { amountAdded: actualCall, raiseTo: null, raiseIncrement: null, allIn: p.chips === actualCall && actualCall > 0, npc });
    
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex] = { ...p, hasActed: true };
    newPlayers[currentPlayerIndex].chips -= actualCall;
    newPlayers[currentPlayerIndex].currentBet += actualCall;
    newPlayers[currentPlayerIndex].invested += actualCall;
    if (newPlayers[currentPlayerIndex].chips === 0) {
      newPlayers[currentPlayerIndex].status = 'all-in';
    }

    const totalBet = newPlayers[currentPlayerIndex].currentBet;
    if (newPlayers[currentPlayerIndex].status === 'all-in') {
      // 筹码全压上的跟注（含不足额跟注），明确标记 All-in，与 playerRaise 路径口径一致
      get().logAction(`${p.name} 全下跟注 (All-in Call) $${actualCall}`);
    } else if (actualCall === totalBet) {
      get().logAction(`${p.name} 跟注 (Call) $${actualCall}`);
    } else {
      get().logAction(`${p.name} 跟注 (Call) $${actualCall} (本轮补齐至 $${totalBet})`);
    }
    const stage = get().stage;
    note(isBettingStage(stage) ? { actorId: p.id, stage, kind: 'call', to: null } : null, {
      players: newPlayers,
      pot: pot + actualCall,
    });
    get().advanceTurn();
  },

  playerCheck: (npc) => {
    const { players, currentPlayerIndex, stage } = get();
    const p = players[currentPlayerIndex];
    record('check', p, { amountAdded: 0, raiseTo: null, raiseIncrement: null, allIn: false, npc });
    
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex] = { ...p, hasActed: true };
    
    get().logAction(`${p.name} 过牌 (Check)`);
    note(isBettingStage(stage) ? { actorId: p.id, stage, kind: 'check', to: null } : null, { players: newPlayers });
    get().advanceTurn();
  },

  playerRaise: (totalBetAmount: number, npc) => {
    // 小数、NaN、无穷、负数和不安全整数在记日志或改状态之前拒绝。合法整数继续走尺寸归一。
    if (!isPayableChipAmount(totalBetAmount)) return false;
    const { players, currentPlayerIndex, pot, currentMaxBet, lastRaiseSize, stage } = get();
    const p = players[currentPlayerIndex];
    if (!p || p.status !== 'active') return false;

    // 目标至少为跟注额；没有加注权限时（面对不完整 All-in 已行动过的玩家）只能跟注
    let target = Math.max(totalBetAmount, currentMaxBet);
    if (!p.canRaise) {
      target = currentMaxBet;
    }
    // 筹码足够最小加注却加得太小 → 钳制到最小加注额（min-raise 规则）
    const fullRaiseTarget = currentMaxBet + lastRaiseSize;
    if (target > currentMaxBet && target < fullRaiseTarget && p.currentBet + p.chips >= fullRaiseTarget) {
      target = fullRaiseTarget;
    }

    const amountToAdd = target - p.currentBet;
    const actualAdd = Math.min(p.chips, Math.max(0, amountToAdd));
    const newBet = p.currentBet + actualAdd;
    const increment = newBet - currentMaxBet;

    const newPlayers = [...players];
    newPlayers[currentPlayerIndex] = { ...p, hasActed: true };
    newPlayers[currentPlayerIndex].chips -= actualAdd;
    newPlayers[currentPlayerIndex].currentBet = newBet;
    newPlayers[currentPlayerIndex].invested += actualAdd;
    if (newPlayers[currentPlayerIndex].chips === 0) {
      newPlayers[currentPlayerIndex].status = 'all-in';
    }
    const isAllIn = newPlayers[currentPlayerIndex].status === 'all-in';
    const verb = isBettingStage(stage) ? raiseVerb(stage, currentMaxBet) : '加注';
    record(increment > 0 ? 'raise' : 'call', p, {
      amountAdded: actualAdd,
      raiseTo: increment > 0 ? newBet : null,
      raiseIncrement: increment > 0 ? increment : null,
      allIn: isAllIn,
      npc,
    });

    // currentMaxBet 只允许单调上升，绝不被小额 All-in 拉低
    let newMaxBet = currentMaxBet;
    let newLastRaiseSize = lastRaiseSize;

    if (increment <= 0) {
      // 实际效果等于跟注（含短码 All-in 跟注），不改变最高下注与最小加注增量
      get().logAction(isAllIn
        ? `${p.name} 全下跟注 $${actualAdd}`
        : `${p.name} 跟注 $${actualAdd}`);
    } else if (increment >= lastRaiseSize) {
      // 完整加注：更新最高下注与最小加注增量，行动对所有玩家重新开放
      newMaxBet = newBet;
      newLastRaiseSize = increment;
      newPlayers.forEach((pl, i) => {
        newPlayers[i] = { ...pl, canRaise: true };
      });
      get().logAction(isAllIn
        ? `${p.name} 全下${verb}到 $${newBet}`
        : `${p.name} ${verb}到 $${newBet}`);
    } else {
      // 不完整 All-in 加注（筹码不足最小加注额）：
      // 大家必须跟到这个数额，但不构成真正加注——
      // 不更新最小加注增量，且本轮已行动过的玩家之后只能跟注/弃牌
      newMaxBet = newBet;
      newPlayers.forEach((pl, i) => {
        if (pl.hasActed && pl.status === 'active') {
          newPlayers[i] = { ...pl, canRaise: false };
        }
      });
      get().logAction(`${p.name} 全下到 $${newBet} (All-in，不足最小加注额，已行动玩家不可再加注)`);
    }

    note(
      isBettingStage(stage)
        ? { actorId: p.id, stage, kind: increment > 0 ? 'raise' : 'call', to: increment > 0 ? newBet : null }
        : null,
      {
        players: newPlayers,
        pot: pot + actualAdd,
        currentMaxBet: newMaxBet,
        lastRaiseSize: newLastRaiseSize,
      },
    );
    get().advanceTurn();
    return true;
  },

  advanceTurn: () => {
    const { players, currentPlayerIndex, currentMaxBet } = get();
    
    const activePlayers = players.filter(p => p.status === 'active');
    const notFoldedPlayers = players.filter(p => p.status !== 'folded');
    
    if (notFoldedPlayers.length === 1) {
       get().advanceStage();
       return;
    }

    // 所有人筹码平齐且都已经行动过，本轮结束
    // 但是如果所有人都 all-in，或者除了一个人 active 其他人都 all-in 了，也直接进入比牌
    const allMatched = activePlayers.every(p => p.currentBet === currentMaxBet && p.hasActed);
    
    if (allMatched || activePlayers.length === 0 || (activePlayers.length === 1 && activePlayers[0].currentBet >= currentMaxBet && activePlayers[0].hasActed)) {
      get().advanceStage();
      return;
    }

    // 寻找下一个需要行动的活跃玩家
    let nextIdx = (currentPlayerIndex + 1) % players.length;
    let loopCount = 0;
    
    while (
      loopCount < players.length &&
      (players[nextIdx].status !== 'active' || 
      (players[nextIdx].hasActed && players[nextIdx].currentBet === currentMaxBet))
    ) {
      nextIdx = (nextIdx + 1) % players.length;
      loopCount++;
    }

    commit({ currentPlayerIndex: nextIdx });
  },

  advanceStage: () => {
    const { stage, deck, board, players, dealerIndex, table } = get();
    const bb = table ? table.bigBlind : 0;
    
    // 收集筹码到底池，重置本轮下注和行动标记
    const newPlayers = players.map(p => ({ ...p, currentBet: 0, hasActed: false, canRaise: true }));
    const newDeck = [...deck];
    const newBoard = [...board];
    let newStage: GameStage = stage;

    const notFolded = newPlayers.filter(p => p.status !== 'folded');
    
    if (notFolded.length === 1) {
      // 只有一人未弃牌，直接获胜
      get().logAction(`${notFolded[0].name} 赢得了底池，其他人已弃牌。`);
      newStage = 'showdown';
      commit({ stage: newStage, players: newPlayers, currentMaxBet: 0, lastRaiseSize: bb });
      get().handleShowdown();
      return;
    }

    // 处理 All-in 的特殊情况：如果只剩0个或1个可以行动的玩家，直接把牌发完进入比牌
    const activeCount = newPlayers.filter(p => p.status === 'active').length;
    if (activeCount <= 1) {
       // 需要将缺失的公共牌全部发齐
       while (newBoard.length < 5) {
         newBoard.push(newDeck.pop()!);
       }
       get().logAction(`玩家 All-in，直接发完公共牌: ${newBoard.join(' ')}`);
       newStage = 'showdown';
       commit({ stage: newStage, players: newPlayers, deck: newDeck, board: newBoard, currentMaxBet: 0, lastRaiseSize: bb });
       get().handleShowdown();
       return;
    }

    if (stage === 'preflop') {
      newStage = 'flop';
      newBoard.push(newDeck.pop()!, newDeck.pop()!, newDeck.pop()!);
      get().logAction(`发翻牌 (Flop): ${newBoard.join(' ')}`);
    } else if (stage === 'flop') {
      newStage = 'turn';
      newBoard.push(newDeck.pop()!);
      get().logAction(`发转牌 (Turn): ${newBoard[3]}`);
    } else if (stage === 'turn') {
      newStage = 'river';
      newBoard.push(newDeck.pop()!);
      get().logAction(`发河牌 (River): ${newBoard[4]}`);
    } else if (stage === 'river') {
      newStage = 'showdown';
    }

    // 确定下注轮的第一个行动者（小盲位开始）
    let nextIdx = (dealerIndex + 1) % players.length;
    let loopCount = 0;
    while (newPlayers[nextIdx].status !== 'active' && loopCount < players.length) {
      nextIdx = (nextIdx + 1) % players.length;
      loopCount++;
    }

    commit({ 
      stage: newStage, 
      deck: newDeck, 
      board: newBoard, 
      players: newPlayers,
      currentMaxBet: 0,
      lastRaiseSize: bb,
      currentPlayerIndex: nextIdx
    });

    if (newStage === 'showdown') {
      get().handleShowdown();
    }
  },

  handleShowdown: () => {
    const { players, board, pot, dealerIndex } = get();
    const inHand = (status: PlayerStatus) => status === 'active' || status === 'all-in';
    const contenders = players.filter(p => inHand(p.status));
    const payouts: PotPayout[] = [];

    const finish = (newPlayers: Player[], potLeft: number) => {
      const live = get().liveHand;
      if (live) {
        try {
          useHandHistoryStore.getState().archive({
            version: 1,
            id: handId(live.sessionId, live.handNumber),
            sessionId: live.sessionId,
            handNumber: live.handNumber,
            startedAt: live.startedAt,
            endedAt: new Date().toISOString(),
            config: live.config,
            dealerIndex: live.dealerIndex,
            seats: live.seats.map((seat) => ({ ...seat, holeCards: [...seat.holeCards] })),
            board: [...board],
            actions: live.actions.map((action) => ({
              ...action,
              board: [...action.board],
              npc: action.npc ? { ...action.npc, assumptions: [...action.npc.assumptions] } : null,
            })),
            payouts: payouts.map((payout) => ({ ...payout })),
            results: newPlayers.map((player) => {
              const before = live.seats.find((seat) => seat.id === player.id)?.chipsBefore ?? player.chips;
              return { id: player.id, chips: player.chips, net: player.chips - before };
            }),
            endKind: contenders.length <= 1 ? 'folds' : 'showdown',
          });
        } catch {
          // 回顾写入失败时牌局仍然结束。
        }
      }
      get().logAction(`本手结束筹码: ${newPlayers.map(p => `${p.name} $${p.chips}`).join(' / ')}`);
      commit({
        players: newPlayers,
        pot: potLeft,
        stage: 'showdown',
        liveHand: null,
        dealerIndex: (dealerIndex + 1) % players.length
      });
    };

    // 只剩一人未弃牌：整池给他，不退未跟注、不切边池
    if (contenders.length <= 1) {
      const newPlayers = players.map(p => ({ ...p }));
      if (contenders.length === 1) {
        const wIdx = newPlayers.findIndex(p => p.id === contenders[0].id);
        newPlayers[wIdx].chips += pot;
        payouts.push({ label: '弃牌赢池', playerId: contenders[0].id, amount: pot, kind: 'win' });
        get().logAction(`${contenders[0].name} 收下底池 $${pot}`);
      }
      finish(newPlayers, contenders.length === 1 ? 0 : pot);
      return;
    }

    contenders.forEach(p => {
      get().logAction(`${p.name} 亮牌 ${p.cards.join(' ')} (${handNameCN([...p.cards, ...board])})`);
    });

    const newPlayers = players.map(p => ({ ...p }));
    let potLeft = pot;
    const contributors = newPlayers.filter(p => p.invested > 0);

    // 只有一个人投过钱：没有次大投入，不走退差额，整池给他
    if (contributors.length < 2) {
      if (contributors.length === 1) {
        const idx = newPlayers.findIndex(p => p.id === contributors[0].id);
        newPlayers[idx].chips += potLeft;
        payouts.push({ label: '底池', playerId: newPlayers[idx].id, amount: potLeft, kind: 'win' });
        get().logAction(`${newPlayers[idx].name} 收下底池 $${potLeft}`);
        potLeft = 0;
      }
      finish(newPlayers, potLeft);
      return;
    }

    const maxInvested = Math.max(...contributors.map(p => p.invested));
    const leaders = contributors.filter(p => p.invested === maxInvested);
    if (leaders.length === 1) {
      const second = Math.max(...contributors.filter(p => p.invested < maxInvested).map(p => p.invested));
      const refund = maxInvested - second;
      const idx = newPlayers.findIndex(p => p.id === leaders[0].id);
      newPlayers[idx].chips += refund;
      newPlayers[idx].invested = second;
      potLeft -= refund;
      payouts.push({ label: '未匹配退还', playerId: newPlayers[idx].id, amount: refund, kind: 'refund' });
      get().logAction(`${newPlayers[idx].name} 收回未跟注 $${refund}`);
    }

    const levels = [...new Set(newPlayers.map(p => p.invested).filter(amount => amount > 0))].sort((a, b) => a - b);
    let prev = 0;
    levels.forEach((level, levelIndex) => {
      const covered = newPlayers.filter(p => p.invested >= level).length;
      const slice = (level - prev) * covered;
      prev = level;
      if (slice <= 0) return;

      const eligible: number[] = [];
      newPlayers.forEach((p, i) => {
        if (inHand(p.status) && p.invested >= level) eligible.push(i);
      });
      if (eligible.length === 0) return;

      let best = [eligible[0]];
      for (let k = 1; k < eligible.length; k++) {
        const idx = eligible[k];
        const cmp = compareHands(
          [...newPlayers[idx].cards, ...board],
          [...newPlayers[best[0]].cards, ...board]
        );
        if (cmp === 1) best = [idx];
        else if (cmp === 0) best.push(idx);
      }

      const base = Math.floor(slice / best.length);
      let extra = slice - base * best.length;
      const gain = new Map<number, number>();
      best.forEach(idx => gain.set(idx, base));
      if (extra > 0) {
        const n = newPlayers.length;
        let seat = (dealerIndex + 1) % n;
        let guard = 0;
        while (extra > 0 && guard < n * best.length) {
          if (gain.has(seat)) {
            gain.set(seat, (gain.get(seat) ?? 0) + 1);
            extra -= 1;
          }
          seat = (seat + 1) % n;
          guard += 1;
        }
      }

      const tier = levels.length > 1 ? `（第 ${levelIndex + 1} 档）` : '';
      [...best].sort((a, b) => a - b).forEach(idx => {
        const got = gain.get(idx) ?? 0;
        if (got <= 0) return;
        newPlayers[idx].chips += got;
        potLeft -= got;
        payouts.push({ label: tier || '底池', playerId: newPlayers[idx].id, amount: got, kind: 'win' });
        const handName = handNameCN([...newPlayers[idx].cards, ...board]);
        get().logAction(`${newPlayers[idx].name} 获胜！以 [${handName}] 赢下 $${got}${tier}`);
      });
    });

    finish(newPlayers, potLeft);
  },

  rebuy: (playerId: string, amount: number) => {
    const { players } = get();
    const newPlayers = [...players];
    const pIdx = newPlayers.findIndex(p => p.id === playerId);
    if (pIdx !== -1) {
      newPlayers[pIdx].chips += amount;
      get().logAction(`${newPlayers[pIdx].name} 重新买入 (Rebuy) $${amount}`);
      commit({ players: newPlayers });
    }
  },

  actAI: () => {
    const state = get();
    const actor = state.players[state.currentPlayerIndex];
    if (!state.table || !actor?.isAI || actor.status !== 'active') return Promise.resolve();
    const view = () => {
      const current = get();
      if (!current.table) return null;
      return toNpcSource({
        sessionId: current.sessionId,
        handNumber: current.handNumber,
        decisionRevision: current.decisionRevision,
        stage: current.stage,
        pot: current.pot,
        board: current.board,
        dealerIndex: current.dealerIndex,
        currentPlayerIndex: current.currentPlayerIndex,
        currentMaxBet: current.currentMaxBet,
        lastRaiseSize: current.lastRaiseSize,
        bigBlind: current.table.bigBlind,
        players: current.players,
        streetActions: current.streetActions,
        deck: current.deck,
        gameLog: current.gameLog,
      });
    };
    const source = view();
    if (!source) return Promise.resolve();
    const runtimeLimits = getNpcLimits();
    return runNpcDecision({
      source,
      readLive: () => {
        const liveSource = view();
        return liveSource ? liveTurnFrom(liveSource) : emptyLive();
      },
      actions: {
        fold: (ctx) => get().playerFold(ctx),
        check: (ctx) => get().playerCheck(ctx),
        call: (ctx) => get().playerCall(ctx),
        raise: (raiseTo, ctx) => get().playerRaise(raiseTo, ctx),
      },
      profile: profileFor(actor.profileId ?? actor.id),
      options: {
        samples: runtimeLimits.samples,
        timeBudgetMs: runtimeLimits.timeBudgetMs,
        batchSize: runtimeLimits.batchSize,
        overallTimeoutMs: runtimeLimits.overallTimeoutMs,
        yieldBetweenBatches: npcYieldBetweenBatches(),
        rng: npcDecisionRng(),
        sampleRng: npcDecisionRng(),
      },
    }).then(() => undefined);
  },

}; });
