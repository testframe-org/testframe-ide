import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import { HTTP_METHODS, endpointParts } from '../frames';
import { useI18n } from '../i18n';
import type { Card, SourceDef } from '../types';

// ============================================================================
// SOURCE-SPECIFIC FORMS: each type-source has its own way of filling a card
// ============================================================================

interface SourceFormProps {
  card: Card;
  source?: SourceDef; // the card's source definition, when it exists
  onChange: (updates: Partial<Card>) => void;
}

type FormKind = 'http' | 'swagger' | 'query' | 'assert' | 'json' | 'expression' | 'code';

const FORM_BY_SOURCE: Record<string, FormKind> = {
  restapi: 'http',
  graphql: 'http',
  swagger: 'swagger',
  mongo: 'query',
  oracle: 'query',
  postgres: 'query',
  mysql: 'query',
  sqlserver: 'query',
  assert: 'assert',
  inline: 'json',
  filter: 'expression',
  mapper: 'expression'
};

export const formKindOf = (sourceType: string): FormKind => FORM_BY_SOURCE[sourceType] ?? 'code';

const inputCls =
  'w-full text-xs font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:border-blue-500 outline-none';
const editorCls =
  'w-full bg-[#191B24] text-slate-100 font-mono text-[12px] leading-5 p-3 rounded-lg border border-slate-700 outline-none focus:border-blue-500/60 resize-y';

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-slate-600 mb-1">{children}</label>;
}

function Editor({ value, onChange, rows = 12, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      rows={rows}
      placeholder={placeholder}
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

// Script picker: reuse a custom query/method stored in the source ({name}/{script}.md)
function ScriptPicker({ card, source, onChange }: SourceFormProps) {
  const { t } = useI18n();
  const scripts = source?.scripts ?? [];
  if (!scripts.length && !card.script) return null;
  return (
    <div>
      <Label>{t('scriptField')}</Label>
      <select
        value={card.script ?? ''}
        onChange={(e) => {
          const name = e.target.value || undefined;
          const script = scripts.find((s) => s.name === name);
          onChange(script ? { script: name, code: script.body.replace(/\n+$/, '') } : { script: name });
        }}
        className={inputCls}
      >
        <option value="">{t('scriptNone')}</option>
        {card.script && !scripts.some((s) => s.name === card.script) && (
          <option value={card.script}>{card.script} (?)</option>
        )}
        {scripts.map((s) => (
          <option key={s.name} value={s.name}>{s.name}</option>
        ))}
      </select>
    </div>
  );
}

// METHOD + path, stored together in `endpoint` ("POST /api/v2/echo")
function MethodPath({ card, onChange }: Pick<SourceFormProps, 'card' | 'onChange'>) {
  const { t } = useI18n();
  const parts = endpointParts(card);
  const method = parts?.method ?? (card.httpMethod || 'GET');
  const path = parts?.path ?? card.endpoint.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/i, '');
  const set = (m: string, p: string) => onChange({ httpMethod: m, endpoint: `${m} ${p}`.trim() });
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2">
      <div>
        <Label>{t('methodLabel')}</Label>
        <select value={method} onChange={(e) => set(e.target.value, path)} className={inputCls}>
          {HTTP_METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
      <div>
        <Label>{t('pathLabel')}</Label>
        <input value={path} onChange={(e) => set(method, e.target.value)} placeholder="/api/v2/echo" className={inputCls} />
      </div>
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

const ASSERT_LINE_RE = /^assert\s+.+\s(==|!=|>=|<=|>|<)\s.+$/;

export function SourceForm({ card, source, onChange }: SourceFormProps) {
  const { t } = useI18n();
  const kind = formKindOf(card.sourceType || 'inline');
  const setCode = (code: string) => onChange({ code });

  switch (kind) {
    case 'http': {
      const body = jsonStatus(card.code);
      return (
        <div className="space-y-3">
          <MethodPath card={card} onChange={onChange} />
          {source?.baseUrl && <p className="text-[11px] text-slate-500 font-mono">{t('baseUrlHint', { url: source.baseUrl })}</p>}
          <ScriptPicker card={card} source={source} onChange={onChange} />
          <div>
            <Label>{t('requestBodyLabel')}</Label>
            <Editor value={card.code} onChange={setCode} placeholder='{ "key": "{{previousVar}}" }' />
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
          <MethodPath card={card} onChange={onChange} />
          <div>
            <Label>{t('requestBodyLabel')}</Label>
            <Editor value={card.code} onChange={setCode} placeholder='{ "nome": "{{productName}}" }' />
          </div>
        </div>
      );
    case 'query':
      return (
        <div className="space-y-3">
          {source?.baseUrl && <p className="text-[11px] text-slate-500 font-mono">{t('connectionHint', { url: source.baseUrl })}</p>}
          <ScriptPicker card={card} source={source} onChange={onChange} />
          <div>
            <Label>{t('queryLabel')}</Label>
            <Editor value={card.code} onChange={setCode} rows={14} placeholder="db.products.find({ ativo: true })" />
          </div>
        </div>
      );
    case 'assert': {
      const lines = card.code.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
      const bad = lines.filter((l) => !ASSERT_LINE_RE.test(l));
      return (
        <div className="space-y-3">
          <ScriptPicker card={card} source={source} onChange={onChange} />
          <div>
            <Label>{t('assertLinesLabel')}</Label>
            <Editor value={card.code} onChange={setCode} rows={10} placeholder="assert $count(items) > 0" />
            <p className="mt-1 text-[11px] text-slate-500 font-mono">{t('assertHint')}</p>
            {lines.length > 0 && (
              <Status
                ok={bad.length === 0}
                text={bad.length === 0 ? t('assertLinesOk', { n: lines.length }) : t('assertLinesBad', { line: bad[0]! })}
              />
            )}
          </div>
        </div>
      );
    }
    case 'json': {
      const status = jsonStatus(card.code);
      return (
        <div>
          <Label>{t('jsonBodyLabel')}</Label>
          <Editor value={card.code} onChange={setCode} rows={16} placeholder='{ "period": "2026-11" }' />
          {card.code.trim() && (
            <Status ok={status.ok} text={status.ok ? t('jsonValid') : t('jsonInvalid', { msg: status.message })} />
          )}
        </div>
      );
    }
    case 'expression':
      return (
        <div className="space-y-3">
          <ScriptPicker card={card} source={source} onChange={onChange} />
          <div>
            <Label>{t('expressionLabel')}</Label>
            <Editor value={card.code} onChange={setCode} rows={10} placeholder="items[price > 100].name" />
          </div>
        </div>
      );
    default:
      return (
        <div className="space-y-3">
          <ScriptPicker card={card} source={source} onChange={onChange} />
          <div>
            <Label>{t('codeLabel')}</Label>
            <Editor value={card.code} onChange={setCode} rows={14} />
          </div>
        </div>
      );
  }
}
