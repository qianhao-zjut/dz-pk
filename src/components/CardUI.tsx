import React from 'react';

interface CardProps {
  card?: string; // e.g. "As", "Th", if undefined, it's a card back
  className?: string;
}

export const CardUI: React.FC<CardProps> = ({ card, className = '' }) => {
  if (!card) {
    return (
      <div className={`w-20 h-32 sm:w-28 sm:h-40 bg-blue-800 rounded-xl border-2 border-white shadow-md flex items-center justify-center ${className}`}>
        <div className="w-16 h-28 sm:w-24 sm:h-36 border border-blue-400 rounded opacity-50 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(255,255,255,0.1)_10px,rgba(255,255,255,0.1)_20px)]"></div>
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
    <div className={`w-20 h-32 sm:w-28 sm:h-40 bg-white rounded-xl border border-gray-300 shadow-md flex flex-col justify-between p-2 sm:p-3 ${colorClass} ${className}`}>
      <div className="text-lg sm:text-2xl font-bold leading-none">{rank === 'T' ? '10' : rank}</div>
      <div className="text-4xl sm:text-6xl text-center leading-none">{suitChar}</div>
      <div className="text-lg sm:text-2xl font-bold leading-none rotate-180">{rank === 'T' ? '10' : rank}</div>
    </div>
  );
};
