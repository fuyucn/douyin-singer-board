import type { DanmuInfo } from '../types';

interface Action {
  label: string;
  onClick: () => void;
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
      <div className="ctx-overlay" onClick={onClose} />
      <div className="ctx-menu" style={{ left: x, top: y }}>
        {items.map((item) => (
          <button
            key={item.label}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
