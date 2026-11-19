# Find a Note

Find a Note is a desktop piano note-reading trainer for Windows 10 and 11 x64
with Microsoft Edge WebView2 Runtime. It uses Go, Wails v2, React, TypeScript,
VexFlow, and Tone.js with Web Audio. The source license is GPL-3.0-only.
macOS is planned.

## Read the repository first

Before asking about existing architecture, build commands, release signing, or
earlier decisions, read the relevant documentation and implementation. Use
[README.md](README.md) for setup and [VALIDATION.md](VALIDATION.md) for historical
checks. When documentation is missing or stale, verify behavior in the source.
Do not ask the user to repeat information already in the repository. Ask when
information is genuinely missing or new permission is required. Do not assume
secret values, access to credentials, or user preferences.

## Architecture

- [main.go](main.go) starts Wails and embeds the built frontend. [app.go](app.go)
  exposes Go services to React through Wails bindings and events.
- [frontend/src](frontend/src) contains the React interface. Exercise generation,
  range and answer rules live in [model.ts](frontend/src/model.ts), and the
  “First Notes” progression lives in [learning.ts](frontend/src/learning.ts).
  [UI-04](docs/UI-04.md) documents the settings sections.
- [internal/midi](internal/midi) contains the MIDI manager and WinMM driver.
  [useMidi.ts](frontend/src/useMidi.ts) connects the frontend to Wails MIDI
  events. Calibration lives in [calibration.ts](frontend/src/calibration.ts),
  [useCalibration.ts](frontend/src/useCalibration.ts), and
  [CalibrationWizard.tsx](frontend/src/CalibrationWizard.tsx). See
  [MIDI-01](docs/MIDI-01.md) and [MIDI-02](docs/MIDI-02.md). CoreMIDI is the
  planned macOS backend. Windows tasks do not require implementing it.
- [audio.ts](frontend/src/audio.ts) and [useAudio.tsx](frontend/src/useAudio.tsx)
  handle playback and source preferences with bundled piano samples. See
  [AUDIO-01](docs/AUDIO-01.md) and [UPDATE-03](docs/UPDATE-03.md) for the
  current per-device sound default and compatibility with saved choices.
- User settings and per-device range profiles use versioned `sonari.*` keys in
  WebView2 local storage. Preserve the existing WebView2 profile and origin,
  settings compatibility, and MIDI calibration profiles across builds and updates.
- [internal/update](internal/update) contains the GitHub provider, manifest
  verification, update service, and Windows helper. React presents update
  status and actions in [updates.tsx](frontend/src/updates.tsx). See
  [UPDATE-01](docs/UPDATE-01.md) for the update protocol and signing,
  and [UPDATE-04](docs/UPDATE-04.md) for the current update dialog and scheduling.
- [scripts/build-release.ps1](scripts/build-release.ps1) packages Windows builds
  and calls [scripts/write-third-party-notices.ps1](scripts/write-third-party-notices.ps1).
  Wails packaging resources and the NSIS installer project live in
  [build/windows](build/windows). See [RELEASE-01](docs/RELEASE-01.md) for
  Windows packaging and [UPDATE-01](docs/UPDATE-01.md) for signed releases.

## Development and Git

- Preserve existing functionality. Prefer minimal, targeted changes, keep the
  interface minimal, and avoid unrelated refactoring and unjustified major
  dependency upgrades.
- Change training algorithms, the MIDI backend, or the audio engine only when
  explicitly requested. Keep Windows working and consider future macOS
  compatibility when touching platform boundaries.
- Run `git status --short --branch` before starting work. Start new feature
  branches from current public `main` and use a Git worktree when isolation helps.
- Preserve user changes and review staged content before committing. Keep local
  files out of commits until reviewed. Modify, delete, or publish the user’s
  `promo/` directory only on explicit request.
- Preserve public history and avoid destructive Git operations. A force push
  requires explicit permission.

## Verification

Run the standard application checks on Windows for application changes. Use the
tooling prerequisites in [README.md](README.md). Playwright uses Microsoft Edge
and starts a local Vite server. Build the frontend before running Go checks so
that the embedded assets exist.

```powershell
Push-Location frontend
npm.cmd ci
npm.cmd run build
npm.cmd test
npm.cmd run test:ui
Pop-Location
go test ./...
go vet ./...
wails build -platform windows/amd64
```

For release tasks, also build both the per-user NSIS Installer and Portable EXE.
Verify the version in Windows executable metadata and the About screen, check
SHA-256 sums, confirm license and attribution notices are bundled, and verify the
update manifest signature and the package sizes and hashes against the manifest.
Use isolated profiles and install locations to test update, restart, rollback,
and settings preservation for both package types.

Report checks as **PASS**, **FAIL**, or **NOT TESTED**, with a reason for each
skipped check. Hardware checks require the physical device and scenario to have
been exercised. Report simulated MIDI and hardware results separately.

## Release process

Use semantic versioning. [wails.json](wails.json) `info.productVersion` is the
version source. Build from a clean, reviewed commit with NSIS and the tools
listed in the release docs on PATH. Run the release script from the repository
root. For signed releases, supply the existing external key via `-SigningKey`
and UTF-8 update notes via `-UpdateNotes` as documented in UPDATE-01.

Release output goes to `artifacts/windows-<version>/`. Verify the Setup and
Portable EXEs, `SHA256SUMS.txt`, and the signed `update-manifest.json` and
`update-manifest.sig`. Provide corresponding source under GPLv3. The public
repository is [pembrock/find-a-note](https://github.com/pembrock/find-a-note).
The stable GitHub Release uses a matching `vX.Y.Z` tag. Creating public tags,
publishing a release, and other external publication actions require explicit
owner authorization. Never replace or edit published release assets.

## Update security

- The updater verifies the canonical manifest bytes with the embedded Ed25519
  public key and checks package size and SHA-256 against the signed manifest.
  Verify the manifest with the trusted public key before release. Editing
  signed bytes invalidates the signature.
- The Windows helper revalidates artifacts before replacement. Portable updates
  replace the EXE directly. Installer updates stage the EXE through NSIS and
  verify it against the signed Portable entry before replacement. The helper
  keeps a backup and restores the previous EXE if replacement or startup
  confirmation fails. Both paths preserve the WebView2 profile and settings.
- Private signing keys must never be committed, printed, uploaded, or included
  in artifacts. Read [UPDATE-01](docs/UPDATE-01.md), the release script, and
  [cmd/update-manifest](cmd/update-manifest) before asking about signing.
  Document non-secret signing configuration only. Keep private-key locations
  out of public instructions. Generating a new key pair requires explicit
  authorization.

## Third-party licenses

Keep the project [LICENSE](LICENSE), third-party license files, attribution, and
notices. Salamander Grand Piano samples are by Alexander Holm under CC BY 3.0.
Preserve their [attribution](frontend/public/audio/salamander/ATTRIBUTION.txt)
and [license](frontend/public/audio/salamander/LICENSE.txt), the
[Tone.js license](frontend/public/audio/TONE-LICENSE.md), and the packaging
script’s generated third-party notices. Do not change third-party licenses.

## Working with the user

Briefly share the plan before edits and report meaningful progress. Surface
errors and skipped checks. In the final report, give artifact paths, branch,
HEAD, and Git status. List limitations separately. Stay within the user’s
explicit authorization for publication.
