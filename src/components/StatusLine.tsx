import { useEffect, useRef, useState } from 'react';

interface Step {
  key: string;
  label: string;
  status: 'pending' | 'done';
}

interface Props {
  steps: Step[];
}

const FADE_DELAY = 1500;

export function StatusLine({ steps }: Props) {
  const [visible, setVisible] = useState(steps.some((s) => s.status !== 'done'));
  const doneAll = steps.every((s) => s.status === 'done');
  const prevDoneAll = useRef(doneAll);

  useEffect(() => {
    if (doneAll && !prevDoneAll.current) {
      // Just transitioned to all-done — keep visible briefly
      setVisible(true);
      const t = setTimeout(() => setVisible(false), FADE_DELAY);
      return () => clearTimeout(t);
    } else if (!doneAll) {
      // Still pending — always visible
      setVisible(true);
    }
    prevDoneAll.current = doneAll;
  }, [doneAll]);

  if (!visible) return null;

  return (
    <div className="border-border-soft text-fg-muted flex items-center gap-4 border-t px-5 py-1.5 text-xs">
      {steps.map((s) => (
        <span
          key={s.key}
          className={`inline-flex items-center gap-1 ${
            s.status === 'done' ? 'text-success' : 'text-fg-faint'
          }`}
        >
          {s.status === 'done' ? (
            <span className="text-[11px]">✓</span>
          ) : (
            <span className="inline-block size-2 animate-pulse rounded-full bg-amber-400" />
          )}
          {s.label}
        </span>
      ))}
    </div>
  );
}
