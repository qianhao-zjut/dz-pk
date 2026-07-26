import React, { useState } from 'react';
import { Lobby } from './components/Lobby';
import type { TableConfig } from './components/Lobby';
import { GameTable } from './components/GameTable';
import { useGameStore } from './store/gameStore';
import { useBankrollStore } from './store/bankrollStore';

function App() {
  const [currentTable, setCurrentTable] = useState<TableConfig | null>(null);
  const joinTable = useGameStore(state => state.joinTable);
  const deductFunds = useBankrollStore(state => state.deductFunds);

  const handleJoin = (table: TableConfig) => {
    if (deductFunds(table.buyIn)) {
      setCurrentTable(table);
      joinTable(table, table.buyIn);
    }
  };

  if (!currentTable) {
    return <Lobby onJoinTable={handleJoin} />;
  }

  return <GameTable onLeave={() => setCurrentTable(null)} />;
}

export default App;

