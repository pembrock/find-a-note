// SPDX-License-Identifier: GPL-3.0-only
package update

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestMacAtomicReplacementAndRestore(t *testing.T) {
	previousID := macBundleID
	macBundleID = "io.github.pembrock.findanote.swaptest"
	t.Cleanup(func() { macBundleID = previousID })

	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	stage := filepath.Join(root, ".find-a-note-update-test")
	if err := os.Mkdir(stage, 0700); err != nil {
		t.Fatal(err)
	}
	tx := macTransaction{
		Target: filepath.Join(root, "Find a Note.app"), Stage: stage,
		OldVersion: "0.4.0", NewVersion: "0.4.1",
	}
	payload := filepath.Join(stage, "payload.app")
	tx.OldHash = macSwapFixture(t, tx.Target, tx.OldVersion, "00c1;00000000;test-A;")
	tx.NewHash = macSwapFixture(t, payload, tx.NewVersion, "0081;00000000;test-B;")

	running, err := macLock(root, "application.lock", unix.LOCK_SH)
	if err != nil {
		t.Fatal(err)
	}
	if err := macSwap(root, tx, false); !errors.Is(err, unix.EWOULDBLOCK) {
		t.Fatalf("exchange while the application is active: %v", err)
	}
	running.Close()

	assertBundle := func(path, version, hash, quarantine string) {
		t.Helper()
		got, err := macBundle(context.Background(), path, version)
		if err != nil || got != hash {
			t.Fatalf("unexpected bundle %s: hash %s, error %v", path, got, err)
		}
		attr, err := macQuarantine(path)
		if err != nil || attr != quarantine {
			t.Fatalf("unexpected quarantine: %q (%v)", attr, err)
		}
	}
	interruptMacExchange(t, root, tx, "before")
	assertBundle(tx.Target, tx.OldVersion, tx.OldHash, "00c1;00000000;test-A;")
	assertBundle(payload, tx.NewVersion, tx.NewHash, "0081;00000000;test-B;")

	interruptMacExchange(t, root, tx, "after")
	assertBundle(tx.Target, tx.NewVersion, tx.NewHash, "0081;00000000;test-B;")
	assertBundle(payload, tx.OldVersion, tx.OldHash, "00c1;00000000;test-A;")

	// The backup and installed identities survive helper termination.
	if err := macSwap(root, tx, false); err != nil {
		t.Fatal(err)
	}
	assertBundle(tx.Target, tx.OldVersion, tx.OldHash, "00c1;00000000;test-A;")
	assertBundle(payload, tx.NewVersion, tx.NewHash, "0081;00000000;test-B;")
}

func interruptMacExchange(t *testing.T, root string, tx macTransaction, phase string) {
	t.Helper()
	journal, err := json.Marshal(tx)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "transaction.json"), journal, 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestMacInterruptedExchangeWorker$")
	cmd.Env = append(os.Environ(), "FIND_A_NOTE_TEST_EXCHANGE_ROOT="+root, "FIND_A_NOTE_TEST_EXCHANGE_PHASE="+phase)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()
	marker := filepath.Join(root, "interruption-"+phase)
	for {
		if _, err := os.Stat(marker); err == nil {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("helper did not reach the %s-exchange interruption point", phase)
		case <-time.After(25 * time.Millisecond):
		}
	}
}

func TestMacInterruptedExchangeWorker(t *testing.T) {
	root := os.Getenv("FIND_A_NOTE_TEST_EXCHANGE_ROOT")
	if root == "" {
		t.Skip("subprocess fixture")
	}
	macBundleID = "io.github.pembrock.findanote.swaptest"
	tx, err := macReadTransaction(root)
	if err != nil {
		t.Fatal(err)
	}
	phase := os.Getenv("FIND_A_NOTE_TEST_EXCHANGE_PHASE")
	if phase == "after" {
		if err := macSwap(root, tx, true); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "interruption-"+phase), nil, 0600); err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Minute)
}

func macSwapFixture(t *testing.T, path, version, quarantine string) string {
	t.Helper()
	ctx := context.Background()
	if err := os.MkdirAll(filepath.Join(path, "Contents", "MacOS"), 0700); err != nil {
		t.Fatal(err)
	}
	plist := filepath.Join(path, "Contents", "Info.plist")
	if _, err := macCommand(ctx, "/usr/bin/plutil", "-create", "xml1", plist); err != nil {
		t.Fatal(err)
	}
	for key, value := range map[string]string{
		"CFBundleIdentifier": macBundleID, "CFBundleExecutable": "fixture",
		"CFBundleVersion": version, "CFBundleShortVersionString": version,
		"CFBundlePackageType": "APPL",
	} {
		if _, err := macCommand(ctx, "/usr/bin/plutil", "-insert", key, "-string", value, plist); err != nil {
			t.Fatal(err)
		}
	}
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if err := macCopyFile(self, filepath.Join(path, "Contents", "MacOS", "fixture"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := macCommand(ctx, "/usr/bin/codesign", "--force", "--sign", "-", path); err != nil {
		t.Fatal(err)
	}
	if err := unix.Setxattr(path, quarantineAttr, []byte(quarantine), unix.XATTR_CREATE); err != nil {
		t.Fatal(err)
	}
	hash, err := macBundle(ctx, path, version)
	if err != nil {
		t.Fatal(err)
	}
	return hash
}

func TestMacStageRejectsCorruptImage(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "download")
	data := []byte("This is not a disk image.")
	if err := os.WriteFile(file, data, 0600); err != nil {
		t.Fatal(err)
	}
	p := MacOSDMG("0.4.1")
	p.Size, p.SHA256 = int64(len(data)), fmt.Sprintf("%x", sha256.Sum256(data))
	// A valid package hash is insufficient when hdiutil cannot verify the image.
	job := Job{Package: p, File: file}
	_, err := macStage(context.Background(), job, root, "0.4.1")
	if err == nil || !strings.Contains(err.Error(), "hdiutil:") {
		t.Fatalf("expected disk image verification error, got %v", err)
	}
	if _, err = os.Lstat(filepath.Join(root, "payload.app")); !os.IsNotExist(err) {
		t.Fatalf("corrupt image left a staged application: %v", err)
	}
}
