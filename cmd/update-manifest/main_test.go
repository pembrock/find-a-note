// SPDX-License-Identifier: GPL-3.0-only
package main

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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

func TestSignedReleaseAgainstCIIndex(t *testing.T) {
	dir := t.TempDir()
	const version = "0.4.1"
	for _, name := range []string{
		"Find-a-Note-0.4.1-Windows-Setup.exe",
		"Find-a-Note-0.4.1-Windows-Portable.exe",
		update.MacOSDMG(version).Name,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	notes := filepath.Join(dir, "notes.md")
	if err := os.WriteFile(notes, []byte("## English\nChanges.\n## Русский\nИзменения."), 0600); err != nil {
		t.Fatal(err)
	}
	manifest, err := releaseManifest(version, dir, notes, true)
	if err != nil {
		t.Fatal(err)
	}
	index := filepath.Join(dir, "packages.json")
	expected := make(map[string]update.Package)
	for _, asset := range manifest.Packages {
		expected[asset.Name] = asset
	}
	rawIndex, err := json.Marshal(expected)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(index, rawIndex, 0600); err != nil {
		t.Fatal(err)
	}
	raw, err := checkedManifest(version, dir, notes, true, index)
	if err != nil {
		t.Fatal(err)
	}
	public, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := signManifest(dir, raw, private, public); err != nil {
		t.Fatal(err)
	}
	if err := verifyRelease(version, dir, notes, true, index, public); err != nil {
		t.Fatal(err)
	}
	if err := signManifest(dir, raw, private, public); !os.IsExist(err) {
		t.Fatalf("expected existing signed manifest to be preserved, got %v", err)
	}
	sigPath := filepath.Join(dir, update.SignatureName)
	sig, err := os.ReadFile(sigPath)
	if err != nil {
		t.Fatal(err)
	}
	sig[0] ^= 1
	if err := os.WriteFile(sigPath, sig, 0600); err != nil {
		t.Fatal(err)
	}
	if err := verifyRelease(version, dir, notes, true, index, public); err == nil || err.Error() != "invalid update signature" {
		t.Fatalf("expected invalid signature, got %v", err)
	}
	asset := filepath.Join(dir, update.MacOSDMG(version).Name)
	if err := os.WriteFile(asset, []byte("different content and size"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := checkedManifest(version, dir, notes, true, index); err == nil || !strings.Contains(err.Error(), "differs from verified CI artifact") {
		t.Fatalf("modified package accepted for signing: %v", err)
	}
}
