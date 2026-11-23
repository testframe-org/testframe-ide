'use client';

import { AlertTriangle, Braces, CheckCircle2, Wand2 } from 'lucide-react';
import type { Arg } from '@/lib/format/mongo-call';
import type { CompletionContext } from '../autocomplete';
import { mongoArgsOf } from '../catalog';
import { useI18n } from '../i18n';
import { CodeEditor } from './code-editor';

interface MongoArgsEditorProps {
  sourceType: string;
  subtype?: string;
  collection?: string;
  code: string;
  onChange: (code: string) => void;
  completion: CompletionContext;
  /** Every problem the IDE's code rule found (POST /api/v2/validate), one per argument at most. */
  problems: string[];
  /** The canonical text the save would store (null when the body cannot be formatted). */
  formatted: string | null;
}

const editorCls =
  'w-full bg-[#191B24] text-slate-100 font-mono text-[12px] leading-5 p-3 rounded-lg border border-slate-700 outline-none focus:border-blue-500/60 resize-y';

const argLabel = (arg: Arg): string => `${arg.name}${arg.required ? '' : '?'}`;

/**
 * The mongo card body editor (Phase 3, item 4): one JSON array holding the positional arguments
 * of the call the subtype names, e.g. `find` -> `[filter, projection?, options?]`. The signature
 * comes from the catalog (GET /api/v2/catalog serves lib/format/mongo-call signatures), never from
 * a copy in the editor; validation and the canonical form come from POST /api/v2/validate.
 */
export function MongoArgsEditor({ sourceType, subtype, collection, code, onChange, completion, problems, formatted }: MongoArgsEditorProps) {
  const { t } = useI18n();
  const args = mongoArgsOf(sourceType, subtype);

  if (!args.length) {
    return <p className="text-xs text-slate-500 border border-dashed border-slate-300 rounded-lg p-4">{t('mongoNoSignature')}</p>;
  }

  const signature = args.map(argLabel).join(', ');
  const canFormat = formatted !== null && formatted !== code;

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <label className="block text-xs font-medium text-slate-600">{t('mongoArgsLabel')}</label>
        <button
          type="button"
          onClick={() => formatted !== null && onChange(formatted)}
          disabled={!canFormat}
          title={t('formatCode')}
          className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-700 disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-slate-600"
        >
          <Wand2 className="w-3 h-3" />
          {t('formatCode')}
        </button>
      </div>

      {/* The call the body feeds, with the argument signature served by the catalog */}
      <p className="text-[11px] font-mono text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
        {t('mongoArgsHint', { collection: collection || 'collection', subtype: subtype ?? '', args: signature })}
      </p>

      <CodeEditor value={code} onChange={onChange} rows={12} completion={completion} ariaLabel={t('mongoArgsLabel')} className={editorCls} placeholder={'[\n  { "ativo": true }\n]'} />

      {code.trim() !== '' &&
        (problems.length ? (
          <div className="space-y-1">
            <p className="flex items-center gap-1 text-[11px] font-semibold text-rose-600">
              <AlertTriangle className="w-3 h-3" />
              {t('codeProblems', { n: problems.length })}
            </p>
            <ul className="space-y-0.5 pl-4">
              {problems.map((problem) => (
                <li key={problem} className="text-[11px] text-rose-600 list-disc">
                  {problem}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="flex items-center gap-1 text-[11px] text-emerald-600">
            <CheckCircle2 className="w-3 h-3" />
            {t('codeRuleOk', { type: `mongo ${subtype ?? ''}` })}
          </p>
        ))}

      <details className="rounded-lg border border-slate-200 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-slate-600 flex items-center gap-1.5">
          <Braces className="w-3.5 h-3.5 text-purple-600" />
          {t('mongoSignature')}
        </summary>
        <ol className="mt-2 space-y-1.5">
          {args.map((arg, index) => (
            <li key={arg.name} className="text-[11px] text-slate-600">
              <span className="font-mono font-semibold text-slate-800">
                {index + 1}. {arg.name}
              </span>{' '}
              <span className="text-slate-400">
                {arg.kind} · {arg.required ? t('mongoArgRequired') : t('mongoArgOptional')}
              </span>
              {arg.options.length > 0 && (
                <span className="block font-mono text-[10.5px] text-slate-500 pl-3">
                  {t('mongoOptionsOf', { names: arg.options.map((o) => o.name).join(', ') })}
                </span>
              )}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
