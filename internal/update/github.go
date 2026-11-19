// SPDX-License-Identifier: GPL-3.0-only
package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var ErrNoRelease = errors.New("no stable release")

type UpdateProvider interface {
	Latest(context.Context) (Release, error)
	Open(context.Context, Version, string) (io.ReadCloser, error)
}

type Release struct {
	Version Version
	Assets  map[string]int64
}

type GitHub struct {
	metadata *http.Client
	assets   *http.Client
}

func NewGitHub() *GitHub {
	return &GitHub{
		metadata: &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}},
		assets: &http.Client{Timeout: 5 * time.Minute, CheckRedirect: githubRedirect},
	}
}

func githubRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 5 || req.URL.Scheme != "https" || req.URL.User != nil || req.URL.Port() != "" {
		return errors.New("unsafe update redirect")
	}
	switch req.URL.Hostname() {
	case "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com":
		return nil
	}
	return errors.New("unexpected update download host")
}

func (g *GitHub) Latest(ctx context.Context) (Release, error) {
	var release Release
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/repos/pembrock/find-a-note/releases/latest", nil)
	if err != nil {
		return release, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	res, err := g.metadata.Do(req)
	if err != nil {
		return release, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return release, ErrNoRelease
	}
	if res.StatusCode != http.StatusOK {
		return release, fmt.Errorf("GitHub status %d", res.StatusCode)
	}
	var latest struct {
		Tag        string `json:"tag_name"`
		Draft      *bool  `json:"draft"`
		Prerelease *bool  `json:"prerelease"`
		Assets     []struct {
			Name  string `json:"name"`
			Size  int64  `json:"size"`
			State string `json:"state"`
		} `json:"assets"`
	}
	const limit = 1024 * 1024
	data, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return release, err
	}
	if len(data) > limit || json.Unmarshal(data, &latest) != nil || latest.Draft == nil || latest.Prerelease == nil {
		return release, errors.New("malformed GitHub release response")
	}
	if *latest.Draft || *latest.Prerelease {
		return release, ErrNoRelease
	}
	tag, ok := strings.CutPrefix(latest.Tag, "v")
	if !ok {
		return release, errors.New("invalid release tag")
	}
	release.Version, err = ParseVersion(tag)
	if err != nil {
		return release, err
	}
	release.Assets = make(map[string]int64, len(latest.Assets))
	for _, a := range latest.Assets {
		if a.State != "uploaded" || a.Size <= 0 {
			continue
		}
		if _, duplicate := release.Assets[a.Name]; duplicate {
			return release, errors.New("duplicate GitHub release asset")
		}
		release.Assets[a.Name] = a.Size
	}
	return release, nil
}

func (g *GitHub) Open(ctx context.Context, v Version, name string) (io.ReadCloser, error) {
	if !namePattern.MatchString(name) {
		return nil, errors.New("invalid update filename")
	}
	url := "https://github.com/pembrock/find-a-note/releases/download/v" + v.String() + "/" + name
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := g.assets.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		return nil, fmt.Errorf("asset HTTP status %d", res.StatusCode)
	}
	return res.Body, nil
}
