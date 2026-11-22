import React, { useRef } from 'react';
import {
  CheckCircle2,
  Check,
  Copy,
  Edit3,
  Loader2,
  XCircle
} from 'lucide-react';
import { highlightSyntax, languageOf } from '../highlight';
import { RunOutput } from './RunOutput';
import { useI18n } from '../i18n';
import type { Card, CardRunResult, ResizeDirection } from '../types';

interface TestBlockCardProps {
  card: Card;
  isSelected: boolean;
  isEditingCode: boolean;
  isCopied: boolean;
  lastRun?: CardRunResult; // shown under the script once the card has run
  zoom: number; // canvas zoom, to convert mouse deltas while resizing
  onSelect: () => void;
  onStartEditCode: () => void;
  onStopEditCode: () => void;
  onOpenEditor: () => void;
  onUpdateCard: (updates: Partial<Card>) => void;
  onStartResize: (e: React.MouseEvent, direction: ResizeDirection) => void;
  onCopy: () => void;
}

// ============================================================================
// ACTION / PAYLOAD CARD WITH FIGMA-STYLE RESIZE HANDLES AND CODE EDITOR
// ============================================================================
export function TestBlockCard({
  card,
  isSelected,
  isEditingCode,
  isCopied,
  lastRun,
  zoom,
  onSelect,
  onStartEditCode,
  onStopEditCode,
  onOpenEditor,
  onUpdateCard,
  onStartResize,
  onCopy
}: TestBlockCardProps) {
  const { t } = useI18n();

  // Height of the last-run panel: stored per card, default ~40% of the card
  const maxResult = Math.max(40, card.height - 110);
  const resultHeight = Math.min(maxResult, card.resultHeight ?? Math.round(card.height * 0.4));
  const startResultResize = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const start = resultHeight;
    const onMove = (ev: MouseEvent) => {
      const next = Math.round(start - (ev.clientY - startY) / zoom); // drag up = bigger
      onUpdateCard({ resultHeight: Math.max(40, Math.min(maxResult, next)) });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Border based on selection or execution status
  let ringStyle = 'border-slate-400/80 shadow-md';
  if (card.status === 'running') {
    ringStyle = 'border-blue-500 ring-4 ring-blue-500/25 shadow-lg';
  } else if (card.status === 'success') {
    ringStyle = 'border-emerald-500 ring-2 ring-emerald-500/30 shadow-md';
  } else if (card.status === 'error') {
    ringStyle = 'border-rose-500 ring-2 ring-rose-500/30 shadow-md';
  } else if (isSelected) {
    ringStyle = 'border-blue-600 ring-2 ring-blue-600/30 shadow-lg';
  }

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      style={{
        width: `${card.width}px`,
        height: `${card.height}px`
      }}
      className={`relative shrink-0 rounded-lg bg-[#232631] border flex flex-col transition-shadow group ${ringStyle}`}
    >
      {/* LIGHT/GRAY HEADER WITH EDITABLE TITLE */}
      <div className="bg-[#BCC0C8] border-b border-slate-400/70 px-3 py-2 rounded-t-[7px] flex items-center justify-between gap-2 shrink-0">
        <div className="flex-1 min-w-0">
          {/* Title opens the card editor (edited there, not inline) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
              onOpenEditor();
            }}
            title={t('editCardTitle')}
            className="group/title flex w-full items-center gap-1 text-left text-[13px] font-bold text-slate-900 hover:text-blue-700 transition-colors cursor-pointer"
          >
            <span className="truncate">{card.title || card.varName}</span>
            <Edit3 className="w-3 h-3 shrink-0 opacity-0 group-hover/title:opacity-70 transition-opacity" />
          </button>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] font-mono text-slate-700 truncate">
              {card.endpoint}
            </span>
          </div>
        </div>

        {/* Execution status badge */}
        <div className="shrink-0 flex items-center gap-1">
          {card.status === 'running' && (
            <Loader2 className="w-4 h-4 text-blue-700 animate-spin" />
          )}
          {card.status === 'success' && (
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
          )}
          {card.status === 'error' && (
            <XCircle className="w-4 h-4 text-rose-700" />
          )}
        </div>
      </div>

      {/* CONTEXT / QUICK ACTION MIDDLE BAR */}
      <div className="bg-[#2D313F] border-b border-slate-700/80 px-2.5 py-1 flex items-center justify-between text-[10px] text-slate-400 shrink-0">
        <span className="uppercase font-mono tracking-wider text-slate-300 flex items-center gap-1">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              card.type === 'json'
                ? 'bg-amber-400'
                : card.type === 'script'
                ? 'bg-purple-400'
                : card.type === 'validation'
                ? 'bg-emerald-400'
                : 'bg-sky-400'
            }`}
          />
          {card.type}
        </span>

        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
            title={t('copyContent')}
            className="hover:text-white transition-colors p-0.5"
          >
            {isCopied ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isEditingCode) onStopEditCode();
              onOpenEditor();
            }}
            title={t('editCardTitle')}
            className="px-1.5 py-0.5 rounded bg-slate-700/80 hover:bg-slate-600 text-slate-200 font-medium transition-colors flex items-center gap-1"
          >
            <Edit3 className="w-3 h-3" />
            {t('edit')}
          </button>
        </div>
      </div>

      {/* DARK BODY: script on top, last run below (split is draggable) */}
      <div className="flex-1 min-h-0 flex flex-col rounded-b-[7px]">
        <div
          onDoubleClick={(e) => {
            e.stopPropagation();
            onStartEditCode();
          }}
          className="flex-1 min-h-6 overflow-auto scrollbar-dark p-2.5 relative cursor-text"
        >
          {isEditingCode ? (
            <textarea
              autoFocus
              value={card.code}
              onChange={(e) => onUpdateCard({ code: e.target.value })}
              onBlur={onStopEditCode}
              onClick={(e) => e.stopPropagation()}
              spellCheck={false}
              className="w-full h-full bg-[#191B24] text-slate-100 font-mono text-[12px] leading-5 p-2 rounded border border-blue-500/60 outline-none resize-none"
            />
          ) : (
            <div className="min-w-max">{highlightSyntax(card.code, languageOf(card))}</div>
          )}
        </div>

        {/* Last run, right under the script; drag its top edge to resize */}
        {lastRun && !isEditingCode && (
          <div
            style={{ height: `${resultHeight}px` }}
            className="shrink-0 flex flex-col min-h-0 px-2.5 pb-2"
            title={lastRun.ranAt}
          >
            <div
              onMouseDown={startResultResize}
              title={t('resizeResult')}
              className="group/split h-2.5 -mx-2.5 shrink-0 cursor-ns-resize flex items-center"
            >
              <div className="w-full border-t border-dashed border-slate-600/70 group-hover/split:border-blue-400 group-hover/split:border-solid" />
            </div>
            <div
              className={`flex items-center gap-1.5 text-[10px] font-semibold shrink-0 ${
                lastRun.status === 'error' ? 'text-rose-300' : 'text-emerald-300'
              }`}
            >
              {lastRun.status === 'error' ? <XCircle className="w-3 h-3 shrink-0" /> : <CheckCircle2 className="w-3 h-3 shrink-0" />}
              <span className="truncate">{t('lastRunResult')} · {lastRun.at}</span>
            </div>
            <RunOutput
              output={lastRun.output}
              className="mt-1 flex-1 min-h-0 overflow-auto text-[10.5px] leading-4 text-slate-300"
            />
          </div>
        )}
      </div>

      {/* RESIZE HANDLES (FIGMA STYLE) */}
      {/* Right edge (width) */}
      <div
        onMouseDown={(e) => onStartResize(e, 'right')}
        title={t('resizeWidth')}
        className="absolute top-2 -right-1.5 w-3 bottom-3 cursor-ew-resize z-20 flex items-center justify-center"
      >
        <div
          className={`w-1 h-7 rounded-full transition-opacity ${
            isSelected
              ? 'bg-blue-500 opacity-100'
              : 'bg-blue-400 opacity-0 group-hover:opacity-75'
          }`}
        />
      </div>

      {/* Bottom edge (height) */}
      <div
        onMouseDown={(e) => onStartResize(e, 'bottom')}
        title={t('resizeHeight')}
        className="absolute left-2 -bottom-1.5 h-3 right-3 cursor-ns-resize z-20 flex items-center justify-center"
      >
        <div
          className={`h-1 w-7 rounded-full transition-opacity ${
            isSelected
              ? 'bg-blue-500 opacity-100'
              : 'bg-blue-400 opacity-0 group-hover:opacity-75'
          }`}
        />
      </div>

      {/* Bottom-right corner (width + height at once) */}
      <div
        onMouseDown={(e) => onStartResize(e, 'corner')}
        title={t('resizeBoth')}
        className="absolute -right-1.5 -bottom-1.5 w-3.5 h-3.5 cursor-nwse-resize z-30 flex items-center justify-center"
      >
        <div
          className={`w-2.5 h-2.5 rounded-xs border border-white transition-opacity ${
            isSelected
              ? 'bg-blue-600 opacity-100 shadow-xs'
              : 'bg-blue-500 opacity-0 group-hover:opacity-90'
          }`}
        />
      </div>

      {/* Floating dimensions badge, Figma style, when selected */}
      {isSelected && (
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded shadow-sm pointer-events-none whitespace-nowrap z-30">
          {card.width} × {card.height}
        </div>
      )}
    </div>
  );
}
