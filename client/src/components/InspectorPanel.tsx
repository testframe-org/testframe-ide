import {
  CheckCircle2,
  Clock,
  Code2,
  Database,
  FileJson,
  Loader2,
  Sliders,
  Trash2,
  XCircle
} from 'lucide-react';
import { HTTP_METHODS, SOURCE_TYPES, endpointParts, toVarName } from '../frames';
import { useI18n } from '../i18n';
import type { Card, CardType, SelectedContext, SourceDef } from '../types';

interface InspectorPanelProps {
  selectedContext: SelectedContext | null;
  sources: SourceDef[];
  onUpdateCard: (cardId: string, updates: Partial<Card>) => void;
  onDeleteCard: (cardId: string) => void;
  onOpenSources: () => void;
}

const PRESETS = [
  { id: 'compact', labelKey: 'presetCompact', w: 200, h: 140 },
  { id: 'medium', labelKey: 'presetMedium', w: 310, h: 210 },
  { id: 'expanded', labelKey: 'presetExpanded', w: 420, h: 310 }
] as const;

// ============================================================================
// RIGHT SIDE PANEL, FIGMA-STYLE INSPECTOR
// ============================================================================
export function InspectorPanel({
  selectedContext,
  sources,
  onUpdateCard,
  onDeleteCard,
  onOpenSources
}: InspectorPanelProps) {
  const { t } = useI18n();

  return (
    <aside className="w-72 lg:w-80 bg-white border-l border-slate-200 flex flex-col z-20 shrink-0">
      <div className="h-11 px-4 border-b border-slate-200 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-blue-600" />
          {t('blockInspector')}
        </span>
        {selectedContext && (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-600">
            {t('stepN', { n: selectedContext.stepNumber })}
          </span>
        )}
      </div>

      {selectedContext ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Card identification */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                {t('blockLayer')}
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  selectedContext.phaseKey === 'preCards'
                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                    : 'bg-teal-50 text-teal-700 border border-teal-200'
                }`}
              >
                {selectedContext.phaseKey === 'preCards' ? t('phasePre') : t('phasePost')}
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {t('cardTitleField')}
              </label>
              <input
                type="text"
                value={selectedContext.card.title}
                onChange={(e) => onUpdateCard(selectedContext.card.id, { title: e.target.value })}
                className="w-full text-xs font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t('varNameField')}</label>
              <input
                type="text"
                value={selectedContext.card.varName ?? toVarName(selectedContext.card.title)}
                onChange={(e) => onUpdateCard(selectedContext.card.id, { varName: toVarName(e.target.value) })}
                placeholder="obterProdutosAtivos"
                className="w-full text-xs font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:border-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {t('endpointField')}
              </label>
              <input
                type="text"
                value={selectedContext.card.endpoint}
                onChange={(e) => onUpdateCard(selectedContext.card.id, { endpoint: e.target.value })}
                className="w-full text-xs font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Figma-style dimensions (W x H) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                {t('dimensions')}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">px</span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between focus-within:border-blue-500 focus-within:bg-white">
                <span className="text-[11px] font-bold text-slate-400">W</span>
                <input
                  type="number"
                  min={165}
                  max={680}
                  value={selectedContext.card.width}
                  onChange={(e) =>
                    onUpdateCard(selectedContext.card.id, {
                      width: Math.max(165, Math.min(680, Number(e.target.value) || 165))
                    })
                  }
                  className="w-16 text-right text-xs font-mono font-semibold text-slate-800 bg-transparent outline-none"
                />
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between focus-within:border-blue-500 focus-within:bg-white">
                <span className="text-[11px] font-bold text-slate-400">H</span>
                <input
                  type="number"
                  min={110}
                  max={620}
                  value={selectedContext.card.height}
                  onChange={(e) =>
                    onUpdateCard(selectedContext.card.id, {
                      height: Math.max(110, Math.min(620, Number(e.target.value) || 110))
                    })
                  }
                  className="w-16 text-right text-xs font-mono font-semibold text-slate-800 bg-transparent outline-none"
                />
              </div>
            </div>

            {/* Quick size presets */}
            <div className="flex items-center gap-1.5 pt-0.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() =>
                    onUpdateCard(selectedContext.card.id, {
                      width: preset.w,
                      height: preset.h
                    })
                  }
                  className="flex-1 text-[11px] py-1 px-1.5 rounded bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 font-medium transition-colors"
                >
                  {t(preset.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Block type */}
          <div className="space-y-2.5">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
              {t('blockType')}
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'request', label: t('typeRequest'), icon: Loader2 },
                { id: 'script', label: t('typeScript'), icon: Database },
                { id: 'json', label: t('typeJson'), icon: FileJson },
                { id: 'validation', label: t('typeValidation'), icon: CheckCircle2 }
              ].map((item) => {
                const Icon = item.icon;
                const active = selectedContext.card.type === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() =>
                      onUpdateCard(selectedContext.card.id, { type: item.id as CardType })
                    }
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

          <hr className="border-slate-100" />

          {/* Frame source (persisted in the .md) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                {t('frameSource')}
              </span>
              <button
                onClick={onOpenSources}
                className="text-[10px] font-medium text-blue-600 hover:text-blue-700"
              >
                {t('manageSources')}
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">type-source</label>
              <select
                value={selectedContext.card.sourceType || 'inline'}
                onChange={(e) => onUpdateCard(selectedContext.card.id, { sourceType: e.target.value })}
                className="w-full text-xs font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:border-blue-500 outline-none"
              >
                {SOURCE_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">type-name-source</label>
              <input
                list="sources-names"
                type="text"
                value={selectedContext.card.sourceName || ''}
                onChange={(e) => onUpdateCard(selectedContext.card.id, { sourceName: e.target.value })}
                placeholder={t('sourceNamePlaceholder')}
                className="w-full text-xs font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:border-blue-500 outline-none"
              />
              <datalist id="sources-names">
                {sources.map((source) => (
                  <option key={`${source.typeSource}/${source.name}`} value={source.name} />
                ))}
              </datalist>
            </div>

            {selectedContext.card.type === 'request' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">http-method</label>
                <select
                  value={
                    selectedContext.card.httpMethod ||
                    endpointParts(selectedContext.card)?.method ||
                    'POST'
                  }
                  onChange={(e) => {
                    const method = e.target.value;
                    const path = selectedContext.card.endpoint.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/i, '');
                    onUpdateCard(selectedContext.card.id, {
                      httpMethod: method,
                      endpoint: `${method} ${path}`
                    });
                  }}
                  className="w-full text-xs font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:border-blue-500 outline-none"
                >
                  {HTTP_METHODS.map((method) => (
                    <option key={method} value={method}>{method}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Timeout & status */}
          <div className="space-y-3">
            <div>
              <label className="flex items-center justify-between text-xs font-medium text-slate-600 mb-1">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  {t('timeoutLabel')}
                </span>
                <span className="font-mono text-[11px] text-slate-500">
                  {(selectedContext.card.timeout / 1000).toFixed(1)}s
                </span>
              </label>
              <input
                type="number"
                step={500}
                min={500}
                max={60000}
                value={selectedContext.card.timeout}
                onChange={(e) =>
                  onUpdateCard(selectedContext.card.id, {
                    timeout: Math.max(500, Number(e.target.value) || 1000)
                  })
                }
                className="w-full text-xs font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:border-blue-500 outline-none"
              />
            </div>

            {/* Last run status */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
              <span className="text-[11px] font-semibold text-slate-500 block">
                {t('lastRunStatus')}
              </span>
              <div className="flex items-center gap-2">
                {selectedContext.card.status === 'success' && (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs font-semibold text-emerald-700">{t('statusSuccess')}</span>
                  </>
                )}
                {selectedContext.card.status === 'error' && (
                  <>
                    <XCircle className="w-4 h-4 text-rose-500" />
                    <span className="text-xs font-semibold text-rose-700">{t('statusError')}</span>
                  </>
                )}
                {selectedContext.card.status === 'running' && (
                  <>
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                    <span className="text-xs font-semibold text-blue-700">{t('statusRunning')}</span>
                  </>
                )}
                {selectedContext.card.status === 'idle' && (
                  <>
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                    <span className="text-xs text-slate-500">{t('statusIdle')}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Card actions */}
          <div className="pt-1">
            <button
              onClick={() => onDeleteCard(selectedContext.card.id)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50/60 hover:bg-rose-100 text-rose-700 text-xs font-semibold transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('removeBlock')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-400">
          <Code2 className="w-9 h-9 mb-2 text-slate-300" />
          <p className="text-xs font-medium text-slate-600">{t('noBlockSelected')}</p>
          <p className="text-[11px] mt-1">{t('noBlockHint')}</p>
        </div>
      )}
    </aside>
  );
}
