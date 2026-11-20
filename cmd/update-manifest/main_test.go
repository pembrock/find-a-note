// SPDX-License-Identifier: GPL-3.0-only
package main

import (
	"bytes"
	"crypto/ed25519"
	"os"
	"path/filepath"
	"testing"

	"sonari/internal/update"
)

func TestCommonReleaseManifest(t *testing.T) {
	dir := t.TempDir()
	const version = "0.3.1"
	payload := []byte("test asset")
	for _, name := range []string{
		"Find-a-Note-0.3.1-Windows-Setup.exe",
		"Find-a-Note-0.3.1-Windows-Portable.exe",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), payload, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := releaseManifest(version, dir, "", true); err == nil {
		t.Fatal("combined manifest accepted a missing DMG")
	}
	mac := update.MacOSDMG(version)
	if err := os.WriteFile(filepath.Join(dir, mac.Name), payload, 0600); err != nil {
		t.Fatal(err)
	}
	old, err := releaseManifest(version, dir, "", false)
	if err != nil || len(old.Packages) != 2 {
		t.Fatalf("Windows-only manifest: %+v, %v", old, err)
	}
	m, err := releaseManifest(version, dir, "", true)
	if err != nil || len(m.Packages) != 3 {
		t.Fatalf("combined manifest: %+v, %v", m, err)
	}
	raw, err := update.CanonicalManifest(m)
	if err != nil {
		t.Fatal(err)
	}
	key, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	verified, err := update.VerifyManifest(raw, ed25519.Sign(private, raw), key)
	if err != nil {
		t.Fatal(err)
	}
	p, ok := update.MacOSPackage(verified)
	if !ok || p.ValidateStream(bytes.NewReader(payload)) != nil {
		t.Fatal("combined manifest does not cover the DMG")
	}
}
