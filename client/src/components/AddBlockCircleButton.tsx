import { Plus } from 'lucide-react';

// ============================================================================
// BLUE CIRCULAR "+" BUTTON, REFERENCE STYLE
// ============================================================================
export function AddBlockCircleButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-500 active:scale-95 text-amber-300 flex items-center justify-center shadow-md shadow-blue-600/25 border border-blue-400/40 shrink-0 transition-all cursor-pointer"
    >
      <Plus className="w-5 h-5 stroke-[2.75]" />
    </button>
  );
}
