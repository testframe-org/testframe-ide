import { useEffect } from 'react';
import {
  CheckCircle2,
  Clock,
  Database,
  FileJson,
  Loader2,
  Play,
  Sliders,
  Trash2,
  X,
  XCircle
} from 'lucide-react';
import { SOURCE_TYPES, cardVarName, normalizeVarName } from '../frames';
import { useI18n } from '../i18n';
import type { Card, CardRunResult, CardType, SelectedContext, SourceDef } from '../types';
import { SourceForm, formKindOf } from './SourceForm';

interface CardEditModalProps {
  selectedContext: SelectedContext | null; // null = closed
  sources: SourceDef[];
  onClose: () => void;
  onRun: (cardId: string) => void;
  running: boolean; // a run (single card or flow) is in progress
  lastRun?: CardRunResult;
  onUpdateCard: (cardId: string, updates: Partial<Card>) => void;
  onDeleteCard: (cardId: string) => void;
  onOpenSources: () => void;
}

const PRESETS = [
  { id: 'compact', labelKey: 'presetCompact', w: 200, h: 140 },
  { id: 'medium', labelKey: 'presetMedium', w: 310, h: 210 },
  { id: 'expanded', labelKey: 'presetExpanded', w: 420, h: 310 }
] as const;

const inputCls =
  'w-full text-xs font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:border-blue-500 outline-none';
const sectionCls = 'text-[11px] font-semibold text-slate-400 uppercase tracking-wider';

