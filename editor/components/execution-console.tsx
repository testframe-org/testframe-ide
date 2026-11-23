import { Loader2, Terminal } from 'lucide-react';
import { useI18n } from '../i18n';
import type { ExecLog } from '../types';

interface ExecutionConsoleProps {
  logs: ExecLog[];
  running: boolean;
  onClear: () => void;
  onCancel: () => void;
}

/** Floating execution console (bottom right of the canvas). */
export function ExecutionConsole({ logs, running, onClear, onCancel }: ExecutionConsoleProps) {
  const { t } = useI18n();

  if (!logs.length && !running) return null;

  return (
    <div className="pointer-events-auto bg-slate-900/95 text-slate-200 border border-slate-700 rounded-xl p-3 shadow-xl w-96 max-h-44 overflow-y-auto text-xs font-mono scrollbar-dark">
      <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-1.5">
        <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
          {running ? <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" /> : <Terminal className="w-3.5 h-3.5 text-blue-400" />}
          {t('consoleTitle')}
        </span>
        <span className="flex items-center gap-2">
          {running && (
            <button type="button" onClick={onCancel} className="text-[10px] text-rose-400 hover:text-rose-300">
              {t('cancelRun')}
            </button>
          )}
          <button type="button" onClick={onClear} className="text-[10px] text-slate-500 hover:text-slate-300">
            {t('clear')}
          </button>
        </span>
      </div>
      <div className="space-y-1">
        {logs.map((log, index) => (
          <div key={index} className="flex items-start gap-2 text-[11px]">
            <span className="text-slate-500 shrink-0">{log.time}</span>
            <span
              className={
                log.type === 'error' ? 'text-rose-400' : log.type === 'success' ? 'text-emerald-400' : 'text-sky-300'
              }
            >
              {log.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
