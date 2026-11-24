import React from 'react';

interface CardProps {
  card?: string;
  className?: string;
  /** seat 用于玩家手牌，board 用于公共牌，full 用于复盘等独立展示。 */
  fit?: 'full' | 'seat' | 'board';
}

export const CardUI: React.FC<CardProps> = ({ card, className = '', fit = 'full' }) => {
  const sizeClass = fit === 'seat' ? 'hole-card' : fit === 'board' ? 'board-card' : 'full-card';
  if (!card) {
    return (
      <div className={`playing-card card-back ${sizeClass} ${className}`} aria-label="牌背">
        <div className="card-back-pattern"><span>♠</span></div>
      </div>
    );
  }

  const rank = card[0];
  const suit = card[1];
  const suitChar = suit === 's' ? '♠' : suit === 'h' ? '♥' : suit === 'd' ? '♦' : '♣';
  const red = suit === 'h' || suit === 'd';
  const suitName = suit === 's' ? '黑桃' : suit === 'h' ? '红桃' : suit === 'd' ? '方块' : '梅花';
  const rankText = rank === 'T' ? '10' : rank;

  return (
    <div
      className={`playing-card ${sizeClass} ${red ? 'is-red' : 'is-black'} ${className}`}
      aria-label={`${suitName}${rankText}`}
    >
      <div className="card-corner card-corner-top"><span className="card-rank">{rankText}</span><span className="card-corner-suit">{suitChar}</span></div>
      <div className="card-suit" aria-hidden="true">{suitChar}</div>
      <div className="card-corner card-corner-bottom" aria-hidden="true"><span className="card-rank">{rankText}</span><span className="card-corner-suit">{suitChar}</span></div>
    </div>
  );
};
