'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, Clock, Loader2, MinusCircle, Play, Sliders, Trash2, X, XCircle } from 'lucide-react';
import { cardTypeOf, formKindOf, hasSources, isCompleteKind, sourceTypes, subtypesOf } from '../catalog';
import { cardVarName, normalizeVarName } from '../frames';
import { useI18n, type TKey } from '../i18n';
import type { DisplayUrl } from '../sources-model';
import { formatElapsed, type CardRunView, type EditorCard, type SelectedContext } from '../types';
import { CardForm } from './card-form';
import { RunOutput } from './run-output';

interface CardEditModalProps {
  /** null = closed. */
  selectedContext: SelectedContext | null;
  project: string;
  /** The current environment: runs and the OpenAPI operations cache use it. */
  environment: string | null;
  /** Declared source names of a type (the Sources tab owns the model). */
  sourcesOfType: (sourceType: string) => string[];
  /** Display-only connection of a source in the current environment. */
  connectionOf: (sourceType: string, sourceName: string) => DisplayUrl | null;
  onClose: () => void;
  onRun: (cardId: string) => void;
  /** A run (single card or frame) is in progress. */
  running: boolean;
  lastRun?: CardRunView;
  onUpdateCard: (cardId: string, updates: Partial<EditorCard>) => void;
  onDeleteCard: (cardId: string) => void;
  onOpenSources: () => void;
  onLog?: (text: string, type?: 'info' | 'success' | 'error') => void;
  /** Variables published by the cards before the edited one, for completion. */
  completionVars?: Record<string, unknown>;
}

const PRESETS: { id: string; labelKey: TKey; w: number; h: number }[] = [
  { id: 'compact', labelKey: 'presetCompact', w: 200, h: 140 },
  { id: 'medium', labelKey: 'presetMedium', w: 310, h: 210 },
  { id: 'expanded', labelKey: 'presetExpanded', w: 420, h: 310 }
];

const inputCls =
  'w-full text-xs font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:border-blue-500 outline-none';
const sectionCls = 'text-[11px] font-semibold text-slate-400 uppercase tracking-wider';

/**
 * The card editor (Radix Dialog): what every card has on the left, the form of the card's
 * (type-source, subtype) on the right. The form only appears once that pair is complete.
 */
