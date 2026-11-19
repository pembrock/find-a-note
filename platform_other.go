//go:build !windows && !darwin

package main

import "github.com/wailsapp/wails/v2/pkg/options"

func configurePlatform(app *options.App) {}
