import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { checkSourceCode, formKindOf } from '../catalog';
import { testframeApi } from '../client-api';
import { useI18n } from '../i18n';
import type { Card, OpenApiSpec, SourceDef } from '../client-api/testframe.z';
import type { CompletionContext } from '../autocomplete';
import { CodeEditor } from './CodeEditor';

// ============================================================================
// CARD FORMS: the form follows the card's (type-source, subtype), served by the
// catalog (request, swagger, mongo, query, assert, expression, json, code)
// ============================================================================

interface SourceFormProps {
  card: Card;
  project: string;
  source?: SourceDef; // the card's source definition, when it exists
  onChange: (updates: Partial<Card>) => void;
  /** Variables visible to this card (earlier cards), for code completion. */
  completionVars?: Record<string, unknown>;
}

const inputCls =
  'w-full text-xs font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:border-blue-500 outline-none';
const editorCls =
  'w-full bg-[#191B24] text-slate-100 font-mono text-[12px] leading-5 p-3 rounded-lg border border-slate-700 outline-none focus:border-blue-500/60 resize-y';

// Placeholder of a mongo body per subtype (find / aggregation)
const MONGO_PLACEHOLDER: Record<string, string> = {
  find: '{ "filter": { "ativo": true } }',
  aggregation: '{ "pipeline": [{ "$match": { "ativo": true } }] }'
};

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-slate-600 mb-1">{children}</label>;
}

function Editor({ value, onChange, rows = 12, placeholder, completion }: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  completion?: CompletionContext;
}) {
  return (
    <CodeEditor
      value={value}
      onChange={onChange}
      rows={rows}
      placeholder={placeholder}
      completion={completion}
      className={editorCls}
    />
  );
}

function Status({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p className={`mt-1 flex items-center gap-1 text-[11px] ${ok ? 'text-emerald-600' : 'text-rose-600'}`}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
      {text}
    </p>
  );
}

const normalizeEndpoint = (endpoint: string) => endpoint.trim().replace(/\s+/g, ' ').toUpperCase();

// The operations of the card's openapi source, read from the source's cache
// ({name}.cache.md, written when the source is saved). Picking one stores its operationId
// (openapi-id, the identity) and its endpoint ("POST /api/products"); free text is not
// offered, but a stored operation missing from the spec still shows, marked (?), with a warning.
const operationKey = (o: { operationId: string; method: string; path: string }) =>
  o.operationId || `${o.method} ${o.path}`;
