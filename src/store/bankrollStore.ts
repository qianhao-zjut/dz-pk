import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface BankrollState {
  balance: number;
  addFunds: (amount: number) => void;
  deductFunds: (amount: number) => boolean;
  resetBankroll: () => void;
  setBankroll: (amount: number) => void;
  initBankroll: (amount: number) => void;
}

export const INITIAL_BANKROLL = 10000;

const saveToDisk = async (balance: number) => {
  try {
    await fetch('/api/bankroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ balance })
    });
  } catch (e) {
    console.error('Failed to save bankroll to disk', e);
  }
};

export const useBankrollStore = create<BankrollState>()(
  persist(
    (set, get) => ({
      balance: INITIAL_BANKROLL,
      initBankroll: (amount: number) => set({ balance: amount }),
      addFunds: (amount: number) => {
        const newBalance = get().balance + amount;
        set({ balance: newBalance });
        saveToDisk(newBalance);
      },
      deductFunds: (amount: number) => {
        const current = get().balance;
        if (current >= amount) {
          const newBalance = current - amount;
          set({ balance: newBalance });
          saveToDisk(newBalance);
          return true;
        }
        return false;
      },
      resetBankroll: () => {
        set({ balance: INITIAL_BANKROLL });
        saveToDisk(INITIAL_BANKROLL);
      },
      setBankroll: (amount: number) => {
        set({ balance: amount });
        saveToDisk(amount);
      },
    }),
    {
      name: 'dz-pk-bankroll-storage',
    }
  )
);

if (typeof window !== 'undefined') {
  fetch('/api/bankroll')
    .then(r => r.json())
    .then(data => {
      if (data && typeof data.balance === 'number') {
        useBankrollStore.getState().initBankroll(data.balance);
      }
    })
    .catch(e => console.error('Failed to load bankroll from disk', e));
}
