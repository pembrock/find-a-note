// SPDX-License-Identifier: GPL-3.0-only
package update

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

const commonNotes = "English\n\n- Release notes\n\nРусский\n\n- Заметки о выпуске"

// This fixture deliberately uses only APIs present in both legacy tags.
func commonRelease(t *testing.T) (Manifest, map[string][]byte) {
	t.Helper()
	m := Manifest{Schema: 1, Product: "find-a-note", Version: "0.4.0", Notes: commonNotes}
	files := map[string][]byte{}
	for _, p := range []Package{
		{OS: "windows", Arch: "amd64", Kind: "installer", Name: "Find-a-Note-0.4.0-Windows-Setup.exe", Method: "nsis-stage-v1"},
		{OS: "darwin", Arch: "arm64", Kind: "dmg", Name: "Find-a-Note-0.4.0-macOS-arm64.dmg", Method: "manual-dmg"},
		{OS: "windows", Arch: "amd64", Kind: "portable", Name: "Find-a-Note-0.4.0-Windows-Portable.exe", Method: "replace-exe"},
	} {
		data := []byte("unsigned package fixture " + p.Kind)
		sum := sha256.Sum256(data)
		p.Size, p.SHA256 = int64(len(data)), hex.EncodeToString(sum[:])
		m.Packages = append(m.Packages, p)
		files[p.Name] = data
	}
	return m, files
}

func signFixture(t *testing.T, m Manifest, files map[string][]byte, edit func([]byte) []byte) ed25519.PublicKey {
	t.Helper()
	key, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := CanonicalManifest(m)
	if err != nil {
		t.Fatal(err)
	}
	if edit != nil {
		raw = edit(raw)
	}
	files[ManifestName], files[SignatureName] = raw, ed25519.Sign(private, raw)
	return key
}

type localTransport struct{ address *url.URL }

func (transport localTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	local := req.Clone(req.Context())
	local.URL.Scheme, local.URL.Host = transport.address.Scheme, transport.address.Host
	local.Host = transport.address.Host
	return http.DefaultTransport.RoundTrip(local)
}

func localGitHub(t *testing.T, tag string, files map[string][]byte, apiStatus int) (*GitHub, *httptest.Server) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/repos/pembrock/find-a-note/releases/latest" {
			if apiStatus != http.StatusOK {
				w.WriteHeader(apiStatus)
				return
			}
			assets := make([]map[string]any, 0, len(files))
			for name, data := range files {
				assets = append(assets, map[string]any{"name": name, "size": len(data), "state": "uploaded"})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"tag_name": tag, "draft": false, "prerelease": false, "assets": assets})
			return
		}
		prefix := "/pembrock/find-a-note/releases/download/" + tag + "/"
		name, ok := strings.CutPrefix(req.URL.Path, prefix)
		if data, exists := files[name]; ok && exists {
			_, _ = w.Write(data)
			return
		}
		http.NotFound(w, req)
	}))
	t.Cleanup(server.Close)
	address, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	provider := NewGitHub()
	provider.metadata.Transport = localTransport{address}
	provider.assets.Transport = localTransport{address}
	return provider, server
}

func TestCommonReleaseWindows(t *testing.T) {
	for _, old := range []string{"0.2.2", "0.3.0"} {
		for _, kind := range []string{"installer", "portable"} {
			t.Run(old+"/"+kind, func(t *testing.T) {
				m, files := commonRelease(t)
				key := signFixture(t, m, files, nil)
				g, _ := localGitHub(t, "v"+m.Version, files, http.StatusOK)
				l := &mockLauncher{kind: kind}
				s := New(version(t, old), key, g, l)
				t.Cleanup(s.Close)
				s.Check()
				if got := s.Status(); got.Phase != "available" || got.Version != m.Version || got.Notes != commonNotes {
					t.Fatalf("signed common offer: %+v", got)
				}
				p := s.job.Package
				if p.OS != "windows" || p.Arch != "amd64" || p.Kind != kind {
					t.Fatalf("wrong legacy selection: %+v", p)
				}
				s.Download()
				if s.Status().Phase != "ready" || !s.Install() || !bytes.Equal(l.got, files[p.Name]) {
					t.Fatal("legacy service did not hand verified Windows bytes to its launcher")
				}
			})
		}
	}
	for _, change := range []string{"extra signed fields", "wrong architecture", "bad signature"} {
		t.Run(change, func(t *testing.T) {
			m, files := commonRelease(t)
			var edit func([]byte) []byte
			if change == "extra signed fields" {
				edit = func(raw []byte) []byte { return append([]byte(`{"extra":true,`), raw[1:]...) }
			}
			if change == "wrong architecture" {
				m.Packages[2].Arch = "arm64"
			}
			key := signFixture(t, m, files, edit)
			if change == "bad signature" {
				files[SignatureName][0] ^= 1
			}
			g, _ := localGitHub(t, "v"+m.Version, files, http.StatusOK)
			s := New(version(t, "0.3.0"), key, g, &mockLauncher{kind: "portable"})
			t.Cleanup(s.Close)
			s.Check()
			want := "check-error"
			if change == "wrong architecture" {
				want = "unavailable"
			}
			if got := s.Status().Phase; got != want {
				t.Fatalf("got %s, want %s", got, want)
			}
		})
	}
}
