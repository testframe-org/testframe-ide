import React, { useLayoutEffect, useRef, useState } from 'react';
import { complete, type CompletionContext, type CompletionItem, type CompletionResult } from '../autocomplete';

// Textarea with a completion popup (see ../autocomplete.ts for what is suggested).
// Typing opens it; Ctrl+Space forces it; ↑/↓ move, Enter/Tab accept, Esc closes.

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  completion?: CompletionContext;
  rows?: number;
  placeholder?: string;
  className?: string;
}

const KIND_BADGE: Record<CompletionItem['kind'], { label: string; cls: string }> = {
  variable: { label: 'var', cls: 'text-sky-300' },
  field: { label: 'fld', cls: 'text-emerald-300' },
  function: { label: 'fn', cls: 'text-violet-300' },
  keyword: { label: 'kw', cls: 'text-amber-300' }
};

/** Pixel position of the caret inside a textarea, via an off-screen mirror element. */
function caretPosition(textarea: HTMLTextAreaElement, index: number): { left: number; top: number; height: number } {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  const props = [
    'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
    'tabSize', 'textTransform', 'wordSpacing', 'textIndent'
  ] as const;
  for (const prop of props) mirror.style[prop] = style[prop];
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.textContent = textarea.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(index) || '.';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const position = {
    left: marker.offsetLeft - textarea.scrollLeft,
    top: marker.offsetTop - textarea.scrollTop,
    height: parseFloat(style.lineHeight) || 20
  };
  document.body.removeChild(mirror);
  return position;
}

export function CodeEditor({ value, onChange, completion, rows = 12, placeholder, className }: CodeEditorProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [result, setResult] = useState<CompletionResult | null>(null);
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState({ left: 0, top: 0 });
  const pendingCaret = useRef<number | null>(null);

  const refresh = (text: string, caret: number, explicit = false) => {
    if (!completion || !ref.current) {
      setResult(null);
      return;
    }
    const next = complete(text, caret, completion, explicit);
    setResult(next);
    setActive(0);
    if (next) {
      const pos = caretPosition(ref.current, next.from);
      setAnchor({ left: pos.left, top: pos.top + pos.height });
    }
  };

  const accept = (item: CompletionItem) => {
    if (!result || !ref.current) return;
    const text = value.slice(0, result.from) + item.insert + value.slice(result.to);
    pendingCaret.current = result.from + (item.caretOffset ?? item.insert.length);
    onChange(text);
    setResult(null);
  };

  // restore the caret after an accepted completion re-renders the value
  useLayoutEffect(() => {
    if (pendingCaret.current !== null && ref.current) {
      const caret = pendingCaret.current;
      pendingCaret.current = null;
      ref.current.focus();
      ref.current.setSelectionRange(caret, caret);
    }
  }, [value]);

  // keep the active row visible
  useLayoutEffect(() => {
    const row = listRef.current?.children[active] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === ' ' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      refresh(value, e.currentTarget.selectionStart, true);
      return;
    }
    if (!result) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % result.items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + result.items.length) % result.items.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      accept(result.items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // close the popup, not the surrounding modal
      e.nativeEvent.stopImmediatePropagation();
      setResult(null);
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          refresh(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onClick={() => setResult(null)}
        onBlur={() => setResult(null)}
        onScroll={() => setResult(null)}
        spellCheck={false}
        autoComplete="off"
        rows={rows}
        placeholder={placeholder}
        className={className}
      />
      {result && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 min-w-[220px] max-w-[420px] max-h-56 overflow-auto rounded-lg border border-slate-600 bg-[#232634] shadow-xl py-1 font-mono text-[12px]"
          style={{ left: Math.max(0, anchor.left), top: anchor.top + 2 }}
        >
          {result.items.map((item, index) => (
            <li
              key={`${item.kind}:${item.label}`}
              role="option"
              aria-selected={index === active}
              // mousedown, not click: keep the textarea focused
              onMouseDown={(e) => {
                e.preventDefault();
                accept(item);
              }}
              onMouseEnter={() => setActive(index)}
              className={`flex items-center gap-2 px-2.5 py-1 cursor-pointer ${
                index === active ? 'bg-blue-600/70 text-white' : 'text-slate-200'
              }`}
            >
              <span className={`w-6 shrink-0 text-[10px] font-semibold ${KIND_BADGE[item.kind].cls}`}>
                {KIND_BADGE[item.kind].label}
              </span>
              <span className="truncate">{item.label}</span>
              {item.detail && <span className="ml-auto pl-3 shrink-0 text-[11px] text-slate-400 truncate max-w-[200px]">{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
