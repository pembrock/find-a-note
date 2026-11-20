"""Prepare, sign, and publish a release from one approved GitHub Actions run."""
import argparse
import http.client
from importlib import import_module
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, HTTPRedirectHandler, build_opener
from zipfile import BadZipFile, ZipFile

ci = import_module("ci-artifacts")
REPO = "pembrock/find-a-note"
API = f"https://api.github.com/repos/{REPO}"
WORKFLOW = ".github/workflows/build-cross-platform.yml"
NOTES = "RELEASE-NOTES.md"
METADATA = "release-metadata.json"
SIGNATURE_FILES = {"update-manifest.json", "update-manifest.sig"}
BUILD_FILES = {"build-metadata.json", "SHA256SUMS.txt"}
PACKAGE_LIMIT = 256 * 1024 * 1024
BUNDLE_LIMIT = 3 * PACKAGE_LIMIT + 1024 * 1024


class Redirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        if not url.startswith("https://"):
            raise ValueError("unexpected download redirect scheme")
        if request.get_method() != "GET":
            raise ValueError("unexpected redirect during GitHub mutation")
        target = super().redirect_request(request, response, code, message, headers, url)
        target.remove_header("Authorization")
        return target


class GitHub:
    def __init__(self, token=None):
        self.token = token
        self.opener = build_opener(Redirect())

    def request(self, route, *, method="GET", data=None, binary=False, public=False):
        url = API + route if route.startswith("/") else route
        request = Request(url, data=data, method=method, headers={
            "Accept": "application/octet-stream" if binary else "application/vnd.github+json",
            "User-Agent": "find-a-note-release-pipeline",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        if self.token and not public:
            request.add_unredirected_header("Authorization", f"Bearer {self.token}")
        if data is not None:
            request.add_header("Content-Type", "application/octet-stream" if binary else "application/json")
        return self.opener.open(request, timeout=120)

    def json(self, route, *, method="GET", payload=None, missing=False, public=False):
        data = json.dumps(payload).encode() if payload is not None else None
        try:
            with self.request(route, method=method, data=data, public=public) as response:
                return json.load(response)
        except HTTPError as error:
            if missing and error.code == 404:
                return None
            raise

    def pages(self, route, key=None):
        for page in range(1, 1001):
            join = "&" if "?" in route else "?"
            result = self.json(f"{route}{join}per_page=100&page={page}")
            entries = result[key] if key else result
            yield from entries
            if len(entries) < 100:
                return
        raise ValueError("GitHub pagination limit reached")

    def download(self, route, destination, limit, *, public=False):
        # Only the Release assets API uses content negotiation to return bytes.
        # The Actions archive API responds with a redirect for the JSON media type.
        binary = route.startswith("/releases/assets/")
        with self.request(route, binary=binary, public=public) as response, destination.open("xb") as out:
            size = 0
            while block := response.read(1024 * 1024):
                size += len(block)
                if size > limit:
                    raise ValueError(f"download exceeded expected size: {destination.name}")
                out.write(block)

    def upload(self, release_id, path):
        url = f"https://uploads.github.com/repos/{REPO}/releases/{release_id}/assets?name={quote(path.name)}"
        with path.open("rb") as file:
            # A fixed length allows streaming and avoids a second package-sized buffer.
            request = Request(url, data=file, method="POST", headers={
                "Content-Length": str(path.stat().st_size),
                "Content-Type": "application/octet-stream",
                "Accept": "application/vnd.github+json",
                "User-Agent": "find-a-note-release-pipeline",
                "X-GitHub-Api-Version": "2022-11-28",
            })
            request.add_unredirected_header("Authorization", f"Bearer {self.token}")
            with self.opener.open(request, timeout=120) as response:
                return json.load(response)


def release_identity(args):
    version, commit = args.version, args.commit
    if (not re.fullmatch(r"(0|[1-9][0-9]{0,4})(\.(0|[1-9][0-9]{0,4})){2}", version)
            or any(int(part) > 65535 for part in version.split("."))):
        raise ValueError("expected a stable X.Y.Z version")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("expected the full approved commit SHA")
    if min(args.run_id, args.attempt) < 1 or not args.branch:
        raise ValueError("expected a branch, run ID and attempt")
    return ci.expected_packages(version)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def package_info(directory, names):
    hashes = ci.verify_sums(directory, names, exact=True)
    return {name: {"sha256": digest, "size": (directory / name).stat().st_size}
            for name, digest in hashes.items()}


def extract_bundle(archive, directory, names):
    with ZipFile(archive) as bundle:
        entries = bundle.infolist()
        if len(entries) != len(names) or {file.filename for file in entries} != names:
            raise ValueError("unexpected ZIP entries")
        for entry in entries:
            limit = PACKAGE_LIMIT if entry.filename not in BUILD_FILES else 65536
            if not 0 < entry.file_size <= limit:
                raise ValueError(f"invalid ZIP entry size: {entry.filename}")
            with bundle.open(entry) as src, (directory / entry.filename).open("xb") as out:
                shutil.copyfileobj(src, out)


def fetch_bundle(api, args, directory):
    platforms = release_identity(args)
    names = {name for packages in platforms.values() for name in packages}
    run_path = f"/actions/runs/{args.run_id}"
    run = api.json(f"{run_path}/attempts/{args.attempt}")
    if (run["id"] != args.run_id or run["run_attempt"] != args.attempt
            or run["repository"]["full_name"] != REPO or (run.get("head_repository") or {}).get("full_name") != REPO
            or run["path"].split("@", 1)[0] != WORKFLOW
            or run["head_sha"] != args.commit or run["head_branch"] != args.branch
            or run["status"] != "completed" or run["conclusion"] != "success"
            or run["event"] not in {"push", "workflow_dispatch"}
            or (run["event"] == "push" and args.branch != "main")):
        raise ValueError("workflow run does not match the approved branch, commit and successful attempt")
    # Selecting an attempt in both the API and the archive name avoids falling back
    # to the latest attempt or to an artifact produced by a different run.
    artifact_name = f"find-a-note-packages-{args.commit}-{args.attempt}"
    artifacts = [item for item in api.pages(f"{run_path}/artifacts?name={artifact_name}", "artifacts")
                 if item["name"] == artifact_name]
    if len(artifacts) != 1 or artifacts[0]["expired"]:
        raise ValueError("expected exactly one live bundle for this run and attempt")
    artifact = artifacts[0]
    digest = artifact.get("digest") or ""
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise ValueError("GitHub did not supply a SHA-256 for the bundle")
    with tempfile.TemporaryDirectory() as temporary:
        archive = Path(temporary) / "bundle.zip"
        api.download(f"/actions/artifacts/{artifact['id']}/zip", archive, BUNDLE_LIMIT)
        if digest != f"sha256:{ci.package_hash(archive)}":
            raise ValueError("GitHub archive SHA-256 mismatch")
        extract_bundle(archive, directory, names | BUILD_FILES)
    packages = package_info(directory, names)
    identity = {
        "repository": REPO, "ref": f"refs/heads/{args.branch}", "event": run["event"],
        "run_id": args.run_id, "run_attempt": args.attempt,
    }
    expected = {
        "commit": args.commit, "version": args.version, "run": identity, "platforms": platforms,
        "packages": {name: info["sha256"] for name, info in packages.items()},
    }
    if read_json(directory / "build-metadata.json") != expected:
        raise ValueError("build metadata differs from approved source, platform or checksums")
    return {**expected, "packages": packages, "artifact_id": artifact["id"], "artifact_digest": digest}


def check_notes(path):
    raw = path.read_bytes()
    notes = raw.decode("utf-8")
    sections = re.split(r"(?m)^## (English|Русский)\s*\r?$", notes)
    if (len(raw) > 4096 or len(sections) != 5 or {sections[1], sections[3]} != {"English", "Русский"}
            or not sections[2].strip() or not sections[4].strip()):
        raise ValueError("release notes require nonempty ## English and ## Русский sections (UTF-8, up to 4096 bytes)")
    return notes


def check_directory(directory, metadata, *, signed):
    names = set(metadata["packages"])
    expected = names | BUILD_FILES | {NOTES, METADATA}
    if signed:
        expected |= SIGNATURE_FILES
    if {entry.name for entry in directory.iterdir()} != expected:
        raise ValueError("unexpected or missing files in release directory")
    if any(entry.is_symlink() or not entry.is_file() for entry in directory.iterdir()):
        raise ValueError("release directory must contain regular files")
    check_notes(directory / NOTES)
    if read_json(directory / METADATA) != metadata or package_info(directory, names) != metadata["packages"]:
        raise ValueError("release files differ from the selected CI bundle")


def manifest_tool(args, directory, metadata, *, sign=False):
    with tempfile.TemporaryDirectory() as temporary:
        index = Path(temporary) / "packages.json"
        index.write_text(json.dumps(metadata["packages"]), encoding="utf-8")
        command = ["go", "run", "./cmd/update-manifest", "-macos", "-version", args.version,
                   "-dir", str(directory.resolve()), "-notes", str((directory / NOTES).resolve()),
                   "-package-index", str(index)]
        if sign:
            # Avoid including the private-key path in a CalledProcessError.
            if subprocess.run([*command, "-key", str(args.key)]).returncode:
                raise ValueError("manifest signing failed")
        else:
            subprocess.run([*command, "-verify"], check=True)


def prepare(api, args):
    notes = check_notes(args.notes).replace("\r\n", "\n")
    args.directory.mkdir()
    try:
        metadata = fetch_bundle(api, args, args.directory)
        (args.directory / METADATA).write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        (args.directory / NOTES).write_bytes(notes.encode("utf-8"))
        check_directory(args.directory, metadata, signed=False)
    except (Exception, KeyboardInterrupt):
        shutil.rmtree(args.directory)
        raise


def verify_again(api, args, *, signed):
    with tempfile.TemporaryDirectory() as temporary:
        source = Path(temporary)
        metadata = fetch_bundle(api, args, source)
        if (args.directory / "build-metadata.json").read_bytes() != (source / "build-metadata.json").read_bytes():
            raise ValueError("release build metadata differs from the selected CI bundle")
    check_directory(args.directory, metadata, signed=signed)
    return metadata


def sign(api, args):
    if os.name != "nt":
        raise ValueError("sign on the trusted Windows machine")
    if args.confirm != f"v{args.version}@{args.commit}":
        raise ValueError("signing requires --confirm vVERSION@COMMIT")
    if not args.key.is_file():
        raise ValueError("external production signing key is missing")
    metadata = verify_again(api, args, signed=False)
    manifest_tool(args, args.directory, metadata, sign=True)
    check_directory(args.directory, metadata, signed=True)
    manifest_tool(args, args.directory, metadata)


def tag_object(api, tag, *, public=False):
    ref = api.json(f"/git/ref/tags/{tag}", missing=True, public=public)
    return ref["object"] if ref else None


def require_tag(api, tag, commit, *, public=False):
    obj = tag_object(api, tag, public=public)
    if not obj or obj["sha"] != commit or obj["type"] != "commit":
        raise ValueError(f"tag {tag} must point directly to approved commit {commit}")


def verify_assets(api, release, directory, metadata, args, *, public):
    tag = release["tag_name"]
    files = set(metadata["packages"]) | SIGNATURE_FILES | {NOTES, METADATA, "SHA256SUMS.txt"}
    assets = release["assets"]
    if len(assets) != len(files) or {item["name"] for item in assets} != files:
        raise ValueError("unexpected or missing GitHub Release assets")
    with tempfile.TemporaryDirectory() as temporary:
        downloaded = Path(temporary)
        for asset in assets:
            name = asset["name"]
            expected_url = f"https://github.com/{REPO}/releases/download/{tag}/{name}"
            local = directory / name
            size = local.stat().st_size
            digest = ci.package_hash(local)
            if ((public and asset["browser_download_url"] != expected_url) or asset["state"] != "uploaded"
                    or asset["size"] != size or asset["digest"] != f"sha256:{digest}"):
                raise ValueError(f"GitHub asset metadata mismatch: {name}")
            route = expected_url if public else f"/releases/assets/{asset['id']}"
            target = downloaded / name
            api.download(route, target, size, public=public)
            if ci.package_hash(target) != digest:
                raise ValueError(f"GitHub asset bytes mismatch: {name}")
        manifest_tool(args, downloaded, metadata)


def verify_public(api, args, metadata):
    tag = f"v{args.version}"
    require_tag(api, tag, args.commit, public=True)
    release = api.json(f"/releases/tags/{tag}", public=True)
    if (release["tag_name"] != tag or release["draft"] or release["prerelease"]
            or api.json("/releases/latest", public=True)["id"] != release["id"]):
        raise ValueError("release is not the latest stable public release")
    if release["body"] != check_notes(args.directory / NOTES):
        raise ValueError("published release notes differ")
    verify_assets(api, release, args.directory, metadata, args, public=True)


def require_draft(release, tag, commit, body):
    if (not release["draft"] or release["prerelease"] or release["tag_name"] != tag
            or release["target_commitish"] != commit or release["body"] != body):
        raise ValueError("unexpected draft metadata")


def publish(api, args, metadata):
    tag = f"v{args.version}"
    if args.confirm != f"{tag}@{args.commit}" or not api.token:
        raise ValueError("publication requires GH_TOKEN and --confirm vVERSION@COMMIT")
    release = api.json(f"/releases/tags/{tag}", missing=True)
    if release is not None and not release["draft"]:
        raise ValueError(f"public release already exists: {tag}")
    matches = [item for item in api.pages("/releases") if item["tag_name"] == tag]
    existing_tag = tag_object(api, tag)
    if args.resume_draft is None and (existing_tag or release or matches):
        raise ValueError(f"tag or release already exists: {tag}")
    body = check_notes(args.directory / NOTES)
    if args.resume_draft is None:
        release = api.json("/releases", method="POST", payload={
            "tag_name": tag, "target_commitish": args.commit, "name": f"Find a Note {tag}",
            "body": body, "draft": True, "prerelease": False,
        })
    else:
        if len(matches) != 1 or matches[0]["id"] != args.resume_draft:
            raise ValueError("approved draft does not match the release tag")
        release = api.json(f"/releases/{args.resume_draft}")
    release_id = release["id"]
    print(f"Draft ID: {release_id}", flush=True)
    require_draft(release, tag, args.commit, body)
    if existing_tag:
        require_tag(api, tag, args.commit)
    files = set(metadata["packages"]) | SIGNATURE_FILES | {NOTES, METADATA, "SHA256SUMS.txt"}
    existing = {item["name"]: item for item in release["assets"]}
    if not existing.keys() <= files or len(existing) != len(release["assets"]):
        raise ValueError("unexpected existing draft assets")
    # Assets can be reused only after an explicit resume and an exact match.
    for name, asset in existing.items():
        local = args.directory / name
        if (args.resume_draft is None or asset["state"] != "uploaded"
                or asset["size"] != local.stat().st_size or asset["digest"] != f"sha256:{ci.package_hash(local)}"):
            raise ValueError(f"refusing to overwrite existing asset: {name}")
    for name in sorted(files - existing.keys()):
        api.upload(release_id, args.directory / name)
    release = api.json(f"/releases/{release_id}")
    require_draft(release, tag, args.commit, body)
    verify_assets(api, release, args.directory, metadata, args, public=False)
    if not existing_tag:
        api.json("/git/refs", method="POST", payload={"ref": f"refs/tags/{tag}", "sha": args.commit})
    require_tag(api, tag, args.commit)
    api.json(f"/releases/{release_id}", method="PATCH", payload={"draft": False, "make_latest": "true"})
    verify_public(api, args, metadata)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "sign", "verify", "publish", "verify-public"):
        command = commands.add_parser(name)
        command.add_argument("--version", required=True)
        command.add_argument("--commit", required=True)
        command.add_argument("--branch", required=True)
        command.add_argument("--run-id", required=True, type=int)
        command.add_argument("--attempt", required=True, type=int)
        command.add_argument("--directory", required=True, type=Path)
        if name == "prepare":
            command.add_argument("--notes", required=True, type=Path)
        if name == "sign":
            command.add_argument("--key", required=True, type=Path)
        if name in {"sign", "publish"}:
            command.add_argument("--confirm", required=True)
        if name == "publish":
            command.add_argument("--resume-draft", type=int)
    args = parser.parse_args()
    api = GitHub(os.environ.get("GH_TOKEN"))
    try:
        if args.command == "prepare":
            prepare(api, args)
        elif args.command == "sign":
            sign(api, args)
        else:
            metadata = verify_again(api, args, signed=True)
            manifest_tool(args, args.directory, metadata)
            if args.command == "publish":
                publish(api, args, metadata)
            elif args.command == "verify-public":
                verify_public(api, args, metadata)
    except HTTPError as error:
        parser.exit(1, f"GitHub request failed (HTTP {error.code}); inspect remote state before retrying a mutation.\n")
    except (OSError, ValueError, KeyError, TypeError, BadZipFile, http.client.HTTPException,
            subprocess.CalledProcessError) as error:
        parser.exit(1, f"Release operation failed: {error}\n")
    print(f"{args.command}: verified {args.version} at {args.commit} from run {args.run_id}/{args.attempt}")


if __name__ == "__main__":
    main()
