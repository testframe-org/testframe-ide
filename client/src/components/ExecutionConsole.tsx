import { Terminal } from 'lucide-react';
import { useI18n } from '../i18n';
import type { ExecLog } from '../client-api/testframe.z';

interface ExecutionConsoleProps {
  logs: ExecLog[];
  onClear: () => void;
}

// Floating execution console (bottom right of the canvas)
export function ExecutionConsole({ logs, onClear }: ExecutionConsoleProps) {
  const { t } = useI18n();

  if (!logs.length) return null;

  return (
    <div className="pointer-events-auto bg-slate-900/95 text-slate-200 border border-slate-700 rounded-xl p-3 shadow-xl w-80 max-h-40 overflow-y-auto text-xs font-mono">
      <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-1.5">
        <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5 text-blue-400" />
          {t('consoleTitle')}
        </span>
        <button
          onClick={onClear}
          className="text-[10px] text-slate-500 hover:text-slate-300"
        >
          {t('clear')}
        </button>
      </div>
      <div className="space-y-1">
        {logs.map((log, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px]">
            <span className="text-slate-500 shrink-0">{log.time}</span>
            <span
              className={
                log.type === 'error'
                  ? 'text-rose-400'
                  : log.type === 'success'
                  ? 'text-emerald-400'
                  : 'text-sky-300'
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
