// SPDX-License-Identifier: GPL-3.0-only
package update

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func version(t *testing.T, s string) Version {
	t.Helper()
	v, err := ParseVersion(s)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestVersions(t *testing.T) {
	for _, pair := range [][2]string{{"0.1.10", "0.1.9"}, {"0.2.0", "0.1.99"}, {"1.0.0", "0.9.9"}} {
		newer, older := version(t, pair[0]), version(t, pair[1])
		if !newer.NewerThan(older) || older.NewerThan(newer) || older.NewerThan(older) {
			t.Fatal(pair)
		}
	}
	for _, invalid := range []string{"v0.1.0", "0.1", "00.1.0", "1.0.0-rc.1", "65536.0.0", "1.0.0+meta", "1.0.0\n"} {
		if _, err := ParseVersion(invalid); err == nil {
			t.Errorf("accepted %q", invalid)
		}
	}
}

type mockProvider struct {
	release Release
	err     error
	files   map[string][]byte
	open    func(context.Context, string) (io.ReadCloser, error)
}

func (p *mockProvider) Latest(context.Context) (Release, error) { return p.release, p.err }
func (p *mockProvider) Open(ctx context.Context, _ Version, name string) (io.ReadCloser, error) {
	if p.open != nil && name != ManifestName && name != SignatureName {
		return p.open(ctx, name)
	}
	return io.NopCloser(bytes.NewReader(p.files[name])), nil
}

type mockLauncher struct {
	kind string
	err  error
	got  []byte
}

func (m *mockLauncher) Supported() bool { return true }
func (m *mockLauncher) Select(manifest Manifest) (Package, bool) {
	return WindowsPackage(manifest, m.kind)
}
func (m *mockLauncher) Start(job Job) error {
	data, err := os.ReadFile(job.File)
	m.got = data
	return errors.Join(err, m.err)
}

func fixture(t *testing.T, arch string) (*mockProvider, *mockLauncher, ed25519.PublicKey) {
	t.Helper()
	key, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	asset := []byte("test payload; never executed")
	digest := sha256.Sum256(asset)
	name := "Find-a-Note-0.2.0-Windows-Portable.exe"
	data, err := CanonicalManifest(Manifest{Schema: 1, Product: "find-a-note", Version: "0.2.0", Notes: "test",
		Packages: []Package{{OS: "windows", Arch: arch, Kind: "portable", Name: name, Size: int64(len(asset)), SHA256: hex.EncodeToString(digest[:]), Method: "replace-exe"}}})
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{ManifestName: data, SignatureName: ed25519.Sign(private, data), name: asset}
	sizes := make(map[string]int64)
	for n, b := range files {
		sizes[n] = int64(len(b))
	}
	return &mockProvider{files: files, release: Release{Version: version(t, "0.2.0"), Assets: sizes}}, &mockLauncher{kind: "portable"}, key
}

func TestSignedChecks(t *testing.T) {
	for _, test := range []struct {
		name, arch, phase string
		mutate            func(*mockProvider)
	}{
		{"available", "amd64", "available", nil},
		{"wrong architecture", "arm64", "unavailable", nil},
		{"wrong package type", "amd64", "unavailable", func(p *mockProvider) { delete(p.release.Assets, "Find-a-Note-0.2.0-Windows-Portable.exe") }},
		{"network unavailable", "amd64", "check-error", func(p *mockProvider) { p.err = errors.New("offline") }},
		{"no release", "amd64", "current", func(p *mockProvider) { p.err = ErrNoRelease }},
		{"same version", "amd64", "current", func(p *mockProvider) { p.release.Version = Version{0, 1, 0} }},
		{"downgrade", "amd64", "current", func(p *mockProvider) { p.release.Version = Version{0, 0, 9} }},
		{"bad signature", "amd64", "check-error", func(p *mockProvider) { p.files[SignatureName][0] ^= 1 }},
		{"malformed manifest", "amd64", "check-error", func(p *mockProvider) { p.files[ManifestName][0] = '!' }},
		{"unsigned release", "amd64", "check-error", func(p *mockProvider) { delete(p.release.Assets, SignatureName) }},
		{"version mismatch", "amd64", "check-error", func(p *mockProvider) { p.release.Version = Version{1, 0, 0} }},
	} {
		t.Run(test.name, func(t *testing.T) {
			p, l, key := fixture(t, test.arch)
			if test.mutate != nil {
				test.mutate(p)
			}
			s := New(version(t, "0.1.0"), key, p, l)
			defer s.Close()
			s.Check()
			if status := s.Status(); status.Phase != test.phase {
				t.Fatalf("got %+v want %s", status, test.phase)
			}
			if s.Install() {
				t.Fatal("installed without download")
			}
		})
	}
}

func TestManifestRejectsAmbiguityEvenWhenSigned(t *testing.T) {
	p, _, _ := fixture(t, "amd64")
	key, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	valid := p.files[ManifestName]
	for _, data := range [][]byte{append(append([]byte(nil), valid...), '\n'),
		bytes.Replace(valid, []byte(`"schema":1`), []byte(`"schema":2,"schema":1`), 1),
		[]byte("invalid")} {
		if _, err := VerifyManifest(data, ed25519.Sign(private, data), key); err == nil {
			t.Fatalf("accepted %s", data)
		}
	}
}

type readFailure struct{}

func (readFailure) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

func TestDownloadCancellationIntegrityAndRetry(t *testing.T) {
	p, l, key := fixture(t, "amd64")
	s := New(version(t, "0.1.0"), key, p, l)
	defer s.Close()
	s.Check()
	name := s.job.Package.Name
	want := append([]byte(nil), p.files[name]...)
	for _, input := range []io.Reader{
		strings.NewReader("corrupt same size..........."),
		bytes.NewReader(want[:2]),
		io.MultiReader(bytes.NewReader(want[:3]), readFailure{}),
		io.MultiReader(bytes.NewReader(want), strings.NewReader("extra")),
	} {
		p.open = func(context.Context, string) (io.ReadCloser, error) { return io.NopCloser(input), nil }
		s.Download()
		if s.Status().Phase != "download-error" || s.Install() {
			t.Fatal("bad payload was accepted")
		}
	}
	started, done := make(chan struct{}), make(chan struct{})
	p.open = func(ctx context.Context, _ string) (io.ReadCloser, error) {
		close(started)
		<-ctx.Done()
		return nil, ctx.Err()
	}
	go func() { defer close(done); s.Download() }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("download did not start")
	}
	s.Cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("download was not cancelled")
	}
	if s.Status().Phase != "available" {
		t.Fatal(s.Status())
	}

	p.open = nil
	s.Download()
	if status := s.Status(); status.Phase != "ready" || status.Progress != 100 {
		t.Fatal(status)
	}
	l.err = errors.New("access denied")
	if s.Install() || s.Status().Phase != "install-error" {
		t.Fatal(s.Status())
	}
	l.err = nil
	if !s.Install() || !bytes.Equal(want, l.got) {
		t.Fatal("verified payload did not reach installer")
	}
}

