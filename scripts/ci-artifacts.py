"""Stage platform packages and verify the consolidated GitHub Actions artifact."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess


def build_identity():
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    if not re.fullmatch(r"[0-9a-f]{40}", commit) or os.environ.get("GITHUB_SHA") != commit:
        raise ValueError("checkout does not match GITHUB_SHA")
    version = json.loads(Path("wails.json").read_text(encoding="utf-8"))["info"]["productVersion"]
    if not re.fullmatch(r"(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)){2}", version):
        raise ValueError("expected a stable X.Y.Z version")
    return commit, version


def expected_packages(version):
    prefix = f"Find-a-Note-{version}"
    return {
        "windows-amd64": [f"{prefix}-Windows-Setup.exe", f"{prefix}-Windows-Portable.exe"],
        "macos-arm64": [f"{prefix}-macOS-arm64.dmg"],
    }


def package_hash(path):
    if path.is_symlink() or not path.is_file() or not path.stat().st_size:
        raise ValueError(f"expected a regular, nonempty package: {path}")
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_sums(directory, names, *, exact):
    expected = set(names)
    actual = {}
    for line in (directory / "SHA256SUMS.txt").read_text(encoding="ascii").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
        if not match:
            raise ValueError(f"malformed checksum in {directory}")
        digest, name = match.groups()
        if name not in expected:
            if exact:
                raise ValueError(f"unexpected package in checksum list: {name}")
            continue
        if name in actual:
            raise ValueError(f"duplicate checksum: {name}")
        if package_hash(directory / name) != digest:
            raise ValueError(f"SHA-256 mismatch: {name}")
        actual[name] = digest
    if actual.keys() != expected:
        raise ValueError(f"missing checksum entries in {directory}: {expected - actual.keys()}")
    return actual


def write_bundle(output, metadata, checksums):
    (output / "build-metadata.json").write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    sums = "".join(f"{digest}  {name}\n" for name, digest in sorted(checksums.items()))
    (output / "SHA256SUMS.txt").write_bytes(sums.encode("ascii"))


def stage(platform, source, output, commit, version):
    names = expected_packages(version)[platform]
    checksums = verify_sums(source, names, exact=platform == "windows-amd64")
    output.mkdir()
    for name in names:
        shutil.copyfile(source / name, output / name)
    metadata = {"commit": commit, "version": version, "platform": platform, "packages": checksums}
    write_bundle(output, metadata, checksums)
    verify_sums(output, names, exact=True)


def collect(source, output, commit, version):
    checksums = {}
    packages = expected_packages(version)
    folders = {f"{platform}-{commit}" for platform in packages}
    if {path.name for path in source.iterdir()} != folders:
        raise ValueError("expected one Windows and one macOS artifact for the checkout SHA")
    for platform, names in packages.items():
        directory = source / f"{platform}-{commit}"
        if {path.name for path in directory.iterdir()} != set(names) | {"build-metadata.json", "SHA256SUMS.txt"}:
            raise ValueError(f"unexpected artifact contents: {directory}")
        verified = verify_sums(directory, names, exact=True)
        metadata = json.loads((directory / "build-metadata.json").read_text(encoding="utf-8"))
        expected = {"commit": commit, "version": version, "platform": platform, "packages": verified}
        if metadata != expected:
            raise ValueError(f"build metadata mismatch for {platform}")
        checksums.update(verified)

    output.mkdir()
    for platform, names in packages.items():
        for name in names:
            shutil.copyfile(source / f"{platform}-{commit}" / name, output / name)
    write_bundle(output, {"commit": commit, "version": version, "packages": checksums}, checksums)
    verify_sums(output, checksums, exact=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    staging = subcommands.add_parser("stage")
    staging.add_argument("platform", choices=("windows-amd64", "macos-arm64"))
    collection = subcommands.add_parser("collect")
    for command in (staging, collection):
        command.add_argument("source", type=Path)
        command.add_argument("output", type=Path)
    args = parser.parse_args()
    commit, version = build_identity()
    if args.command == "stage":
        stage(args.platform, args.source, args.output, commit, version)
    else:
        collect(args.source, args.output, commit, version)
    print(f"Verified {args.output} for {commit} (version {version})")


if __name__ == "__main__":
    main()