export function CardEditModal({ selectedContext, onClose, ...rest }: CardEditModalProps) {
  return (
    <Dialog.Root
      open={selectedContext !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {selectedContext && <CardEditDialog context={selectedContext} onClose={onClose} {...rest} />}
    </Dialog.Root>
  );
}

function CardEditDialog({
  context,
  project,
  environment,
  sourcesOfType,
  connectionOf,
  onClose,
  onRun,
  running,
  lastRun,
  onUpdateCard,
  onDeleteCard,
  onOpenSources,
  onLog,
  completionVars
}: Omit<CardEditModalProps, 'selectedContext'> & { context: SelectedContext }) {
  const { t } = useI18n();
  const { card } = context;
  const update = (updates: Partial<EditorCard>) => onUpdateCard(card.id, updates);
  const sourceType = card.sourceType;
  const names = hasSources(sourceType) ? sourcesOfType(sourceType) : [];
  const declared = names.includes(card.sourceName);
  const subtypes = subtypesOf(sourceType);
  const complete = isCompleteKind(sourceType, card.subtype);
  const formKind = formKindOf(sourceType, card.subtype);

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px]" />
      <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[980px] max-w-[95vw] h-[680px] max-h-[92vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* HEADER */}
        <div className="h-12 px-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <Dialog.Title className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5 min-w-0">
            <Sliders className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            {t('editCardTitle')}
            <span className="normal-case font-mono font-medium text-slate-500 truncate">· {cardVarName(card)}</span>
          </Dialog.Title>
          <Dialog.Description className="sr-only">{t('stepN', { n: context.stepNumber })}</Dialog.Description>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-600">
              {t('stepN', { n: context.stepNumber })}
            </span>
            <button
              type="button"
              onClick={() => onRun(card.id)}
              disabled={running}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300 transition-colors"
            >
              {card.status === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              {t('runCard')}
            </button>
            <Dialog.Close asChild>
              <button type="button" title={t('close')} aria-label={t('close')} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* LEFT: GENERAL */}
          <div className="w-80 shrink-0 border-r border-slate-200 overflow-y-auto p-4 space-y-5 bg-slate-50/40">
            {/* Source first: type-source -> subtype (when the type has them) -> name-source */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className={sectionCls}>{t('frameSource')}</span>
                <button type="button" onClick={onOpenSources} className="text-[10px] font-medium text-blue-600 hover:text-blue-700">
                  {t('manageSources')}
                </button>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="card-source-type">
                  type-source
                </label>
                <select
                  id="card-source-type"
                  value={card.sourceType}
                  autoFocus={card.sourceType === ''}
                  onChange={(e) => {
                    const next = e.target.value;
                    // a new type clears the subtype (a type with a single subtype gets it); the
                    // project's first source of that type is the default name-source
                    const first = hasSources(next) ? (sourcesOfType(next)[0] ?? '') : '';
                    const only = subtypesOf(next).length === 1 ? subtypesOf(next)[0] : undefined;
                    update({
                      sourceType: next,
                      subtype: only,
                      type: cardTypeOf(next, only),
                      sourceName: first,
                      openapiId: undefined,
                      collection: undefined
                    });
                  }}
                  className={`${inputCls} ${card.sourceType ? '' : 'ring-2 ring-blue-500/40 border-blue-500'}`}
                >
                  {!card.sourceType && <option value="" disabled>{t('sourceTypePlaceholder')}</option>}
                  {sourceTypes().map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              {subtypes.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="card-subtype">
                    subtype
                  </label>
                  <select
                    id="card-subtype"
                    value={card.subtype ?? ''}
                    autoFocus={!card.subtype}
                    onChange={(e) => {
                      const next = e.target.value || undefined;
                      update({ subtype: next, type: cardTypeOf(sourceType, next) });
                    }}
                    className={`${inputCls} ${card.subtype ? '' : 'ring-2 ring-blue-500/40 border-blue-500'}`}
                  >
                    {!card.subtype && <option value="" disabled>{t('subtypePlaceholder')}</option>}
                    {card.subtype && !subtypes.includes(card.subtype) && <option value={card.subtype}>{card.subtype} (?)</option>}
                    {subtypes.map((sub) => (
                      <option key={sub} value={sub}>
                        {sub}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {hasSources(sourceType) && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="card-source-name">
                    name-source
                  </label>
                  <select
                    id="card-source-name"
                    value={card.sourceName || ''}
                    onChange={(e) => update({ sourceName: e.target.value, openapiId: undefined })}
                    className={inputCls}
                  >
                    <option value="">{t('sourceNamePlaceholder')}</option>
                    {card.sourceName && !declared && <option value={card.sourceName}>{card.sourceName} (?)</option>}
                    {names.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  {!names.length && <p className="mt-1 text-[11px] text-amber-700">{t('noSourceOfType', { type: sourceType })}</p>}
                </div>
              )}

              {sourceType === 'mongo' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="card-collection">
                    collection
                  </label>
                  <input
                    id="card-collection"
                    type="text"
                    value={card.collection ?? ''}
                    onChange={(e) => update({ collection: e.target.value || undefined })}
                    placeholder="products"
                    className={`${inputCls} ${card.collection ? '' : 'ring-2 ring-blue-500/40 border-blue-500'}`}
                  />
                  {!card.collection && <p className="mt-1 text-[11px] text-slate-500">{t('collectionRequired')}</p>}
                </div>
              )}
            </div>

            <div className="space-y-2.5">
              <span className={sectionCls}>{t('generalSection')}</span>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="card-title">
                  {t('cardTitleField')}
                </label>
                <input
                  id="card-title"
                  type="text"
                  value={card.title}
                  onChange={(e) => update({ title: e.target.value })}
                  className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg px-2.5 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="card-varname">
                  {t('varNameField')}
                </label>
                <input
                  id="card-varname"
                  type="text"
                  value={cardVarName(card)}
                  onChange={(e) => update({ varName: normalizeVarName(e.target.value) })}
                  placeholder="getActiveProducts"
                  className={inputCls}
                />
              </div>
              {formKind && formKind !== 'request' && formKind !== 'swagger' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="card-endpoint">
                    {t('endpointField')}
                  </label>
                  <input id="card-endpoint" type="text" value={card.endpoint} onChange={(e) => update({ endpoint: e.target.value })} className={inputCls} />
                </div>
              )}
            </div>

            {/* Timeout */}
            <div>
              <label className="flex items-center justify-between text-xs font-medium text-slate-600 mb-1" htmlFor="card-timeout">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  {t('timeoutLabel')}
                </span>
                <span className="font-mono text-[11px] text-slate-500">{(card.timeout / 1000).toFixed(1)}s</span>
              </label>
              <input
                id="card-timeout"
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
                  <div key={key} className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between focus-within:border-blue-500">
                    <label className="text-[11px] font-bold text-slate-400" htmlFor={`card-${key}`}>
                      {label}
                    </label>
                    <input
                      id={`card-${key}`}
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
                    type="button"
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
                {card.status === 'skipped' && (
                  <>
                    <MinusCircle className="w-4 h-4 text-slate-500" />
                    <span className="text-xs font-semibold text-slate-600">{t('statusSkipped')}</span>
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
              type="button"
              onClick={() => onDeleteCard(card.id)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50/60 hover:bg-rose-100 text-rose-700 text-xs font-semibold transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('removeBlock')}
            </button>
          </div>

          {/* RIGHT: THE FORM OF THE CARD'S (type-source, subtype) */}
          <div className="flex-1 min-w-0 overflow-y-auto p-5 space-y-5">
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className={sectionCls}>
                  {complete
                    ? t('sourceFormTitle', { type: card.subtype ? `${sourceType} · ${card.subtype}` : sourceType })
                    : card.sourceType
                      ? t('subtypePlaceholder')
                      : t('sourceTypePlaceholder')}
                </span>
                {card.sourceName && <span className="text-[11px] font-mono text-slate-500 truncate">{sourceType}/{card.sourceName}</span>}
              </div>
              {complete ? (
                <CardForm
                  card={card}
                  project={project}
                  environment={environment}
                  connection={connectionOf(sourceType, card.sourceName)}
                  onChange={update}
                  onLog={onLog}
                  completionVars={completionVars}
                />
              ) : (
                <p className="text-xs text-slate-500 border border-dashed border-slate-300 rounded-lg p-4">
                  {card.sourceType ? t('subtypeFirstHint') : t('sourceTypeFirstHint')}
                </p>
              )}
            </div>

            {/* Last run of this card, in the current environment */}
            {lastRun && (
              <div
                className={`rounded-xl border p-3 space-y-2 ${
                  lastRun.status === 'error'
                    ? 'border-rose-200 bg-rose-50/50'
                    : lastRun.status === 'skipped'
                      ? 'border-slate-200 bg-slate-50'
                      : 'border-emerald-200 bg-emerald-50/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={sectionCls}>{environment ? t('lastRunOf', { env: environment }) : t('lastRunResult')}</span>
                  <span className="text-[11px] font-mono text-slate-500">{formatElapsed(lastRun.elapsedMs)}</span>
                </div>
                <p
                  className={`text-xs font-medium ${
                    lastRun.status === 'error' ? 'text-rose-700' : lastRun.status === 'skipped' ? 'text-slate-600' : 'text-emerald-700'
                  }`}
                >
                  {lastRun.text}
                </p>
                <RunOutput output={lastRun.output} className="max-h-56 overflow-auto bg-[#191B24] text-slate-100 text-[11px] leading-5 p-3 rounded-lg" />
              </div>
            )}

            {/* Private notes: {var-file}.private.md, gitignored, never sent to the plugin */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="card-private">
                {t('privateDataLabel')}
              </label>
              <textarea
                id="card-private"
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
      </Dialog.Content>
    </Dialog.Portal>
  );
}
