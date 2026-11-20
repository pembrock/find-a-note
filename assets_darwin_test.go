//go:build macdistribution

package main

import (
	"bytes"
	"io/fs"
	"os"
	"testing"
)

func TestEmbeddedFrontend(t *testing.T) {
	const dist = "frontend/dist"
	if _, err := assets.Open(dist + "/index.html"); err != nil {
		t.Fatal(err)
	}
	err := fs.WalkDir(os.DirFS("."), dist, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		onDisk, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		embedded, err := assets.ReadFile(path)
		if err != nil {
			return err
		}
		if !bytes.Equal(onDisk, embedded) {
			t.Errorf("embedded asset differs from build output: %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
