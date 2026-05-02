import type { Config } from '../types';
import type { ToastKind } from '../hooks/useToast';
import { resolvePlaylistByName } from '../kugouSession';
import { saveConfig } from '../db';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tv2,
  Shield,
  Music2,
  Plus,
  RefreshCw,
  HelpCircle,
} from 'lucide-react';

interface Props {
  config: Config;
  running: boolean;
  autoSync: boolean;
  kugouLoggedIn: boolean;
  manualText: string;
  onConfigChange: (patch: Partial<Config>) => void;
  onManualTextChange: (text: string) => void;
  onManualAdd: () => void;
  onAutoSyncToggle: () => void;
  showToast: (msg: string, kind?: ToastKind) => void;
  appVersion: string;
}

export function LeftPanel({
  config,
  running,
  autoSync,
  kugouLoggedIn,
  manualText,
  onConfigChange,
  onManualTextChange,
  onManualAdd,
  onAutoSyncToggle,
  showToast,
  appVersion,
}: Props) {
  const handleSavePlaylist = async () => {
    const name = config.target_playlist_name.trim();
    if (!name) {
      showToast('请先填歌单名', 'error');
      return;
    }
    try {
      const { listid, created } = await resolvePlaylistByName(name);
      onConfigChange({ target_playlist_id: listid });
      await saveConfig({ ...config, target_playlist_name: name, target_playlist_id: listid });
      showToast(created ? `已新建歌单 (id: ${listid})` : `已绑定歌单 (id: ${listid})`);
    } catch (e) {
      const detail = String(e);
      showToast(
        detail.includes('not logged in') ? '请先点酷狗图标扫码登录' : `解析失败: ${detail}`,
        'error',
      );
    }
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-[var(--border-soft)] bg-[var(--bg-elev)]">
      {/* 直播间配置 */}
      <div className="p-4">
        <div className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-[var(--fg-base)]">
          <Tv2 className="size-4 text-blue-500" />
          直播间配置
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-[var(--fg-muted)]">抖音直播间 ID</Label>
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
              <HelpCircle className="size-3 text-[var(--fg-faint)]" />
            </Label>
            <Input
              value={config.sing_prefix}
              disabled={running}
              onChange={(e) => onConfigChange({ sing_prefix: e.target.value })}
              placeholder="[song]"
              title="Placeholders: [space]=whitespace, [song]=song name"
              className="h-8 bg-[var(--bg-base)] text-sm"
            />
          </div>
        </div>
      </div>

      <Separator className="bg-[var(--border-soft)]" />

      {/* 点歌规则 */}
      <div className="p-4">
        <div className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-[var(--fg-base)]">
          <Shield className="size-4 text-green-500" />
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
      </div>

      {/* Kugou歌单 — 仅登录后显示 */}
      {kugouLoggedIn && (
        <>
          <Separator className="bg-[var(--border-soft)]" />
          <div className="p-4">
            <div className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-[var(--fg-base)]">
              <Music2 className="size-4 text-orange-400" />
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
                  className="h-8 flex-1 bg-blue-500 text-white hover:bg-blue-600"
                  onClick={handleSavePlaylist}
                >
                  保存
                </Button>
                {config.target_playlist_id > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className={[
                      'h-8 flex-1 text-xs',
                      autoSync
                        ? 'auto-sync-btn active border-transparent!'
                        : 'auto-sync-btn border-[var(--border-strong)]',
                    ].join(' ')}
                    onClick={onAutoSyncToggle}
                    title={autoSync ? '自动歌单同步中' : '自动歌单同步'}
                  >
                    <RefreshCw className={`size-3 ${autoSync ? 'animate-spin' : ''}`} />
                    自动同步
                  </Button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <Separator className="bg-[var(--border-soft)]" />

      {/* 手动点歌 */}
      <div className="p-4">
        <div className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-[var(--fg-base)]">
          <Plus className="size-4 text-purple-500" />
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
        <div>
          Made with <span className="text-red-400">♥</span> by SUSU
        </div>
      </div>
    </aside>
  );
}
