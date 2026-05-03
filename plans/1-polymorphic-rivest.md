# Refactor Blacklist System — KuGou-Result-Level Filtering

## Context

The current blacklist operates on danmaku-extracted song names (exact string match). This is unreliable because the danmaku text may differ from the actual KuGou song name.

The refactored blacklist operates at the **KuGou search result** level, supporting two entry types:

1. **Song blacklist**: blocks a specific `[songname] - [singername]` pair (matched against KuGou's `FileName` + `SingerName`)
2. **Singer blacklist**: blocks ALL songs by a given singer

### Single source of truth: `useBlacklist.checkTrack()`

Instead of having multiple places check Sets independently, `useBlacklist` exposes a single `checkTrack(track: KuGouTrack): 'song' | 'singer' | null` method. All consumers (auto-sync, manual-add, UI rendering) call this one method.

In `App.tsx`, a `useMemo` enriches `kugouCache` entries with `blockedReason`:

```
kugouCache (raw) + checkTrack()  ──useMemo──→  enrichedCache (带 blockedReason)
                                                      │
                                  ┌────────────────────┴──────────────────┐
                                  ▼                                       ▼
                            MainContent                             useAutoSync
                         (读 blockedReason                        (读 blockedReason
                          渲染红色+原因)                            决定是否跳过)
```

---

## Implementation Steps

### Step 1: Add `singer_name` to `KuGouTrack` and extract it from API

**File: `src/kugouSession.ts`**

- Add `singer_name: string` to `KuGouTrack` interface
- Extract `SingerName` from KuGou API response in both `searchKuGouTopHit()` and `searchKuGouPreferredHit()`
- Populate it in the `visit` closure of `searchKuGouPreferredHit`

### Step 2: Migrate `blacklist` table schema (frontend-side in `getDb()`)

**File: `src/db.ts`**

Replace the ad-hoc `CREATE TABLE IF NOT EXISTS blacklist` in `getDb()` with conditional migration logic:

- Query `sqlite_master` to check if `blacklist` table exists
- If not → create new schema directly
- If exists but old schema (no `entry_type` column) → create `blacklist_new`, copy rows as `entry_type='song'`, swap, add indexes
- If already new schema → skip

**New schema:**
```sql
CREATE TABLE blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_type TEXT NOT NULL CHECK (entry_type IN ('song', 'singer')),
    song_name TEXT NOT NULL DEFAULT '',
    singer_name TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE UNIQUE INDEX idx_bl_song_unique ON blacklist(song_name, singer_name) WHERE entry_type = 'song';
CREATE UNIQUE INDEX idx_bl_singer_unique ON blacklist(singer_name) WHERE entry_type = 'singer';
```

**New `BlacklistEntry` interface:**
```ts
export interface BlacklistEntry {
  id: number;
  entry_type: 'song' | 'singer';
  song_name: string;
  singer_name: string;
  created_at: number;
}
```

**New CRUD functions:**
- `loadBlacklist()` — returns `BlacklistEntry[]`
- `addSongToBlacklist(songName, singerName)` — insert song-type entry (partial unique index enforces dedup)
- `addSingerToBlacklist(singerName)` — insert singer-type entry
- `removeFromBlacklist(id)` — delete by id

### Step 3: Restructure Zustand blacklist state

**File: `src/store/logs.ts`**

Replace `Map<string, number>` with:

```ts
interface BlacklistItem {
  id: number;
  entryType: 'song' | 'singer';
  songName: string;
  singerName: string;
  createdAt: number;
}

// In LogSlice:
blacklist: BlacklistItem[];          // full ordered list for UI rendering
blockedSongKeys: Set<string>;         // "songName|singerName" keys for O(1) check
blockedSingers: Set<string>;          // singerName keys for O(1) check
```

Store actions rebuild Sets on every mutation:
- `hydrateBlacklist(entries)` — builds array + both Sets from DB rows
- `addSongToBlacklist(item)` / `addSingerToBlacklist(item)` — prepend + update relevant Set
- `removeFromBlacklist(id)` — filter array + rebuild both Sets

### Step 4: Rewrite `useBlacklist` hook — expose `checkTrack`

**File: `src/hooks/useBlacklist.ts`**

```ts
export function useBlacklist() {
  // ... store fields ...

  // Load from DB on mount
  useEffect(() => { loadBlacklist().then(hydrateBlacklist) }, []);

  // Single source of truth for blacklist matching
  const checkTrack = useCallback((track: KuGouTrack): 'song' | 'singer' | null => {
    // Singer check first (broader scope)
    if (track.singer_name && blockedSingers.has(track.singer_name)) return 'singer';
    // Song check
    const key = `${track.filename}|${track.singer_name}`;
    if (blockedSongKeys.has(key)) return 'song';
    return null;
  }, [blockedSongKeys, blockedSingers]);

  const addSong = async (songName: string, singerName: string, msgId?: string) => {
    await dbAddSong(songName, singerName);
    const entries = await loadBlacklist();
    hydrateBlacklist(entries);  // reload for server-assigned id
    if (msgId) { removeByMsgId(msgId); await deleteHistoryByMsgId(msgId).catch(() => {}); }
    syncSidecar();
  };

  const addSinger = async (singerName: string) => {
    await dbAddSinger(singerName);
    const entries = await loadBlacklist();
    hydrateBlacklist(entries);
    syncSidecar();
  };

  const remove = async (id: number) => {
    await dbRemove(id);
    removeFromStore(id);
    syncSidecar();
  };

  // Sidecar sync: only song names from song-type entries
  const syncSidecar = async () => { /* ... */ };

  return { blacklist, checkTrack, addSong, addSinger, remove };
}
```

### Step 5: Enrich `kugouCache` in `App.tsx`

**File: `src/App.tsx`**

Add a `useMemo` that wraps `kugouCache` entries with `blockedReason`:

```ts
// New type — extends KuGouEntry with optional block status
type EnrichedEntry = KuGouEntry & { blockedReason?: 'song' | 'singer' | null };

const enrichedCache = useMemo<Record<string, EnrichedEntry>>(() => {
  const result: Record<string, EnrichedEntry> = {};
  for (const [name, entry] of Object.entries(kugouCache)) {
    if (entry.status === 'found') {
      result[name] = { ...entry, blockedReason: checkTrack(entry.track) };
    } else {
      result[name] = entry;
    }
  }
  return result;
}, [kugouCache, checkTrack]);
```

Propagate `enrichedCache` (instead of raw `kugouCache`) to `MainContent` and `useAutoSync`.

### Step 6: Update auto-sync — use `blockedReason` instead of Sets

**File: `src/hooks/useAutoSync.ts`**

Replace `blockedSongKeys` / `blockedSingers` props with the enriched cache.

In the `tick` function, after finding a `found` song:

```ts
const entry = currentCache[found.song_name.trim()];
if (entry?.status === 'found') {
  if (entry.blockedReason) {
    pushLog(`[auto-sync] blocked (${entry.blockedReason}): ${found.song_name}`);
    onBlocked(entry.track, found);
    // onBlocked removes song from active list
    processingRef.current = false;
    schedule();
    return;
  }
  await addTrackToPlaylist(entry.track, targetPlaylistId);
  onSynced(entry.track, found);
}
```

### Step 7: Update manual "add to playlist" — use `checkTrack`

**File: `src/App.tsx`** — `onAddToPlaylist` handler

```ts
const onAddToPlaylist = async (track: KuGouTrack, song: DanmuInfo) => {
  const reason = checkTrack(track);
  if (reason) {
    toast.error(reason === 'singer'
      ? `已黑名单该歌手: ${track.singer_name}`
      : `已黑名单: ${track.filename} - ${track.singer_name}`);
    return;
  }
  // ... existing add logic ...
};
```

### Step 8: Update context menu (right-click on song)

**File: `src/App.tsx`** — `ctxActions` array

Replace single "加入黑名单" with:
- **`黑名单这首歌: filename - singer_name`** — when KuGou found; calls `addSong(filename, singer_name, msgId)`
- **`黑名单该歌手: singer_name`** — when singer_name available; calls `addSinger(singer_name)`
- **`加入黑名单 (搜索中...)`** disabled — when KuGou not yet resolved

### Step 9: Simplify `useSidecarEvents` — remove frontend blacklist guard

**File: `src/hooks/useSidecarEvents.ts`**

Remove the `blacklist.has(ev.data.song_name)` check. The sidecar already does early filtering; the authoritative check is via `checkTrack` in auto-sync/manual-add. Remove `blacklist` from props and deps.

### Step 10: Update `MainContent` — red text for blocked entries

**File: `src/components/MainContent.tsx`**

- Change `kugouCache` prop type to `Record<string, EnrichedEntry>`
- In the song name cell rendering, after checking `entry.status === 'found'`:
  ```tsx
  {entry?.status === 'found' ? (
    entry.blockedReason ? (
      <>
        <div className="truncate text-[11px] text-red-500">{entry.track.filename}</div>
        <div className="truncate text-[11px] text-red-400">
          {entry.blockedReason === 'singer' 
            ? `黑名单歌手: ${entry.track.singer_name}`
            : '黑名单歌曲'}
        </div>
      </>
    ) : (
      <div className="truncate text-[11px] text-blue-500">{entry.track.filename}</div>
    )
  ) : ...}
  ```

### Step 11: Update `BlacklistPanel` UI

**File: `src/components/BlacklistPanel.tsx`**

Update `Props`:
```ts
interface Props {
  items: Array<{ id: number; entryType: 'song' | 'singer'; songName: string; singerName: string; createdAt: number }>;
  onRemove: (id: number) => void;
}
```

Columns: Type badge (`歌曲`/`歌手`), Song Name, Singer, Time, Remove button. Singer-type entries show `—` or `全部歌曲` in song name column.

### Step 12: Update `MainContent` tab wiring for blacklist

**File: `src/components/MainContent.tsx`**

- Change `blacklist` prop from `Map<string, number>` to `BlacklistItem[]`
- Change `onRemoveBlacklist` from `(name: string)` to `(id: number)`
- Update blacklist tab count: `blacklist.length`

### Step 13: Wire everything in `App.tsx`

- Destructure from `useBlacklist()`: `blacklist`, `checkTrack`, `addSong`, `addSinger`, `remove`
- Compute `enrichedCache` via `useMemo` (Step 5)
- Pass `enrichedCache` to `MainContent` and `useAutoSync`
- Update `removeBlacklist` callback to use `id`

### Step 14: Update store tests

**File: `src/store.test.ts`**

Rewrite blacklist tests for the new `BlacklistItem[]` + `Set`-based state.

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| `checkTrack` as single source of truth | Auto-sync, manual-add, and UI all call the same function — no duplicated matching logic |
| Enriched cache in App.tsx via useMemo | Derived state; recomputes automatically when blacklist or search results change |
| Singer check before song check | Singer blacklist is broader; short-circuits earlier |
| `"filename\|singer_name"` as song key | Matches what KuGou returns; distinguishes same song name by different singers |
| Migration in frontend `getDb()`, not Tauri v4 | Blacklist was already frontend-managed; JS conditional logic handles old/new/fresh cases robustly |
| Sidecar blacklist stays as song-name-only `string[]` | Sidecar lacks singer info at match time; early filter only |
| Old entries migrate as `song`-type with empty singer | Backward compatible — `"songname\|"` key still blocks that danmaku text |
| Red text in song list for blocked entries | Instant visual feedback before auto-sync cleans them up |

---

## Files to Modify

| File | Change |
|---|---|
| `src/kugouSession.ts` | Add `singer_name` to `KuGouTrack`, extract from API |
| `src/db.ts` | New blacklist schema + migration logic + CRUD |
| `src/store/logs.ts` | New `BlacklistItem[]` + `Set` state shape |
| `src/hooks/useBlacklist.ts` | Rewrite; expose `checkTrack()` |
| `src/hooks/useAutoSync.ts` | Use enriched cache `blockedReason` instead of Sets |
| `src/hooks/useSidecarEvents.ts` | Remove redundant blacklist guard |
| `src/App.tsx` | Enriched cache, `checkTrack` in manual-add, context menu, wiring |
| `src/components/BlacklistPanel.tsx` | Show type + singer columns |
| `src/components/MainContent.tsx` | Red text for blocked, updated props |
| `src/store.test.ts` | Update blacklist tests |

## Files NOT Modified

| File | Why |
|---|---|
| `sidecar/src/matcher.ts` | Blacklist Set behavior unchanged; only receives filtered list |
| `sidecar/src/types.ts` | `blacklist?: string[]` unchanged |
| `src/types.ts` | `Config` interface unchanged |
| `src-tauri/src/lib.rs` | No Tauri migration needed |

---

## Verification

1. **Fresh install**: Delete app data, launch → blacklist tab empty
2. **Existing data migration**: Launch with old DB → old entries appear as song-type with empty singer
3. **Add song to blacklist**: Right-click found song → "黑名单这首歌" → entry in panel → auto-sync skips it → red text in list before cleanup
4. **Add singer to blacklist**: Right-click → "黑名单该歌手" → entry in panel → all songs by that singer skipped → red text with `黑名单歌手: xxx`
5. **Manual add to playlist**: Click add on blacklisted song → toast error with reason
6. **Auto-sync**: Enable with blacklisted songs → `[auto-sync] blocked` log → songs cleaned from list
7. **Remove from blacklist**: Click X → entry removed → previously blocked songs can be added again
8. **Run tests**: `pnpm test` → all pass after Step 14
