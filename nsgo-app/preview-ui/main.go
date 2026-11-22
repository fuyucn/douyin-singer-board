package main

import (
	"embed"

	"github.com/nsgo-dev/nsgo"
	"github.com/nsgo-dev/nsgo/tsx/compiler"
	_ "github.com/nsgo-dev/nsgo/tsx/ui"
)

//go:embed App.tsx logo.png nsgo.yaml
var source embed.FS

var Root = compiler.App(source, "App.tsx")

func main() {
	nsgo.Run(Root, nsgo.WindowSize(1000, 680))
}
