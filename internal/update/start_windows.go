//go:build windows && amd64

// SPDX-License-Identifier: GPL-3.0-only
package update

import (
	"context"
	"crypto/ed25519"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const (
	stagePrefix  = ".find-a-note-update-"
	helperFlag   = "--find-a-note-update-helper"
	healthFlag   = "--find-a-note-update-health"
	recoveryFlag = "--find-a-note-update-recovered"
	installKey   = `Software\Microsoft\Windows\CurrentVersion\Uninstall\Find a Note`
)

type NativeLauncher struct {
	target  string
	version Version
	key     ed25519.PublicKey
}

func NewNativeLauncher(v Version, key ed25519.PublicKey) NativeLauncher {
	exe, err := os.Executable()
	if err == nil {
		exe, err = filepath.EvalSymlinks(exe)
	}
	if err != nil {
		exe = ""
	}
	return NativeLauncher{target: exe, version: v, key: key}
}

func (n NativeLauncher) Kind() string {
	if n.target == "" {
		return ""
	}
	return installationKind(n.target)
}

func (n NativeLauncher) Supported() bool { return n.target != "" }

func (n NativeLauncher) Select(m Manifest) (Package, bool) {
	return WindowsPackage(m, n.Kind())
}

func installationKind(target string) string {
	key, err := registry.OpenKey(registry.CURRENT_USER, installKey, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return "portable"
	}
	defer key.Close()
	location, _, err := key.GetStringValue("InstallLocation")
	if err == nil && location != "" {
		if actual, err := filepath.EvalSymlinks(filepath.Join(location, "Find a Note.exe")); err == nil && equalPath(actual, target) {
			return "installer"
		}
	}
	return "portable"
}

func equalPath(a, b string) bool { return strings.EqualFold(filepath.Clean(a), filepath.Clean(b)) }

func (n NativeLauncher) Start(job Job) error {
	_, p, err := verifiedJob(job.Manifest, job.Signature, n.key, n.version, n.Kind())
	if err != nil || p != job.Package {
		return errors.New("invalid prepared update")
	}
	stage, err := os.MkdirTemp(filepath.Dir(n.target), stagePrefix)
	if err != nil {
		return err
	}
	keep := false
	defer func() {
		if !keep {
			_ = os.RemoveAll(stage)
		}
	}()
	if err := restrictDirectory(stage); err != nil {
		return err
	}
	if err := copyExclusive(n.target, filepath.Join(stage, "helper.exe")); err != nil {
		return err
	}
	if err := copyExclusive(job.File, filepath.Join(stage, "package.exe")); err != nil {
		return err
	}
	if err := checkFile(p, filepath.Join(stage, "package.exe")); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(stage, ManifestName), job.Manifest, 0600); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(stage, SignatureName), job.Signature, 0600); err != nil {
		return err
	}

	cmd := exec.Command(filepath.Join(stage, "helper.exe"), helperFlag, n.target, strconv.Itoa(os.Getpid()), n.Kind())
	cmd.Dir = stage
	if err := cmd.Start(); err != nil {
		return err
	}
	finished := make(chan error, 1)
	go func() { finished <- cmd.Wait() }()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err := waitMarker(ctx, filepath.Join(stage, "waiting"), finished); err != nil {
		if cmd.Process.Kill() == nil {
			<-finished
		}
		return err
	}
	keep = true
	return nil
}

