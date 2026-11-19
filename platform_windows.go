//go:build windows

package main

import (
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

// Preserve the legacy WebView2 profile and DWM appearance.
func configurePlatform(app *options.App) {
	app.Windows = &windows.Options{
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
	}
}