type roundTrip func(*http.Request) (*http.Response, error)

func (r roundTrip) RoundTrip(req *http.Request) (*http.Response, error) { return r(req) }

func TestGitHubStableMetadata(t *testing.T) {
	g := NewGitHub()
	for _, test := range []struct {
		code            int
		body            string
		success, absent bool
	}{
		{200, `{"tag_name":"v0.1.10","draft":false,"prerelease":false,"assets":[{"name":"update-manifest.json","size":100,"state":"uploaded"}]}`, true, false},
		{200, `{"tag_name":"v0.1.10","draft":true,"prerelease":false}`, false, true},
		{200, `{"tag_name":"v0.1.10","draft":false,"prerelease":true}`, false, true},
		{404, "{}", false, true}, {429, "{}", false, false}, {403, "{}", false, false}, {200, "{", false, false},
		{200, `{"tag_name":"v0.1.10"}`, false, false},
	} {
		g.metadata.Transport = roundTrip(func(req *http.Request) (*http.Response, error) {
			if req.URL.Host != "api.github.com" || req.Header.Get("Authorization") != "" {
				t.Fatal("unexpected request")
			}
			return &http.Response{StatusCode: test.code, Body: io.NopCloser(strings.NewReader(test.body))}, nil
		})
		release, err := g.Latest(context.Background())
		if (err == nil) != test.success || errors.Is(err, ErrNoRelease) != test.absent {
			t.Errorf("%+v: %v", test, err)
		}
		if test.success && (release.Version != (Version{0, 1, 10}) || release.Assets[ManifestName] != 100) {
			t.Fatal(release)
		}
	}
}

