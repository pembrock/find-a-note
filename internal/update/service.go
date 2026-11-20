// SPDX-License-Identifier: GPL-3.0-only
package update

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

// Trust changes require a new application build.
const PublicKeyHex = "512fd9985370df2113693f2c33cb121a4a77690afd182592846320fd22add00a"

func PublicKey() ed25519.PublicKey {
	key, _ := hex.DecodeString(PublicKeyHex)
	return key
}

type Status struct {
	Phase          string `json:"phase"`
	Version        string `json:"version"`
	Notes          string `json:"notes"`
	Progress       int    `json:"progress"`
	Received       int64  `json:"received"`
	Total          int64  `json:"total"`
	Problem        string `json:"problem"`
	Manual         bool   `json:"manual,omitempty"`
	VerifiedSHA256 string `json:"verifiedSHA256,omitempty"`
}

type Job struct {
	Manifest  []byte
	Signature []byte
	Package   Package
	File      string
}

type Launcher interface {
	Supported() bool
	Select(Manifest) (Package, bool)
	Start(Job) error
}

type Service struct {
	ctx      context.Context
	stop     context.CancelFunc
	provider UpdateProvider
	launcher Launcher
	current  Version
	key      ed25519.PublicKey
	mu       sync.Mutex
	state    Status
	job      Job
	cache    string
	cancel   context.CancelFunc
}

func New(current Version, key ed25519.PublicKey, p UpdateProvider, l Launcher) *Service {
	ctx, stop := context.WithCancel(context.Background())
	initial := "idle"
	if !l.Supported() {
		initial = "unsupported"
	}
	return &Service{ctx: ctx, stop: stop, current: current, key: append(ed25519.PublicKey(nil), key...), provider: p, launcher: l, state: Status{Phase: initial}}
}

func (s *Service) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

func (s *Service) RunChecks(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	s.runChecks(ticker.C)
}

func (s *Service) runChecks(ticks <-chan time.Time) {
	s.checkOnce(true)
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticks:
			s.checkOnce(true)
		}
	}
}

func (s *Service) Check() {
	s.checkOnce(false)
}

func (s *Service) checkOnce(background bool) {
	s.mu.Lock()
	if s.ctx.Err() != nil {
		s.mu.Unlock()
		return
	}
	switch s.state.Phase {
	case "unsupported", "checking", "downloading", "installing", "install-error":
		s.mu.Unlock()
		return
	}
	if s.state.Phase == "ready" && !s.state.Manual {
		s.mu.Unlock()
		return
	}
	previous := s.state
	s.state.Phase = "checking"
	s.mu.Unlock()

	ctx, cancel := context.WithTimeout(s.ctx, 25*time.Second)
	defer cancel()
	state, job := s.check(ctx)
	s.mu.Lock()
	defer s.mu.Unlock()
	if background && state.Phase == "check-error" && previous.Version != "" {
		s.state = previous
	} else {
		s.state, s.job = state, job
	}
}

func (s *Service) check(ctx context.Context) (Status, Job) {
	release, err := s.provider.Latest(ctx)
	version := release.Version
	if errors.Is(err, ErrNoRelease) || (err == nil && !version.NewerThan(s.current)) {
		return Status{Phase: "current"}, Job{}
	}
	fail := Status{Phase: "check-error", Problem: "feed"}
	if err != nil {
		return fail, Job{}
	}
	if n := release.Assets[ManifestName]; n <= 0 || n > MaxManifestSize || release.Assets[SignatureName] != ed25519.SignatureSize {
		return fail, Job{}
	}
	raw, err := readAsset(ctx, s.provider, version, ManifestName, MaxManifestSize)
	if err != nil {
		return fail, Job{}
	}
	signature, err := readAsset(ctx, s.provider, version, SignatureName, ed25519.SignatureSize)
	if err != nil {
		return fail, Job{}
	}
	m, err := VerifyManifest(raw, signature, s.key)
	if err != nil || m.Version != version.String() {
		fail.Problem = "manifest"
		return fail, Job{}
	}
	p, ok := s.launcher.Select(m)
	if !ok || release.Assets[p.Name] != p.Size {
		return Status{Phase: "unavailable"}, Job{}
	}
	return Status{Phase: "available", Version: m.Version, Notes: m.Notes, Manual: p.OS == "darwin"}, Job{Manifest: raw, Signature: signature, Package: p}
}

