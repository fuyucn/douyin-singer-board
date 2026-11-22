package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

const boardSettingsVersion = 1

type BoardSettings struct {
	db *sql.DB
}

func OpenBoardSettings(path string, create, initialized bool, seed func(snapshot string) ([]byte, error)) (*BoardSettings, []byte, error) {
	if create {
		if err := createBoardDatabase(path, seed); err != nil {
			return nil, nil, err
		}
		initialized = true
	}
	db, err := openBoardDatabase(path)
	if err != nil {
		return nil, nil, err
	}
	data, err := initializeBoardSettings(db, path, false, initialized, seed)
	if err != nil {
		db.Close()
		return nil, nil, err
	}
	return &BoardSettings{db: db}, data, nil
}

func openBoardDatabase(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", sqliteURI(path, runtime.GOOS)+"?mode=rw&_pragma=busy_timeout(3000)&_pragma=synchronous(EXTRA)&_txlock=immediate")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

func createBoardDatabase(path string, seed func(string) ([]byte, error)) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".nsgo-database-*")
	if err != nil {
		return err
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	if err := file.Close(); err != nil {
		return err
	}
	db, err := openBoardDatabase(temporary)
	if err != nil {
		return err
	}
	_, initErr := initializeBoardSettings(db, temporary, true, false, seed)
	closeErr := db.Close()
	if err := errors.Join(initErr, closeErr); err != nil {
		return err
	}
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		if err != nil {
			return err
		}
		return os.ErrExist
	}
	return os.Rename(temporary, path)
}

func initializeBoardSettings(db *sql.DB, path string, create, initialized bool, seed func(string) ([]byte, error)) ([]byte, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var exists bool
	if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='nsgo_board_settings')").Scan(&exists); err != nil {
		return nil, err
	}
	if exists {
		var version int
		var data []byte
		if err := tx.QueryRow("SELECT version, data FROM nsgo_board_settings WHERE id=1").Scan(&version, &data); err != nil {
			return nil, err
		}
		if version != boardSettingsVersion {
			return nil, fmt.Errorf("unsupported SQLite settings version %d", version)
		}
		return data, nil
	}
	if initialized {
		return nil, errors.New("selected SQLite database is missing its NSGo settings table")
	}
	snapshot := ""
	if !create {
		snapshot, err = backupBoardDatabase(path)
		if err != nil {
			return nil, err
		}
	}
	data, err := seed(snapshot)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec("CREATE TABLE nsgo_board_settings (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, data BLOB NOT NULL)"); err != nil {
		return nil, err
	}
	if _, err := tx.Exec("INSERT INTO nsgo_board_settings (id, version, data) VALUES (1, ?, ?)", boardSettingsVersion, data); err != nil {
		return nil, err
	}
	return data, tx.Commit()
}

func backupBoardDatabase(path string) (string, error) {
	directory := filepath.Join(filepath.Dir(path), "sqlite-backups")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	backupDir, err := os.MkdirTemp(directory, "pre-nsgo-")
	if err != nil {
		return "", err
	}
	verified := false
	defer func() {
		if !verified {
			_ = os.RemoveAll(backupDir)
		}
	}()
	backup := DatabasePath(backupDir)
	file, err := os.OpenFile(backup, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	source, err := sql.Open("sqlite", sqliteURI(path, runtime.GOOS)+"?mode=ro&_pragma=busy_timeout(3000)")
	if err != nil {
		return "", err
	}
	defer source.Close()
	if err := onlineBackup(source, sqliteURI(backup, runtime.GOOS)); err != nil {
		return "", err
	}
	snapshot, err := sql.Open("sqlite", sqliteURI(backup, runtime.GOOS)+"?mode=ro")
	if err != nil {
		return "", err
	}
	defer snapshot.Close()
	var integrity string
	if err := snapshot.QueryRow("PRAGMA quick_check").Scan(&integrity); err != nil {
		return "", err
	}
	if integrity != "ok" {
		return "", errors.New("SQLite backup failed its integrity check")
	}
	verified = true
	return backup, nil
}

func (settings *BoardSettings) Save(data []byte) error {
	result, err := settings.db.Exec("UPDATE nsgo_board_settings SET data=? WHERE id=1 AND version=?", data, boardSettingsVersion)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return errors.New("SQLite settings row is missing or has an unsupported version")
	}
	return nil
}

func (settings *BoardSettings) Close() error {
	return settings.db.Close()
}
