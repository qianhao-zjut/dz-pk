import { create } from 'zustand';
import type { Card } from '../utils/poker';
import { createDeck, shuffleDeck, compareHands } from '../utils/poker';
import type { TableConfig } from '../components/Lobby';

export type GameStage = 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type PlayerStatus = 'active' | 'folded' | 'all-in' | 'sitting-out';

export interface Player {
  id: string;
  name: string;
  isAI: boolean;
  chips: number;
  cards: Card[];
  currentBet: number;
  status: PlayerStatus;
  hasActed: boolean;
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
  currentPlayerIndex: number;
  currentMaxBet: number;
  
  // History/Log for teaching purposes
  gameLog: string[];

  // Actions
  joinTable: (table: TableConfig, humanBuyIn: number) => void;
  leaveTable: () => number; // returns chips to bankroll
  startHand: () => void;
  
  // Player actions
  playerFold: () => void;
  playerCall: () => void;
  playerCheck: () => void;
  playerRaise: (totalBetAmount: number) => void;
  
  // Internal engine
  advanceTurn: () => void;
  advanceStage: () => void;
  handleShowdown: () => void;
  logAction: (msg: string) => void;
  actAI: () => void;
  rebuy: (playerId: string, amount: number) => void;
}

const STARTING_AI_NAMES = ['德州老手', '激进小伙', '保守大叔'];

