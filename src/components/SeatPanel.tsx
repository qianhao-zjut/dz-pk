import type { SeatRole } from '../game/positions';
import { stackText } from '../game/positions';
import { CardUI } from './CardUI';

export function SeatActionLine({
  dealer,
  bet,
  label,
  human = false,
  compact = false,
}: {
  dealer: boolean;
  bet: number;
  label: string | null;
  human?: boolean;
  compact?: boolean;
}) {
  const dealerClass = human
    ? 'w-5 h-5 sm:w-6 sm:h-6 text-xs'
    : 'w-4 h-4 text-[10px]';
  const betClass = human
    ? 'px-3 py-1 bg-yellow-600/90 rounded-full text-xs sm:text-sm font-bold border border-yellow-400 shadow-lg'
    : 'px-1 bg-yellow-600/80 rounded text-[10px] font-bold border border-yellow-400';
  const rowClass = human
    ? 'flex items-center justify-center space-x-2 mb-0.5 h-6'
    : `flex items-center justify-center space-x-1 mb-0.5 ${compact ? 'h-4' : 'h-5'}`;
  const loud = label === '弃牌' || label === '全下';
  const labelNode = label ? (
    <span className={loud ? 'px-1 bg-red-600/80 rounded' : 'px-1 bg-black/50 rounded'}>{label}</span>
  ) : null;
  if (compact) {
    return (
      <div className="flex items-center justify-center gap-0.5 h-4 text-[10px] font-bold">
        {dealer && (
          <div className={`${dealerClass} bg-white text-black rounded-full flex items-center justify-center font-bold shadow-md`}>D</div>
        )}
        {bet > 0 && <div className={betClass}>${bet}</div>}
        {labelNode}
      </div>
    );
  }
  return (
    <>
      <div className={rowClass}>
        {dealer && (
          <div className={`${dealerClass} bg-white text-black rounded-full flex items-center justify-center font-bold shadow-md`}>D</div>
        )}
        {bet > 0 && <div className={betClass}>${bet}</div>}
      </div>
      <div className="h-5 flex items-center justify-center text-[10px] font-bold">
        {labelNode}
      </div>
    </>
  );
}

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
  compact,
  layer,
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
  compact: boolean;
  /** plate 只画姓名，cards 只画牌。两层分开排，姓名才能盖住邻近座位的牌背。 */
  layer?: 'plate' | 'cards';
}) {
  const inHand = cards.length > 0;
  const width = compact ? 'w-16' : 'w-24 sm:w-28';
  const fit = compact ? 'seat' : 'board';
  const holeRow = compact ? 'h-8 gap-0.5' : 'h-14 gap-1 sm:h-20';
  return (
    <div className={`flex flex-col items-center ${width} ${layer === 'cards' ? 'pointer-events-none' : ''}`}>
      <div className={layer === 'cards' ? 'invisible' : undefined} aria-hidden={layer === 'cards'}>
        <div data-seat-name={name} className={`px-1 py-0.5 rounded-lg shadow-lg text-center w-full border ${current ? 'bg-yellow-600 border-yellow-400 ring-2 ring-yellow-400' : 'bg-gray-800 border-gray-700'}`}>
          <div className="font-bold text-[10px] leading-tight truncate">{name}</div>
          <div className="text-[10px] leading-tight text-gray-200 truncate">{role ?? '坐出'} · {stackText(chips, bigBlind)}</div>
        </div>
        <SeatActionLine dealer={dealer} bet={bet} label={label} human={human} compact={compact} />
      </div>
      <div className={`flex items-start justify-center ${holeRow}`}>
        {layer !== 'plate' && inHand && reveal && cards.map((card, index) => (
          <CardUI key={`${card}-${index}`} card={card} fit={fit} />
        ))}
        {layer !== 'plate' && inHand && !reveal && (
          <>
            <CardUI fit={fit} />
            <CardUI fit={fit} />
          </>
        )}
      </div>
    </div>
  );
}
