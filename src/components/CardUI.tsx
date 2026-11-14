import React from 'react';

interface CardProps {
  card?: string; // e.g. "As", "Th", if undefined, it's a card back
  className?: string;
  /** seat 用于六人、九人座位；board 用于公共牌。字号跟着牌面走，避免花色被裁切。 */
  fit?: 'full' | 'seat' | 'board';
}

const FIT = {
  full: {
    box: 'w-20 h-32 p-2 sm:w-28 sm:h-40 sm:p-3',
    rank: 'text-lg sm:text-2xl',
    suit: 'text-4xl sm:text-6xl',
    back: 'w-16 h-28 sm:w-24 sm:h-36',
  },
  seat: {
    box: 'h-8 w-5 p-px',
    rank: 'text-[8px]',
    suit: 'text-xs',
    back: 'h-5 w-3',
  },
  board: {
    box: 'h-14 w-9 p-0.5 sm:h-20 sm:w-12 sm:p-1',
    rank: 'text-[10px] sm:text-sm',
    suit: 'text-lg sm:text-2xl',
    back: 'h-10 w-6 sm:h-14 sm:w-8',
  },
} as const;

export const CardUI: React.FC<CardProps> = ({ card, className = '', fit = 'full' }) => {
  const size = FIT[fit];
  if (!card) {
    return (
      <div className={`${size.box} bg-blue-800 rounded-md border border-white shadow-md flex items-center justify-center overflow-hidden ${className}`}>
        <div className={`${size.back} border border-blue-400 rounded opacity-50 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(255,255,255,0.1)_10px,rgba(255,255,255,0.1)_20px)]`}></div>
      </div>
    );
  }

  const rank = card[0];
  const suit = card[1];

  let suitChar = '';
  let colorClass = '';

  switch (suit) {
    case 's': suitChar = '♠'; colorClass = 'text-black'; break;
    case 'h': suitChar = '♥'; colorClass = 'text-red-600'; break;
    case 'd': suitChar = '♦'; colorClass = 'text-red-600'; break;
    case 'c': suitChar = '♣'; colorClass = 'text-black'; break;
  }

  // Fallback to standard 2-color for simplicity if preferred, but 4-color is good for training
  
  return (
    <div className={`${size.box} bg-white rounded-md border border-gray-300 shadow-md flex flex-col justify-between overflow-hidden ${colorClass} ${className}`}>
      <div className={`${size.rank} font-bold leading-none`}>{rank === 'T' ? '10' : rank}</div>
      <div className={`${size.suit} text-center leading-none`}>{suitChar}</div>
      <div className={`${size.rank} font-bold leading-none rotate-180`}>{rank === 'T' ? '10' : rank}</div>
    </div>
  );
};
