// SPDX-License-Identifier: GPL-3.0-only
package update

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"debug/macho"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

const (
	quarantineAttr = "com.apple.quarantine"
)

var macBundleID = "io.github.pembrock.findanote"

type NativeLauncher struct {
	current Version
	key     ed25519.PublicKey
}

func NewNativeLauncher(current Version, key ed25519.PublicKey) NativeLauncher {
	return NativeLauncher{current, key}
}

func (NativeLauncher) Supported() bool { return true }
func (NativeLauncher) Select(m Manifest) (Package, bool) {
	if state, err := macStatePath(); err == nil {
		version, _ := os.ReadFile(filepath.Join(state, "rejected-version"))
		if string(version) == m.Version {
			return Package{}, false
		}
	}
	return MacOSPackage(m)
}
func (n NativeLauncher) AutomaticDMG() bool {
	_, err := macInstallTarget()
	return err == nil && macApplicationLock != nil
}
func diskFull(error) bool { return false }

func macInstallTarget() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	target := filepath.Dir(filepath.Dir(filepath.Dir(executable)))
	parent := filepath.Dir(target)
	if !strings.HasSuffix(target, ".app") || strings.Contains(target, "/AppTranslocation/") ||
		filepath.Dir(executable) != filepath.Join(target, "Contents", "MacOS") {
		return "", os.ErrPermission
	}
	if err := macTargetDirectory(target); err != nil {
		return "", err
	}
	var stat unix.Statfs_t
	if err := unix.Statfs(parent, &stat); err != nil {
		return "", err
	}
	if stat.Flags&unix.MNT_RDONLY != 0 || unix.Access(parent, unix.W_OK|unix.X_OK) != nil {
		return "", os.ErrPermission
	}
	return target, nil
}

func macTargetDirectory(target string) error {
	if !filepath.IsAbs(target) || !strings.HasSuffix(target, ".app") || strings.Contains(target, "/AppTranslocation/") {
		return os.ErrPermission
	}
	for dir := target; dir != "/"; dir = filepath.Dir(dir) {
		var st unix.Stat_t
		if err := unix.Lstat(dir, &st); err != nil {
			return err
		}
		if st.Mode&unix.S_IFMT != unix.S_IFDIR || (st.Uid != 0 && st.Uid != uint32(os.Getuid())) ||
			(st.Mode&0022 != 0 && !(dir == "/Applications" && st.Uid == 0 && st.Gid == 80 && st.Mode&0002 == 0)) {
			return os.ErrPermission
		}
	}
	return nil
}

func macCommand(ctx context.Context, path string, args ...string) ([]byte, error) {
	out, err := exec.CommandContext(ctx, path, args...).CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("%s: %w (%s)", filepath.Base(path), err, strings.TrimSpace(string(out)))
	}
	return out, nil
}

func macPlist(ctx context.Context, app, key string) (string, error) {
	out, err := macCommand(ctx, "/usr/bin/plutil", "-extract", key, "raw", "-o", "-", filepath.Join(app, "Contents", "Info.plist"))
	return strings.TrimSpace(string(out)), err
}

func macExecutable(ctx context.Context, app string) (string, error) {
	name, err := macPlist(ctx, app, "CFBundleExecutable")
	if err != nil || name == "" || filepath.Base(name) != name || name == "." || name == ".." {
		return "", errors.New("invalid bundle executable")
	}
	return filepath.Join(app, "Contents", "MacOS", name), nil
}

func macHash(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func macBundle(ctx context.Context, app, version string) (string, error) {
	if err := filepath.WalkDir(app, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 || (!entry.IsDir() && !entry.Type().IsRegular()) {
			return fmt.Errorf("unexpected bundle entry: %s", filepath.Base(path))
		}
		return nil
	}); err != nil {
		return "", err
	}
	for key, expected := range map[string]string{
		"CFBundleIdentifier": macBundleID, "CFBundleVersion": version,
		"CFBundleShortVersionString": version, "CFBundlePackageType": "APPL",
	} {
		if actual, err := macPlist(ctx, app, key); err != nil || actual != expected {
			return "", fmt.Errorf("bundle %s does not match %q", key, expected)
		}
	}
	path, err := macExecutable(ctx, app)
	if err != nil {
		return "", err
	}
	binary, err := macho.Open(path)
	if err != nil {
		return "", err
	}
	defer binary.Close()
	if binary.Cpu != macho.CpuArm64 || binary.Type != macho.TypeExec {
		return "", errors.New("expected an arm64 executable")
	}
	if _, err = macCommand(ctx, "/usr/bin/codesign", "--verify", "--deep", "--strict", "--all-architectures", app); err != nil {
		return "", err
	}
	return macHash(path)
}

func macCopyFile(source, dest string, mode os.FileMode) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	return errors.Join(copyErr, output.Sync(), output.Close())
}

func macQuarantine(path string) (string, error) {
	var data [1024]byte
	n, err := unix.Getxattr(path, quarantineAttr, data[:])
	if err != nil {
		return "", err
	}
	return string(data[:n]), nil
}

func macStage(ctx context.Context, job Job, dir, version string) (string, error) {
	dmg := filepath.Join(dir, job.Package.Name)
	if err := macCopyFile(job.File, dmg, 0600); err != nil {
		return "", err
	}
	input, err := os.Open(dmg)
	if err != nil {
		return "", err
	}
	err = job.Package.ValidateStream(input)
	input.Close()
	if err != nil {
		return "", err
	}
	// Go's HTTP client does not mark downloads. Use a fresh quarantine record;
	// never apply the old application's user-approval flags to new bytes.
	if err := unix.Setxattr(dmg, quarantineAttr, []byte(fmt.Sprintf("0081;%08x;Find a Note;", time.Now().Unix())), unix.XATTR_CREATE); err != nil {
		return "", err
	}
	if _, err := macCommand(ctx, "/usr/bin/hdiutil", "verify", dmg); err != nil {
		return "", err
	}
	mount, err := os.MkdirTemp("", "find-a-note-mount-")
	if err != nil {
		return "", err
	}
	defer os.Remove(mount)
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_, _ = macCommand(cleanup, "/usr/bin/hdiutil", "detach", mount)
	}()
	if _, err := macCommand(ctx, "/usr/bin/hdiutil", "attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, dmg); err != nil {
		return "", err
	}
	var stat unix.Statfs_t
	if err := unix.Statfs(mount, &stat); err != nil || stat.Flags&unix.MNT_RDONLY == 0 {
		return "", errors.New("expected a read-only disk image")
	}
	source := filepath.Join(mount, "Find a Note.app")
	expected, err := macBundle(ctx, source, version)
	if err != nil {
		return "", err
	}
	staged := filepath.Join(dir, "payload.app")
	if _, err := macCommand(ctx, "/usr/bin/ditto", source, staged); err != nil {
		return "", err
	}
	if attr, err := macQuarantine(staged); err != nil || !strings.HasPrefix(attr, "0081;") {
		return "", errors.New("disk image did not quarantine the copied bundle")
	}
	if actual, err := macBundle(ctx, staged, version); err != nil || actual != expected {
		return "", errors.New("copied bundle failed verification")
	}
	return expected, nil
}
