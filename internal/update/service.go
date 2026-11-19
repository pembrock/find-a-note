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
	"time"
)

// Trust changes require a new application build.
const PublicKeyHex = "512fd9985370df2113693f2c33cb121a4a77690afd182592846320fd22add00a"

func PublicKey() ed25519.PublicKey {
	key, _ := hex.DecodeString(PublicKeyHex)
	return key
}

type Status struct {
	Phase    string `json:"phase"`
	Version  string `json:"version"`
	Notes    string `json:"notes"`
	Progress int    `json:"progress"`
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

func (s *Service) Check() {
	s.mu.Lock()
	switch s.state.Phase {
	case "unsupported", "checking", "downloading", "ready", "installing", "install-error":
		s.mu.Unlock()
		return
	}
	s.state = Status{Phase: "checking"}
	s.job = Job{}
	s.mu.Unlock()

	ctx, cancel := context.WithTimeout(s.ctx, 25*time.Second)
	defer cancel()
	state, job := s.check(ctx)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state, s.job = state, job
}

func (s *Service) check(ctx context.Context) (Status, Job) {
	release, err := s.provider.Latest(ctx)
	version := release.Version
	if errors.Is(err, ErrNoRelease) || (err == nil && !version.NewerThan(s.current)) {
		return Status{Phase: "current"}, Job{}
	}
	fail := Status{Phase: "check-error"}
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
		return fail, Job{}
	}
	p, ok := s.launcher.Select(m)
	if !ok || release.Assets[p.Name] != p.Size {
		return Status{Phase: "unavailable"}, Job{}
	}
	return Status{Phase: "available", Version: m.Version, Notes: m.Notes}, Job{Manifest: raw, Signature: signature, Package: p}
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
	s.mu.Unlock()

	dir, file, err := s.download(ctx, version, p)
	canceled := errors.Is(ctx.Err(), context.Canceled)
	cancel()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cancel = nil
	if err != nil || canceled {
		if dir != "" {
			_ = os.RemoveAll(dir)
		}
		s.state.Phase = "download-error"
		if canceled {
			s.state.Phase = "available"
		}
		return
	}
	s.cache, s.job.File = dir, file
	s.state.Phase, s.state.Progress = "ready", 100
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
	src, err := s.provider.Open(ctx, version, p.Name)
	if err != nil {
		return dir, "", err
	}
	defer src.Close()
	progress := &progressWriter{file: dst, ctx: ctx, total: p.Size, report: func(percent int) {
		s.mu.Lock()
		s.state.Progress = percent
		s.mu.Unlock()
	}}
	err = p.ValidateStream(io.TeeReader(src, progress))
	if err == nil {
		err = dst.Sync()
	}
	if err == nil {
		err = dst.Close()
	}
	return dir, file, err
}

type progressWriter struct {
	file           io.Writer
	ctx            context.Context
	total, written int64
	report         func(int)
}

func (w *progressWriter) Write(data []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := w.file.Write(data)
	w.written += int64(n)
	w.report(min(99, int(w.written*100/w.total)))
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
	}
}

func (s *Service) Install() bool {
	s.mu.Lock()
	if s.state.Phase != "ready" && s.state.Phase != "install-error" {
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
		return false
	}
	_ = os.RemoveAll(s.cache)
	s.cache = ""
	return true
}

func (s *Service) Close() {
	s.stop()
	s.Cancel()
}
