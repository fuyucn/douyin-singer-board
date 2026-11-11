import { Storage } from "nsh";
import { SqliteStorage } from "app/sqlite";

/** Every operation waits for migration. A rejected startup never enables writes. */
export function createSqliteStore(dataDir: string | null, testSeed?: Record<string, string>) {
  const ready = Promise.resolve().then(async () => {
    // Renderer tests explicitly opt into an isolated connection too.
    const db = new SqliteStorage(testSeed ? "" : dataDir ?? "");
    if (testSeed) {
      db.setMany(JSON.stringify(testSeed));
      return db;
    }
    // NSH test fixtures supply Storage seeds. Read them into an isolated real
    // SQLite connection only when the engine has no application data directory.
    // Production never reads or writes NSH Storage; Rust migrates files itself.
    if (dataDir === null) {
      const seed: Record<string, string> = {};
      for (const key of ["board.config", "board.theme", "kugou.session"]) {
        const value = await Storage.getItem(key);
        if (value !== null) seed[key] = value;
      }
      db.setMany(JSON.stringify(seed));
    }
    return db;
  });
  return {
    async getItem(key: string): Promise<string | null> { return (await ready).get(key); },
    async setItem(key: string, value: string): Promise<void> {
      (await ready).setMany(JSON.stringify({ [key]: value }));
    },
    async setItems(values: Record<string, string>): Promise<void> {
      (await ready).setMany(JSON.stringify(values));
    },
    async removeItem(key: string): Promise<void> { (await ready).remove(key); },
    async exportJson(): Promise<string> { return (await ready).exportJson(); },
  };
}
