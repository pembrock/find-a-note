package main

import (
	"context"
	"embed"
	"log"
	"os"
	"path/filepath"
	"sonari/internal/update"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
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
	err = wails.Run(&options.App{
		Title: product.Name, Width: 900, Height: 600, MinWidth: 760, MinHeight: 560,
		Frameless: true, BackgroundColour: &options.RGBA{R: 16, G: 17, B: 30, A: 255},
		// Windows DWM owns the outer shape, border and shadow. WebView fills it
		// opaquely; a second CSS rounded frame would expose rectangular backing.
		Windows: &windows.Options{
			// Wails formerly derived this roaming profile from Sonari.exe.
			WebviewUserDataPath:               filepath.Join(os.Getenv("AppData"), "Sonari.exe"),
			Theme:                             windows.Dark,
			DisableFramelessWindowDecorations: false,
			WebviewIsTransparent:              false,
			WindowIsTranslucent:               false,
			CustomTheme: &windows.ThemeSettings{
				DarkModeBorder:         windows.RGB(53, 53, 76),
				DarkModeBorderInactive: windows.RGB(53, 53, 76),
			},
		},
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
	})
	if err != nil {
		log.Fatal(err)
	}
}
