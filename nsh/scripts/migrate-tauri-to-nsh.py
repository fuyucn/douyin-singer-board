#!/usr/bin/env python3
"""Migrate a Tauri SUSUSongBoard SQLite database into an NSH storage.json.

0.7.9 uses the same app id as the old Tauri app (`com.sususongboard.app`), so
`storage.json` and `sususongboard.db` share the app-data directory. The app
itself now auto-imports the SQLite file through its read-only SQLite/fs bridge
on first run; this script remains as a manual repair/export tool.

Usage:
  python3 migrate-tauri-to-nsh.py                     # auto-detect platform paths
  python3 migrate-tauri-to-nsh.py --db /path/to/sususongboard.db
  python3 migrate-tauri-to-nsh.py --out /path/to/storage.json
  python3 migrate-tauri-to-nsh.py --dry-run           # print JSON, do not write
  python3 migrate-tauri-to-nsh.py --force             # overwrite existing storage.json

By default the script refuses to overwrite an existing storage.json. Pass
--force to back it up as storage.json.bak-tauri-migrate-<timestamp> and
replace it.
"""
import argparse
import json
import os
import platform
import shutil
import sqlite3
import sys
from datetime import datetime

OLD_APP_IDS = ("com.sususongboard.app", "com.fuyucn.sususongboard")
NSH_APP_ID = "com.sususongboard.app"

