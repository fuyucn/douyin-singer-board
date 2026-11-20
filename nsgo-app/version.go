package main

import (
	"runtime"

	"github.com/nsgo-dev/nsgo/core"
	"go.yaml.in/yaml/v3"
)

var manifest = func() appManifest {
	data, err := sources.ReadFile("nsgo.yaml")
	if err != nil {
		panic(err)
	}
	var manifest appManifest
	if err := yaml.Unmarshal(data, &manifest); err != nil || manifest.Version == "" {
		panic("invalid application version")
	}
	return manifest
}()

type appManifest struct {
	Version string
	Updates struct {
		Channel string
		Key     string
		Feed    string
	}
}

var appVersion = manifest.Version

func appUpdatesEnabled() bool {
	return !core.App().Development && (runtime.GOOS == "darwin" || runtime.GOOS == "windows") &&
		manifest.Updates.Channel == "direct" && manifest.Updates.Key != "" && manifest.Updates.Feed != ""
}
