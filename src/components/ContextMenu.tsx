import { Button } from '@/components/ui/button';
import type { DanmuInfo } from '../types';

interface Action {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  song: DanmuInfo;
  items: Action[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  return (
    <>
      <div className="fixed inset-0 z-[900]" onClick={onClose} />
      <div
        className="border-border-strong bg-bg-elev fixed z-[901] max-w-[320px] overflow-hidden rounded-md border"
        style={{ left: x, top: y, boxShadow: 'var(--shadow-modal)' }}
      >
        {items.map((item) => (
          <Button
            key={item.label}
            variant="ghost"
            size="sm"
            className="block w-full justify-start rounded-none px-4 py-2 text-left text-[13px] truncate"
            disabled={item.disabled}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.label}
          </Button>
        ))}
      </div>
    </>
  );
}
