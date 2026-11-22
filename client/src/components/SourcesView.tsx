import React from 'react';
import { Plus, Trash2, Save, Loader2, RefreshCw, AlertCircle, FileCode2 } from 'lucide-react';
import { ApiError, testframeApi } from '../client-api';
import { SOURCE_TYPES, hasScripts, validateSourceCode } from '../frames';
import { useI18n } from '../i18n';
import type { LogLevel, SourceDef, SourceScript } from '../types';

interface SourcesViewProps {
  project: string;
  sources: SourceDef[];
  setSources: React.Dispatch<React.SetStateAction<SourceDef[]>>;
  onLog?: (text: string, type?: LogLevel) => void;
}

// ============================================================================
// SOURCES TAB: register and edit the project's sources (full-page view)
// ============================================================================
export function SourcesView({ project, sources, setSources, onLog }: SourcesViewProps) {
  const { t } = useI18n();
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<string[]>([]);

  const current = sources[selectedIndex];

  const updateCurrent = (updates: Partial<SourceDef>) =>
    setSources((prev) => prev.map((s, i) => (i === selectedIndex ? { ...s, ...updates } : s)));

  const updateScript = (index: number, updates: Partial<SourceScript>) => {
    const next = (current.scripts ?? []).map((s, i) => (i === index ? { ...s, ...updates } : s));
    updateCurrent({ scripts: next });
  };

  const addScript = () => {
    const next = [...(current.scripts ?? []), { name: `newScript${(current.scripts?.length ?? 0) + 1}`, body: '' }];
    updateCurrent({ scripts: next });
  };

  const removeScript = (index: number) => {
    updateCurrent({ scripts: (current.scripts ?? []).filter((_, i) => i !== index) });
  };

  const addSource = () => {
    setSources((prev) => {
      const next = [
        ...prev,
        { typeSource: 'restapi', name: `new-source-${prev.length + 1}`, publicData: '', privateData: '', scripts: [] }
      ];
      setSelectedIndex(next.length - 1);
      return next;
    });
    setErrors([]);
  };

  const removeSource = () => {
    setSources((prev) => prev.filter((_, i) => i !== selectedIndex));
    setSelectedIndex((i) => Math.max(0, Math.min(i, sources.length - 2)));
    setErrors([]);
  };

  // Code rules per source type are checked here; names, types and the file layout are validated
  // by the server on save (its 400 reasons land in the same error list)
  const validate = (): boolean => {
    const issues: string[] = [];
    sources.forEach((s, i) => {
      (s.scripts ?? []).forEach((script, j) => {
        const problem = validateSourceCode(s.typeSource, script.body);
        if (problem) issues.push(`Source ${i + 1} (${s.name || '?'}): scripts.${j}.body: ${script.name}: ${problem}`);
      });
    });
    setErrors(issues);
    return issues.length === 0;
  };

  const saveAll = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const data = await testframeApi.saveSources(project, sources);
      onLog?.(t('savedSources', { n: data.saved, root: data.root }), 'success');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setErrors(err.reason.split('; '));
      onLog?.(t('savedSourcesFail', { msg: (err as Error).message }), 'error');
    } finally {
      setSaving(false);
    }
  };

  const loadAll = async () => {
    try {
      const data = await testframeApi.loadSources(project);
      if (data.sources?.length) {
        setSources(data.sources);
        setSelectedIndex(0);
        onLog?.(t('loadedSources', { n: data.sources.length }), 'success');
      } else {
        onLog?.(t('noSavedSources'), 'error');
      }
    } catch (err) {
      onLog?.(t('loadedSourcesFail', { msg: (err as Error).message }), 'error');
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-white">
        {/* SOURCE LIST */}
        <div className="w-72 shrink-0 border-r border-slate-200 flex flex-col bg-slate-50/70">
          <div className="h-12 px-3 flex items-center justify-between border-b border-slate-200">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600">{t('sources')}</span>
            <button
              onClick={addSource}
              title={t('newSource')}
              className="p-1 rounded-md hover:bg-white text-blue-600"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sources.map((s, i) => (
              <button
                key={`${s.typeSource}/${s.name}-${i}`}
                onClick={() => {
                  setSelectedIndex(i);
                  setErrors([]);
                }}
                className={`w-full text-left px-2.5 py-2 rounded-lg border text-xs transition-colors ${
                  i === selectedIndex
                    ? 'bg-white border-blue-500 shadow-2xs'
                    : 'border-transparent hover:bg-white/70'
                }`}
              >
                <span className="block font-semibold text-slate-800 truncate">{s.name}</span>
                <span className="mt-0.5 inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-200">
                  {s.typeSource}
                </span>
              </button>
            ))}
            {!sources.length && (
              <p className="text-[11px] text-slate-400 px-2 py-4 text-center">{t('noSources')}</p>
            )}
          </div>

          <div className="p-2 border-t border-slate-200 flex gap-1.5">
            <button
              onClick={loadAll}
              className="flex-1 flex items-center justify-center gap-1 text-[11px] font-medium px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
            >
              <RefreshCw className="w-3 h-3" />
              {t('read')}
            </button>
            <button
              onClick={saveAll}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              {t('save')}
            </button>
          </div>
        </div>

        {/* SOURCE EDITOR */}
        {current ? (
          <div className="flex-1 flex flex-col min-w-0">
            <div className="h-12 px-4 flex items-center justify-between border-b border-slate-200 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <select
                  value={current.typeSource}
                  onChange={(e) => updateCurrent({ typeSource: e.target.value })}
                  className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-blue-500"
                >
                  {SOURCE_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                <input
                  value={current.name}
                  onChange={(e) => updateCurrent({ name: e.target.value })}
                  className="text-xs font-semibold text-slate-800 bg-transparent border-b border-dashed border-slate-300 focus:border-blue-500 outline-none py-0.5 w-52"
                />
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={removeSource}
                  title={t('deleteSource')}
                  className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 border border-rose-200"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="px-4 py-2.5 border-b border-slate-100">
              <label className="flex items-center gap-2 text-[10px] font-mono text-slate-500">
                base-url
                <input
                  type="text"
                  value={current.baseUrl ?? ''}
                  onChange={(e) => updateCurrent({ baseUrl: e.target.value })}
                  placeholder={
                    current.typeSource === 'swagger'
                      ? 'http://localhost:18081/api/docs/openapi.json'
                      : 'mongodb://localhost:27017/products'
                  }
                  className="flex-1 min-w-0 text-xs font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-500"
                />
              </label>
            </div>

            <div className="flex-1 flex flex-col gap-3 p-4 min-h-0 overflow-y-auto">
              <label className="flex flex-col gap-1 min-h-[120px]">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  {current.name || '{name}'}.md{' '}
                  <span className="normal-case font-normal text-slate-400">{t('publicDataDesc')}</span>
                </span>
                <textarea
                  spellCheck={false}
                  value={current.publicData}
                  onChange={(e) => updateCurrent({ publicData: e.target.value })}
                  placeholder={t('publicPlaceholder')}
                  className="flex-1 min-h-[100px] resize-y bg-[#191B24] text-slate-100 font-mono text-[12px] leading-5 p-3 rounded-lg border border-slate-700 outline-none focus:border-blue-500/60"
                />
              </label>

              <label className="flex flex-col gap-1 min-h-[90px]">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  {current.name || '{name}'}.private.md{' '}
                  <span className="normal-case font-normal text-slate-400">{t('privateDataDesc')}</span>
                </span>
                <textarea
                  spellCheck={false}
                  value={current.privateData}
                  onChange={(e) => updateCurrent({ privateData: e.target.value })}
                  placeholder={t('privatePlaceholder')}
                  className="flex-1 min-h-[70px] resize-y bg-[#191B24] text-slate-100 font-mono text-[12px] leading-5 p-3 rounded-lg border border-slate-700 outline-none focus:border-amber-500/60"
                />
              </label>

              {/* {name}/{script}.md — custom queries (swagger sources rely on the spec instead) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <FileCode2 className="w-3.5 h-3.5 text-emerald-600" />
                    scripts/
                    <span className="normal-case font-normal text-slate-400 lowercase">{t('scriptsHint')}</span>
                  </span>
                  {hasScripts(current.typeSource) && (
                    <button
                      onClick={addScript}
                      className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-700 px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50/60"
                    >
                      <Plus className="w-3 h-3" />
                      {t('addScript')}
                    </button>
                  )}
                </div>

                {!hasScripts(current.typeSource) && (
                  <p className="text-[11px] text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    swagger: endpoints are defined 100% by the spec at base-url — no custom scripts needed.
                  </p>
                )}

                {hasScripts(current.typeSource) && !(current.scripts?.length) && (
                  <p className="text-[11px] text-slate-400">{t('noScripts')}</p>
                )}

                {hasScripts(current.typeSource) &&
                  (current.scripts ?? []).map((script, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-400">script-name</span>
                        <input
                          value={script.name}
                          onChange={(e) => updateScript(i, { name: e.target.value })}
                          className="flex-1 min-w-0 text-xs font-mono text-slate-800 bg-white border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-500"
                        />
                        <button
                          onClick={() => removeScript(i)}
                          title={t('removeScript')}
                          className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <textarea
                        spellCheck={false}
                        value={script.body}
                        onChange={(e) => updateScript(i, { body: e.target.value })}
                        placeholder={'db.collection.find({ ... })'}
                        className="w-full h-40 resize-y bg-[#191B24] text-slate-100 font-mono text-[12px] leading-5 p-2.5 rounded border border-slate-700 outline-none focus:border-emerald-500/60"
                      />
                    </div>
                  ))}
              </div>
            </div>

            {errors.length > 0 && (
              <div className="mx-4 mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 space-y-0.5 shrink-0">
                {errors.map((error, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
            {t('createFirst')}
          </div>
        )}
    </div>
  );
}
