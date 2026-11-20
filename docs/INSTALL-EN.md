# Install Find a Note

Download packages from the [official releases](https://github.com/pembrock/find-a-note/releases).
Compare the SHA-256 of your download with the release's `SHA256SUMS.txt` before opening it.

## Windows 10 and 11, x64

Run `*-Windows-Setup.exe` for a per-user installation, or run
`*-Windows-Portable.exe` directly. The app requires Microsoft Edge WebView2
Runtime. If it is missing, the app or installer can prompt you to download it.

Use **Settings → About → Check for updates** to download and verify the
matching package. Confirm before applying the update.

## macOS on Apple Silicon

1. Open `Find-a-Note-<version>-macOS-arm64.dmg`.
2. Drag **Find a Note** to **Applications**.
3. Eject the disk image and open the installed app from Applications.

The app uses an ad hoc signature and ships without Apple notarization. If
Gatekeeper blocks the new copy, verify the download source and the DMG's
SHA-256. Try opening the installed app, then choose **System Settings →
Privacy & Security → Open Anyway** if your Mac's security policy allows it.
Confirm **Open** in the next prompt.
[Apple's guide](https://support.apple.com/en-us/102445)

### macOS updates

- **From 0.4.0 to 0.4.1.** Download the 0.4.1 arm64 DMG from the official
  release and verify its SHA-256. Quit Find a Note with ⌘Q, use the DMG to
  replace the app in Applications, then open the new copy.
- **After installing 0.4.1.** Choose **Settings → About → Check for updates**.
  In a supported writable location, the app downloads and verifies the update.
  Confirm installation and restart. Gatekeeper may ask you to approve the new
  copy.
- **Manual option.** If the app is running from the DMG or is installed in an
  unsupported location, the update dialog offers a verified DMG. Download it
  from the official release, compare its SHA-256 with the value in the dialog,
  quit the app, and replace it manually.
- **Recovery.** If the updated copy fails to start, use the update helper's
  **Restore** option to go back to the previous copy.
