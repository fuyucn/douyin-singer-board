//! Per-engine SQLite storage for the NSH application.
mod store;

use nsh_core::prelude::*;
use store::Store;

/// SQLite is authoritative; an empty directory creates an isolated test store.
#[class]
pub struct SqliteStorage {
    store: Store,
}

#[class]
impl SqliteStorage {
    /// Opens sususongboard.db, taking snapshots before the first migration.
    pub fn new(data_dir: String) -> Result<Self, String> {
        Store::open(&data_dir).map(|store| Self { store })
    }

    /// Reads a key, or null when absent.
    pub fn get(&self, key: String) -> Result<Option<String>, String> {
        self.store.get(&key)
    }

    /// Writes all supplied string values in one transaction.
    pub fn set_many(&mut self, entries_json: String) -> Result<(), String> {
        self.store.set_many(&entries_json)
    }

    /// Removes a key durably.
    pub fn remove(&mut self, key: String) -> Result<(), String> {
        self.store.remove(&key)
    }

    /// Returns the committed keys as JSON, for backups and verification.
    pub fn export_json(&self) -> Result<String, String> {
        self.store.export_json()
    }
}

#[native_module("app/sqlite")]
fn native(registry: &mut Registry) {
    registry.class::<SqliteStorage>();
}
