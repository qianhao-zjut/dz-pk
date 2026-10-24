import React from 'react';
import { practiceTip, reasonText, type CompletedHand } from '../game/handRecord';
import { roleLabel } from '../game/positions';
import { useHandHistoryStore } from '../store/handHistoryStore';

function money(value: number): string {
  return `${value >= 0 ? '' : '-'}$${Math.abs(value)}`;
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return '—';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export const HandReview: React.FC<{ handId: string; onClose: () => void }> = ({ handId, onClose }) => {
  const hand = useHandHistoryStore((state) => state.hands.find((item) => item.id === handId));
  const autoOpenReview = useHandHistoryStore((state) => state.autoOpenReview);
  const setAutoOpenReview = useHandHistoryStore((state) => state.setAutoOpenReview);
  if (!hand) return null;
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-2 sm:p-6">
      <div className="bg-gray-900 text-gray-100 w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-700 p-4 sm:p-6">
        <ReviewBody hand={hand} />
        <label className="mt-4 flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={autoOpenReview} onChange={(event) => setAutoOpenReview(event.target.checked)} />
          每手结束自动展开回顾
        </label>
        <button onClick={onClose} className="mt-4 w-full py-3 rounded-xl bg-gray-700 font-bold">关闭</button>
      </div>
    </div>
  );
};

export const ReviewBody: React.FC<{ hand: CompletedHand }> = ({ hand }) => {
  const human = hand.results.find((result) => result.id === 'human');
  const streets = ['preflop', 'flop', 'turn', 'river'] as const;
  return (
    <div className="space-y-4 text-sm">
      <div>
        <h2 className="text-xl font-bold">第 {hand.handNumber} 手回顾</h2>
        <p className="text-gray-400">{hand.config.levelName} · {hand.config.buyInBb}bb · 买入 ${hand.config.buyIn}</p>
        <p className={human && human.net >= 0 ? 'text-green-400 text-lg font-bold' : 'text-red-300 text-lg font-bold'}>
          本手结果 {human ? money(human.net) : '—'}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {hand.seats.map((seat) => {
          const end = hand.results.find((result) => result.id === seat.id);
          return (
            <div key={seat.id} className="bg-gray-800 rounded-lg p-2">
              <div className="font-bold">{seat.name} · {seat.role} {roleLabel(seat.role)}{seat.style ? ` · ${seat.style}` : ''}</div>
              <div>{seat.holeCards.join(' ') || '无牌'}</div>
              <div className="text-gray-400">{money(seat.chipsBefore)} → {end ? money(end.chips) : '—'}（{end ? money(end.net) : '—'}）</div>
            </div>
          );
        })}
      </div>
      <div>公共牌：{hand.board.length > 0 ? hand.board.join(' ') : '未发出'}</div>
      {streets.map((street) => {
        const actions = hand.actions.filter((action) => action.street === street);
        if (actions.length === 0) return null;
        const board = actions[0]?.board ?? [];
        return (
          <div key={street}>
            <div className="font-bold text-blue-300">{street}{board.length > 0 ? ` · ${board.join(' ')}` : ''}</div>
            {actions.map((action) => {
              const actor = hand.seats.find((seat) => seat.id === action.actorId);
              const share = action.kind === 'call' ? pct(action.callCost, action.potBefore) : null;
              const threshold = action.kind === 'call' ? pct(action.callCost, action.potBefore + action.callCost) : null;
              const betScale = action.kind === 'raise' && action.potBefore > 0 ? pct(action.amountAdded, action.potBefore) : null;
              return (
                <div key={action.actionSeq} className="border-b border-gray-800 py-2">
                  <div>
                    {actor?.name ?? action.actorId} {action.kind}
                    {action.raiseTo != null ? ` 到 $${action.raiseTo}` : ''}
                    {action.amountAdded > 0 ? `，本次 $${action.amountAdded}` : ''}
                    {action.raiseIncrement != null ? `，增量 $${action.raiseIncrement}` : ''}
                    {action.allIn ? '，全下' : ''}
                  </div>
                  <div className="text-gray-400">
                    行动前池 ${action.potBefore}
                    {action.kind === 'call' ? ` · 跟注 $${action.callCost} · 占池 ${share} · 门槛 ${threshold}` : ''}
                    {betScale ? ` · 本次投入占行动前池 ${betScale}` : ''}
                  </div>
                  {action.npc && (
                    <div className="mt-1 text-yellow-200">
                      实际依据：{reasonText(action.npc.reasonCode, action.npc.fallback)}
                      {action.npc.position ? ` · ${action.npc.position}` : ''}
                      {action.npc.priceTier ? ` · 价格 ${action.npc.priceTier}` : ''}
                      {action.npc.stackDepth ? ` · ${action.npc.stackDepth}` : ''}
                      {action.npc.equity != null ? ` · 抽样权益 ${(action.npc.equity * 100).toFixed(0)}%（${action.npc.samples} 次）` : ''}
                    </div>
                  )}
                  {action.npc && <div className="text-gray-500">{practiceTip(actor?.role ?? 'UTG')}</div>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
