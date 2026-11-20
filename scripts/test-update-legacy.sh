#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
for tag in v0.2.2 v0.3.0 v0.4.0; do
    case "$tag" in
        v0.2.2) commit=a56e6d624299f933e76507496cbf8accc4ab0334 ;;
        v0.3.0) commit=852a69714b433ef78911d229c84dd362edce09f7 ;;
        v0.4.0) commit=14e085b24c85f47a81e255a63a0a631f6d7b0bdf ;;
    esac
    if git show-ref --verify --quiet "refs/tags/$tag"; then
        test "$(git rev-parse "$tag^{commit}")" = "$commit"
    fi
    checkout="$work/$tag"
    mkdir "$checkout"
    git archive "$commit" go.mod go.sum internal/update | tar -xf - -C "$checkout"
    cp internal/update/common_release_test.go "$checkout/internal/update/"
    echo "Testing $tag ($commit)"
    (cd "$checkout" && go test -count=1 -v ./internal/update -run '^TestCommonReleaseWindows$')
done
