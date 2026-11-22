package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/sususongboard/nsgo-app/queue"
	"github.com/sususongboard/nsgo-app/store"
)

const (
	preferencesFilename       = "board-settings-v1.json"
	databaseSelectionFilename = "board-database-v1.json"
)

func acquireSettingsLock(path string) (*os.File, error) {
	if path == "" {
		return nil, errors.New("no application settings directory")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := lockSettingsFile(file); err != nil {
		file.Close()
		return nil, err
	}
	return file, nil
}

func openBoardPreferences(scope *core.Scope, defaults boardSettings) (boardSettings, func([]byte) error, error) {
	directory := os.Getenv("SUSUSONGBOARD_SETTINGS_DIR")
	if directory == "" {
		directory = scope.DataDir()
	}
	if directory == "" {
		return defaults, nil, errors.New("no application settings directory")
	}
	preferences := filepath.Join(directory, preferencesFilename)
	preferencesLock, err := acquireSettingsLock(preferences)
	if err != nil {
		return defaults, nil, err
	}
	var databaseLock *os.File
	var database *store.BoardSettings
	cleanup := func() {
		if database != nil {
			_ = database.Close()
		}
		if databaseLock != nil {
			_ = databaseLock.Close()
		}
		_ = preferencesLock.Close()
	}
	ready := false
	defer func() {
		if !ready {
			cleanup()
		}
	}()

	selection := filepath.Join(directory, databaseSelectionFilename)
	path, create, pinned, err := selectBoardDatabase(directory, selection)
	if err != nil {
		return defaults, nil, err
	}
	databaseLock, err = acquireSettingsLock(path)
	if err != nil {
		return defaults, nil, err
	}
	if !create {
		if err := requireSingleDatabaseLink(path); err != nil {
			return defaults, nil, err
		}
	}
	database, data, err := store.OpenBoardSettings(path, create, pinned, func(snapshot string) ([]byte, error) {
		return migrateBoardPreferences(preferences, snapshot, defaults)
	})
	if err != nil {
		return defaults, nil, err
	}
	settings, err := decodeBoardPreferences(data)
	if err != nil {
		return defaults, nil, err
	}
	if !pinned {
		if err := writeDatabaseSelection(selection, path); err != nil {
			return defaults, nil, err
		}
	}
	scope.Cleanup(cleanup)
	ready = true
	return settings, database.Save, nil
}

func writeDatabaseSelection(selection, path string) error {
	file, err := os.CreateTemp(filepath.Dir(selection), ".board-database-*")
	if err != nil {
		return err
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	writeErr := json.NewEncoder(file).Encode(path)
	syncErr := file.Sync()
	closeErr := file.Close()
	if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
		return err
	}
	return publishDatabaseSelection(temporary, selection)
}

func selectBoardDatabase(directory, selection string) (path string, create, pinned bool, err error) {
	override := os.Getenv("SUSUSONGBOARD_DB")
	if override == "" {
		override = os.Getenv("SUSUSONGBOARD_TEST_DB")
	}
	record, err := os.ReadFile(selection)
	if err == nil {
		if err := json.Unmarshal(record, &path); err != nil || !filepath.IsAbs(path) {
			return "", false, false, errors.New("invalid SQLite database selection")
		}
		if override != "" {
			selected, selectedErr := os.Stat(path)
			requested, requestedErr := os.Stat(override)
			if selectedErr != nil || requestedErr != nil || !os.SameFile(selected, requested) {
				return "", false, false, errors.New("SQLite override differs from the database selected for this settings directory")
			}
		}
		pinned = true
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", false, false, err
	} else if override != "" {
		path = override
	} else {
		path = store.DatabasePath(directory)
		if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
			legacy := store.DatabasePath(filepath.Join(filepath.Dir(directory), "com.sususongboard.app"))
			if _, err := os.Lstat(legacy); manifest.ID == "com.sususongboard.nsgo.updatetest" || errors.Is(err, os.ErrNotExist) {
				create = true
			} else {
				path = legacy
			}
		}
	}
	path, err = filepath.Abs(path)
	if err != nil {
		return "", false, false, err
	}
	if create {
		parent, err := filepath.EvalSymlinks(filepath.Dir(path))
		return filepath.Join(parent, filepath.Base(path)), true, false, err
	}
	path, err = filepath.EvalSymlinks(path)
	if err != nil {
		return "", false, false, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", false, false, err
	}
	if !info.Mode().IsRegular() || info.Size() == 0 {
		return "", false, false, errors.New("SQLite database is not a nonempty regular file")
	}
	return path, false, pinned, nil
}

func decodeBoardPreferences(data []byte) (boardSettings, error) {
	var decoded struct {
		Rules *rules `json:"rules"`
		*boardSettings
	}
	var settings boardSettings
	decoded.boardSettings = &settings
	if err := json.Unmarshal(data, &decoded); err != nil {
		return boardSettings{}, err
	}
	if decoded.Rules == nil {
		return boardSettings{}, errors.New("missing SQLite song request rules")
	}
	settings.Rules = *decoded.Rules
	if _, err := queue.New(matcherConfig(settings)); err != nil {
		return boardSettings{}, err
	}
	if settings.Targets == nil {
		settings.Targets = map[string]playlistBinding{}
	}
	return settings, nil
}

func migrateBoardPreferences(preferences, snapshot string, settings boardSettings) ([]byte, error) {
	data, err := os.ReadFile(preferences)
	if err == nil {
		_, err = decodeBoardPreferences(data)
		return data, err
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if snapshot != "" {
		config, err := store.LoadConfig(snapshot)
		if err != nil {
			return nil, err
		}
		settings.Rules = rules{config.RoomID, config.SingPrefix, config.FansLevel, config.SingCooldown, config.CooldownSeconds, config.MaxSongsPerUser}
		settings.Platform = config.ActivePlugin
		for _, name := range config.BlacklistSongs {
			settings.Blacklist = append(settings.Blacklist, blacklistEntry{Kind: "song", Name: name, CreatedAt: config.BlacklistMeta["song:"+name]})
		}
		for _, name := range config.BlacklistSingers {
			settings.Blacklist = append(settings.Blacklist, blacklistEntry{Kind: "singer", Name: name, CreatedAt: config.BlacklistMeta["singer:"+name]})
		}
	}
	if _, err := queue.New(matcherConfig(settings)); err != nil {
		return nil, err
	}
	return json.Marshal(settings)
}
