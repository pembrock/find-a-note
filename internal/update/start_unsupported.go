//go:build !windows || !amd64

// SPDX-License-Identifier: GPL-3.0-only
package update

import (
	"crypto/ed25519"
	"errors"
)

type NativeLauncher struct{}

func (NativeLauncher) Supported() bool                            { return false }
func (NativeLauncher) Select(Manifest) (Package, bool)            { return Package{}, false }
func (NativeLauncher) Start(Job) error                            { return errors.New("updates unsupported") }
func NewNativeLauncher(Version, ed25519.PublicKey) NativeLauncher { return NativeLauncher{} }
func RunHelper([]string, Version, ed25519.PublicKey) bool         { return false }
func FrontendReady([]string) bool                                 { return false }
func RecoveryNotice([]string) bool                                { return false }
func diskFull(error) bool                                         { return false }
