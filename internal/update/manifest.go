// SPDX-License-Identifier: GPL-3.0-only
package update

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	ManifestName    = "update-manifest.json"
	SignatureName   = "update-manifest.sig"
	MaxManifestSize = 32 * 1024
	maxPackageSize  = 256 * 1024 * 1024
)

var (
	versionPattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})$`)
	digestPattern  = regexp.MustCompile(`^[a-f0-9]{64}$`)
	namePattern    = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$`)
)

type Version [3]uint16

func ParseVersion(value string) (Version, error) {
	var version Version
	if !versionPattern.MatchString(value) {
		return version, errors.New("invalid stable version")
	}
	for i, part := range strings.Split(value, ".") {
		value, err := strconv.ParseUint(part, 10, 16)
		if err != nil {
			return version, err
		}
		version[i] = uint16(value)
	}
	return version, nil
}

func (v Version) String() string { return fmt.Sprintf("%d.%d.%d", v[0], v[1], v[2]) }

func (v Version) NewerThan(other Version) bool {
	for i, value := range v {
		if value != other[i] {
			return value > other[i]
		}
	}
	return false
}

type Package struct {
	OS     string `json:"os"`
	Arch   string `json:"arch"`
	Kind   string `json:"kind"`
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
	Method string `json:"method"`
}

type Manifest struct {
	Schema   int       `json:"schema"`
	Product  string    `json:"product"`
	Version  string    `json:"version"`
	Notes    string    `json:"notes"`
	Packages []Package `json:"packages"`
}

func (m Manifest) Find(os, arch, kind string) (Package, bool) {
	for _, p := range m.Packages {
		if p.OS == os && p.Arch == arch && p.Kind == kind {
			return p, true
		}
	}
	return Package{}, false
}

// CanonicalManifest defines the exact UTF-8 bytes signed by the release tool.
func CanonicalManifest(m Manifest) ([]byte, error) {
	if m.Schema != 1 || m.Product != "find-a-note" || !utf8.ValidString(m.Notes) || len(m.Notes) > 4096 || len(m.Packages) == 0 || len(m.Packages) > 16 {
		return nil, errors.New("invalid manifest header")
	}
	if _, err := ParseVersion(m.Version); err != nil {
		return nil, err
	}
	seen := make(map[[3]string]bool)
	names := make(map[string]bool)
	for _, p := range m.Packages {
		target := [3]string{p.OS, p.Arch, p.Kind}
		if seen[target] || names[strings.ToLower(p.Name)] || !namePattern.MatchString(p.Name) ||
			!namePattern.MatchString(p.OS) || !namePattern.MatchString(p.Arch) || !namePattern.MatchString(p.Kind) ||
			!namePattern.MatchString(p.Method) || !digestPattern.MatchString(p.SHA256) || p.Size < 1 || p.Size > maxPackageSize {
			return nil, errors.New("invalid or duplicate update package")
		}
		seen[target] = true
		names[strings.ToLower(p.Name)] = true
	}
	return json.Marshal(m)
}

func VerifyManifest(data, signature []byte, key ed25519.PublicKey) (Manifest, error) {
	var m Manifest
	if len(data) > MaxManifestSize || len(key) != ed25519.PublicKeySize || !ed25519.Verify(key, data, signature) {
		return m, errors.New("invalid update signature")
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return m, err
	}
	canonical, err := CanonicalManifest(m)
	if err != nil || !bytes.Equal(data, canonical) {
		return m, errors.New("non-canonical update manifest")
	}
	return m, nil
}

var errPackageIntegrity = errors.New("update package integrity check failed")

func (p Package) ValidateStream(r io.Reader) error {
	h := sha256.New()
	n, err := io.Copy(h, io.LimitReader(r, p.Size+1))
	if err != nil {
		return err
	}
	if n != p.Size || hex.EncodeToString(h.Sum(nil)) != p.SHA256 {
		return errPackageIntegrity
	}
	return nil
}

func WindowsPackage(m Manifest, kind string) (Package, bool) {
	p, ok := m.Find("windows", "amd64", kind)
	if !ok {
		return Package{}, false
	}
	prefix := "Find-a-Note-" + m.Version + "-Windows-"
	switch kind {
	case "portable":
		return p, p.Name == prefix+"Portable.exe" && p.Method == "replace-exe"
	case "installer":
		_, portable := WindowsPackage(m, "portable")
		return p, portable && p.Name == prefix+"Setup.exe" && p.Method == "nsis-stage-v1"
	default:
		return Package{}, false
	}
}

// MacOSDMG describes the versioned asset for manual updates on Apple Silicon.
func MacOSDMG(version string) Package {
	return Package{
		OS: "darwin", Arch: "arm64", Kind: "dmg", Method: "manual-dmg",
		Name: "Find-a-Note-" + version + "-macOS-arm64.dmg",
	}
}

func MacOSPackage(m Manifest) (Package, bool) {
	expected := MacOSDMG(m.Version)
	p, ok := m.Find(expected.OS, expected.Arch, expected.Kind)
	return p, ok && p.Name == expected.Name && p.Method == expected.Method
}
