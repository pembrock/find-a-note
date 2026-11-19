// SPDX-License-Identifier: GPL-3.0-only
package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"flag"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"sonari/internal/update"
)

func main() {
	key := flag.String("key", "", "path to the release owner's external PKCS#8 Ed25519 PEM")
	version := flag.String("version", "", "version from wails.json")
	dir := flag.String("dir", "", "directory of the Windows release assets")
	notes := flag.String("notes", "", "optional UTF-8 release summary")
	flag.Parse()
	if err := sign(*key, *version, *dir, *notes); err != nil {
		log.Fatal(err)
	}
}

func sign(keyPath, version, dir, notesPath string) error {
	if keyPath == "" || dir == "" {
		return errors.New("-key and -dir are required")
	}
	if _, err := update.ParseVersion(version); err != nil {
		return err
	}
	private, err := loadKey(keyPath)
	if err != nil {
		return err
	}
	defer clear(private)
	m := update.Manifest{Schema: 1, Product: "find-a-note", Version: version}
	if notesPath != "" {
		notes, err := os.ReadFile(notesPath)
		if err != nil {
			return err
		}
		if !utf8.Valid(notes) {
			return errors.New("release notes must be UTF-8")
		}
		m.Notes = string(notes)
	}
	for _, p := range []update.Package{
		{OS: "windows", Arch: "amd64", Kind: "installer", Name: "Find-a-Note-" + version + "-Windows-Setup.exe", Method: "nsis-stage-v1"},
		{OS: "windows", Arch: "amd64", Kind: "portable", Name: "Find-a-Note-" + version + "-Windows-Portable.exe", Method: "replace-exe"},
	} {
		f, err := os.Open(filepath.Join(dir, p.Name))
		if err != nil {
			return err
		}
		hash := sha256.New()
		p.Size, err = io.Copy(hash, f)
		if err := errors.Join(err, f.Close()); err != nil {
			return err
		}
		p.SHA256 = hex.EncodeToString(hash.Sum(nil))
		m.Packages = append(m.Packages, p)
	}
	data, err := update.CanonicalManifest(m)
	if err != nil {
		return err
	}
	sig := ed25519.Sign(private, data)
	if _, err := update.VerifyManifest(data, sig, update.PublicKey()); err != nil {
		return err
	}
	if err := writeNew(filepath.Join(dir, update.ManifestName), data); err != nil {
		return err
	}
	if err := writeNew(filepath.Join(dir, update.SignatureName), sig); err != nil {
		_ = os.Remove(filepath.Join(dir, update.ManifestName))
		return err
	}
	return nil
}

func loadKey(path string) (ed25519.PrivateKey, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	absolute, err = filepath.EvalSymlinks(absolute)
	if err != nil {
		return nil, err
	}
	root, err := exec.Command("git", "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return nil, errors.New("run the signer from the source checkout")
	}
	common, err := exec.Command("git", "rev-parse", "--path-format=absolute", "--git-common-dir").Output()
	if err != nil {
		return nil, err
	}
	for _, dir := range []string{strings.TrimSpace(string(root)), filepath.Dir(strings.TrimSpace(string(common)))} {
		resolved, err := filepath.EvalSymlinks(dir)
		if err != nil {
			return nil, err
		}
		rel, err := filepath.Rel(resolved, absolute)
		if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			return nil, errors.New("the private key must be outside the repository")
		}
	}
	data, err := os.ReadFile(absolute)
	if err != nil {
		return nil, errors.New("could not read the external signing key")
	}
	defer clear(data)
	block, rest := pem.Decode(data)
	if block == nil || block.Type != "PRIVATE KEY" || len(bytes.TrimSpace(rest)) != 0 {
		return nil, errors.New("expected one PKCS#8 private key")
	}
	defer clear(block.Bytes)
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, errors.New("invalid PKCS#8 private key")
	}
	private, ok := key.(ed25519.PrivateKey)
	if !ok {
		return nil, errors.New("expected an Ed25519 private key")
	}
	if !bytes.Equal(private.Public().(ed25519.PublicKey), update.PublicKey()) {
		clear(private)
		return nil, errors.New("signing key does not match the pinned public key")
	}
	return private, nil
}

func writeNew(path string, data []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if err = errors.Join(err, f.Close()); err != nil {
		_ = os.Remove(path)
	}
	return err
}
