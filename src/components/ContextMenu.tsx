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
        className="border-border-strong bg-bg-elev fixed z-[901] min-w-[140px] overflow-hidden rounded-md border"
        style={{ left: x, top: y, boxShadow: 'var(--shadow-modal)' }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            className="text-fg-base hover:bg-bg-soft block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-[13px] whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40"
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