func restrictDirectory(stage string) error {
	token, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return err
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(A;OICI;FA;;;" + token.User.Sid.String() + ")")
	if err != nil {
		return err
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(stage, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
}

func copyExclusive(src, dest string) error {
	r, err := os.Open(src)
	if err != nil {
		return err
	}
	defer r.Close()
	w, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = io.Copy(w, r)
	if err == nil {
		err = w.Sync()
	}
	return errors.Join(err, w.Close())
}

func checkFile(p Package, path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return p.ValidateStream(file)
}

func verifiedJob(raw, sig []byte, key ed25519.PublicKey, current Version, kind string) (Manifest, Package, error) {
	m, err := VerifyManifest(raw, sig, key)
	if err != nil {
		return m, Package{}, err
	}
	v, err := ParseVersion(m.Version)
	if err != nil || !v.NewerThan(current) {
		return m, Package{}, errors.New("update is not newer")
	}
	p, ok := WindowsPackage(m, kind)
	if !ok {
		return m, p, errors.New("wrong Windows update package")
	}
	return m, p, nil
}

func waitMarker(ctx context.Context, path string, finished <-chan error) error {
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		if _, err := os.Stat(path); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-finished:
			return errors.New("update process exited before acknowledgement")
		case <-ticker.C:
		}
	}
}

func marker(path string) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	return f.Close()
}

func safeStage(stage, target string) bool {
	return filepath.IsAbs(stage) && filepath.IsAbs(target) && equalPath(filepath.Dir(stage), filepath.Dir(target)) &&
		strings.HasPrefix(filepath.Base(stage), stagePrefix) && strings.EqualFold(filepath.Ext(target), ".exe")
}

func RunHelper(args []string, current Version, key ed25519.PublicKey) bool {
	if len(args) == 0 || args[0] != helperFlag {
		return false
	}
	if len(args) != 4 {
		return true
	}
	self, err := os.Executable()
	if err != nil {
		return true
	}
	stage, target := filepath.Dir(self), args[1]
	pid, err := strconv.ParseUint(args[2], 10, 32)
	if err != nil || !safeStage(stage, target) || !strings.EqualFold(filepath.Base(self), "helper.exe") {
		return true
	}
	if err := runHelper(stage, target, uint32(pid), args[3], current, key); err != nil {
		if _, waiting := os.Stat(filepath.Join(stage, "waiting")); waiting == nil {
			reportFailure("Не удалось завершить обновление. Папка восстановления: " + stage)
		}
	}
	return true
}

func runHelper(stage, target string, pid uint32, kind string, current Version, key ed25519.PublicKey) error {
	parent, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(parent)
	image := make([]uint16, 32768)
	size := uint32(len(image))
	if err := windows.QueryFullProcessImageName(parent, 0, &image[0], &size); err != nil || !equalPath(windows.UTF16ToString(image[:size]), target) {
		return errors.New("update parent path differs")
	}
	if kind != installationKind(target) {
		return errors.New("update installation type differs")
	}
	raw, err := readLocal(filepath.Join(stage, ManifestName), MaxManifestSize)
	if err != nil {
		return err
	}
	sig, err := readLocal(filepath.Join(stage, SignatureName), ed25519.SignatureSize)
	if err != nil {
		return err
	}
	m, p, err := verifiedJob(raw, sig, key, current, kind)
	if err != nil {
		return err
	}
	candidate := filepath.Join(stage, "package.exe")
	if err := checkFile(p, candidate); err != nil {
		return err
	}
	backup := filepath.Join(stage, "previous.exe")
	if err := copyExclusive(target, backup); err != nil {
		return err
	}
	if err := marker(filepath.Join(stage, "waiting")); err != nil {
		return err
	}
	code, err := windows.WaitForSingleObject(parent, 60000)
	if err != nil || code != windows.WAIT_OBJECT_0 {
		return errors.New("old application did not exit")
	}

	next := candidate
	if kind == "installer" {
		next, err = extractInstaller(stage, candidate)
		if err == nil {
			portable, _ := WindowsPackage(m, "portable")
			err = checkFile(portable, next)
		}
	}
	if err == nil {
		err = replaceFile(next, target)
	}
	if err != nil {
		return recoverApp(target, stage)
	}

	if err = launchAndConfirm(target, stage, kind, m.Version); err != nil {
		if err := replaceFile(backup, target); err != nil {
			return err
		}
		return recoverApp(target, stage)
	}
	_ = marker(filepath.Join(stage, "finished"))
	return nil
}

