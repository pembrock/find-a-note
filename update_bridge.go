// SPDX-License-Identifier: GPL-3.0-only
package main

import (
	"context"
	"os"
	"sonari/internal/update"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type UpdateBridge struct {
	version update.Version
	ctx     context.Context
	service atomic.Pointer[update.Service]
	started atomic.Bool
	ready   sync.Once
	restart atomic.Bool
}

const updateCheckInterval = time.Hour

func (b *UpdateBridge) startup(ctx context.Context) {
	defer b.started.Store(true)
	b.ctx = ctx
	if runtime.Environment(ctx).BuildType != "production" {
		return
	}
	key := update.PublicKey()
	service := update.New(b.version, key, update.NewGitHub(), update.NewNativeLauncher(b.version, key))
	b.service.Store(service)
	go service.RunChecks(updateCheckInterval)
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
		b.restart.Store(true)
		runtime.Quit(b.ctx)
	}
}

func (b *UpdateBridge) beforeClose(context.Context) bool {
	service := b.service.Load()
	return service != nil && service.Status().Phase == "installing" && !b.restart.Load()
}

func (b *UpdateBridge) FrontendReady() string {
	var notice string
	b.ready.Do(func() {
		args := os.Args[1:]
		if update.FrontendReady(args) {
			notice = "updated"
		} else if update.RecoveryNotice(args) {
			notice = "recovered"
		}
	})
	return notice
}