type scheduledProvider struct {
	*mockProvider
	requests chan struct{}
	results  chan error
}

func (p *scheduledProvider) Latest(ctx context.Context) (Release, error) {
	select {
	case p.requests <- struct{}{}:
	case <-ctx.Done():
		return Release{}, ctx.Err()
	}
	select {
	case err := <-p.results:
		return p.release, err
	case <-ctx.Done():
		return Release{}, ctx.Err()
	}
}

func TestScheduledChecksRecoverAndAvoidOverlap(t *testing.T) {
	base, launcher, key := fixture(t, "amd64")
	p := &scheduledProvider{base, make(chan struct{}, 4), make(chan error)}
	s := New(version(t, "0.1.0"), key, p, launcher)
	t.Cleanup(s.Close)
	ticks := make(chan time.Time)
	done := make(chan struct{})
	go func() {
		defer close(done)
		s.runChecks(ticks)
	}()
	awaitRequest := func() {
		t.Helper()
		select {
		case <-p.requests:
		case <-time.After(2 * time.Second):
			t.Fatal("expected update check")
		}
	}
	tick := func() {
		t.Helper()
		select {
		case ticks <- time.Now():
		case <-time.After(2 * time.Second):
			t.Fatal("scheduler did not accept tick")
		}
	}

	awaitRequest() // Startup.
	manual := make(chan struct{})
	go func() { defer close(manual); s.Check() }()
	select {
	case <-manual:
	case <-time.After(2 * time.Second):
		t.Fatal("manual check overlapped the startup request")
	}
	p.results <- errors.New("offline")
	tick()
	awaitRequest()
	p.results <- nil

	// Tick receipt synchronizes with completion of the preceding check.
	tick()
	awaitRequest()
	p.results <- errors.New("rate limited")
	s.Close()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("scheduler did not stop")
	}
	if got := s.Status(); got.Phase != "available" || got.Version != "0.2.0" {
		t.Fatalf("lost the verified offer after a transient error: %+v", got)
	}
}

func TestScheduleSkipsDownloadsAndPreparedUpdates(t *testing.T) {
	p, l, key := fixture(t, "amd64")
	s := New(version(t, "0.1.0"), key, p, l)
	defer s.Close()
	s.Check()
	started, done := make(chan struct{}), make(chan struct{})
	p.open = func(ctx context.Context, _ string) (io.ReadCloser, error) {
		close(started)
		<-ctx.Done()
		return nil, ctx.Err()
	}
	go func() { defer close(done); s.Download() }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("download did not start")
	}
	s.checkOnce(true)
	if got := s.Status(); got.Phase != "downloading" || got.Total != s.job.Package.Size {
		t.Fatalf("unexpected download state: %+v", got)
	}
	s.Cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("download did not stop")
	}
	p.open = nil
	s.Download()
	s.checkOnce(true)
	if got := s.Status(); got.Phase != "ready" || got.Received != got.Total || got.Total <= 0 {
		t.Fatalf("verified download was not retained: %+v", got)
	}
}
