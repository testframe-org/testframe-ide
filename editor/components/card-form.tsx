'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import type { OpenApiSpec } from '@/lib/openapi/openapi-spec';
import type { CompletionContext } from '../autocomplete';
import { ideApi } from '../api/ide';
import { reasonOf } from '../api/http';
import { formKindOf, validateCode } from '../catalog';
import { useI18n } from '../i18n';
import type { DisplayUrl } from '../sources-model';
import type { EditorCard, LogLevel } from '../types';
import { CodeEditor } from './code-editor';
import { MongoArgsEditor } from './mongo-args-editor';

// The card's body form. Which form a card gets follows its (type-source, subtype) as served by
// the catalog (request, swagger, mongo, query, script, condition, json, code); the code rule of
// that pair comes from POST /api/v2/validate. The editor keeps no copy of either table.

interface CardFormProps {
  card: EditorCard;
  project: string;
  /** The current environment: the OpenAPI operations cache is per environment. */
  environment: string | null;
  /** Display-only connection of the card's source in the current environment (null when it has none). */
  connection: DisplayUrl | null;
  onChange: (updates: Partial<EditorCard>) => void;
  onLog?: (text: string, type?: LogLevel) => void;
  /** Variables published by the cards before this one, for completion. */
  completionVars?: Record<string, unknown>;
}

const inputCls =
  'w-full text-xs font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:border-blue-500 outline-none';
const editorCls =
  'w-full bg-[#191B24] text-slate-100 font-mono text-[12px] leading-5 p-3 rounded-lg border border-slate-700 outline-none focus:border-blue-500/60 resize-y';

function Label({ children }: { children: ReactNode }) {
  return <label className="block text-xs font-medium text-slate-600 mb-1">{children}</label>;
}

function Status({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p className={`mt-1 flex items-center gap-1 text-[11px] ${ok ? 'text-emerald-600' : 'text-rose-600'}`}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
      {text}
    </p>
  );
}

function Editor({
  value,
  onChange,
  rows = 12,
  placeholder,
  completion,
  ariaLabel
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  completion?: CompletionContext;
  ariaLabel?: string;
}) {
  return <CodeEditor value={value} onChange={onChange} rows={rows} placeholder={placeholder} completion={completion} ariaLabel={ariaLabel} className={editorCls} />;
}

/** The card's connection line: a resolved base-url, or why there is none to show. */
function ConnectionHint({ connection, environment }: { connection: DisplayUrl | null; environment: string | null }) {
  const { t } = useI18n();
  if (!connection) return null;
  if (connection.isPrivate) return <p className="text-[11px] text-slate-500">{t('connectionPrivate')}</p>;
  if (!connection.value) return <p className="text-[11px] text-amber-700">{t('connectionMissing', { env: environment ?? '—' })}</p>;
  return <p className="text-[11px] text-slate-500 font-mono">{t('connectionHint', { url: connection.value })}</p>;
}

const normalizeEndpoint = (endpoint: string): string => endpoint.trim().replace(/\s+/g, ' ').toUpperCase();
const operationKey = (o: { operationId: string; method: string; path: string }): string => o.operationId || `${o.method} ${o.path}`;

interface OperationPickerProps {
  card: EditorCard;
  project: string;
  environment: string | null;
  connection: DisplayUrl | null;
  onChange: (updates: Partial<EditorCard>) => void;
  onLog?: (text: string, type?: LogLevel) => void;
}

/**
 * The operations of the card's openapi source, from that environment's cache. Picking one stores
 * its operationId (the operation's identity) and its endpoint ("POST /api/products"). A stored
 * operation the spec no longer has still shows, marked (?), with a warning.
 */
