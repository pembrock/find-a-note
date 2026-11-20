// SPDX-License-Identifier: GPL-3.0-only
package update

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

const macHelperFlag = "--find-a-note-mac-update"
const macResumeFlag = "--find-a-note-mac-recover"

type macTransaction struct {
	Target, Stage, OldVersion, NewVersion, OldHash, NewHash string
}

var macApplicationLock *os.File

func macStatePath() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, macBundleID+".updates"), nil
}

func macState() (string, error) {
	dir, err := macStatePath()
	if err != nil {
		return "", err
	}
	if err := os.Mkdir(dir, 0700); err != nil && !os.IsExist(err) {
		return "", err
	}
	var st unix.Stat_t
	if err := unix.Lstat(dir, &st); err != nil {
		return "", err
	}
	if st.Mode&unix.S_IFMT != unix.S_IFDIR || st.Mode&0077 != 0 || st.Uid != uint32(os.Getuid()) {
		return "", os.ErrPermission
	}
	return dir, nil
}

func macLock(dir, name string, mode int) (*os.File, error) {
	f, err := os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_RDWR|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	if err := unix.Flock(int(f.Fd()), mode); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}

func macSyncDir(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func macWrite(dir, name string, data []byte) error {
	f, err := os.CreateTemp(dir, ".write-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, writeErr := f.Write(data)
	if err := errors.Join(writeErr, f.Sync(), f.Close()); err != nil {
		return err
	}
	if err := os.Rename(f.Name(), filepath.Join(dir, name)); err != nil {
		return err
	}
	return macSyncDir(dir)
}

func macReadTransaction(state string) (macTransaction, error) {
	var tx macTransaction
	raw, err := os.ReadFile(filepath.Join(state, "transaction.json"))
	if err != nil {
		return tx, err
	}
	if err = json.Unmarshal(raw, &tx); err != nil {
		return tx, err
	}
	old, e1 := ParseVersion(tx.OldVersion)
	next, e2 := ParseVersion(tx.NewVersion)
	if e1 != nil || e2 != nil || !next.NewerThan(old) ||
		!digestPattern.MatchString(tx.OldHash) || !digestPattern.MatchString(tx.NewHash) ||
		filepath.Clean(tx.Target) != tx.Target || filepath.Clean(tx.Stage) != tx.Stage ||
		filepath.Dir(tx.Target) != filepath.Dir(tx.Stage) ||
		!strings.HasPrefix(filepath.Base(tx.Stage), ".find-a-note-update-") {
		return tx, errors.New("invalid macOS update journal")
	}
	return tx, nil
}

func (n NativeLauncher) Start(job Job) error {
	if macApplicationLock == nil {
		return os.ErrPermission
	}
	manifest, err := VerifyManifest(job.Manifest, job.Signature, n.key)
	if err != nil {
		return err
	}
	p, ok := MacOSPackage(manifest)
	next, err := ParseVersion(manifest.Version)
	if !ok || p != job.Package || err != nil || !next.NewerThan(n.current) {
		return errors.New("ineligible macOS update")
	}
	target, err := macInstallTarget()
	if err != nil {
		return err
	}
	state, err := macState()
	if err != nil {
		return err
	}
	lock, err := macLock(state, "transaction.lock", unix.LOCK_EX|unix.LOCK_NB)
	if err != nil {
		return errUpdatePending
	}
	defer lock.Close()
	if _, err := os.Lstat(filepath.Join(state, "transaction.json")); !os.IsNotExist(err) {
		return errUpdatePending
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	old, err := macBundle(ctx, target, n.current.String())
	if err != nil {
		return err
	}
	if old != macCurrentHash() {
		return errors.New("running executable does not match the update target")
	}
	parent := filepath.Dir(target)
	var stat unix.Statfs_t
	if err := unix.Statfs(parent, &stat); err != nil {
		return err
	}
	if stat.Bavail*uint64(stat.Bsize) < uint64(p.Size)*3 {
		return unix.ENOSPC
	}
	stage, err := os.MkdirTemp(parent, ".find-a-note-update-")
	if err != nil {
		return err
	}
	keep := false
	defer func() {
		if !keep {
			_ = os.RemoveAll(stage)
		}
	}()
	hash, err := macStage(ctx, job, stage, manifest.Version)
	if err != nil {
		log.Printf("macOS update staging: %v", err)
		return err
	}
	if err := os.Remove(filepath.Join(stage, p.Name)); err != nil {
		return err
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	helper := filepath.Join(stage, "helper")
	if err := macCopyFile(self, helper, 0700); err != nil {
		return err
	}

	// The inherited lock eliminates a gap between writing the journal and
	// starting the helper. The helper releases it when it exits.
	tx := macTransaction{target, stage, n.current.String(), manifest.Version, old, hash}
	raw, err := json.Marshal(tx)
	if err != nil {
		return err
	}
	_ = os.Remove(filepath.Join(state, "ready"))
	_ = os.Remove(filepath.Join(state, "failure"))
	_ = os.Remove(filepath.Join(state, "recovered"))
	_ = os.Remove(filepath.Join(state, "restoring"))
	if err := macWrite(state, "transaction.json", raw); err != nil {
		keep = true // Sync may have failed after the rename.
		return err
	}
	keep = true
	if err := macStartHelper(helper, macHelperFlag, lock, state); err != nil {
		return err
	}
	return nil
}

func macStartHelper(helper, flag string, lock *os.File, state string) error {
	logfile, err := os.OpenFile(filepath.Join(state, "helper.log"), os.O_WRONLY|os.O_CREATE|os.O_APPEND|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	defer logfile.Close()
	cmd := exec.Command(helper, flag)
	cmd.ExtraFiles = []*os.File{lock}
	cmd.Stdout, cmd.Stderr = logfile, logfile
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

func RunHelper(args []string, current Version, _ ed25519.PublicKey) bool {
	state, err := macState()
	isHelper := len(args) == 1 && (args[0] == macHelperFlag || args[0] == macResumeFlag)
	if err != nil {
		return isHelper
	}
	if isHelper {
		// A manually invoked recovery copy acquires the lock itself. Other
		// helper launches carry a locked descriptor from the application.
		lock, err := macHelperLock(state)
		if err != nil {
			return true
		}
		defer lock.Close()
		if err := macRunTransaction(state, current, args[0] == macResumeFlag); err != nil {
			log.Printf("macOS update: %v", err)
			macDialog(macText("The update could not continue. Any backup has been kept.", "Не удалось продолжить обновление. Резервная копия сохранена."), "error")
		}
		return true
	}
	macApplicationLock, err = macLock(state, "application.lock", unix.LOCK_SH)
	if err != nil {
		log.Printf("macOS updater application lock: %v", err)
	}
	return false
}

func macHelperLock(state string) (*os.File, error) {
	var inherited, expected unix.Stat_t
	if unix.Fstat(3, &inherited) == nil && unix.Lstat(filepath.Join(state, "transaction.lock"), &expected) == nil &&
		inherited.Dev == expected.Dev && inherited.Ino == expected.Ino &&
		unix.Flock(3, unix.LOCK_EX|unix.LOCK_NB) == nil {
		unix.CloseOnExec(3)
		return os.NewFile(3, "transaction lock"), nil
	}
	return macLock(state, "transaction.lock", unix.LOCK_EX|unix.LOCK_NB)
}

func macRunTransaction(state string, current Version, resume bool) error {
	tx, err := macReadTransaction(state)
	if err != nil {
		return err
	}
	if current.String() != tx.OldVersion {
		return errors.New("unexpected helper version")
	}
	if err := macTargetDirectory(tx.Target); err != nil {
		return err
	}
	self, err := os.Executable()
	if err != nil || self != filepath.Join(tx.Stage, "helper") {
		return errors.New("unexpected helper path")
	}
	info, err := os.Lstat(tx.Stage)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return errors.New("unexpected staging directory")
	}
	payload := filepath.Join(tx.Stage, "payload.app")
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	old, err := macBundle(ctx, tx.Target, tx.OldVersion)
	uninstalled := err == nil && old == tx.OldHash
	if uninstalled {
		failed, _ := os.ReadFile(filepath.Join(state, "restoring"))
		if string(failed) == tx.OldHash {
			return macFinishRestore(state, tx)
		}
		if resume {
			return macFinish(state, tx)
		}
		hash, err := macBundle(ctx, payload, tx.NewVersion)
		if err != nil || hash != tx.NewHash {
			return errors.New("unexpected staged version")
		}
		if err := macSwap(state, tx, true); err != nil {
			return err
		}
	} else {
		hash, err := macBundle(ctx, tx.Target, tx.NewVersion)
		old, oldErr := macBundle(ctx, payload, tx.OldVersion)
		if err != nil || oldErr != nil || hash != tx.NewHash || old != tx.OldHash {
			return errors.New("unexpected installed or backup version")
		}
	}
	if macIsReady(state, tx) {
		return macFinish(state, tx)
	}
	var launchErr error
	if !macHasMarker(state, "failure", tx.NewHash) {
		launchErr = macLaunch(tx.Target)
		if launchErr != nil {
			log.Printf("Launch Services: %v", launchErr)
		}
	}
	return macWaitForDecision(state, tx, launchErr)
}

func macSwap(state string, tx macTransaction, installing bool) error {
	target, payload := tx.Target, filepath.Join(tx.Stage, "payload.app")
	deadline := time.Now().Add(30 * time.Second)
	for {
		lock, err := macLock(state, "application.lock", unix.LOCK_EX|unix.LOCK_NB)
		if err == nil {
			defer lock.Close()
			if err := macTargetDirectory(target); err != nil {
				return err
			}
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			targetVersion, targetHash, payloadVersion, payloadHash := tx.OldVersion, tx.OldHash, tx.NewVersion, tx.NewHash
			if !installing {
				targetVersion, targetHash, payloadVersion, payloadHash = payloadVersion, payloadHash, targetVersion, targetHash
			}
			actualTarget, targetErr := macBundle(ctx, target, targetVersion)
			actualPayload, payloadErr := macBundle(ctx, payload, payloadVersion)
			if targetErr != nil || payloadErr != nil || actualTarget != targetHash || actualPayload != payloadHash {
				return errors.New("bundle changed before replacement")
			}
			if err := unix.RenameatxNp(unix.AT_FDCWD, target, unix.AT_FDCWD, payload, unix.RENAME_SWAP); err != nil {
				return err
			}
			return errors.Join(macSyncDir(filepath.Dir(target)), macSyncDir(filepath.Dir(payload)))
		}
		if !installing || !errors.Is(err, unix.EWOULDBLOCK) || time.Now().After(deadline) {
			return fmt.Errorf("cannot replace a running application: %w", err)
		}
		time.Sleep(150 * time.Millisecond)
	}
}

func macLaunch(app string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	_, err := macCommand(ctx, "/usr/bin/open", app)
	return err
}

func macHasMarker(state, name, hash string) bool {
	content, err := os.ReadFile(filepath.Join(state, name))
	return err == nil && string(content) == hash
}

func macIsReady(state string, tx macTransaction) bool {
	return macHasMarker(state, "ready", tx.NewHash)
}

func macFinish(state string, tx macTransaction) error {
	// Clear and sync the journal before removing the directory. A crash can
	// leave an orphaned backup, but cannot leave a journal without one.
	if err := os.Remove(filepath.Join(state, "transaction.json")); err != nil {
		return err
	}
	if err := macSyncDir(state); err != nil {
		return err
	}
	return os.RemoveAll(tx.Stage)
}

func macFinishRestore(state string, tx macTransaction) error {
	if err := macWrite(state, "rejected-version", []byte(tx.NewVersion)); err != nil {
		return err
	}
	if err := macWrite(state, "recovered", []byte(tx.OldHash)); err != nil {
		return err
	}
	if err := macFinish(state, tx); err != nil {
		return err
	}
	_ = os.Remove(filepath.Join(state, "restoring"))
	return macLaunch(tx.Target)
}

func macWaitForDecision(state string, tx macTransaction, launchErr error) error {
	for i := 0; i < 20; i++ {
		if macIsReady(state, tx) {
			return macFinish(state, tx)
		}
		time.Sleep(250 * time.Millisecond)
	}

	for {
		message := macText(
			"Waiting for Find a Note to start. If macOS blocked it, dismiss the warning and use System Settings → Privacy & Security → Open Anyway for Find a Note.",
			"Ожидается запуск Find a Note. Если macOS заблокировала запуск, закройте предупреждение и выберите «Системные настройки → Конфиденциальность и безопасность → Всё равно открыть» для Find a Note.",
		)
		if launchErr != nil {
			message = macText("macOS reported a launch error. ", "macOS сообщила об ошибке запуска. ") + message
		}
		action := "failed"
		if !macHasMarker(state, "failure", tx.NewHash) {
			action = macAwaitDialog(state, tx, message)
		}
		if macIsReady(state, tx) {
			return macFinish(state, tx)
		}
		switch action {
		case "restore", "failed":
			if action == "failed" {
				// The failed process writes the marker before exiting.
				time.Sleep(250 * time.Millisecond)
			}
			if err := macWrite(state, "restoring", []byte(tx.OldHash)); err != nil {
				return err
			}
			if err := macSwap(state, tx, false); err != nil {
				log.Printf("macOS update restore: %v", err)
				if action == "failed" {
					_ = os.Remove(filepath.Join(state, "failure"))
				}
				macDialog(macText("Quit Find a Note before restoring the previous version.", "Закройте Find a Note перед восстановлением предыдущей версии."), "error")
				continue
			}
			return macFinishRestore(state, tx)
		case "retry":
			launchErr = macLaunch(tx.Target)
		default:
			// No deadline for a Gatekeeper decision. Leave the journal and
			// backup intact and accept readiness even after this helper exits.
			return nil
		}
	}
}

func macAwaitDialog(state string, tx macTransaction, message string) string {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan string, 1)
	go func() { done <- macDialogContext(ctx, message, "waiting") }()
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case result := <-done:
			return result
		case <-ticker.C:
			if macIsReady(state, tx) {
				return ""
			}
			if macHasMarker(state, "failure", tx.NewHash) {
				return "failed"
			}
		}
	}
}

func macText(en, ru string) string {
	out, _ := exec.Command("/usr/bin/defaults", "read", "-g", "AppleLanguages").Output()
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) > 1 && strings.HasPrefix(strings.Trim(strings.TrimSpace(lines[1]), "\""), "ru") {
		return ru
	}
	return en
}

func macDialog(message, kind string) { macDialogContext(context.Background(), message, kind) }

func macDialogContext(ctx context.Context, message, kind string) string {
	const script = `on run argv
set promptText to item 1 of argv
set dialogKind to item 2 of argv
set laterTitle to item 3 of argv
set retryTitle to item 4 of argv
set restoreTitle to item 5 of argv
if dialogKind is "waiting" then
  set answer to button returned of (display dialog promptText with title "Find a Note" buttons {laterTitle, restoreTitle, retryTitle} default button laterTitle)
  if answer is restoreTitle then return "restore"
  if answer is retryTitle then return "retry"
else
  display alert "Find a Note" message promptText
end if
end run`
	out, _ := macCommand(ctx, "/usr/bin/osascript", "-e", script, message, kind,
		macText("Later", "Позже"), macText("Restore", "Восстановить"), macText("Retry launch", "Повторить запуск"))
	return strings.TrimSpace(string(out))
}

func macCurrentHash() string {
	self, err := os.Executable()
	if err != nil {
		return ""
	}
	hash, _ := macHash(self)
	return hash
}

// ReportStartupFailure is emitted only when Wails reports a startup error.
func ReportStartupFailure() {
	state, err := macState()
	if err != nil {
		return
	}
	tx, err := macReadTransaction(state)
	if err != nil || macIsReady(state, tx) || macCurrentHash() != tx.NewHash {
		return
	}
	if err := macWrite(state, "failure", []byte(tx.NewHash)); err != nil {
		log.Printf("macOS update startup failure marker: %v", err)
	}
	macResume(state, tx)
}

func FrontendReady([]string) bool {
	state, err := macState()
	if err != nil {
		return false
	}
	tx, err := macReadTransaction(state)
	if err != nil {
		return false
	}
	self, err := os.Executable()
	app := filepath.Dir(filepath.Dir(filepath.Dir(self)))
	current := macCurrentHash()
	if err != nil || (app != tx.Target && !strings.Contains(app, "/AppTranslocation/")) || current != tx.NewHash {
		// The old application can cancel an interrupted pre-swap update.
		if (app == tx.Target || strings.Contains(app, "/AppTranslocation/")) && current == tx.OldHash {
			macResume(state, tx)
		}
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	hash, err := macBundle(ctx, tx.Target, tx.NewVersion)
	if err != nil || hash != tx.NewHash || macWrite(state, "ready", []byte(tx.NewHash)) != nil {
		return false
	}
	macResume(state, tx)
	return true
}

func macResume(state string, tx macTransaction) {
	lock, err := macLock(state, "transaction.lock", unix.LOCK_EX|unix.LOCK_NB)
	if err == nil {
		defer lock.Close()
		if err := macStartHelper(filepath.Join(tx.Stage, "helper"), macResumeFlag, lock, state); err != nil {
			log.Printf("macOS update recovery: %v", err)
		}
	}
}

func RecoveryNotice([]string) bool {
	state, err := macState()
	if err != nil {
		return false
	}
	path := filepath.Join(state, "recovered")
	content, err := os.ReadFile(path)
	return err == nil && string(content) == macCurrentHash() && os.Remove(path) == nil
}
