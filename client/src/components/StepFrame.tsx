import React, { useRef } from 'react';
import { GripVertical, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n';
import type { Card, PhaseKey, ResizeDirection, Step } from '../types';
import { AddBlockCircleButton } from './AddBlockCircleButton';
import { ConnectorArrow } from './ConnectorArrow';
import { TestBlockCard } from './TestBlockCard';

interface StepFrameProps {
  step: Step;
  totalSteps: number;
  selectedCardId: string | null;
  editingCodeCardId: string | null;
  copiedId: string | null;
  onSelectCard: (id: string) => void;
  onStartEditCode: (id: string) => void;
  onStopEditCode: () => void;
  onUpdateCard: (cardId: string, updates: Partial<Card>) => void;
  onStartCardResize: (e: React.MouseEvent, card: Card, direction: ResizeDirection) => void;
  onStartSplitResize: (e: React.MouseEvent, stepId: string, ratio: number, el: HTMLElement | null) => void;
  onAddCard: (stepId: string, phaseKey: PhaseKey) => void;
  onDeleteCard: (cardId: string) => void;
  onDeleteStep: (stepId: string) => void;
  onCopyCode: (card: Card) => void;
}

// ============================================================================
// STEP COMPONENT (PRE-EXECUTION AND POST-EXECUTION COLUMNS)
// ============================================================================
export function StepFrame({
  step,
  totalSteps,
  selectedCardId,
  editingCodeCardId,
  copiedId,
  onSelectCard,
  onStartEditCode,
  onStopEditCode,
  onUpdateCard,
  onStartCardResize,
  onStartSplitResize,
  onAddCard,
  onDeleteCard,
  onDeleteStep,
  onCopyCode
}: StepFrameProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLElement | null>(null);

  const blocksCount =
    step.preCards.length === 1
      ? t('blocksOne', { n: step.preCards.length })
      : t('blocksMany', { n: step.preCards.length });
  const assertionsCount =
    step.postCards.length === 1
      ? t('assertsOne', { n: step.postCards.length })
      : t('assertsMany', { n: step.postCards.length });

  const phaseCards = (phaseKey: PhaseKey) => (
    <div className="flex-1 flex items-center gap-2 overflow-x-auto pb-2">
      {step[phaseKey].map((card, index) => (
        <React.Fragment key={card.id}>
          <TestBlockCard
            card={card}
            isSelected={selectedCardId === card.id}
            isEditingCode={editingCodeCardId === card.id}
            isCopied={copiedId === card.id}
            onSelect={() => onSelectCard(card.id)}
            onStartEditCode={() => onStartEditCode(card.id)}
            onStopEditCode={onStopEditCode}
            onUpdateCard={(updates) => onUpdateCard(card.id, updates)}
            onStartResize={(e, dir) => onStartCardResize(e, card, dir)}
            onCopy={() => onCopyCode(card)}
          />

          {/* Connector SVG arrow between cards */}
          {index < step[phaseKey].length - 1 && <ConnectorArrow />}
        </React.Fragment>
      ))}

      {/* Short arrow + blue circular "+" button at the end of the phase */}
      {step[phaseKey].length > 0 && <ConnectorArrow short />}
      <AddBlockCircleButton
        title={phaseKey === 'preCards' ? t('addCardPre') : t('addCardPost')}
        onClick={() => onAddCard(step.id, phaseKey)}
      />
    </div>
  );

  return (
    <section
      ref={containerRef}
      className="relative bg-[#DCDFE4]/85 border border-slate-300/90 rounded-2xl shadow-sm flex items-stretch min-w-[980px] transition-shadow hover:shadow-md"
    >
      {/* Numbered circular badge on the left (1, 2...) */}
      <div className="w-16 shrink-0 flex flex-col items-center justify-between py-5 border-r border-slate-300/60 bg-slate-200/50 rounded-l-2xl">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {t('stepWord')}
        </span>

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

      {/* Two-column area: PRE-EXECUTION | POST-EXECUTION */}
      <div className="flex-1 flex items-stretch relative">
        {/* COLUMN 1: PRE-EXECUTION */}
        <div
          style={{ flexBasis: `${step.splitRatio}%` }}
          className="p-5 flex flex-col shrink-0 grow-0 min-w-[320px]"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-extrabold tracking-wide text-slate-800 uppercase">
              {t('phasePre')}
            </h2>
            <span className="text-[11px] font-medium text-slate-500">{blocksCount}</span>
          </div>

          {phaseCards('preCards')}
        </div>

        {/* RESIZABLE VERTICAL DIVIDER BETWEEN PRE AND POST-EXECUTION */}
        <div
          onMouseDown={(e) =>
            onStartSplitResize(e, step.id, step.splitRatio, containerRef.current)
          }
          title={t('splitHint')}
          className="w-3 cursor-col-resize flex items-center justify-center group relative z-10 select-none"
        >
          <div className="w-[1.5px] h-full bg-slate-500/70 group-hover:bg-blue-600 group-hover:w-[2.5px] transition-all" />
          <div className="absolute bg-white border border-slate-300 group-hover:border-blue-500 rounded-full p-0.5 shadow-xs opacity-0 group-hover:opacity-100 transition-opacity">
            <GripVertical className="w-3 h-3 text-blue-600" />
          </div>
        </div>

        {/* COLUMN 2: POST-EXECUTION */}
        <div className="flex-1 p-5 flex flex-col min-w-[320px]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-extrabold tracking-wide text-slate-800 uppercase">
              {t('phasePost')}
            </h2>
            <span className="text-[11px] font-medium text-slate-500">{assertionsCount}</span>
          </div>

          {phaseCards('postCards')}
        </div>
      </div>
    </section>
  );
}