function OperationPicker({ card, project, onChange }: Pick<SourceFormProps, 'card' | 'project' | 'onChange'>) {
  const { t } = useI18n();
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sourceName = card.sourceName;

  useEffect(() => {
    if (!sourceName) return;
    let alive = true;
    setLoading(true);
    setError(null);
    testframeApi
      .loadOperations(project, sourceName)
      .then((data) => alive && setSpec(data))
      .catch((err: Error) => {
        if (!alive) return;
        setSpec(null);
        setError(err.message);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [project, sourceName]);

  if (!sourceName) return <p className="text-[11px] text-slate-500">{t('operationNeedsSource')}</p>;

  const stored = card.endpoint.trim();
  const operations = spec?.operations ?? [];
  // the operationId is the identity; cards without one match by endpoint
  const current = card.openapiId
    ? operations.find((o) => o.operationId === card.openapiId)
    : operations.find((o) => normalizeEndpoint(`${o.method} ${o.path}`) === normalizeEndpoint(stored));
  const storedKey = card.openapiId || stored;
  const value = current ? operationKey(current) : storedKey;
  const moved = !!current && normalizeEndpoint(`${current.method} ${current.path}`) !== normalizeEndpoint(stored);
  return (
    <div className="space-y-1">
      <Label>{t('operationLabel')}</Label>
      <select
        value={value}
        onChange={(e) => {
          const op = operations.find((o) => operationKey(o) === e.target.value);
          if (op) onChange({ endpoint: `${op.method} ${op.path}`, openapiId: op.operationId || undefined, httpMethod: op.method });
        }}
        className={inputCls}
      >
        {!storedKey && <option value="">{t('operationPlaceholder')}</option>}
        {storedKey && !current && <option value={storedKey}>{card.openapiId ? `${card.openapiId}: ${stored}` : stored} (?)</option>}
        {operations.map((o) => (
          <option key={operationKey(o)} value={operationKey(o)}>
            {o.method} {o.path}{o.summary ? ` — ${o.summary}` : ''}
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

export function SourceForm({ card, project, source, onChange, completionVars = {} }: SourceFormProps) {
  const { t } = useI18n();
  const kind = formKindOf(card.sourceType, card.subtype) ?? 'code';
  // assert lines and filter/mapper expressions speak jsonassert; every other body only binds {{vars}}
  const completion: CompletionContext = {
    mode: kind === 'script' || kind === 'condition' ? 'jsonassert' : 'bindings',
    vars: completionVars
  };
  const setCode = (code: string) => onChange({ code });
  // Rule of the (type, subtype) (mongo: JSON body per subtype, sql/oracle: one SELECT,
  // jsonassert/assert: jsonassert lines), answered by the server (POST /api/v2/validate,
  // cached): the save answers 400 anyway
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      checkSourceCode(card.sourceType, card.subtype, card.code).then((p) => alive && setProblem(p));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [card.sourceType, card.subtype, card.code]);

  switch (kind) {
    case 'request': {
      const body = jsonStatus(card.code);
      return (
        <div className="space-y-3">
          <OperationPicker card={card} project={project} onChange={onChange} />
          <div>
            <Label>{t('requestBodyLabel')}</Label>
            <Editor completion={completion} value={card.code} onChange={setCode} placeholder='{ "key": "{{previousVar}}" }' />
            {card.code.trim() && card.code.trim().startsWith('{') && (
              <Status ok={body.ok} text={body.ok ? t('jsonValid') : t('jsonInvalid', { msg: body.message })} />
            )}
          </div>
        </div>
      );
    }
    case 'swagger':
      return (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-500 flex items-center gap-1">
            {t('swaggerHint')}
            {source?.baseUrl && (
              <a href={source.baseUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-0.5 font-mono">
                {source.baseUrl}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </p>
          <OperationPicker card={card} project={project} onChange={onChange} />
          <div>
            <Label>{t('requestBodyLabel')}</Label>
            <Editor completion={completion} value={card.code} onChange={setCode} placeholder='{ "nome": "{{productName}}" }' />
          </div>
        </div>
      );
    case 'mongo': {
      const status = jsonStatus(card.code);
      return (
        <div className="space-y-3">
          {source?.baseUrl && <p className="text-[11px] text-slate-500 font-mono">{t('connectionHint', { url: source.baseUrl })}</p>}
          <div>
            <Label>{t('mongoBodyLabel', { subtype: card.subtype ?? '' })}</Label>
            <Editor
              completion={completion}
              value={card.code}
              onChange={setCode}
              rows={14}
              placeholder={MONGO_PLACEHOLDER[card.subtype ?? ''] ?? MONGO_PLACEHOLDER.find}
            />
            {card.code.trim() && !status.ok && <Status ok={false} text={t('jsonInvalid', { msg: status.message })} />}
            {card.code.trim() && status.ok && (
              <Status ok={!problem} text={problem ?? t('codeRuleOk', { type: `mongo ${card.subtype ?? ''}` })} />
            )}
          </div>
        </div>
      );
    }
    case 'query':
      return (
        <div className="space-y-3">
          {source?.baseUrl && <p className="text-[11px] text-slate-500 font-mono">{t('connectionHint', { url: source.baseUrl })}</p>}
          <div>
            <Label>{t('queryLabel')}</Label>
            <Editor value={card.code} onChange={setCode} rows={14} placeholder="SELECT * FROM products WHERE ativo = 1" />
            {card.code.trim() && (
              <Status ok={!problem} text={problem ?? t('codeRuleOk', { type: card.subtype ?? card.sourceType })} />
            )}
          </div>
        </div>
      );
    case 'script': {
      // assert lines and/or expressions; the last expression's value is the card's variable
      const lines = card.code.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
      return (
        <div>
          <Label>{t('scriptLinesLabel')}</Label>
          <Editor
            completion={completion}
            value={card.code}
            onChange={setCode}
            rows={10}
            placeholder={'assert $count(items) > 0\nitems[price > 100].name'}
          />
          <p className="mt-1 text-[11px] text-slate-500 font-mono">{t('scriptHint')}</p>
          {lines.length > 0 && <Status ok={!problem} text={problem ?? t('scriptLinesOk', { n: lines.length })} />}
        </div>
      );
    }
    case 'condition':
      // one boolean expression: false skips the rest of the step
      return (
        <div>
          <Label>{t('conditionLabel')}</Label>
          <Editor completion={completion} value={card.code} onChange={setCode} rows={4} placeholder="$count(activeProducts) > 0" />
          <p className="mt-1 text-[11px] text-slate-500">{t('conditionHint')}</p>
          {card.code.trim() && <Status ok={!problem} text={problem ?? t('conditionOk')} />}
        </div>
      );
    case 'json': {
      const status = jsonStatus(card.code);
      return (
        <div>
          <Label>{t('jsonBodyLabel')}</Label>
          <Editor completion={completion} value={card.code} onChange={setCode} rows={16} placeholder='{ "period": "2026-11" }' />
          {card.code.trim() && (
            <Status ok={status.ok} text={status.ok ? t('jsonValid') : t('jsonInvalid', { msg: status.message })} />
          )}
        </div>
      );
    }
    default:
      return (
        <div>
          <Label>{t('codeLabel')}</Label>
          <Editor completion={completion} value={card.code} onChange={setCode} rows={14} />
        </div>
      );
  }
}
