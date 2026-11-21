// --- LIGHTWEIGHT SYNTAX HIGHLIGHTING ---
export const highlightSyntax = (code: string, type: string) => {
  const lines = code.split('\n');
  return lines.map((line, idx) => {
    let coloredLine = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    if (type === 'json') {
      coloredLine = coloredLine
        .replace(/(".*?")(\s*:)/g, '<span class="text-sky-300">$1</span>$2')
        .replace(/:\s*(".*?")/g, ': <span class="text-amber-300">$1</span>')
        .replace(/:\s*(\d+\.?\d*)/g, ': <span class="text-emerald-300">$1</span>')
        .replace(/:\s*(true|false|null)/g, ': <span class="text-purple-400 font-semibold">$1</span>');
    } else if (type === 'script') {
      coloredLine = coloredLine
        .replace(/(--.*$)/g, '<span class="text-slate-500 italic">$1</span>')
        .replace(/\b(SELECT|FROM|INNER|JOIN|ON|WHERE|AND|LIMIT|AS|ORDER|BY)\b/g, '<span class="text-purple-400 font-semibold">$1</span>')
        .replace(/('.*?')/g, '<span class="text-amber-300">$1</span>')
        .replace(/\b(\d+)\b/g, '<span class="text-emerald-300">$1</span>');
    } else {
      coloredLine = coloredLine
        .replace(/(\/\/.*$)/g, '<span class="text-slate-500 italic">$1</span>')
        .replace(/\b(const|let|await|async|return|expect|toBe|toEqual|toBeGreaterThan)\b/g, '<span class="text-purple-400 font-semibold">$1</span>')
        .replace(/('.*?'|".*?")/g, '<span class="text-amber-300">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g, '<span class="text-emerald-300">$1</span>');
    }

    return (
      <div key={idx} className="flex leading-5 min-h-[20px]">
        <span className="w-7 shrink-0 select-none text-right pr-2.5 text-[11px] text-slate-500 font-mono">
          {idx + 1}
        </span>
        <span
          className="font-mono text-[12px] text-slate-200 whitespace-pre"
          dangerouslySetInnerHTML={{ __html: coloredLine || ' ' }}
        />
      </div>
    );
  });
};
