import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { handId, isCompletedHand, type CompletedHand } from '../game/handRecord';

const memory = new Map<string, string>();

export const handHistoryStorage = {
  getItem: (name: string): string | null => {
    try {
      if (typeof localStorage === 'undefined') return memory.get(name) ?? null;
      return localStorage.getItem(name);
    } catch {
      return memory.get(name) ?? null;
    }
  },
  setItem: (name: string, value: string) => {
    memory.set(name, value);
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(name, value);
    } catch {
      // 存储满或不可写时保留本次会话的内存档案。
    }
  },
  removeItem: (name: string) => {
    memory.delete(name);
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(name);
    } catch {
      // 忽略不可写。
    }
  },
};

interface HandHistoryState {
  hands: CompletedHand[];
  autoOpenReview: boolean;
  /** 只存在内存里。刷新后为空，所以不会补弹已经结束的手牌。 */
  pendingAutoOpenId: string | null;
  archive: (hand: CompletedHand) => void;
  setAutoOpenReview: (value: boolean) => void;
  consumeAutoOpen: (id: string) => void;
  cancelPending: () => void;
}

const opened = new Set<string>();

export const useHandHistoryStore = create<HandHistoryState>()(
  persist(
    (set, get) => ({
      hands: [],
      autoOpenReview: false,
      pendingAutoOpenId: null,
      archive: (hand) => {
        const id = hand.id || handId(hand.sessionId, hand.handNumber);
        const stored = { ...hand, id };
        const exists = get().hands.some((item) => item.id === id);
        if (!exists) {
          const hands = [...get().hands, stored].slice(-20);
          const pendingAutoOpenId = get().autoOpenReview && !opened.has(id) ? id : get().pendingAutoOpenId;
          if (pendingAutoOpenId === id) opened.add(id);
          set({ hands, pendingAutoOpenId });
          return;
        }
        set({ hands: get().hands.map((item) => (item.id === id ? stored : item)) });
      },
      setAutoOpenReview: (value) => set({ autoOpenReview: value }),
      consumeAutoOpen: (id) => {
        if (get().pendingAutoOpenId === id) set({ pendingAutoOpenId: null });
      },
      cancelPending: () => set({ pendingAutoOpenId: null }),
    }),
    {
      name: 'dz-pk-hand-history',
      version: 1,
      storage: createJSONStorage(() => handHistoryStorage),
      partialize: (state) => ({ hands: state.hands, autoOpenReview: state.autoOpenReview }),
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== 'object') return { ...current, pendingAutoOpenId: null };
        const data = persisted as { hands?: unknown; autoOpenReview?: unknown };
        const hands = Array.isArray(data.hands) ? data.hands.filter(isCompletedHand).slice(-20) : [];
        return {
          ...current,
          hands,
          autoOpenReview: data.autoOpenReview === true,
          pendingAutoOpenId: null,
        };
      },
    },
  ),
);

export function resetHandHistoryForTests(): void {
  opened.clear();
  memory.clear();
  useHandHistoryStore.setState({ hands: [], autoOpenReview: false, pendingAutoOpenId: null });
}
