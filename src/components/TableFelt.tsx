import type { PublicAction, TableStage } from '../ai/types';
import { seatActionLabel } from '../game/seatActionLabel';
import { seatAnchor } from '../game/seatLayout';
import { roleAt, type SeatRole } from '../game/positions';
import type { Player } from '../store/gameStore';
import { CardUI } from './CardUI';
import { SeatPanel } from './SeatPanel';

export function TableFelt({
  players,
  stage,
  pot,
  board,
  bigBlind,
  buttonIndex,
  currentPlayerIndex,
  streetActions,
}: {
  players: Player[];
  stage: TableStage;
  pot: number;
  board: string[];
  bigBlind: number;
  buttonIndex: number;
  currentPlayerIndex: number;
  streetActions: PublicAction[];
}) {
  const statuses = players.map((player) => player.status);
  return (
    <div className="relative flex-1 min-h-[32rem] sm:min-h-[36rem]" data-felt="true">
      {players.map((player, seat) => {
        const anchor = seatAnchor(seat, players.length);
        const role: SeatRole | null = roleAt(seat, buttonIndex, statuses);
        const current = seat === currentPlayerIndex && stage !== 'idle' && stage !== 'showdown';
        const reveal = player.id === 'human' || stage === 'showdown';
        return (
          <div
            key={player.id}
            data-seat-id={player.id}
            data-seat-index={seat}
            data-role={role ?? 'out'}
            data-current={current ? 'true' : 'false'}
            className="absolute z-20"
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
              reveal={reveal && (player.status === 'active' || player.status === 'all-in')}
              compact={players.length >= 6}
            />
          </div>
        );
      })}
      <div className="absolute left-1/2 top-[46%] z-10 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2 pointer-events-none">
        <div className="bg-black/60 px-4 py-1 rounded-full border border-yellow-500/30">
          <span className="text-yellow-400 font-bold text-base sm:text-xl">Pot: ${pot}</span>
        </div>
        <div className="flex space-x-1 justify-center">
          {board.map((card, index) => (
            <CardUI key={`${card}-${index}`} card={card} className="!h-16 !w-10 !p-1 sm:!h-24 sm:!w-14" />
          ))}
          {Array.from({ length: Math.max(0, 5 - board.length) }).map((_, index) => (
            <div key={`empty-${index}`} className="w-10 h-16 sm:w-16 sm:h-24 rounded-xl border-2 border-dashed border-gray-600/50 flex-shrink-0" />
          ))}
        </div>
      </div>
    </div>
  );
}
