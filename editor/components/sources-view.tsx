'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Check, Globe, Lock, Plus, RefreshCw, Save, Trash2, Unlock, Loader2 } from 'lucide-react';
import { environmentNameProblem, sourceNameProblem } from '@/lib/format/names';
import type { SourcesModel } from '@/lib/sources/sources-yaml';
import { namedSourceTypes } from '../catalog';
import { useI18n } from '../i18n';
import {
  ALL_SCOPE,
  addEnvironment,
  addSource,
  baseUrlState,
  declaredCount,
  envScope,
  headerNames,
  headerState,
  isStoredPrivate,
  layerFile,
  removeEnvironment,
  removeSource,
  renameSource,
  scopeFiles,
  setBaseUrl,
  setHeader,
  sourceNames,
  toggledValue,
  type FieldState,
  type SourcesScope
} from '../sources-model';

// The Sources tab (Phase 3, item 3): the project's sources.yaml and its layers. A source exists
// only if declared in sources.yaml; the layers only override declared sources. The scope selector
// decides which two files an edit writes: "all environments" edits sources.yaml (shared) and
// sources.private.yaml (credentials), a specific environment edits sources.{env}.yaml (override)
// and sources.{env}.private.yaml (credentials). The IDE validates and rewrites the files on save;
// this view only edits the model in memory (agents/specs/project-format.md, "Sources").
// Private values are write-only: the IDE never sends them back (a marker stands in for each), so
// a private field is a password input, empty, saying a value is stored; typing replaces it.

interface SourcesViewProps {
  project: string;
  model: SourcesModel;
  /** Problems the IDE reported while loading the layer files. */
  loadErrors: string[];
  /** Problems of the last rejected save. */
  problems: string[];
  /** Non-fatal warnings of the last save (specs that could not be cached, undeclared source uses). */
  warnings: string[];
  saving: boolean;
  /** The environment the editor currently runs in (the default scope, and the resolution shown). */
  currentEnvironment: string | null;
  onChange: (model: SourcesModel) => void;
  onSave: () => void;
  onReload: () => void;
}

interface Selection {
  type: string;
  name: string;
}

const inputCls =
  'text-xs font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-500 focus:bg-white';

