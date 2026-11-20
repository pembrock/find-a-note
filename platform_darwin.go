package main

import (
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

func configurePlatform(app *options.App) {
	// Native frame also enables Wails' standard Application/Edit/Window menus.
	app.Frameless = false
	app.Mac = &mac.Options{
		TitleBar: mac.TitleBarDefault(), Appearance: mac.NSAppearanceNameDarkAqua,
		Preferences: &mac.Preferences{TabFocusesLinks: mac.Enabled},
	}
}
