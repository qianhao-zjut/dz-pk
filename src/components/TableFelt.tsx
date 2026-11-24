import type { PublicAction, TableStage } from '../ai/types';
import type { PotPayout } from '../game/handRecord';
import { seatActionLabel } from '../game/seatActionLabel';
import { seatAnchor } from '../game/seatLayout';
import { roleAt, type SeatRole } from '../game/positions';
import type { Player } from '../store/gameStore';
import { CardUI } from './CardUI';
import { SeatPanel } from './SeatPanel';

const STAGE_LABEL: Partial<Record<TableStage, string>> = {
  preflop: '翻牌前', flop: '翻牌圈', turn: '转牌圈', river: '河牌圈', showdown: '摊牌',
};

export function TableFelt({
  players, stage, pot, board, bigBlind, buttonIndex, currentPlayerIndex, streetActions, payouts = [],
}: {
  players: Player[];
  stage: TableStage;
  pot: number;
  board: string[];
  bigBlind: number;
  buttonIndex: number;
  currentPlayerIndex: number;
  streetActions: PublicAction[];
  /** 结算记录中的真实赢池；退款不参与获胜高亮。 */
  payouts?: PotPayout[];
}) {
  const statuses = players.map((player) => player.status);
  const winnings = new Map<string, number>();
  if (stage === 'showdown') {
    payouts.filter((payout) => payout.kind === 'win').forEach((payout) => {
      winnings.set(payout.playerId, (winnings.get(payout.playerId) ?? 0) + payout.amount);
    });
  }
  const winners = players.filter((player) => (winnings.get(player.id) ?? 0) > 0);
  const totalWon = [...winnings.values()].reduce((sum, amount) => sum + amount, 0);
  return (
    <div className={`table-felt seat-count-${players.length} relative min-h-0 flex-1 overflow-hidden`} data-felt="true">
      <div className="absolute left-1/2 top-[44%] z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-4 sm:gap-5">
        <div className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-1.5 shadow-lg ${winners.length > 0 ? 'border-[#e3c46480] bg-[#302a13e8] text-[#f4d77f]' : 'border-[#d5bd6650] bg-[#071710b5]'}`}>
          <span className="chip-dot" />
          <span className="text-sm font-bold text-[#efd580] sm:text-base">{winners.length > 0 ? `${winners.length > 1 ? '平分底池' : winners[0].id === 'human' ? '你赢得底池' : `${winners[0].name} 赢得底池`} $${totalWon}` : `底池 $${pot.toLocaleString()}`}</span>
        </div>
        <div className="flex justify-center gap-1.5 sm:gap-2">
          {board.map((card, index) => <CardUI key={`${card}-${index}`} card={card} fit="board" />)}
          {Array.from({ length: Math.max(0, 5 - board.length) }).map((_, index) => (
            <div key={`empty-${index}`} className="playing-card board-card card-empty" aria-hidden="true" />
          ))}
        </div>
        <div className={`text-[10px] font-semibold tracking-[.15em] ${winners.length > 0 ? 'text-[#f3d681]' : 'tracking-[.25em] text-[#b4c6ac75]'}`}>{winners.length > 0 ? '本手结束 · 获胜座位已高亮' : STAGE_LABEL[stage] ?? '等待开局'}</div>
      </div>
      {players.map((player, seat) => {
        const anchor = seatAnchor(seat, players.length);
        const role: SeatRole | null = roleAt(seat, buttonIndex, statuses);
        const current = seat === currentPlayerIndex && stage !== 'idle' && stage !== 'showdown';
        const reveal = (player.id === 'human' || stage === 'showdown') && (player.status === 'active' || player.status === 'all-in');
        return (
          <div
            key={player.id}
            data-seat-id={player.id}
            data-seat-index={seat}
            data-role={role ?? 'out'}
            data-current={current ? 'true' : 'false'}
            className={`absolute ${(winnings.get(player.id) ?? 0) > 0 ? 'z-30' : 'z-20'}`}
            style={{ left: `${anchor.x}%`, top: `${anchor.y}%`, transform: 'translate(-50%, -50%)' }}
          >
            <SeatPanel
              name={player.name}
              role={role}
              chips={player.chips}
              bigBlind={bigBlind}
              bet={player.currentBet}
              label={seatActionLabel(player.id, player.status, stage, streetActions)}
              dealer={seat === buttonIndex}
              current={current}
              human={player.id === 'human'}
              cards={player.cards}
              reveal={reveal}
              folded={player.status === 'folded'}
              winner={(winnings.get(player.id) ?? 0) > 0}
              winAmount={winnings.get(player.id) ?? 0}
              avatarSeed={seat}
            />
          </div>
        );
      })}
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-0 -translate-x-1/2 text-center text-[9px] font-medium tracking-[.35em] text-[#c3d3b52a] sm:bottom-5 sm:text-[11px]">TEXAS HOLD'EM · TRAINING TABLE</div>
    </div>
  );
}
