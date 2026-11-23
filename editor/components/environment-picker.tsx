'use client';

import { Globe } from 'lucide-react';
import { useI18n } from '../i18n';

interface EnvironmentPickerProps {
  /** The environments sources.yaml declares (an empty list blocks every run). */
  environments: string[];
  /** The current environment, null while none is declared or picked. */
  value: string | null;
  onChange: (environment: string) => void;
}

/**
 * The current environment (Phase 3, item 2): every run needs one, each card keeps its last run
 * per environment, and the OpenAPI operations cache is per environment.
 */
export function EnvironmentPicker({ environments, value, onChange }: EnvironmentPickerProps) {
  const { t } = useI18n();

  if (!environments.length) {
    return (
      <div
        title={t('environmentNoneHint')}
        className="hidden sm:flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800"
      >
        <Globe className="w-3.5 h-3.5" />
        {t('environmentNone')}
      </div>
    );
  }

  return (
    <label title={t('environmentHint')} className="flex items-center gap-1.5 bg-slate-100 border border-slate-200/80 rounded-lg pl-2 pr-1 py-0.5">
      <Globe className="w-3.5 h-3.5 text-blue-600 shrink-0" />
      <span className="sr-only">{t('environmentLabel')}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('environmentLabel')}
        className="text-[11px] font-semibold font-mono text-slate-700 bg-transparent border-none outline-none cursor-pointer py-1 pr-1 max-w-[9rem]"
      >
        {value === null && <option value="" disabled>{t('environmentLabel')}</option>}
        {environments.map((env) => (
          <option key={env} value={env}>{env}</option>
        ))}
      </select>
    </label>
  );
}
