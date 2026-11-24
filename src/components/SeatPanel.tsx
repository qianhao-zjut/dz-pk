import type { CSSProperties } from 'react';
import { Crown } from 'lucide-react';
import type { SeatRole } from '../game/positions';
import { CardUI } from './CardUI';

export function SeatPanel({
  name,
  role,
  chips,
  bigBlind,
  bet,
  label,
  dealer,
  current,
  human,
  cards,
  reveal,
  folded = false,
  winner = false,
  winAmount = 0,
  avatarSeed = 0,
}: {
  name: string;
  role: SeatRole | null;
  chips: number;
  bigBlind: number;
  bet: number;
  label: string | null;
  dealer: boolean;
  current: boolean;
  human: boolean;
  cards: string[];
  reveal: boolean;
  folded?: boolean;
  winner?: boolean;
  winAmount?: number;
  avatarSeed?: number;
}) {
  const avatars = [
    ['#68765b', '#344a3b'], ['#8a6850', '#493c34'], ['#586e83', '#293f52'],
    ['#8d7250', '#4f422c'], ['#6b5d7b', '#3c314b'], ['#517a73', '#27453e'],
    ['#936254', '#50362f'], ['#737958', '#3e422b'], ['#57718a', '#2c3c4b'],
  ];
  const [avatarA, avatarB] = avatars[avatarSeed % avatars.length];
  const displayRole = dealer ? 'BTN' : role;
  return (
    <div
      className={`seat-card ${human ? 'is-human' : ''} ${current ? 'is-current' : ''} ${winner ? 'is-winner' : ''} ${folded ? 'is-folded' : ''}`}
      data-winner={winner ? 'true' : 'false'}
      style={{ '--avatar-a': avatarA, '--avatar-b': avatarB } as CSSProperties}
    >
      {current && <div className="turn-track" aria-label="正在行动" />}
      {winner && <div className="winner-badge"><Crown size={12} strokeWidth={2.5} /><span>获胜</span><strong>+${winAmount.toLocaleString()}</strong></div>}
      {displayRole && <div className={`seat-role role-${displayRole}`}>{displayRole === 'BTN' ? 'D' : displayRole}</div>}
      <div className="seat-top">
        <div className="seat-avatar" aria-hidden="true">{human ? 'ME' : name.trim().charAt(0)}</div>
        <div className="seat-hole">
          {cards.length > 0 && reveal && cards.map((card, index) => <CardUI key={`${card}-${index}`} card={card} fit="seat" />)}
          {cards.length > 0 && !reveal && <><CardUI fit="seat" /><CardUI fit="seat" /></>}
        </div>
      </div>
      <div className="seat-meta">
        <div className="seat-name" title={name}>{human ? name.replace(' (Player)', '') : name}</div>
        <div className="seat-stack">${chips.toLocaleString()}<span className="ml-1 font-normal text-[10px] text-[#aab5a8]">{bigBlind > 0 ? `${Number((chips / bigBlind).toFixed(1))} BB` : ''}</span></div>
      </div>
      {label && <div className="seat-action">{label}</div>}
      {bet > 0 && <div className="seat-bet"><span className="chip-dot" />${bet.toLocaleString()}</div>}
    </div>
  );
}