// ============================================================================
// CARD EDITOR MODAL (opened from a card's Edit button)
// Left: what every card has. Right: the form of the card's type-source.
// ============================================================================
export function CardEditModal({
  selectedContext,
  sources,
  onClose,
  onRun,
  running,
  lastRun,
  onUpdateCard,
  onDeleteCard,
  onOpenSources
}: CardEditModalProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!selectedContext) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedContext, onClose]);

  if (!selectedContext) return null;

  const { card } = selectedContext;
  const update = (updates: Partial<Card>) => onUpdateCard(card.id, updates);
  const sourceType = card.sourceType || 'inline';
  const source = sources.find((s) => s.typeSource === sourceType && s.name === card.sourceName);
  const formKind = formKindOf(sourceType);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('editCardTitle')}
        className="w-[980px] max-w-[95vw] h-[680px] max-h-[92vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="h-12 px-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5 min-w-0">
            <Sliders className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            {t('editCardTitle')}
            <span className="normal-case font-mono font-medium text-slate-500 truncate">· {cardVarName(card)}</span>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                selectedContext.phaseKey === 'preCards'
                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  : 'bg-teal-50 text-teal-700 border border-teal-200'
              }`}
            >
              {selectedContext.phaseKey === 'preCards' ? t('phasePre') : t('phasePost')}
            </span>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-600">
              {t('stepN', { n: selectedContext.stepNumber })}
            </span>
            <button
              onClick={() => onRun(card.id)}
              disabled={running}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300 transition-colors"
            >
              {card.status === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              {t('runCard')}
            </button>
            <button onClick={onClose} title={t('close')} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* LEFT: GENERAL */}
          <div className="w-80 shrink-0 border-r border-slate-200 overflow-y-auto p-4 space-y-5 bg-slate-50/40">
            <div className="space-y-2.5">
              <span className={sectionCls}>{t('generalSection')}</span>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('cardTitleField')}</label>
                <input
                  type="text"
                  value={card.title}
                  onChange={(e) => update({ title: e.target.value })}
                  className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg px-2.5 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('varNameField')}</label>
                <input
                  type="text"
                  value={cardVarName(card)}
                  onChange={(e) => update({ varName: normalizeVarName(e.target.value) })}
                  placeholder="getActiveProducts"
                  className={inputCls}
                />
              </div>
              {formKind !== 'http' && formKind !== 'swagger' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('endpointField')}</label>
                  <input type="text" value={card.endpoint} onChange={(e) => update({ endpoint: e.target.value })} className={inputCls} />
                </div>
              )}
            </div>

            {/* Block type */}
            <div className="space-y-2">
              <span className={`${sectionCls} block`}>{t('blockType')}</span>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'request', label: t('typeRequest'), icon: Loader2 },
                  { id: 'script', label: t('typeScript'), icon: Database },
                  { id: 'json', label: t('typeJson'), icon: FileJson },
                  { id: 'validation', label: t('typeValidation'), icon: CheckCircle2 }
                ].map((item) => {
                  const Icon = item.icon;
                  const active = card.type === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => update({ type: item.id as CardType })}
                      className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition-all ${
                        active
                          ? 'border-blue-600 bg-blue-50/70 text-blue-700 shadow-2xs'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Source */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className={sectionCls}>{t('frameSource')}</span>
                <button onClick={onOpenSources} className="text-[10px] font-medium text-blue-600 hover:text-blue-700">
                  {t('manageSources')}
                </button>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">type-source</label>
                <select
                  value={sourceType}
                  onChange={(e) => update({ sourceType: e.target.value, sourceName: '', script: undefined })}
                  className={inputCls}
                >
                  {SOURCE_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              {sourceType !== 'inline' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">name-source</label>
                  <select
                    value={card.sourceName || ''}
                    onChange={(e) => update({ sourceName: e.target.value, script: undefined })}
                    className={inputCls}
                  >
                    <option value="">{t('sourceNamePlaceholder')}</option>
                    {card.sourceName && !source && <option value={card.sourceName}>{card.sourceName} (?)</option>}
                    {sources
                      .filter((s) => s.typeSource === sourceType)
                      .map((s) => (
                        <option key={s.name} value={s.name}>{s.name}</option>
                      ))}
                  </select>
                </div>
              )}
            </div>

            {/* Timeout */}
            <div>
              <label className="flex items-center justify-between text-xs font-medium text-slate-600 mb-1">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  {t('timeoutLabel')}
                </span>
                <span className="font-mono text-[11px] text-slate-500">{(card.timeout / 1000).toFixed(1)}s</span>
              </label>
              <input
                type="number"
                step={500}
                min={500}
                max={60000}
                value={card.timeout}
                onChange={(e) => update({ timeout: Math.max(500, Number(e.target.value) || 1000) })}
                className={inputCls}
              />
            </div>

            {/* Dimensions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className={sectionCls}>{t('dimensions')}</span>
                <span className="text-[10px] text-slate-400 font-mono">px</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['W', 'width', 165, 680],
                  ['H', 'height', 110, 620]
                ] as const).map(([label, key, min, max]) => (
                  <div
                    key={key}
                    className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between focus-within:border-blue-500"
                  >
                    <span className="text-[11px] font-bold text-slate-400">{label}</span>
                    <input
                      type="number"
                      min={min}
                      max={max}
                      value={card[key]}
                      onChange={(e) => update({ [key]: Math.max(min, Math.min(max, Number(e.target.value) || min)) })}
                      className="w-16 text-right text-xs font-mono font-semibold text-slate-800 bg-transparent outline-none"
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => update({ width: preset.w, height: preset.h })}
                    className="flex-1 text-[11px] py-1 px-1.5 rounded bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 font-medium transition-colors"
                  >
                    {t(preset.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            {/* Last run status */}
            <div className="p-3 rounded-xl bg-white border border-slate-200/80 space-y-1.5">
              <span className="text-[11px] font-semibold text-slate-500 block">{t('lastRunStatus')}</span>
              <div className="flex items-center gap-2">
                {card.status === 'success' && (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs font-semibold text-emerald-700">{t('statusSuccess')}</span>
                  </>
                )}
                {card.status === 'error' && (
                  <>
                    <XCircle className="w-4 h-4 text-rose-500" />
                    <span className="text-xs font-semibold text-rose-700">{t('statusError')}</span>
                  </>
                )}
                {card.status === 'running' && (
                  <>
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                    <span className="text-xs font-semibold text-blue-700">{t('statusRunning')}</span>
                  </>
                )}
                {card.status === 'idle' && (
                  <>
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                    <span className="text-xs text-slate-500">{t('statusIdle')}</span>
                  </>
                )}
              </div>
            </div>

            <button
              onClick={() => onDeleteCard(card.id)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50/60 hover:bg-rose-100 text-rose-700 text-xs font-semibold transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('removeBlock')}
            </button>
          </div>

          {/* RIGHT: FORM OF THE CARD'S SOURCE TYPE */}
          <div className="flex-1 min-w-0 overflow-y-auto p-5 space-y-5">
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className={sectionCls}>{t('sourceFormTitle', { type: sourceType })}</span>
                {card.sourceName && <span className="text-[11px] font-mono text-slate-500 truncate">{sourceType}/{card.sourceName}</span>}
              </div>
              <SourceForm card={card} source={source} onChange={update} />
            </div>

            {/* Last run of this card */}
            {lastRun && (
              <div
                className={`rounded-xl border p-3 space-y-2 ${
                  lastRun.status === 'error' ? 'border-rose-200 bg-rose-50/50' : 'border-emerald-200 bg-emerald-50/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={sectionCls}>{t('lastRunResult')}</span>
                  <span className="text-[11px] font-mono text-slate-500">{lastRun.at}</span>
                </div>
                <p className={`text-xs font-medium ${lastRun.status === 'error' ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {lastRun.text}
                </p>
                <pre className="max-h-56 overflow-auto bg-[#191B24] text-slate-100 font-mono text-[11px] leading-5 p-3 rounded-lg whitespace-pre-wrap break-all select-text">
                  {lastRun.output}
                </pre>
              </div>
            )}

            {/* Private data: saved to {var-file}.private.md (gitignored) */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t('privateDataLabel')}</label>
              <textarea
                value={card.privateData ?? ''}
                onChange={(e) => update({ privateData: e.target.value })}
                placeholder={t('privateDataHint')}
                rows={3}
                spellCheck={false}
                className="w-full text-xs font-mono text-slate-800 bg-amber-50/40 border border-amber-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:border-amber-500 outline-none resize-y"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
