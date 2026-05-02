import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store';
import {
  loadBlacklist,
  addToBlacklist as dbAdd,
  removeFromBlacklist as dbRemove,
  deleteHistoryByMsgId,
} from '../db';

export function useBlacklist() {
  const blacklist = useAppStore((s) => s.blacklist);
  const hydrateBlacklist = useAppStore((s) => s.hydrateBlacklist);
  const addToStore = useAppStore((s) => s.addToBlacklist);
  const removeFromStore = useAppStore((s) => s.removeFromBlacklist);
  const removeByMsgId = useAppStore((s) => s.removeByMsgId);
  const config = useAppStore((s) => s.config);
  const pushLog = useAppStore((s) => s.pushLog);

  useEffect(() => {
    loadBlacklist()
      .then((entries) => hydrateBlacklist(entries))
      .catch((e) => pushLog(`[blacklist] load failed: ${e}`));
  }, [hydrateBlacklist, pushLog]);

  const sync = async (names: string[]) => {
    invoke('sidecar_send', {
      cmd: { cmd: 'reload_config', config: { ...config, blacklist: names } },
    }).catch(() => {});
  };

  const add = async (songName: string, msgId?: string) => {
    await dbAdd(songName);
    addToStore(songName, Math.floor(Date.now() / 1000));
    if (msgId) {
      removeByMsgId(msgId);
      await deleteHistoryByMsgId(msgId).catch(() => {});
    }
    const names = await getNames();
    await sync(names);
  };

  const remove = async (songName: string) => {
    await dbRemove(songName);
    removeFromStore(songName);
    const names = await getNames();
    await sync(names);
  };

  const getNames = () => loadBlacklist().then(rows => rows.map(r => r.song_name));

  return { blacklist, add, remove, getNames };
}