func readAsset(ctx context.Context, p UpdateProvider, version Version, name string, limit int64) ([]byte, error) {
	r, err := p.Open(ctx, version, name)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	data, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err == nil && int64(len(data)) > limit {
		err = errors.New("asset exceeds limit")
	}
	return data, err
}

func (s *Service) Download() {
	s.mu.Lock()
	if s.state.Phase != "available" && s.state.Phase != "download-error" {
		s.mu.Unlock()
		return
	}
	ctx, cancel := context.WithTimeout(s.ctx, 5*time.Minute)
	s.cancel = cancel
	s.state.Phase, s.state.Progress = "downloading", 0
	version, _ := ParseVersion(s.state.Version)
	p := s.job.Package
	s.state.Received, s.state.Total, s.state.Problem = 0, p.Size, ""
	s.mu.Unlock()

	var dir, file string
	var err error
	if p.OS == "darwin" {
		// Verify the served bytes without writing a launchable image. The browser
		// handles the user's copy and its normal quarantine policy.
		err = s.receive(ctx, version, p, io.Discard)
	} else {
		dir, file, err = s.download(ctx, version, p)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	canceled := errors.Is(ctx.Err(), context.Canceled)
	cancel()
	s.cancel = nil
	if err != nil || canceled {
		if dir != "" {
			_ = os.RemoveAll(dir)
		}
		s.state.Phase = "download-error"
		s.state.Problem = updateProblem(err, "download")
		if canceled {
			s.state.Phase = "available"
		}
		return
	}
	s.cache, s.job.File = dir, file
	s.state.Phase, s.state.Progress = "ready", 100
	if s.state.Manual {
		s.state.VerifiedSHA256 = p.SHA256
	}
}

func (s *Service) download(ctx context.Context, version Version, p Package) (string, string, error) {
	dir, err := os.MkdirTemp("", "find-a-note-download-")
	if err != nil {
		return "", "", err
	}
	file := filepath.Join(dir, p.Name)
	dst, err := os.OpenFile(file, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return dir, "", err
	}
	defer dst.Close()
	err = s.receive(ctx, version, p, dst)
	if err == nil {
		err = dst.Sync()
	}
	if err == nil {
		err = dst.Close()
	}
	return dir, file, err
}

func (s *Service) receive(ctx context.Context, version Version, p Package, dst io.Writer) error {
	src, err := s.provider.Open(ctx, version, p.Name)
	if err != nil {
		return err
	}
	defer src.Close()
	progress := &progressWriter{file: dst, ctx: ctx, report: func(written int64) {
		s.mu.Lock()
		s.state.Received = written
		s.state.Progress = min(99, int(written*100/p.Size))
		s.mu.Unlock()
	}}
	return p.ValidateStream(io.TeeReader(src, progress))
}

type progressWriter struct {
	file    io.Writer
	ctx     context.Context
	written int64
	report  func(int64)
}

func (w *progressWriter) Write(data []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := w.file.Write(data)
	w.written += int64(n)
	w.report(w.written)
	return n, err
}

func (s *Service) Cancel() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
	}
	if s.state.Phase == "ready" || s.state.Phase == "install-error" {
		_ = os.RemoveAll(s.cache)
		s.cache, s.job.File = "", ""
		s.state.Phase, s.state.Progress = "available", 0
		s.state.VerifiedSHA256 = ""
	}
}

func (s *Service) Install() bool {
	s.mu.Lock()
	if s.state.Manual || (s.state.Phase != "ready" && s.state.Phase != "install-error") {
		s.mu.Unlock()
		return false
	}
	s.state.Phase = "installing"
	job := s.job
	s.mu.Unlock()
	err := s.launcher.Start(job)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		s.state.Phase = "install-error"
		s.state.Problem = updateProblem(err, "prepare")
		return false
	}
	_ = os.RemoveAll(s.cache)
	s.cache = ""
	return true
}

func updateProblem(err error, fallback string) string {
	switch {
	case errors.Is(err, syscall.ENOSPC), diskFull(err):
		return "space"
	case errors.Is(err, os.ErrPermission):
		return "permission"
	case errors.Is(err, errPackageIntegrity):
		return "integrity"
	default:
		return fallback
	}
}

func (s *Service) Close() {
	s.stop()
	s.Cancel()
}
