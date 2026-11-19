# Find a Note v0.2.0

## Automatic updates

- Find a Note checks for stable releases in the background. You can also check manually in About.
- Update notifications can be deferred. Downloads show progress and can be cancelled.
- Ed25519 signatures authenticate update manifests. Package size and SHA-256 are checked before installation.
- Both the Windows Installer and Portable editions support updates. Installation requires confirmation before restart. If the new app fails its startup check, the updater restores the previous executable.
- Exercise, display, audio and MIDI settings stay in the existing profile.

## Requirements and upgrade

Windows 10 or 11 x64 with Microsoft Edge WebView2 Runtime. macOS support is planned. Windows executables are unsigned. Update manifests are separately signed.

If you use v0.1.0, install v0.2.0 or download the v0.2.0 Portable edition once. From v0.2.0 onward, you can install subsequent signed updates through the app.

## License and source

Copyright (C) 2026 Kirill Pasikuta. Find a Note is licensed under GNU GPL version 3 only. The corresponding source archives include the full license and build scripts. Salamander Grand Piano samples by Alexander Holm are licensed under CC BY 3.0.