/** A unique, valid source name for a type (`new-source`, `new-source-2`, ...). */
function freshName(model: SourcesModel, type: string): string {
  const taken = new Set(sourceNames(model, type));
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? 'new-source' : `new-source-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Props of a field input: write-only (password, empty, "stored" placeholder) when the scope's value is private. */
function fieldInputProps(state: FieldState, placeholder: string, storedPlaceholder: string) {
  const stored = isStoredPrivate(state);
  return {
    type: state.ownIsPrivate ? 'password' : 'text',
    value: stored ? '' : (state.own ?? ''),
    placeholder: stored ? storedPlaceholder : placeholder,
    autoComplete: state.ownIsPrivate ? 'new-password' : 'off'
  };
}

/** The private/shared toggle of one field: which layer of the current scope holds the value. */
function LayerToggle({ isPrivate, onToggle, title }: { isPrivate: boolean; onToggle: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      aria-pressed={isPrivate}
      className={`shrink-0 p-1.5 rounded border transition-colors ${
        isPrivate
          ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
          : 'border-slate-200 bg-white text-slate-400 hover:text-slate-700 hover:bg-slate-50'
      }`}
    >
      {isPrivate ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
    </button>
  );
}

export function SourcesView({
  project,
  model,
  loadErrors,
  problems,
  warnings,
  saving,
  currentEnvironment,
  onChange,
  onSave,
  onReload
}: SourcesViewProps) {
  const { t } = useI18n();
  const [scope, setScope] = useState<SourcesScope>(ALL_SCOPE);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [newEnv, setNewEnv] = useState('');
  const [newHeader, setNewHeader] = useState({ name: '', value: '' });

  const scopeEnv = scope.kind === 'env' ? scope.env : currentEnvironment;
  // Read per render (not memoised): the catalog is loaded asynchronously, so the list of types
  // with named sources is empty on the first render and filled once GET /api/v2/catalog resolves.
  const types = namedSourceTypes();

  // The scope follows the environments list: an environment that disappears falls back to "all".
  useEffect(() => {
    if (scope.kind === 'env' && !model.environments.includes(scope.env)) setScope(ALL_SCOPE);
  }, [model.environments, scope]);

  // Keep a valid selection: the model also changes from the card editor, from a reload and from
  // deleting a source, and nothing is selected until the sources are known.
  useEffect(() => {
    if (selection && sourceNames(model, selection.type).includes(selection.name)) return;
    const firstType = types.find((type) => sourceNames(model, type).length > 0);
    setSelection(firstType ? { type: firstType, name: sourceNames(model, firstType)[0]! } : null);
  }, [model, selection, types]);

  useEffect(() => {
    if (selection) setNameDraft(selection.name);
  }, [selection]);

  const messages = [...loadErrors, ...problems, ...warnings];

  const commitName = () => {
    if (!selection) return;
    const next = nameDraft.trim();
    if (!next || next === selection.name || sourceNameProblem(next)) {
      setNameDraft(selection.name);
      return;
    }
    onChange(renameSource(model, selection.type, selection.name, next));
    setSelection({ type: selection.type, name: next });
  };

  const selected = selection && sourceNames(model, selection.type).includes(selection.name) ? selection : null;
  const url = selected ? baseUrlState(model, scope, scopeEnv, selected.type, selected.name) : null;
  const headers = selected && selected.type === 'openapi' ? headerNames(model, scopeEnv, selected.type, selected.name) : [];

  return (
    <div className="flex-1 flex overflow-hidden bg-white">
      {/* ------------------------------------------------------------ LEFT: ENVIRONMENTS + SOURCES */}
      <div className="w-80 shrink-0 border-r border-slate-200 flex flex-col bg-slate-50/70">
        <div className="h-12 px-3 flex items-center justify-between border-b border-slate-200">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-600">{t('sourcesTitle', { project })}</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">
            {declaredCount(model)}
          </span>
        </div>

        {/* Scope: which two layer files an edit writes */}
        <div className="px-3 py-2.5 border-b border-slate-200 space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1" htmlFor="sources-scope">
            <Globe className="w-3 h-3" />
            {t('scopeLabel')}
          </label>
          <select
            id="sources-scope"
            value={scope.kind === 'all' ? '' : scope.env}
            onChange={(e) => setScope(e.target.value ? envScope(e.target.value) : ALL_SCOPE)}
            className="w-full text-xs font-mono bg-white border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-blue-500"
          >
            <option value="">{t('scopeAll')}</option>
            {model.environments.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
          <p className="text-[10.5px] text-slate-500 font-mono">
            {scope.kind === 'all' ? t('scopeAllHint') : t('scopeEnvHint', { env: scope.env })}
          </p>
        </div>

        {/* Environments declared by sources.yaml */}
        <div className="px-3 py-2.5 border-b border-slate-200 space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">{t('environmentsLabel')}</span>
          <div className="flex flex-wrap gap-1">
            {model.environments.map((env) => (
              <span key={env} className="group inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                {env}
                <button
                  type="button"
                  aria-label={t('removeEnvironment')}
                  title={t('removeEnvironment')}
                  onClick={() => {
                    if (window.confirm(t('confirmRemoveEnvironment', { env }))) onChange(removeEnvironment(model, env));
                  }}
                  className="text-blue-400 hover:text-rose-600"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            ))}
            {!model.environments.length && <span className="text-[11px] text-amber-700">{t('noEnvironmentsYet')}</span>}
          </div>
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const env = newEnv.trim();
              if (!env || model.environments.includes(env) || environmentNameProblem(env)) return;
              onChange(addEnvironment(model, env));
              setNewEnv('');
            }}
          >
            <input
              value={newEnv}
              onChange={(e) => setNewEnv(e.target.value)}
              placeholder={t('environmentPlaceholder')}
              aria-label={t('environmentsLabel')}
              className={`flex-1 min-w-0 ${inputCls}`}
            />
            <button
              type="submit"
              disabled={!newEnv.trim()}
              className="shrink-0 text-[11px] font-semibold px-2 py-1 rounded border border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-700 disabled:opacity-40"
            >
              {t('addEnvironment')}
            </button>
          </form>
          <p className="text-[10px] text-slate-400">{t('environmentsHint')}</p>
        </div>

        {/* Sources, grouped by type */}
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          {types.map((type) => {
            const names = sourceNames(model, type);
            return (
              <div key={type}>
                <div className="flex items-center justify-between px-1 mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{type}</span>
                  <button
                    type="button"
                    title={t('newSource')}
                    aria-label={t('newSource')}
                    onClick={() => {
                      const name = freshName(model, type);
                      onChange(addSource(model, type, name));
                      setSelection({ type, name });
                    }}
                    className="p-0.5 rounded text-blue-600 hover:bg-white"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-1">
                  {names.map((name) => (
                    <button
                      key={`${type}/${name}`}
                      type="button"
                      onClick={() => setSelection({ type, name })}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
                        selected?.type === type && selected.name === name
                          ? 'bg-white border-blue-500 shadow-2xs'
                          : 'border-transparent hover:bg-white/70'
                      }`}
                    >
                      <span className="block font-mono font-semibold text-slate-800 truncate">{name}</span>
                    </button>
                  ))}
                  {!names.length && <p className="text-[10.5px] text-slate-400 px-2">—</p>}
                </div>
              </div>
            );
          })}
          {!declaredCount(model) && <p className="text-[11px] text-slate-400 px-2 py-4 text-center">{t('noSources')}</p>}
        </div>

        <div className="p-2 border-t border-slate-200 flex gap-1.5">
          <button
            type="button"
            onClick={onReload}
            className="flex-1 flex items-center justify-center gap-1 text-[11px] font-medium px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
          >
            <RefreshCw className="w-3 h-3" />
            {t('read')}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            {t('save')}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------ RIGHT: THE SELECTED SOURCE */}
      {selected && url ? (
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          <div className="h-12 px-4 flex items-center justify-between border-b border-slate-200 gap-3 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-200 shrink-0">
                {selected.type}
              </span>
              <label className="sr-only" htmlFor="source-name">
                {t('sourceNameLabel')}
              </label>
              <input
                id="source-name"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName();
                }}
                className="text-xs font-mono font-semibold text-slate-800 bg-transparent border-b border-dashed border-slate-300 focus:border-blue-500 outline-none py-0.5 w-56"
              />
              {nameDraft !== selected.name && sourceNameProblem(nameDraft) && (
                <span className="text-[10.5px] text-rose-600 shrink-0">{sourceNameProblem(nameDraft)}</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10.5px] font-mono text-slate-400">{scopeFiles(scope).join(' + ')}</span>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t('confirmDeleteSource', { name: `${selected.type}/${selected.name}` }))) {
                    onChange(removeSource(model, selected.type, selected.name));
                    setSelection(null);
                  }
                }}
                title={t('deleteSource')}
                aria-label={t('deleteSource')}
                className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 border border-rose-200"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="p-4 space-y-5">
            {/* base-url */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block" htmlFor="source-base-url">
                {t('baseUrlLabel')}
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="source-base-url"
                  {...fieldInputProps(url, t('baseUrlPlaceholder'), t('privateStoredPlaceholder'))}
                  onChange={(e) => onChange(setBaseUrl(model, scope, url.ownIsPrivate, selected.type, selected.name, e.target.value))}
                  spellCheck={false}
                  className={`flex-1 min-w-0 ${inputCls} ${url.ownIsPrivate ? 'border-amber-300 bg-amber-50/50' : ''}`}
                />
                {isStoredPrivate(url) && (
                  <button
                    type="button"
                    title={t('removePrivateValue')}
                    aria-label={t('removePrivateValue')}
                    onClick={() => onChange(setBaseUrl(model, scope, true, selected.type, selected.name, ''))}
                    className="shrink-0 p-1.5 rounded border border-slate-200 bg-white text-slate-400 hover:text-rose-600 hover:border-rose-200"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <LayerToggle
                  isPrivate={url.ownIsPrivate}
                  title={url.ownIsPrivate ? t('layerPrivateHint') : t('layerSharedHint')}
                  onToggle={() => {
                    const toPrivate = !url.ownIsPrivate;
                    if (isStoredPrivate(url) && !window.confirm(t('confirmPrivateToShared'))) return;
                    const value = toggledValue(url);
                    onChange(
                      setBaseUrl(setBaseUrl(model, scope, toPrivate, selected.type, selected.name, value), scope, !toPrivate, selected.type, selected.name, '')
                    );
                  }}
                />
              </div>
              <FieldFooter state={url} env={scopeEnv} />
              {selected.type === 'openapi' && <p className="text-[10.5px] text-slate-400">{t('openapiSourceHint')}</p>}
              <p className="text-[10.5px] text-slate-400">{t('envPlaceholderHint')}</p>
            </div>

            {/* headers: openapi sources only */}
            {selected.type === 'openapi' && (
              <div className="space-y-2">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">{t('headersLabel')}</span>
                <p className="text-[10.5px] text-slate-400 -mt-1">{t('headersHint')}</p>

                {headers.map((header) => {
                  const state = headerState(model, scope, scopeEnv, selected.type, selected.name, header);
                  return (
                    <div key={header} className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-40 shrink-0 text-[11px] font-mono font-semibold text-slate-700 truncate" title={header}>
                          {header}
                        </span>
                        <input
                          {...fieldInputProps(state, t('headerValuePlaceholder'), t('privateStoredPlaceholder'))}
                          aria-label={`${header} ${t('headerValuePlaceholder')}`}
                          onChange={(e) =>
                            onChange(setHeader(model, scope, state.ownIsPrivate, selected.type, selected.name, header, e.target.value))
                          }
                          spellCheck={false}
                          className={`flex-1 min-w-0 ${inputCls} ${state.ownIsPrivate ? 'border-amber-300 bg-amber-50/50' : ''}`}
                        />
                        <LayerToggle
                          isPrivate={state.ownIsPrivate}
                          title={state.ownIsPrivate ? t('layerPrivateHint') : t('layerSharedHint')}
                          onToggle={() => {
                            const toPrivate = !state.ownIsPrivate;
                            if (isStoredPrivate(state) && !window.confirm(t('confirmPrivateToShared'))) return;
                            const value = toggledValue(state);
                            onChange(
                              setHeader(
                                setHeader(model, scope, toPrivate, selected.type, selected.name, header, value),
                                scope,
                                !toPrivate,
                                selected.type,
                                selected.name,
                                header,
                                ''
                              )
                            );
                          }}
                        />
                        <button
                          type="button"
                          title={t('removeHeader')}
                          aria-label={t('removeHeader')}
                          onClick={() => onChange(setHeader(model, scope, state.ownIsPrivate, selected.type, selected.name, header, ''))}
                          className="shrink-0 p-1.5 rounded border border-slate-200 bg-white text-slate-400 hover:text-rose-600 hover:border-rose-200"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <FieldFooter state={state} env={scopeEnv} />
                    </div>
                  );
                })}

                <form
                  className="flex items-center gap-1.5 pt-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = newHeader.name.trim();
                    if (!name || !newHeader.value.trim() || headers.some((h) => h.toLowerCase() === name.toLowerCase())) return;
                    onChange(setHeader(model, scope, false, selected.type, selected.name, name, newHeader.value.trim()));
                    setNewHeader({ name: '', value: '' });
                  }}
                >
                  <input
                    value={newHeader.name}
                    onChange={(e) => setNewHeader((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder={t('headerNamePlaceholder')}
                    aria-label={t('headerNamePlaceholder')}
                    className={`w-40 shrink-0 ${inputCls}`}
                  />
                  <input
                    value={newHeader.value}
                    onChange={(e) => setNewHeader((prev) => ({ ...prev, value: e.target.value }))}
                    placeholder={t('headerValuePlaceholder')}
                    aria-label={t('headerValuePlaceholder')}
                    className={`flex-1 min-w-0 ${inputCls}`}
                  />
                  <button
                    type="submit"
                    disabled={!newHeader.name.trim() || !newHeader.value.trim()}
                    className="shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-700 disabled:opacity-40"
                  >
                    <Plus className="w-3 h-3" />
                    {t('addHeader')}
                  </button>
                </form>
              </div>
            )}
          </div>

          {messages.length > 0 && (
            <div className="mx-4 mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 space-y-0.5">
              {warnings.length > 0 && <p className="font-semibold">{t('sourcesWarnings')}</p>}
              {messages.map((message, index) => (
                <div key={index} className="flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-xs px-6 text-center">
          {declaredCount(model) ? t('createFirst') : t('noSources')}
        </div>
      )}
    </div>
  );
}

/** What the whole layer stack yields for one field, and whether it is a secret. */
function FieldFooter({ state, env }: { state: { effective: string | null; effectiveIsPrivate: boolean; from: 'base' | 'private' | 'env' | 'env-private' | null; own: string | null }; env: string | null }) {
  const { t } = useI18n();
  const text = state.effectiveIsPrivate ? t('valueHidden') : (state.effective ?? t('valueNotSet'));
  const ownHere = state.own !== null && state.own !== '';
  return (
    <p className="flex items-center gap-1.5 text-[10.5px] text-slate-500 font-mono pl-0.5">
      {ownHere ? <Check className="w-3 h-3 text-emerald-600" /> : <span className="w-3 h-3 inline-block" />}
      <span className={state.effectiveIsPrivate ? 'text-amber-700' : ''}>
        {t('effectiveLabel', { env: env ?? '—' })}: {text}
      </span>
      {state.from && <span className="text-slate-400">{t('effectiveFrom', { file: layerFile(state.from, env ?? '') })}</span>}
      <span className="text-slate-400">{ownHere ? t('scopeOverridden') : t('scopeInherited')}</span>
    </p>
  );
}
