#!/bin/bash
set -euo pipefail

[[ $(uname -sm) == 'Darwin arm64' ]]
[[ $# == 1 ]]
script_dir=$(cd "$(dirname "$0")" && pwd)
mkdir "$1"
root=$(cd "$1" && pwd)
mkdir "$root/local" "$root/image-a" "$root/image-b" "$root/installed" "$root/downloads"

for version in A B; do
    if [[ $version == A ]]; then
        number=1
        copies=(local image-a)
    else
        number=2
        copies=(image-b)
    fi

    for directory in "${copies[@]}"; do
        app="$root/$directory/MAC-06A Probe.app"
        mkdir -p "$app/Contents/MacOS"
        plist="$app/Contents/Info.plist"
        plutil -create xml1 "$plist"
        plutil -insert CFBundleIdentifier -string io.github.pembrock.findanote.mac06a "$plist"
        plutil -insert CFBundleName -string "MAC-06A Probe $version" "$plist"
        plutil -insert CFBundleDisplayName -string "MAC-06A Probe $version" "$plist"
        plutil -insert CFBundleExecutable -string Probe "$plist"
        plutil -insert CFBundlePackageType -string APPL "$plist"
        plutil -insert CFBundleVersion -string "$number" "$plist"
        plutil -insert CFBundleShortVersionString -string "1.0.$number" "$plist"
        plutil -insert ProbeLogPath -string "$root/launch.log" "$plist"
        clang -arch arm64 -fobjc-arc -framework AppKit "$script_dir/probe.m" -o "$app/Contents/MacOS/Probe"
        codesign --force --sign - "$app"
        codesign --verify --deep --strict --verbose=2 "$app"
        codesign -dv --verbose=4 "$app"
        shasum -a 256 "$plist" "$app/Contents/MacOS/Probe" "$app/Contents/_CodeSignature/CodeResources"
    done

    hdiutil create -srcfolder "$root/image-$(printf '%s' "$version" | tr 'AB' 'ab')" \
        -volname "MAC-06A Probe $version" -format UDZO "$root/MAC-06A-$version.dmg"
    shasum -a 256 "$root/MAC-06A-$version.dmg"
done
