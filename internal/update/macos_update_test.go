// SPDX-License-Identifier: GPL-3.0-only
package update

import (
	"net/http"
	"runtime"
	"testing"
)

type manualLauncher struct{ mockLauncher }

func (*manualLauncher) Select(m Manifest) (Package, bool) { return MacOSPackage(m) }

func TestMacOSUpdateChannel(t *testing.T) {
	for _, scenario := range []struct {
		name, want, problem string
	}{
		{"verified", "ready", ""},
		{"wrong architecture", "unavailable", ""},
		{"wrong method", "unavailable", ""},
		{"wrong name", "unavailable", ""},
		{"unknown platform", "unavailable", ""},
		{"missing package", "unavailable", ""},
		{"wrong listed size", "unavailable", ""},
		{"bad hash", "download-error", "integrity"},
		{"truncated stream", "download-error", "integrity"},
		{"corrupt signed manifest", "check-error", "manifest"},
		{"API unavailable", "check-error", "feed"},
		{"offline", "check-error", "feed"},
		{"bad version", "check-error", "feed"},
		{"downgrade", "current", ""},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			m, files := commonRelease(t)
			p := &m.Packages[1]
			tag, apiStatus := "v"+m.Version, http.StatusOK
			current := "0.3.0"
			var edit func([]byte) []byte
			switch scenario.name {
			case "wrong architecture":
				p.Arch = "amd64"
			case "wrong method":
				p.Method = "replace-app"
			case "wrong name":
				p.Name = "other.dmg"
			case "unknown platform":
				p.OS = "other"
			case "missing package":
				delete(files, p.Name)
			case "wrong listed size":
				p.Size++
			case "bad hash":
				files[p.Name][0] ^= 1
			case "corrupt signed manifest":
				edit = func([]byte) []byte { return []byte("bad JSON") }
			case "API unavailable":
				apiStatus = http.StatusServiceUnavailable
			case "bad version":
				tag = "v0.4.0-rc.1"
			case "downgrade":
				current = "0.4.1"
			}
			key := signFixture(t, m, files, edit)
			g, server := localGitHub(t, tag, files, apiStatus)
			if scenario.name == "offline" {
				server.Close()
			}
			l := &manualLauncher{}
			s := New(version(t, current), key, g, l)
			t.Cleanup(s.Close)
			s.Check()
			if s.Status().Phase == "available" {
				if got := s.Status(); !got.Manual || got.VerifiedSHA256 != "" || got.Notes != commonNotes || s.Install() {
					t.Fatalf("unexpected unverified offer: %+v", got)
				}
				if scenario.name == "truncated stream" {
					files[p.Name] = files[p.Name][:len(files[p.Name])-1]
				}
				s.Download()
			}
			got := s.Status()
			if got.Phase != scenario.want || got.Problem != scenario.problem {
				t.Fatalf("phase/problem %s/%s; want %s/%s", got.Phase, got.Problem, scenario.want, scenario.problem)
			}
			if got.Phase == "ready" && got.VerifiedSHA256 != p.SHA256 ||
				got.Phase != "ready" && got.VerifiedSHA256 != "" {
				t.Fatalf("unexpected verified checksum: %+v", got)
			}
			if s.Install() || l.got != nil || s.job.File != "" {
				t.Fatal("manual flow cached or launched a package")
			}
		})
	}
}

func TestNativeMacLauncher(t *testing.T) {
	if runtime.GOOS != "darwin" || runtime.GOARCH != "arm64" {
		t.Skip("requires Apple Silicon")
	}
	m, _ := commonRelease(t)
	l := NewNativeLauncher(version(t, "0.3.0"), PublicKey())
	p, ok := l.Select(m)
	if !l.Supported() || !ok || p != m.Packages[1] || l.Start(Job{Package: p}) == nil {
		t.Fatal("native launcher must select a DMG and decline installation")
	}
}
