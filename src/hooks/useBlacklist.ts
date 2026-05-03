import { useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store';
import {
  loadBlacklist,
  addSongToBlacklist as dbAddSong,
  addSingerToBlacklist as dbAddSinger,
  removeFromBlacklist as dbRemove,
  deleteHistoryByMsgId,
} from '../db';
import type { KuGouTrack } from '../kugouSession';

export function useBlacklist() {
  const blacklist = useAppStore((s) => s.blacklist);
  const blockedSongKeys = useAppStore((s) => s.blockedSongKeys);
  const blockedSingers = useAppStore((s) => s.blockedSingers);
  const hydrateBlacklist = useAppStore((s) => s.hydrateBlacklist);
  const removeFromStore = useAppStore((s) => s.removeFromBlacklist);
  const removeByMsgId = useAppStore((s) => s.removeByMsgId);
  const config = useAppStore((s) => s.config);
  const pushLog = useAppStore((s) => s.pushLog);

  useEffect(() => {
    loadBlacklist()
      .then((entries) => hydrateBlacklist(entries))
      .catch((e) => pushLog(`[blacklist] load failed: ${e}`));
  }, [hydrateBlacklist, pushLog]);

  // Single source of truth for blacklist matching.
  // Singer check first (broader scope), then song check.
  const checkTrack = useCallback(
    (track: KuGouTrack): 'song' | 'singer' | null => {
      if (track.singer_name && blockedSingers.has(track.singer_name)) return 'singer';
      const key = `${track.filename}|${track.singer_name}`;
      if (blockedSongKeys.has(key)) return 'song';
      return null;
    },
    [blockedSongKeys, blockedSingers],
  );

  const syncSidecar = async () => {
    const entries = await loadBlacklist();
    const names = entries
      .filter((e) => e.entry_type === 'song' && e.song_name)
      .map((e) => e.song_name);
    invoke('sidecar_send', {
      cmd: { cmd: 'reload_config', config: { ...config, blacklist: names } },
    }).catch(() => {});
  };

  const addSong = async (songName: string, singerName: string, msgId?: string) => {
    if (!singerName) {
      pushLog('[blacklist] cannot add song without singer name from KuGou');
      return;
    }
    try {
      await dbAddSong(songName, singerName);
    } catch {
      pushLog(`[blacklist] song already exists: ${songName} - ${singerName}`);
      return;
    }
    // Reload from DB for server-assigned id, then hydrate store
    const entries = await loadBlacklist();
    hydrateBlacklist(entries);
    if (msgId) {
      removeByMsgId(msgId);
      await deleteHistoryByMsgId(msgId).catch(() => {});
    }
    await syncSidecar();
  };

  const addSinger = async (singerName: string) => {
    if (!singerName) {
      pushLog('[blacklist] cannot add singer with empty name');
      return;
    }
    try {
      await dbAddSinger(singerName);
    } catch {
      pushLog(`[blacklist] singer already blacklisted: ${singerName}`);
      return;
    }
    const entries = await loadBlacklist();
    hydrateBlacklist(entries);
    await syncSidecar();
  };

  const remove = async (id: number) => {
    await dbRemove(id);
    removeFromStore(id);
    await syncSidecar();
  };

  return { blacklist, checkTrack, addSong, addSinger, remove };
}