def candidate_db_paths():
    system = platform.system()
    out = []
    if system == "Darwin":
        base = os.path.expanduser("~/Library/Application Support")
        for aid in OLD_APP_IDS:
            out.append(os.path.join(base, aid, "sususongboard.db"))
    elif system == "Windows":
        base = os.environ.get("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
        for aid in OLD_APP_IDS:
            out.append(os.path.join(base, aid, "sususongboard.db"))
    else:
        xdg = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
        for aid in OLD_APP_IDS:
            out.append(os.path.join(xdg, aid, "sususongboard.db"))
    return out

def default_nsh_storage_path():
    system = platform.system()
    if system == "Darwin":
        base = os.path.expanduser("~/Library/Application Support")
    elif system == "Windows":
        base = os.environ.get("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
    else:
        base = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
    return os.path.join(base, NSH_APP_ID, "storage.json")

def pick_db(explicit):
    if explicit:
        if not os.path.exists(explicit):
            raise SystemExit("db not found: " + explicit)
        return explicit
    found = [p for p in candidate_db_paths() if os.path.exists(p)]
    if not found:
        raise SystemExit("no Tauri sususongboard.db found; pass --db explicitly")
    best = None
    for p in found:
        try:
            c = sqlite3.connect(p)
            n = c.execute("SELECT COUNT(*) FROM history").fetchone()[0]
            c.close()
            if best is None or n > best[1]:
                best = (p, n)
        except sqlite3.Error:
            continue
    return best[0]

def read_config(cur):
    rows = cur.execute(
        "SELECT room_id, sing_prefix, fans_level, sing_cd, cooldown_seconds, "
        "max_songs_per_user, target_playlist_name, target_playlist_id, kugou_enabled "
        "FROM config WHERE id=1"
    ).fetchall()
    if not rows:
        return {}
    cols = [d[0] for d in cur.description]
    return dict(zip(cols, rows[0]))

def read_blacklist(cur):
    songs, singers, meta = [], [], {}
    tables = {r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}
    if "blacklist" in tables:
        for r in cur.execute("SELECT entry_type, song_name, singer_name, created_at FROM blacklist").fetchall():
            et, song, singer, ts = r
            ts = ts or int(datetime.now().timestamp())
            if et == "song" and song:
                if song not in songs:
                    songs.append(song)
                meta["song:" + song] = ts
            elif et == "singer" and singer:
                if singer not in singers:
                    singers.append(singer)
                meta["singer:" + singer] = ts
    if "blacklist_new" in tables:
        for r in cur.execute("SELECT entry_type, song_name, singer_name, created_at FROM blacklist_new").fetchall():
            et, song, singer, ts = r
            ts = ts or int(datetime.now().timestamp())
            if et == "song" and song and song not in songs:
                songs.append(song); meta["song:" + song] = ts
            elif et == "singer" and singer and singer not in singers:
                singers.append(singer); meta["singer:" + singer] = ts
    return songs, singers, meta

def read_session(cur):
    rows = cur.execute(
        "SELECT token, userid, dfid FROM kugou_session WHERE id=1"
    ).fetchall()
    if not rows:
        return None
    token, userid, dfid = rows[0]
    if not (token and userid):
        return None
    return {"token": token, "userid": str(userid), "dfid": dfid or "-", "nickname": str(userid)}

def convert(db_path):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cfg = read_config(cur)
    songs, singers, meta = read_blacklist(cur)
    session = read_session(cur)
    conn.close()

    target_name = cfg.get("target_playlist_name") or ""
    target_id = cfg.get("target_playlist_id") or 0
    kugou_enabled = bool(cfg.get("kugou_enabled", 0))
    ns_config = {
        "room_id": cfg.get("room_id", "") or "",
        "sing_prefix": cfg.get("sing_prefix") or "点歌[space][song]",
        "fans_level": cfg.get("fans_level") or 0,
        "sing_cd": cfg.get("sing_cd") or 0,
        "cooldown_seconds": cfg.get("cooldown_seconds") or 1800,
        "max_songs_per_user": cfg.get("max_songs_per_user") or 3,
        "target_playlist_name": target_name,
        "target_playlist_id": target_id,
        "kugou_enabled": kugou_enabled,
        "blacklist": songs,
        "blacklist_singers": singers,
        "blacklist_meta": meta,
        "auto_sync": False,
        "active_plugin": "kugou" if kugou_enabled else "",
        "config_version": 2,
    }

    storage = {
        "board.config": json.dumps(ns_config, ensure_ascii=False),
        "board.theme": "system",
    }
    if session is not None:
        storage["kugou.session"] = json.dumps(session, ensure_ascii=False)

    summary = {
        "db": db_path,
        "room_id": ns_config["room_id"],
        "target_playlist": (target_name + " (id " + str(target_id) + ")") if (target_name or target_id) else "none",
        "blacklist_songs": len(songs),
        "blacklist_singers": len(singers),
        "kugou_session_migrated": session is not None,
        "note": "kugou.session token is migrated as-is and may be expired; "
                "NSH will re-validate on first use. Rescan if login shows expired.",
    }
    return storage, summary

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", help="path to sususongboard.db")
    ap.add_argument("--out", help="output storage.json path")
    ap.add_argument("--dry-run", action="store_true", help="print JSON, do not write")
    ap.add_argument("--force", action="store_true", help="overwrite an existing storage.json")
    args = ap.parse_args()

    db_path = pick_db(args.db)
    storage, summary = convert(db_path)

    if args.dry_run:
        print(json.dumps(storage, ensure_ascii=False, indent=2))
        print()
        print("# summary:", json.dumps(summary, ensure_ascii=False))
        return

    out_path = args.out or default_nsh_storage_path()
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    if os.path.exists(out_path) and not args.force:
        raise SystemExit(f"{out_path} already exists; pass --force to overwrite")

    if os.path.exists(out_path):
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = out_path + ".bak-tauri-migrate-" + ts
        shutil.copy2(out_path, backup)
        print("backed up existing storage to " + backup)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(storage, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("wrote " + out_path)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print()
    print("Next steps:")
    print("  1. Quit NSH if it is running, then start it: it will read the new storage.json.")
    print("  2. Open 设置 -> 插件, confirm the Kugou login shows your userid.")
    print("  3. If login shows expired, click '生成登录二维码 / 刷新' and rescan.")
    print("  4. Verify the target playlist id and blacklist entries in the UI.")

if __name__ == "__main__":
    main()
