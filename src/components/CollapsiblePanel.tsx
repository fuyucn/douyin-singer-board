import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

export function CollapsiblePanel({ children }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="shrink-0 border-b border-[var(--border-soft)] bg-[var(--bg-elev)]">
      <button
        className="flex w-full items-center gap-2 px-4 py-2 text-[13px] font-medium text-[var(--fg-base)] hover:bg-[var(--bg-soft)]"
        onClick={() => setExpanded(!expanded)}
      >
        <span>⚙ 配置</span>
        {expanded ? (
          <ChevronUp className="ml-auto size-4" />
        ) : (
          <ChevronDown className="ml-auto size-4" />
        )}
      </button>
      {expanded && (
        <div className="max-h-[40vh] overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}