export const useGameStore = create<GameState>((set, get) => ({
  table: null,
  stage: 'idle',
  pot: 0,
  board: [],
  deck: [],
  players: [],
  dealerIndex: 0,
  currentPlayerIndex: -1,
  currentMaxBet: 0,
  gameLog: [],

  logAction: (msg: string) => {
    set((state) => ({ gameLog: [...state.gameLog, msg] }));
  },

  joinTable: (table: TableConfig, humanBuyIn: number) => {
    // 初始化玩家（1名人类 + 3名AI）
    const newPlayers: Player[] = [
      { id: 'human', name: '你 (Player)', isAI: false, chips: humanBuyIn, cards: [], currentBet: 0, status: 'active', hasActed: false },
    ];
    
    // 给AI加上和桌子标准买入相近的筹码
    STARTING_AI_NAMES.forEach((name, i) => {
      newPlayers.push({
        id: `ai_${i}`,
        name,
        isAI: true,
        chips: table.buyIn,
        cards: [],
        currentBet: 0,
        status: 'active',
        hasActed: false
      });
    });

    set({
      table,
      players: newPlayers,
      dealerIndex: 0,
      stage: 'idle',
      gameLog: [`你坐下了 ${table.name} 牌桌，买入 $${humanBuyIn}`]
    });
  },

  leaveTable: () => {
    const { players } = get();
    const human = players.find(p => p.id === 'human');
    const returnedChips = human ? human.chips : 0;
    
    set({
      table: null,
      stage: 'idle',
      players: [],
      pot: 0,
      board: [],
      gameLog: []
    });
    
    return returnedChips;
  },

  startHand: () => {
    const { players, dealerIndex, table } = get();
    if (!table) return;

    let deck = shuffleDeck(createDeck());
    const updatedPlayers = players.map(p => {
      // AI 破产自动重买
      let chips = p.chips;
      if (p.isAI && chips === 0) {
        chips = table.buyIn;
        get().logAction(`${p.name} 自动重新买入 $${chips}`);
      }
      return {
        ...p,
        chips,
        cards: [] as Card[],
        currentBet: 0,
        status: chips > 0 ? 'active' : 'sitting-out' as PlayerStatus,
        hasActed: false
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
    let pot = 0;

    const sbAmount = Math.min(updatedPlayers[sbIndex].chips, table.smallBlind);
    updatedPlayers[sbIndex].chips -= sbAmount;
    updatedPlayers[sbIndex].currentBet = sbAmount;
    pot += sbAmount;

    const bbAmount = Math.min(updatedPlayers[bbIndex].chips, table.bigBlind);
    updatedPlayers[bbIndex].chips -= bbAmount;
    updatedPlayers[bbIndex].currentBet = bbAmount;
    pot += bbAmount;

    // 枪口下(UTG)先行动
    const utgIndex = (dealerIndex + 3) % updatedPlayers.length;

    set({
      stage: 'preflop',
      deck,
      board: [],
      players: updatedPlayers,
      pot,
      currentMaxBet: table.bigBlind,
      currentPlayerIndex: utgIndex,
      gameLog: ['--- 新的一手牌开始 ---', `小盲注下注 $${sbAmount}, 大盲注下注 $${bbAmount}`]
    });
  },

  playerFold: () => {
    const { players, currentPlayerIndex } = get();
    const p = players[currentPlayerIndex];
    
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex] = { ...p, status: 'folded', hasActed: true };
    
    get().logAction(`${p.name} 弃牌 (Fold)`);
    set({ players: newPlayers });
    get().advanceTurn();
  },

  playerCall: () => {
    const { players, currentPlayerIndex, currentMaxBet, pot } = get();
    const p = players[currentPlayerIndex];
    const amountToCall = currentMaxBet - p.currentBet;
    
    // 如果筹码不够跟注，则是All-in
    const actualCall = Math.min(p.chips, amountToCall);
    
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex] = { ...p, hasActed: true };
    newPlayers[currentPlayerIndex].chips -= actualCall;
    newPlayers[currentPlayerIndex].currentBet += actualCall;
    if (newPlayers[currentPlayerIndex].chips === 0) {
      newPlayers[currentPlayerIndex].status = 'all-in';
    }

    const totalBet = newPlayers[currentPlayerIndex].currentBet;
    if (actualCall === totalBet) {
      get().logAction(`${p.name} 跟注 (Call) $${actualCall}`);
    } else {
      get().logAction(`${p.name} 跟注 (Call) $${actualCall} (本轮补齐至 $${totalBet})`);
    }
    set({ players: newPlayers, pot: pot + actualCall });
    get().advanceTurn();
  },

  playerCheck: () => {
    const { players, currentPlayerIndex } = get();
    const p = players[currentPlayerIndex];
    
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex] = { ...p, hasActed: true };
    
    get().logAction(`${p.name} 过牌 (Check)`);
    set({ players: newPlayers });
    get().advanceTurn();
  },

  playerRaise: (totalBetAmount: number) => {
    const { players, currentPlayerIndex, pot } = get();
    const p = players[currentPlayerIndex];
    const amountToAdd = totalBetAmount - p.currentBet;
    
    const actualAdd = Math.min(p.chips, amountToAdd);
    
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex] = { ...p, hasActed: true };
    newPlayers[currentPlayerIndex].chips -= actualAdd;
    newPlayers[currentPlayerIndex].currentBet += actualAdd;
    
    if (newPlayers[currentPlayerIndex].chips === 0) {
      newPlayers[currentPlayerIndex].status = 'all-in';
    }

    get().logAction(`${p.name} 加注 (Raise) 到 $${newPlayers[currentPlayerIndex].currentBet}`);
    set({ 
      players: newPlayers, 
      pot: pot + actualAdd,
      currentMaxBet: newPlayers[currentPlayerIndex].currentBet
    });
    get().advanceTurn();
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

    set({ currentPlayerIndex: nextIdx });
  },

  advanceStage: () => {
    const { stage, deck, board, players, dealerIndex } = get();
    
    // 收集筹码到底池，重置本轮下注和行动标记
    const newPlayers = players.map(p => ({ ...p, currentBet: 0, hasActed: false }));
    let newDeck = [...deck];
    let newBoard = [...board];
    let newStage: GameStage = stage;

    const notFolded = newPlayers.filter(p => p.status !== 'folded');
    
    if (notFolded.length === 1) {
      // 只有一人未弃牌，直接获胜
      get().logAction(`${notFolded[0].name} 赢得了底池，其他人已弃牌。`);
      newStage = 'showdown';
      set({ stage: newStage, players: newPlayers, currentMaxBet: 0 });
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
       set({ stage: newStage, players: newPlayers, deck: newDeck, board: newBoard, currentMaxBet: 0 });
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

    set({ 
      stage: newStage, 
      deck: newDeck, 
      board: newBoard, 
      players: newPlayers,
      currentMaxBet: 0,
      currentPlayerIndex: nextIdx
    });

    if (newStage === 'showdown') {
      get().handleShowdown();
    }
  },

  handleShowdown: () => {
    const { players, board, pot, dealerIndex } = get();
    const candidates = players.filter(p => p.status !== 'folded');
    
    if (candidates.length === 1) {
      // 对手全弃牌
      const winner = candidates[0];
      const newPlayers = [...players];
      const wIdx = newPlayers.findIndex(p => p.id === winner.id);
      newPlayers[wIdx].chips += pot;
      get().logAction(`${winner.name} 收下底池 $${pot}`);
      set({ players: newPlayers, pot: 0, stage: 'showdown', dealerIndex: (dealerIndex + 1) % players.length });
      return;
    }

    // 比较牌型大小
    let bestPlayers: Player[] = [];
    
    // 这里做最简单的比较（不支持边池边算，一次性全分配给赢家）
    candidates.forEach(p => {
      if (bestPlayers.length === 0) {
        bestPlayers.push(p);
      } else {
        const cmp = compareHands([...p.cards, ...board], [...bestPlayers[0].cards, ...board]);
        if (cmp === 1) {
          bestPlayers = [p];
        } else if (cmp === 0) {
          bestPlayers.push(p);
        }
      }
    });

    const newPlayers = [...players];
    const winAmount = Math.floor(pot / bestPlayers.length);
    
    bestPlayers.forEach(winner => {
      const wIdx = newPlayers.findIndex(p => p.id === winner.id);
      newPlayers[wIdx].chips += winAmount;
      get().logAction(`${winner.name} 获胜！赢下 $${winAmount}`);
    });

    set({ players: newPlayers, pot: 0, stage: 'showdown', dealerIndex: (dealerIndex + 1) % players.length });
  },

  rebuy: (playerId: string, amount: number) => {
    const { players } = get();
    const newPlayers = [...players];
    const pIdx = newPlayers.findIndex(p => p.id === playerId);
    if (pIdx !== -1) {
      newPlayers[pIdx].chips += amount;
      get().logAction(`${newPlayers[pIdx].name} 重新买入 (Rebuy) $${amount}`);
      set({ players: newPlayers });
    }
  },

  actAI: () => {
    const { players, currentPlayerIndex, currentMaxBet } = get();
    const p = players[currentPlayerIndex];
    if (!p || !p.isAI || p.status !== 'active') return;

    const amountToCall = currentMaxBet - p.currentBet;
    
    // 极简AI决策逻辑
    const rand = Math.random();
    
    if (amountToCall === 0) {
      // 没人加注
      if (rand < 0.2) {
        // 20% 概率加注 (简单固定加注当前底池的3盲注)
        const { table } = get();
        get().playerRaise(currentMaxBet + (table ? table.bigBlind * 3 : 0));
      } else {
        // 80% 过牌
        get().playerCheck();
      }
    } else {
      // 有人加注了
      if (rand < 0.4) {
        // 40% 弃牌
        get().playerFold();
      } else if (rand < 0.9) {
        // 50% 跟注
        get().playerCall();
      } else {
        // 10% 反加
        const { table } = get();
        get().playerRaise(currentMaxBet + (table ? table.bigBlind * 3 : 0));
      }
    }
  }

}));
