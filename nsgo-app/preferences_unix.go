//go:build !windows

package main

import (
	"errors"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

func lockSettingsFile(file *os.File) error {
	return unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB)
}

func requireSingleDatabaseLink(path string) error {
	var info unix.Stat_t
	if err := unix.Stat(path, &info); err != nil {
		return err
	}
	if info.Nlink != 1 {
		return errors.New("SQLite database hard links are not supported")
	}
	return nil
}

func publishDatabaseSelection(temporary, destination string) error {
	if err := os.Rename(temporary, destination); err != nil {
		return err
	}
	directory, err := os.Open(filepath.Dir(destination))
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
