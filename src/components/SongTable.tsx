import { useRef } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DanmuInfo } from '../types';

interface Props {
  songs: DanmuInfo[];
  emptyText: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<DanmuInfo, any>[];
  columnVisibility?: Record<string, boolean>;
}

const ROW_HEIGHT = 48;

export function SongTable({ songs, emptyText, meta, columns, columnVisibility }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const table = useReactTable({
    data: songs,
    columns,
    getCoreRowModel: getCoreRowModel(),
    meta: meta as Record<string, unknown>,
    state: { columnVisibility: columnVisibility ?? {} },
  });

  const { rows } = table.getRowModel();

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();
  const headerGroups = table.getHeaderGroups();
  // minWidth = sum of fixed columns only (grow columns fill remaining space)
  const totalWidth = table.getAllColumns().reduce((acc, col) => {
    const grow = (col.columnDef.meta as { grow?: boolean } | undefined)?.grow;
    return grow ? acc : acc + col.getSize();
  }, 0);

  if (songs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--fg-faint)]">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Sticky header — outside scroll container so it never scrolls vertically */}
      <div className="shrink-0 overflow-hidden border-b border-[var(--border-soft)] bg-[var(--bg-soft)]">
        <div style={{ minWidth: totalWidth }}>
          {headerGroups.map((hg) => (
            <div key={hg.id} className="flex">
              {hg.headers.map((header) => {
                const grow = (header.column.columnDef.meta as { grow?: boolean } | undefined)?.grow;
                return (
                  <div
                    key={header.id}
                    className="px-3 py-2 text-left text-xs font-medium text-[var(--fg-muted)] select-none"
                    style={
                      grow ? { flex: '1 1 0', minWidth: 0 } : { flex: `0 0 ${header.getSize()}px` }
                    }
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Scroll container — only rows scroll */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
        <div style={{ minWidth: totalWidth, height: totalHeight, position: 'relative' }}>
          {virtualRows.map((vRow) => {
            const row = rows[vRow.index];
            return (
              <div
                key={row.id}
                data-index={vRow.index}
                ref={virtualizer.measureElement}
                className="group absolute top-0 left-0 flex w-full items-center border-b border-[var(--border-softer)] transition-colors hover:bg-[var(--bg-softer)]"
                style={{
                  transform: `translateY(${vRow.start}px)`,
                  height: ROW_HEIGHT,
                }}
              >
                {row.getVisibleCells().map((cell) => {
                  const grow = (cell.column.columnDef.meta as { grow?: boolean } | undefined)?.grow;
                  return (
                    <div
                      key={cell.id}
                      className="overflow-hidden px-2 py-2 text-sm"
                      style={
                        grow
                          ? { flex: '1 1 0', minWidth: 0 }
                          : { flex: `0 0 ${cell.column.getSize()}px` }
                      }
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const songColumnHelper = createColumnHelper<DanmuInfo>();
