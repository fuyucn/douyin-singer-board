import { open, type OpenOptions } from "nsh/test";

/** Real-renderer Storage seeds are virtual, not files in process.dataDir. */
export function openSqliteBoard(entry: string, options: OpenOptions = {}) {
  return open(entry, {
    ...options,
    host: {
      ...options.host,
      params: { ...options.host?.params, sqliteTestSeed: options.storage ?? {} },
    },
  });
}