func readLocal(path string, limit int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(io.LimitReader(file, limit+1))
}

func extractInstaller(stage, installer string) (string, error) {
	extract := filepath.Join(stage, "extract")
	if err := os.Mkdir(extract, 0700); err != nil {
		return "", err
	}
	if err := marker(filepath.Join(extract, ".find-a-note-stage")); err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, installer)
	cmd.Dir = stage
	cmd.SysProcAttr = &windows.SysProcAttr{HideWindow: true, CmdLine: windows.EscapeArg(installer) + " /S /UPDATESTAGE /D=" + extract}
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return filepath.Join(extract, "Find a Note.exe"), nil
}

func replaceFile(from, to string) error {
	a, err := windows.UTF16PtrFromString(from)
	if err != nil {
		return err
	}
	b, err := windows.UTF16PtrFromString(to)
	if err != nil {
		return err
	}
	return windows.MoveFileEx(a, b, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}

func launchAndConfirm(target, stage, kind, version string) error {
	cmd := exec.Command(target, healthFlag, stage, strconv.Itoa(os.Getpid()))
	cmd.Dir = filepath.Dir(target)
	if err := cmd.Start(); err != nil {
		return err
	}
	finished := make(chan error, 1)
	go func() { finished <- cmd.Wait() }()
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	err := waitMarker(ctx, filepath.Join(stage, "healthy"), finished)
	if err == nil && kind == "installer" {
		if installationKind(target) != kind {
			err = errors.New("installation registration changed")
		} else {
			err = writeInstalledVersion(version)
		}
	}
	if err != nil {
		if cmd.Process.Kill() == nil {
			<-finished
		}
	}
	return err
}

func writeInstalledVersion(version string) error {
	key, err := registry.OpenKey(registry.CURRENT_USER, installKey, registry.SET_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return err
	}
	defer key.Close()
	return key.SetStringValue("DisplayVersion", version)
}

func recoverApp(target, stage string) error {
	cmd := exec.Command(target, recoveryFlag, stage, strconv.Itoa(os.Getpid()))
	cmd.Dir = filepath.Dir(target)
	if err := cmd.Start(); err != nil {
		return err
	}
	_ = marker(filepath.Join(stage, "finished"))
	return cmd.Process.Release()
}

func RecoveryNotice(args []string) bool {
	return len(args) == 3 && args[0] == recoveryFlag
}

func FrontendReady(args []string) {
	if len(args) != 3 || (args[0] != healthFlag && args[0] != recoveryFlag) {
		return
	}
	exe, err := os.Executable()
	if err != nil || !safeStage(args[1], exe) {
		return
	}
	stage := args[1]
	pid, err := strconv.ParseUint(args[2], 10, 32)
	if err != nil {
		return
	}
	if args[0] == healthFlag {
		_ = marker(filepath.Join(stage, "healthy"))
	}
	go cleanupFinished(stage, uint32(pid))
}

func cleanupFinished(stage string, pid uint32) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if waitMarker(ctx, filepath.Join(stage, "finished"), nil) != nil {
		return
	}
	if p, err := windows.OpenProcess(windows.SYNCHRONIZE, false, pid); err == nil {
		code, err := windows.WaitForSingleObject(p, 10000)
		_ = windows.CloseHandle(p)
		if err != nil || code != windows.WAIT_OBJECT_0 {
			return
		}
	}
	for _, name := range []string{ManifestName, SignatureName, "helper.exe", "package.exe", "previous.exe", "healthy", "waiting", "finished",
		filepath.Join("extract", "Find a Note.exe"), filepath.Join("extract", ".find-a-note-stage"), "extract"} {
		_ = os.Remove(filepath.Join(stage, name))
	}
	_ = os.Remove(stage)
}

func reportFailure(message string) {
	text, _ := windows.UTF16PtrFromString(message)
	title, _ := windows.UTF16PtrFromString("Find a Note")
	_, _ = windows.MessageBox(0, text, title, 0x10)
}
