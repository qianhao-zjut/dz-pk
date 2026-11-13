import type { SeatRole } from '../game/positions';
import { stackText } from '../game/positions';
import { CardUI } from './CardUI';

export function SeatActionLine({
  dealer,
  bet,
  label,
  human = false,
}: {
  dealer: boolean;
  bet: number;
  label: string | null;
  human?: boolean;
}) {
  const dealerClass = human
    ? 'w-5 h-5 sm:w-6 sm:h-6 text-xs'
    : 'w-4 h-4 sm:w-5 sm:h-5 text-[10px]';
  const betClass = human
    ? 'px-3 py-1 bg-yellow-600/90 rounded-full text-xs sm:text-sm font-bold border border-yellow-400 shadow-lg'
    : 'px-1 sm:px-2 bg-yellow-600/80 rounded text-[10px] sm:text-xs font-bold border border-yellow-400';
  const rowClass = human
    ? 'flex items-center justify-center space-x-2 mb-1 h-6'
    : 'flex items-center justify-center space-x-1 sm:space-x-2 mb-1 h-6';
  const loud = label === '弃牌' || label === '全下';
  return (
    <>
      <div className={rowClass}>
        {dealer && (
          <div className={`${dealerClass} bg-white text-black rounded-full flex items-center justify-center font-bold shadow-md`}>D</div>
        )}
        {bet > 0 && <div className={betClass}>${bet}</div>}
      </div>
      <div className="h-5 mb-1 flex items-center justify-center text-[10px] sm:text-xs font-bold">
        {label ? (
          <span className={loud ? 'px-1 sm:px-2 bg-red-600/80 rounded' : 'px-1 sm:px-2 bg-black/50 rounded'}>{label}</span>
        ) : null}
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
}) {
  const inHand = cards.length > 0;
  const width = compact ? 'w-[5.6rem] sm:w-28' : 'w-24 sm:w-32';
  return (
    <div className={`flex flex-col items-center ${width}`}>
      <div className={`px-1 sm:px-2 py-1 rounded-lg shadow-lg text-center w-full mb-1 border ${current ? 'bg-yellow-600 border-yellow-400 ring-4 ring-yellow-400' : 'bg-gray-800 border-gray-700'}`}>
        <div className="font-bold text-[10px] sm:text-sm truncate">{name}</div>
        <div className="text-[10px] leading-tight text-gray-200">{role ?? '坐出'}</div>
        <div className="text-[10px] leading-tight text-gray-200 truncate">{stackText(chips, bigBlind)}</div>
      </div>
      <SeatActionLine dealer={dealer} bet={bet} label={label} human={human} />
      <div className={`flex items-start justify-center overflow-hidden ${compact ? 'h-10 gap-0.5 sm:h-14' : 'h-16 gap-1 sm:h-24'}`}>
        {inHand && reveal && cards.map((card, index) => (
          <CardUI key={`${card}-${index}`} card={card} className={compact ? '!h-10 !w-7 !p-0.5 !text-[10px] overflow-hidden sm:!h-14 sm:!w-9' : '!h-16 !w-10 !p-1 sm:!h-24 sm:!w-14'} />
        ))}
        {inHand && !reveal && (
          <>
            <CardUI className={compact ? '!h-10 !w-7 overflow-hidden sm:!h-14 sm:!w-9' : '!h-16 !w-10 sm:!h-24 sm:!w-14'} />
            <CardUI className={compact ? '!h-10 !w-7 overflow-hidden sm:!h-14 sm:!w-9' : '!h-16 !w-10 sm:!h-24 sm:!w-14'} />
          </>
        )}
      </div>
    </div>
  );
}
