// Minimal read-only SQLite reader for the Tauri-era sususongboard.db.
// NSH runs in QuickJS with no sqlite module and no WASM, so this parses the
// file format directly. Only the three tables the migration needs are exposed;
// everything else is ignored. See https://www.sqlite.org/fileformat2.html.
import { Buffer } from "buffer";

const MAGIC = "SQLite format 3\0";

function u16(b: Uint8Array, off: number): number {
  return (b[off] << 8) | b[off + 1];
}
function u32(b: Uint8Array, off: number): number {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}
function readVarint(b: Uint8Array, off: number): { value: bigint; bytes: number } {
  let result = 0n;
  for (let i = 0; i < 8; i++) {
    const byte = b[off + i];
    result = (result << 7n) | BigInt(byte & 0x7f);
    if ((byte & 0x80) === 0) return { value: result, bytes: i + 1 };
  }
  const last = b[off + 8];
  result = (result << 8n) | BigInt(last);
  return { value: result, bytes: 9 };
}
function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8").decode(bytes); }
  catch { return ""; }
}

export interface SqliteDb {
  tables: Record<string, { columns: string[]; rows: any[][] }>;
}

export function parseSqlite(bytes: Uint8Array): SqliteDb {
  const header = new TextDecoder("latin1").decode(bytes.slice(0, 16));
  if (header !== MAGIC) throw new Error("not a SQLite database");
  const pageSizeRaw = u16(bytes, 16);
  const pageSize = pageSizeRaw === 1 ? 65536 : pageSizeRaw;
  const reserved = bytes[20];
  const usable = pageSize - reserved;
  const encoding = u32(bytes, 56); // 1 = UTF-8 (offset 56 per SQLite spec)
  if (encoding !== 1) throw new Error("only UTF-8 SQLite databases are supported");

  const db: SqliteDb = { tables: {} };

  function readPage(n: number): Uint8Array {
    const start = (n - 1) * pageSize;
    return bytes.slice(start, start + pageSize);
  }

  function readLeafTableCell(page: Uint8Array, ptr: number, hdrOff: number) {
    let off = ptr;
    const plen = readVarint(page, off); off += plen.bytes;
    const rowid = readVarint(page, off); off += rowid.bytes;
    const payloadLen = Number(plen.value);
    // local vs overflow
    const X = usable - 35;
    const M = Math.floor(((usable - 12) * 32) / 255) - 23;
    let localLen: number;
    if (payloadLen <= X) localLen = payloadLen;
    else {
      let K = M + ((payloadLen - M) % (usable - 4));
      if (K <= X) localLen = K; else localLen = M;
    }
    let payload: Uint8Array;
    if (localLen === payloadLen) {
      payload = page.slice(off, off + localLen);
      off += localLen;
    } else {
      payload = page.slice(off, off + localLen);
      off += localLen;
      let ovfl = u32(page, off); off += 4;
      const chunks: Uint8Array[] = [payload];
      let remaining = payloadLen - localLen;
      while (remaining > 0 && ovfl !== 0) {
        const op = readPage(ovfl);
        const next = u32(op, 0);
        const chunkSize = Math.min(remaining, usable - 4);
        chunks.push(op.slice(4, 4 + chunkSize));
        remaining -= chunkSize;
        ovfl = next;
      }
      const total = chunks.reduce((a, c) => a + c.length, 0);
      const buf = new Uint8Array(total);
      let i = 0;
      for (const c of chunks) { buf.set(c, i); i += c.length; }
      payload = buf;
    }
    // parse record
    let ho = 0;
    const hlen = readVarint(payload, ho); ho += hlen.bytes;
    const headerEnd = Number(hlen.value);
    const serialTypes: bigint[] = [];
    while (ho < headerEnd) {
      const v = readVarint(payload, ho); ho += v.bytes;
      serialTypes.push(v.value);
    }
    let vo = headerEnd;
    const values: any[] = [];
    for (const st of serialTypes) {
      const s = Number(st);
      if (s === 0) { values.push(null); continue; }
      if (s === 8) { values.push(0); continue; }
      if (s === 9) { values.push(1); continue; }
      if (s >= 12 && s % 2 === 0) {
        const n = (s - 12) / 2;
        values.push(payload.slice(vo, vo + n));
        vo += n; continue;
      }
      if (s >= 13 && s % 2 === 1) {
        const n = (s - 13) / 2;
        values.push(decodeUtf8(payload.slice(vo, vo + n)));
        vo += n; continue;
      }
      const sizes: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 6, 6: 8, 7: 8 };
      const n = sizes[s];
      if (s === 7) {
        const dv = new DataView(payload.buffer, payload.byteOffset + vo, 8);
        values.push(dv.getFloat64(0, false));
        vo += 8; continue;
      }
      let v = 0n;
      for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(payload[vo + i]);
      const bits = n * 8;
      if (v >= (1n << BigInt(bits - 1))) v -= (1n << BigInt(bits));
      values.push(Number(v));
      vo += n;
    }
    return { rowid: Number(rowid.value), values };
  }

  function visitTable(rootPage: number, out: { rowid: number; values: any[] }[]) {
    function visit(pageNum: number) {
      const page = readPage(pageNum);
      const hdrOff = pageNum === 1 ? 100 : 0;
      const type = page[hdrOff];
      const numCells = u16(page, hdrOff + 3);
      const ptrOff = hdrOff + (type === 0x02 || type === 0x05 ? 12 : 8);
      const cellPtrs: number[] = [];
      for (let i = 0; i < numCells; i++) cellPtrs.push(u16(page, ptrOff + i * 2));
      if (type === 0x0d) { // leaf table
        for (const ptr of cellPtrs) out.push(readLeafTableCell(page, ptr, hdrOff));
      } else if (type === 0x05) { // interior table
        for (const ptr of cellPtrs) {
          const leftChild = u32(page, ptr);
          visit(leftChild);
        }
        const rightMost = u32(page, hdrOff + 8);
        if (rightMost) visit(rightMost);
      }
    }
    visit(rootPage);
  }

  // Read sqlite_master (page 1) to discover tables.
  const masterRows: { rowid: number; values: any[] }[] = [];
  visitTable(1, masterRows);
  // sqlite_master columns: type, name, tbl_name, rootpage, sql
  const tableRoots: Record<string, number> = {};
  for (const r of masterRows) {
    const [type, name, tblName, rootpage] = r.values;
    if (type === "table" && typeof rootpage === "number" && rootpage > 0) {
      tableRoots[String(name)] = rootpage;
    }
  }

  const TABLE_COLUMNS: Record<string, string[]> = {
    config: ["id", "room_id", "sing_prefix", "fans_level", "sing_cd",
             "target_playlist_name", "target_playlist_id", "cooldown_seconds",
             "max_songs_per_user", "kugou_enabled"],
    kugou_session: ["id", "token", "userid", "dfid", "refreshed_at"],
    blacklist: ["id", "entry_type", "song_name", "singer_name", "created_at"],
  };

  for (const [tname, cols] of Object.entries(TABLE_COLUMNS)) {
    const root = tableRoots[tname];
    if (!root) continue;
    const rows: { rowid: number; values: any[] }[] = [];
    visitTable(root, rows);
    db.tables[tname] = {
      columns: cols,
      rows: rows.map((r) => r.values),
    };
  }
  // Merge blacklist_new if present (partial-migration leftover).
  if (tableRoots["blacklist_new"]) {
    const rows: { rowid: number; values: any[] }[] = [];
    visitTable(tableRoots["blacklist_new"], rows);
    const cols = ["id", "entry_type", "song_name", "singer_name", "created_at"];
    if (!db.tables.blacklist) db.tables.blacklist = { columns: cols, rows: [] };
    const seen = new Set(db.tables.blacklist.rows.map((r) => `${r[1]}|${r[2]}|${r[3]}`));
    for (const r of rows) {
      const key = `${r.values[1]}|${r.values[2]}|${r.values[3]}`;
      if (!seen.has(key)) { db.tables.blacklist.rows.push(r.values); seen.add(key); }
    }
  }
  return db;
}

export function readTable(db: SqliteDb, name: string): { columns: string[]; rows: any[][] } | null {
  return db.tables[name] || null;
}

export function rowsAsObjects(db: SqliteDb, name: string): Record<string, any>[] {
  const t = db.tables[name];
  if (!t) return [];
  return t.rows.map((r) => {
    const o: Record<string, any> = {};
    t.columns.forEach((c, i) => { o[c] = r[i]; });
    return o;
  });
}
