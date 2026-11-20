#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
root=$PWD
out="${1:-$root/artifacts/mac-04a}"
mkdir -p "$out"
out=$(cd "$out" && pwd)
log="$out/build.log"
exec > >(tee "$log") 2>&1

[[ $(uname -s) == Darwin && $(uname -m) == arm64 ]]
export GOOS=darwin GOARCH=arm64 CGO_ENABLED=1
export MACOSX_DEPLOYMENT_TARGET=11.0
export CGO_CFLAGS="-O2 -g -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"
export CGO_CXXFLAGS="$CGO_CFLAGS"
export CGO_LDFLAGS="-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET -framework UniformTypeIdentifiers"
export GOTOOLCHAIN=${GOTOOLCHAIN:-go1.26.11}
wails=${WAILS:-$(go env GOPATH)/bin/wails}
dmg_python=${DMGBUILD_PYTHON:-python3}
dmg_layout="$root/build/darwin/dmg"
if ! "$dmg_python" -m dmgbuild --help >/dev/null; then
    echo "Install DMG build tools from $dmg_layout/requirements.txt and set DMGBUILD_PYTHON." >&2
    exit 1
fi

sw_vers
uname -m
xcode-select -p
xcodebuild -version || pkgutil --pkg-info=com.apple.pkg.CLTools_Executables
xcrun clang --version
xcrun --sdk macosx --show-sdk-version
echo "Deployment target: $MACOSX_DEPLOYMENT_TARGET"
go version
node --version
npm --version
cli_version=$("$wails" version)
echo "$cli_version"
[[ ${cli_version%%$'\n'*} == "$(go list -m -f '{{.Version}}' github.com/wailsapp/wails/v2)" ]]
if [[ -e .git ]]; then
    git rev-parse HEAD
else
    echo "Source archive: Git metadata unavailable"
fi

name=$(node -p 'require("./wails.json").info.productName')
version=$(node -p 'require("./wails.json").info.productVersion')
bundle="$name.app"
dmg="Find-a-Note-$version-macOS-arm64.dmg"
for file in "$bundle" "$dmg" SHA256SUMS.txt; do
    if [[ -e "$out/$file" ]]; then
        echo "Output already exists: $out/$file. Use a new output directory." >&2
        exit 1
    fi
done

work=$(mktemp -d "${TMPDIR:-/tmp}/find-a-note-release.XXXXXXXX")
mount="$work/mounted"
mounted=false
cleanup() {
    if "$mounted"; then
        hdiutil detach "$mount" || return
    fi
    rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

(cd frontend && npm ci --include=dev && npm run build && npm test)
diff -r frontend/public/audio frontend/dist/audio
go test -tags desktop,production,macdistribution -run '^TestEmbeddedFrontend$' -v .
go test ./...
go vet ./...
"$wails" build -platform darwin/arm64 -s -nosyncgomod -skipbindings

staging="$work/image"
app="$staging/$bundle"
mkdir "$staging"
ditto --norsrc --noextattr "build/bin/$(node -p 'require("./wails.json").name').app" "$app"
plist="$app/Contents/Info.plist"
plist_value() { /usr/libexec/PlistBuddy -c "Print :$1" "$plist"; }
plutil -lint "$plist"
plutil -p "$plist"
[[ $(plist_value CFBundlePackageType) == APPL ]]
[[ $(plist_value CFBundleName) == "$name" ]]
[[ $(plist_value CFBundleIdentifier) == io.github.pembrock.findanote ]]
[[ $(plist_value CFBundleVersion) == "$version" ]]
[[ $(plist_value CFBundleShortVersionString) == "$version" ]]
[[ $(plist_value NSHumanReadableCopyright) == *'Kirill Pasikuta' ]]
[[ $(plist_value LSMinimumSystemVersion) == "$MACOSX_DEPLOYMENT_TARGET" ]]
executable="Contents/MacOS/$(plist_value CFBundleExecutable)"
test -x "$app/$executable"
icon="$app/Contents/Resources/$(plist_value CFBundleIconFile).icns"
[[ $(sips -g format "$icon" | awk '$1 == "format:" {print $2}') == icns ]]
file "$app/$executable"
[[ $(lipo -archs "$app/$executable") == arm64 ]]
load_commands=$(xcrun vtool -show-build "$app/$executable")
echo "$load_commands"
[[ $(awk '$1 == "minos" {print $2}' <<< "$load_commands") == "$MACOSX_DEPLOYMENT_TARGET" ]]
otool -L "$app/$executable"

scripts/write-macos-notices.sh "$app/Contents/Resources/Licenses"
codesign --force --sign - --timestamp=none "$app"
codesign -d --verbose=4 "$app"
codesign --verify --deep --strict --verbose=2 "$app"

xcrun swift "$dmg_layout/background.swift" "$work"
"$dmg_python" -m dmgbuild -s "$dmg_layout/layout.py" \
    -D "app=$app" -D "background=$work/background.png" "$name" "$work/$dmg"
hdiutil verify "$work/$dmg"
mkdir "$mount"
hdiutil attach "$work/$dmg" -readonly -nobrowse -mountpoint "$mount"
mounted=true
ls -la "$mount"
"$dmg_python" "$dmg_layout/verify.py" "$mount" "$app" "$dmg_layout/layout.py"
/usr/bin/tiffutil -info "$mount/.background.tiff"
[[ $(readlink "$mount/Applications") == /Applications ]]
diff -r "$app" "$mount/$bundle"
codesign --verify --deep --strict --verbose=2 "$mount/$bundle"
hdiutil detach "$mount"
mounted=false

ditto --norsrc --noextattr "$app" "$out/$bundle"
codesign --verify --deep --strict --verbose=2 "$out/$bundle"
mv "$work/$dmg" "$out/$dmg"
(
    cd "$out"
    shasum -a 256 "$dmg"
    find "$bundle" -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256
) > "$out/SHA256SUMS.txt"
(cd "$out" && shasum -a 256 -c SHA256SUMS.txt)
