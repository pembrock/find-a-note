#!/bin/bash
set -euo pipefail

# Run from the repository root after npm ci, with the production Go build environment.
root=$PWD
out=$1
mkdir -p "$out"
out=$(cd "$out" && pwd)
cp LICENSE "$out/Find-a-Note-GPL-3.0-only.txt"
cp frontend/public/audio/TONE-LICENSE.md "$out/"
mkdir -p "$out/Salamander"
cp frontend/public/audio/salamander/{ATTRIBUTION.txt,LICENSE.txt,UPSTREAM-README.txt} "$out/Salamander/"
cat > "$out/README.txt" <<'NOTICE'
Find a Note — Copyright (C) 2026 Kirill Pasikuta
Application source license: GPL-3.0-only.
Salamander Grand Piano by Alexander Holm: CC BY 3.0. See Salamander/.
Go/ contains notices for modules selected by the Darwin arm64 production
package graph and the Go toolchain. npm/ includes the installed production
dependency graph and Vite's bundled runtime helpers. System frameworks
are supplied by macOS.
NOTICE

copy_notices() {
    local source=$1 destination=$2 notice count=0
    mkdir -p "$destination"
    for notice in "$source"/{LICENSE*,LICENCE*,COPYING*,NOTICE*,PATENTS*,COPYRIGHT*}; do
        if [[ -f "$notice" ]]; then
            cp "$notice" "$destination/"
            count=$((count + 1))
        fi
    done
    if [[ $count == 0 ]]; then
        echo "Missing license notice: $source" >&2
        return 1
    fi
}

copy_notices "$(go env GOROOT)" "$out/Go/toolchain"
go list -deps -tags desktop,production -f '{{if and .Module (not .Module.Main)}}{{.Module.Path}}@{{.Module.Version}}{{"\t"}}{{.Module.Dir}}{{end}}' . |
    LC_ALL=C sort -u |
    while IFS=$'\t' read -r module dir; do
        [[ -n "$module" ]] || continue
        echo "$module"
        copy_notices "$dir" "$out/Go/$module"
    done

(
    cd frontend
    frontend_root=$(pwd -P)
    packages=$(npm ls --omit=dev --all --parseable)
    printf '%s\n' "$packages" "$frontend_root/node_modules/vite" |
        LC_ALL=C sort -u |
        while IFS= read -r dir; do
            [[ "$dir" != "$frontend_root" ]] || continue
            package=$(node -p 'const p = require(process.argv[1] + "/package.json"); p.name + "@" + p.version' "$dir")
            echo "$package"
            if [[ "$package" == react-remove-scroll-bar@2.3.8 ]]; then
                # The published tarball only declares MIT. Include the author's text.
                mkdir -p "$out/npm/$package"
                cp "$dir/README.md" "$out/npm/$package/"
                cp "$root/licenses/react-remove-scroll-bar-2.3.8.LICENSE.txt" "$out/npm/$package/LICENSE"
            else
                copy_notices "$dir" "$out/npm/$package"
            fi
        done
)