function OperationPicker({ card, project, environment, connection, onChange, onLog }: OperationPickerProps) {
  const { t } = useI18n();
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const sourceName = card.sourceName;

  useEffect(() => {
    if (!sourceName || !environment) {
      setSpec(null);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    ideApi
      .operations(project, sourceName, environment)
      .then((data) => alive && setSpec(data))
      .catch((err: Error) => {
        if (!alive) return;
        setSpec(null);
        setError(reasonOf(err));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [project, sourceName, environment]);

  if (!sourceName) return <p className="text-[11px] text-slate-500">{t('operationNeedsSource')}</p>;
  if (!environment) return <p className="text-[11px] text-amber-700">{t('operationNeedsEnvironment')}</p>;

  const refresh = async () => {
    setRefreshing(true);
    try {
      const data = await ideApi.refreshOperations(project, sourceName, environment);
      setSpec(data);
      setError(null);
      onLog?.(t('operationsRefreshed', { name: sourceName }), 'success');
    } catch (err) {
      const reason = reasonOf(err);
      setError(reason);
      onLog?.(t('operationsRefreshFail', { msg: reason }), 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const stored = card.endpoint.trim();
  const operations = spec?.operations ?? [];
  // the operationId is the identity; a card without one matches by endpoint
  const current = card.openapiId
    ? operations.find((o) => o.operationId === card.openapiId)
    : operations.find((o) => normalizeEndpoint(`${o.method} ${o.path}`) === normalizeEndpoint(stored));
  const storedKey = card.openapiId || stored;
  const value = current ? operationKey(current) : storedKey;
  const moved = !!current && normalizeEndpoint(`${current.method} ${current.path}`) !== normalizeEndpoint(stored);
  const specIsPrivate = connection?.isPrivate === true;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label>{t('operationLabel')}</Label>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing || loading}
          title={t('operationsRefresh')}
          className="flex items-center gap-1 text-[10px] font-medium text-slate-500 hover:text-blue-700 disabled:opacity-40"
        >
          {refreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {t('operationsRefresh')}
        </button>
      </div>
      <select
        value={value}
        onChange={(e) => {
          const op = operations.find((o) => operationKey(o) === e.target.value);
          if (op) onChange({ endpoint: `${op.method} ${op.path}`, openapiId: op.operationId || undefined, httpMethod: op.method });
        }}
        className={inputCls}
        aria-label={t('operationLabel')}
      >
        {!storedKey && <option value="">{t('operationPlaceholder')}</option>}
        {storedKey && !current && <option value={storedKey}>{card.openapiId ? `${card.openapiId}: ${stored}` : stored} (?)</option>}
        {operations.map((o) => (
          <option key={operationKey(o)} value={operationKey(o)}>
            {o.method} {o.path}
            {o.summary ? ` — ${o.summary}` : ''}
          </option>
        ))}
      </select>
      {loading && (
        <p className="flex items-center gap-1 text-[11px] text-slate-500">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t('operationsLoading')}
        </p>
      )}
      {error && <Status ok={false} text={t('operationsFail', { msg: error })} />}
      {spec && storedKey && !current && <Status ok={false} text={t('operationMissing', { endpoint: card.openapiId || stored })} />}
      {spec && current && moved && (
        <Status ok={false} text={t('operationMoved', { endpoint: stored, current: `${current.method} ${current.path}` })} />
      )}
      {spec && (
        <p className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
          {specIsPrivate || !connection?.value ? t('valueHidden') : (
            <a href={connection.value} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-0.5">
              {t('specUrlHint', { url: connection.value })}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <span className="text-slate-400">· {t('operationsEnvHint', { env: environment })}</span>
        </p>
      )}
      {spec && <p className="text-[11px] text-slate-500 font-mono">{t('baseUrlHint', { url: spec.baseUrl })}</p>}
    </div>
  );
}

function jsonStatus(text: string): { ok: boolean; message: string } {
  if (!text.trim()) return { ok: true, message: '' };
  // {{bindings}} are substituted at run time: validate with placeholders
  const probe = text.replace(/"\{\{[^}]+\}\}"/g, 'null').replace(/\{\{[^}]+\}\}/g, 'null');
  try {
    JSON.parse(probe);
    return { ok: true, message: '' };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export function CardForm({ card, project, environment, connection, onChange, onLog, completionVars = {} }: CardFormProps) {
  const { t } = useI18n();
  const kind = formKindOf(card.sourceType, card.subtype) ?? 'code';
  // assert lines and conditions speak jsonassert; every other body only binds {{vars}}
  const completion: CompletionContext = {
    mode: kind === 'script' || kind === 'condition' ? 'jsonassert' : 'bindings',
    vars: completionVars
  };
  const setCode = (code: string) => onChange({ code });

  // The code rule of (type, subtype), answered by the IDE and cached: the save rejects it anyway,
  // this is the live feedback while typing.
  const [problems, setProblems] = useState<string[]>([]);
  const [formatted, setFormatted] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      validateCode(card.sourceType, card.subtype, card.code).then((r) => {
        if (!alive) return;
        setProblems(r.problems);
        setFormatted(r.formatted);
      });
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [card.sourceType, card.subtype, card.code]);

  const ruleStatus = (label: string) =>
    problems.length ? <Status ok={false} text={problems[0]!} /> : <Status ok text={label} />;

  switch (kind) {
    case 'request': {
      const body = jsonStatus(card.code);
      return (
        <div className="space-y-3">
          <OperationPicker card={card} project={project} environment={environment} connection={connection} onChange={onChange} onLog={onLog} />
          <div>
            <Label>{t('requestBodyLabel')}</Label>
            <Editor completion={completion} value={card.code} onChange={setCode} ariaLabel={t('requestBodyLabel')} placeholder='{ "key": "{{previousVar}}" }' />
            {card.code.trim().startsWith('{') && (
              <Status ok={body.ok} text={body.ok ? t('jsonValid') : t('jsonInvalid', { msg: body.message })} />
            )}
          </div>
        </div>
      );
    }
    case 'swagger':
      return (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-500">{t('swaggerHint')}</p>
          <OperationPicker card={card} project={project} environment={environment} connection={connection} onChange={onChange} onLog={onLog} />
          <div>
            <Label>{t('requestBodyLabel')}</Label>
            <Editor completion={completion} value={card.code} onChange={setCode} ariaLabel={t('requestBodyLabel')} placeholder='{ "nome": "{{productName}}" }' />
          </div>
        </div>
      );
    case 'mongo':
      return (
        <div className="space-y-3">
          <ConnectionHint connection={connection} environment={environment} />
          <MongoArgsEditor
            sourceType={card.sourceType}
            subtype={card.subtype}
            collection={card.collection}
            code={card.code}
            onChange={setCode}
            completion={completion}
            problems={problems}
            formatted={formatted}
          />
        </div>
      );
    case 'query':
      return (
        <div className="space-y-3">
          <ConnectionHint connection={connection} environment={environment} />
          <div>
            <Label>{t('queryLabel')}</Label>
            <Editor value={card.code} onChange={setCode} rows={14} ariaLabel={t('queryLabel')} placeholder="SELECT * FROM products WHERE ativo = 1" />
            {card.code.trim() !== '' && ruleStatus(t('codeRuleOk', { type: card.subtype ?? card.sourceType }))}
          </div>
        </div>
      );
    case 'script': {
      // assert lines and/or expressions; the last expression's value is the card's variable
      const lines = card.code.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('//'));
      return (
        <div>
          <Label>{t('scriptLinesLabel')}</Label>
          <Editor
            completion={completion}
            value={card.code}
            onChange={setCode}
            rows={10}
            ariaLabel={t('scriptLinesLabel')}
            placeholder={'assert $count(items) > 0\nitems[price > 100].name'}
          />
          <p className="mt-1 text-[11px] text-slate-500 font-mono">{t('scriptHint')}</p>
          {lines.length > 0 && ruleStatus(t('scriptLinesOk', { n: lines.length }))}
        </div>
      );
    }
    case 'condition':
      // one boolean expression: false skips the rest of the step
      return (
        <div>
          <Label>{t('conditionLabel')}</Label>
          <Editor completion={completion} value={card.code} onChange={setCode} rows={4} ariaLabel={t('conditionLabel')} placeholder="$count(activeProducts) > 0" />
          <p className="mt-1 text-[11px] text-slate-500">{t('conditionHint')}</p>
          {card.code.trim() !== '' && ruleStatus(t('conditionOk'))}
        </div>
      );
    case 'json': {
      const status = jsonStatus(card.code);
      return (
        <div>
          <Label>{t('jsonBodyLabel')}</Label>
          <Editor completion={completion} value={card.code} onChange={setCode} rows={16} ariaLabel={t('jsonBodyLabel')} placeholder='{ "period": "2026-11" }' />
          {card.code.trim() !== '' && <Status ok={status.ok} text={status.ok ? t('jsonValid') : t('jsonInvalid', { msg: status.message })} />}
        </div>
      );
    }
    default:
      return (
        <div>
          <Label>{t('codeLabel')}</Label>
          <Editor completion={completion} value={card.code} onChange={setCode} rows={14} ariaLabel={t('codeLabel')} />
        </div>
      );
  }
}
