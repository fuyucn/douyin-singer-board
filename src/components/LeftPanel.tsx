import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Config } from '../types';
import { clearPlaylistByName } from '../kugouSession';
import { toast } from 'sonner';
import { saveConfig } from '../db';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Tv2, Shield, Music2, Plus, RefreshCw, HelpCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DouyinRoomInfo {
  id_str: string;
  nickname: string;
  title: string;
  status: number;
}

interface Props {
  config: Config;
  running: boolean;
  kugouEnabled: boolean;
  autoSync: boolean;
  kugouLoggedIn: boolean;
  manualText: string;
  compact?: boolean;
  onConfigChange: (patch: Partial<Config>) => void;
  onManualTextChange: (text: string) => void;
  onManualAdd: () => void;
  onAutoSyncToggle: () => void;
  appVersion: string;
}

export function LeftPanel({
  config,
  running,
  kugouEnabled,
  autoSync,
  kugouLoggedIn,
  manualText,
  compact,
  onConfigChange,
  onManualTextChange,
  onManualAdd,
  onAutoSyncToggle,
  appVersion,
}: Props) {
  // Live room metadata preview (debounced when room_id changes).
  // Only shows nickname on successful fetch; silent on loading/error/empty.
  const [roomInfo, setRoomInfo] = useState<DouyinRoomInfo | null>(null);

  useEffect(() => {
    const id = config.room_id.trim();
    setRoomInfo(null);
    if (!id || !/^\d+$/.test(id)) return;
    const timer = window.setTimeout(async () => {
      try {
        const info = await invoke<DouyinRoomInfo | null>('douyin_room_info', { webRid: id });
        setRoomInfo(info);
      } catch {
        /* silent — no UI for errors */
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [config.room_id]);

  const handleClearPlaylist = async () => {
    if (!kugouEnabled) return;
    const name = config.target_playlist_name.trim();
    if (!name) {
      toast.error('请先填歌单名');
      return;
    }
    try {
      const { listid } = await clearPlaylistByName(name);
      onConfigChange({ target_playlist_id: listid });
      await saveConfig({ ...config, target_playlist_name: name, target_playlist_id: listid });
      toast(`歌单已清空重建 (id: ${listid})`);
    } catch (e) {
      const detail = String(e);
      toast.error(
        detail.includes('not logged in') ? '请先点酷狗图标扫码登录' : `清理失败: ${detail}`,
      );
    }
  };

  return (
    <aside
      className={cn(
        'flex flex-col bg-[var(--bg-elev)]',
        compact ? 'w-full' : 'w-72 shrink-0 overflow-y-auto border-r border-[var(--border-soft)]',
      )}
    >
      {/* 直播间配置 */}
      <div className="p-4">
        <div className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-[var(--fg-base)]">
          <Tv2 className="text-fg-faint size-4" />
          直播间配置
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-[var(--fg-muted)]">抖音直播间 ID</Label>
              {roomInfo?.nickname && (
                <span
                  className="inline-flex max-w-[60%] items-center gap-1 truncate text-[11px]"
                  title={roomInfo.title}
                >
                  <span
                    className={cn(
                      'inline-block size-1.5 shrink-0 rounded-full',
                      roomInfo.status === 2 ? 'bg-emerald-500' : 'bg-zinc-400',
                    )}
                  />
                  <span className="truncate text-[var(--fg-base)]">{roomInfo.nickname}</span>
                </span>
              )}
            </div>
            <Input
              value={config.room_id}
              disabled={running}
              onChange={(e) => onConfigChange({ room_id: e.target.value })}
              placeholder="221321076494"
              className="h-8 bg-[var(--bg-base)] text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1 text-xs text-[var(--fg-muted)]">
              点歌指令模板
              <Tooltip>
                <TooltipTrigger>
                  <HelpCircle className="size-3 cursor-help text-[var(--fg-faint)] hover:text-[var(--fg-muted)]" />
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  className="max-w-[260px] space-y-2 p-3 text-xs leading-relaxed"
                >
                  <p className="font-semibold">占位符说明</p>
                  <div className="text-muted-foreground space-y-1">
                    <p>
                      <code className="rounded bg-black/10 px-1 dark:bg-white/10">[song]</code> 或{' '}
                      <code className="rounded bg-black/10 px-1 dark:bg-white/10">[歌曲]</code> —
                      歌曲名
                    </p>
                    <p>
                      <code className="rounded bg-black/10 px-1 dark:bg-white/10">[space]</code> 或{' '}
                      <code className="rounded bg-black/10 px-1 dark:bg-white/10">[空格]</code> —
                      空格
                    </p>
                  </div>
                  <div className="border-border space-y-1 border-t pt-2">
                    <p className="text-foreground font-medium">示例：</p>
                    <div className="space-y-0.5">
                      <p>
                        <code className="rounded bg-black/10 px-1 dark:bg-white/10">
                          点歌[space][song]
                        </code>
                      </p>
                      <p className="text-muted-foreground">→ 「点歌 七里香」</p>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      <p>
                        <code className="rounded bg-black/10 px-1 dark:bg-white/10">
                          点歌[song]
                        </code>
                      </p>
                      <p className="text-muted-foreground">→ 「点歌七里香」</p>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </Label>
            <Input
              value={config.sing_prefix}
              disabled={running}
              onChange={(e) => onConfigChange({ sing_prefix: e.target.value })}
              placeholder="[song]"
              className="h-8 bg-[var(--bg-base)] text-sm"
            />
          </div>
        </div>
      </div>

      <Separator className="bg-[var(--border-soft)]" />

      {/* 点歌规则 */}
      <div className="p-4">
        <div className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-[var(--fg-base)]">
          <Shield className="text-fg-faint size-4" />
          点歌规则
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-[var(--fg-muted)]">最低粉丝团等级</Label>
            <Input
              type="number"
              min={0}
              value={config.fans_level}
              disabled={running}
              onChange={(e) => onConfigChange({ fans_level: Number(e.target.value) || 0 })}
              className="h-8 bg-[var(--bg-base)] text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-[var(--fg-muted)]">点歌冷却 (秒)</Label>
            <Input
              type="number"
              min={0}
              value={config.sing_cd}
              disabled={running}
              onChange={(e) =>
                onConfigChange({ sing_cd: Math.max(0, Number(e.target.value) || 0) })
              }
              className="h-8 bg-[var(--bg-base)] text-sm"
            />
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <Label className="text-xs text-[var(--fg-muted)]">重复点歌冷却 (秒)</Label>
          <Input
            type="number"
            min={0}
            value={config.cooldown_seconds}
            disabled={running}
            onChange={(e) =>
              onConfigChange({ cooldown_seconds: Math.max(0, Number(e.target.value) || 0) })
            }
            className="h-8 bg-[var(--bg-base)] text-sm"
          />
          <p className="text-[11px] text-[var(--fg-faint)]">同一首歌在冷却时间内不会重复加入歌单</p>
        </div>
        <div className="mt-3 space-y-1.5">
          <Label className="text-xs text-[var(--fg-muted)]">单人单场点歌上限</Label>
          <Input
            type="number"
            min={0}
            value={config.max_songs_per_user}
            disabled={running}
            onChange={(e) =>
              onConfigChange({ max_songs_per_user: Math.max(0, Number(e.target.value) || 0) })
            }
            className="h-8 bg-[var(--bg-base)] text-sm"
          />
          <p className="text-[11px] text-[var(--fg-faint)]">
            每位观众本场最多自动点歌的首数（0 = 不限制）；手动加入不受限
          </p>
        </div>
      </div>

      {/* Kugou歌单 — 仅登录后显示 */}
      {kugouEnabled && kugouLoggedIn && (
        <>
          <Separator className="bg-[var(--border-soft)]" />
          <div className="p-4">
            <div className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-[var(--fg-base)]">
              <Music2 className="text-accent-soft-fg size-4" />
              Kugou 歌单
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-[var(--fg-muted)]">歌单名称</Label>
                {config.target_playlist_id > 0 && (
                  <span className="font-mono text-xs text-[var(--fg-faint)]">
                    id: {config.target_playlist_id}
                  </span>
                )}
              </div>
              <Input
                value={config.target_playlist_name}
                onChange={(e) => onConfigChange({ target_playlist_name: e.target.value })}
                placeholder="自动加入歌单的名字"
                className="h-8 bg-[var(--bg-base)] text-sm"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 flex-1 border-[var(--border-strong)] text-[var(--fg-muted)]"
                  onClick={handleClearPlaylist}
                  title="清空并重建歌单"
                >
                  <Trash2 className="size-3" />
                  清理
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn(
                    'auto-sync-btn h-8 flex-1 border-[var(--border-strong)] text-xs',
                    autoSync && 'active border-transparent!',
                  )}
                  onClick={onAutoSyncToggle}
                  title={autoSync ? '自动歌单同步中' : '自动歌单同步'}
                >
                  <RefreshCw className={`size-3 ${autoSync ? 'animate-spin' : ''}`} />
                  {autoSync ? '同步中' : '自动同步'}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      <Separator className="bg-[var(--border-soft)]" />

      {/* 手动点歌 */}
      <div className="p-4">
        <div className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-[var(--fg-base)]">
          <Plus className="text-fg-faint size-4" />
          手动点歌
        </div>
        <div className="flex gap-2">
          <Input
            className="h-8 flex-1 bg-[var(--bg-base)] text-sm"
            type="text"
            placeholder="输入歌曲名称..."
            value={manualText}
            onChange={(e) => onManualTextChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onManualAdd()}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0 border-[var(--border-strong)] bg-[var(--bg-elev)] text-[var(--fg-base)] hover:bg-[var(--bg-soft)]"
            onClick={onManualAdd}
          >
            添加
          </Button>
        </div>
      </div>

      {/* 底部版本信息 */}
      <div className="mt-auto p-4 text-[11px] text-[var(--fg-faint)]">
        <div>SUSUSongBoard v{appVersion}</div>
      </div>
    </aside>
  );
}
