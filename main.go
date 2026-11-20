package main

import (
	"context"
	"embed"
	"log"
	"os"
	"sonari/internal/update"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	version, err := update.ParseVersion(product.Version)
	if err != nil {
		log.Fatal(err)
	}
	key := update.PublicKey()
	if update.RunHelper(os.Args[1:], version, key) {
		return
	}
	app := &App{}
	updater := &UpdateBridge{version: version}
	appOptions := &options.App{
		Title: product.Name, Width: 900, Height: 600, MinWidth: 760, MinHeight: 560,
		Frameless: true, BackgroundColour: &options.RGBA{R: 16, G: 17, B: 30, A: 255},
		AssetServer: &assetserver.Options{Assets: assets},
		OnStartup: func(ctx context.Context) {
			app.startup(ctx)
			updater.startup(ctx)
		},
		OnBeforeClose: updater.beforeClose,
		OnShutdown: func(ctx context.Context) {
			updater.shutdown()
			app.shutdown(ctx)
		},
		Bind: []interface{}{app, updater},
	}
	configurePlatform(appOptions)
	err = wails.Run(appOptions)
	if err != nil {
		update.ReportStartupFailure()
		log.Fatal(err)
	}
}
