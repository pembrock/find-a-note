// SPDX-License-Identifier: GPL-3.0-only
package main

import (
	"context"
	"os"
	"sonari/internal/update"
	"sync/atomic"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type UpdateBridge struct {
	version update.Version
	ctx     context.Context
	service atomic.Pointer[update.Service]
	started atomic.Bool
}

func (b *UpdateBridge) startup(ctx context.Context) {
	defer b.started.Store(true)
	b.ctx = ctx
	if runtime.Environment(ctx).BuildType != "production" {
		return
	}
	key := update.PublicKey()
	service := update.New(b.version, key, update.NewGitHub(), update.NewNativeLauncher(b.version, key))
	b.service.Store(service)
	go service.Check()
}

func (b *UpdateBridge) shutdown() {
	if service := b.service.Load(); service != nil {
		service.Close()
	}
}

func (b *UpdateBridge) Status() update.Status {
	if service := b.service.Load(); service != nil {
		return service.Status()
	}
	if !b.started.Load() {
		return update.Status{Phase: "idle"}
	}
	return update.Status{Phase: "unsupported"}
}

func (b *UpdateBridge) Check() {
	if service := b.service.Load(); service != nil {
		service.Check()
	}
}

func (b *UpdateBridge) Download() {
	if service := b.service.Load(); service != nil {
		service.Download()
	}
}

func (b *UpdateBridge) Cancel() {
	if service := b.service.Load(); service != nil {
		service.Cancel()
	}
}

func (b *UpdateBridge) Install() {
	if service := b.service.Load(); service != nil && service.Install() {
		runtime.Quit(b.ctx)
	}
}

func (b *UpdateBridge) FrontendReady() bool {
	update.FrontendReady(os.Args[1:])
	return update.RecoveryNotice(os.Args[1:])
}
