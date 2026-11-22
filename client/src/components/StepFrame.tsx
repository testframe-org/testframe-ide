import React from 'react';
import { Trash2 } from 'lucide-react';
import { useI18n } from '../i18n';
import type { Card, CardRunResult, ResizeDirection, Step } from '../client-api/testframe.z';
import { AddBlockCircleButton } from './AddBlockCircleButton';
import { ConnectorArrow } from './ConnectorArrow';
import { TestBlockCard } from './TestBlockCard';

interface StepFrameProps {
  step: Step;
  totalSteps: number;
  selectedCardId: string | null;
  editingCodeCardId: string | null;
  copiedId: string | null;
  cardRuns: Record<string, CardRunResult>; // last run per card id
  zoom: number;
  onSelectCard: (id: string) => void;
  onStartEditCode: (id: string) => void;
  onStopEditCode: () => void;
  onOpenEditor: (id: string) => void;
  onUpdateCard: (cardId: string, updates: Partial<Card>) => void;
  onStartCardResize: (e: React.MouseEvent, card: Card, direction: ResizeDirection) => void;
  onAddCard: (stepId: string) => void;
  onDeleteStep: (stepId: string) => void;
  onCopyCode: (card: Card) => void;
}

// ============================================================================
// STEP COMPONENT: one ordered sequence of cards, executed left to right.
// The row grows with its cards (the canvas pans), so it never scrolls.
// ============================================================================
export function StepFrame({
  step,
  totalSteps,
  selectedCardId,
  editingCodeCardId,
  copiedId,
  cardRuns,
  zoom,
  onSelectCard,
  onStartEditCode,
  onStopEditCode,
  onOpenEditor,
  onUpdateCard,
  onStartCardResize,
  onAddCard,
  onDeleteStep,
  onCopyCode
}: StepFrameProps) {
  const { t } = useI18n();
  const count = step.cards.length === 1 ? t('blocksOne', { n: 1 }) : t('blocksMany', { n: step.cards.length });

  return (
    <section className="relative bg-[#DCDFE4]/85 border border-slate-300/90 rounded-2xl shadow-sm flex items-stretch min-w-[980px] w-max transition-shadow hover:shadow-md">
      {/* Numbered circular badge on the left (1, 2...) */}
      <div className="w-16 shrink-0 flex flex-col items-center justify-between py-5 border-r border-slate-300/60 bg-slate-200/50 rounded-l-2xl">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t('stepWord')}</span>

        <div className="w-10 h-10 rounded-full bg-[#B4B9C2] text-slate-800 font-bold text-base flex items-center justify-center shadow-inner border border-slate-400/30">
          {step.number}
        </div>

        {totalSteps > 1 ? (
          <button
            onClick={() => onDeleteStep(step.id)}
            title={t('deleteStep')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-100/70 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        ) : (
          <div className="h-6" />
        )}
      </div>

      {/* Cards in execution order */}
      <div className="flex-1 p-5 flex flex-col">
        <div className="flex items-center justify-end mb-3">
          <span className="text-[11px] font-medium text-slate-500">{count}</span>
        </div>

        <div className="flex items-center gap-2 pb-6">
          {step.cards.map((card, index) => (
            <React.Fragment key={card.id}>
              <TestBlockCard
                card={card}
                isSelected={selectedCardId === card.id}
                isEditingCode={editingCodeCardId === card.id}
                isCopied={copiedId === card.id}
                lastRun={cardRuns[card.id]}
                zoom={zoom}
                onSelect={() => onSelectCard(card.id)}
                onStartEditCode={() => onStartEditCode(card.id)}
                onStopEditCode={onStopEditCode}
                onOpenEditor={() => onOpenEditor(card.id)}
                onUpdateCard={(updates) => onUpdateCard(card.id, updates)}
                onStartResize={(e, dir) => onStartCardResize(e, card, dir)}
                onCopy={() => onCopyCode(card)}
              />
              {index < step.cards.length - 1 && <ConnectorArrow />}
            </React.Fragment>
          ))}

          {/* Short arrow + blue circular "+" button at the end of the step */}
          {step.cards.length > 0 && <ConnectorArrow short />}
          <AddBlockCircleButton title={t('addCard')} onClick={() => onAddCard(step.id)} />
        </div>
      </div>
    </section>
  );
}
