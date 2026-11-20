import hashlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import ANY, Mock, patch
from urllib.error import URLError
from zipfile import ZipFile

from importlib import import_module

release = import_module("release-pipeline")
ci = release.ci


class ReleasePipelineTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.directory = self.root / "release"
        self.notes = self.root / "notes.md"
        self.notes.write_text("## English\nChanges.\n## Русский\nИзменения.\n", encoding="utf-8")
        commit = "a" * 40
        self.args = SimpleNamespace(
            version="0.4.1", commit=commit, branch="main", run_id=12, attempt=2,
            directory=self.directory, notes=self.notes, key=self.root / "missing-key",
            confirm=f"v0.4.1@{commit}", resume_draft=None,
        )
        self.run = {
            "id": 12, "run_attempt": 2, "repository": {"full_name": release.REPO},
            "head_repository": {"full_name": release.REPO},
            "path": release.WORKFLOW, "head_sha": commit, "head_branch": "main",
            "status": "completed", "conclusion": "success", "event": "push",
        }
        self.identity = {"repository": release.REPO, "ref": "refs/heads/main", "event": "push",
                         "run_id": 12, "run_attempt": 2}
        self.platforms = ci.expected_packages(self.args.version)
        self.artifact = {"id": 99, "expired": False, "name": f"find-a-note-packages-{commit}-2"}
        self.api = Mock(token="test-token")
        self.api.json.return_value = self.run
        self.api.pages.return_value = [self.artifact]
        self.api.download.side_effect = lambda route, path, limit: path.write_bytes(self.archive)
        stage_root = self.root / "platforms"
        stage_root.mkdir()
        for platform, names in self.platforms.items():
            source = self.root / platform
            source.mkdir()
            for name in names:
                (source / name).write_bytes(name.encode())
            ci.write_bundle(source, {}, {name: ci.package_hash(source / name) for name in names})
            ci.stage(platform, source, stage_root / f"{platform}-{commit}-2", commit, self.args.version, self.identity)
        self.bundle = self.root / "bundle"
        ci.collect(stage_root, self.bundle, commit, self.args.version, self.identity)
        self.pack_archive()

    def pack_archive(self):
        raw = io.BytesIO()
        with ZipFile(raw, "w") as zip_file:
            for path in self.bundle.iterdir():
                zip_file.write(path, path.name)
        self.archive = raw.getvalue()
        digest = hashlib.sha256(self.archive).hexdigest()
        self.artifact["digest"] = "sha256:" + digest

    def test_prepare_and_reverify(self):
        release.prepare(self.api, self.args)
        metadata = release.verify_again(self.api, self.args, signed=False)
        self.assertEqual(metadata["commit"], self.args.commit)
        self.assertEqual(metadata["run"]["run_id"], 12)
        self.assertEqual(metadata["artifact_id"], 99)
        self.assertEqual(len(metadata["packages"]), 3)
        self.api.json.assert_called_with("/actions/runs/12/attempts/2")
        self.api.download.assert_called_with("/actions/artifacts/99/zip", ANY, release.BUNDLE_LIMIT)

    def test_modified_package(self):
        (self.bundle / self.platforms["macos-arm64"][0]).write_bytes(b"bad")
        self.pack_archive()
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            release.prepare(self.api, self.args)
        self.assertFalse(self.directory.exists())

    def test_modified_archive(self):
        self.artifact["digest"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(ValueError, "archive SHA-256 mismatch"):
            release.prepare(self.api, self.args)

    def test_missing_file(self):
        (self.bundle / self.platforms["macos-arm64"][0]).unlink()
        self.pack_archive()
        with self.assertRaisesRegex(ValueError, "ZIP entries"):
            release.prepare(self.api, self.args)

    def test_wrong_metadata(self):
        path = self.bundle / "build-metadata.json"
        original = json.loads(path.read_text(encoding="utf-8"))
        for field, value in (("version", "0.4.0"), ("commit", "b" * 40), ("platforms", {}),
                             ("run", {**self.identity, "run_attempt": 1}),
                             ("run", {**self.identity, "ref": "refs/tags/main"})):
            with self.subTest(field=field, value=value):
                path.write_text(json.dumps({**original, field: value}), encoding="utf-8")
                self.pack_archive()
                with self.assertRaisesRegex(ValueError, "build metadata differs"):
                    release.prepare(self.api, self.args)

    def test_run_mismatch(self):
        for field, value in (("head_sha", "b" * 40), ("event", "pull_request"),
                             ("run_attempt", 1), ("conclusion", "failure")):
            with self.subTest(field=field):
                self.api.json.return_value = {**self.run, field: value}
                with self.assertRaisesRegex(ValueError, "workflow run does not match"):
                    release.prepare(self.api, self.args)
        self.api.download.assert_not_called()

    def test_network_failure(self):
        self.api.download.side_effect = URLError("offline")
        with self.assertRaises(URLError):
            release.prepare(self.api, self.args)
        self.assertFalse(self.directory.exists())

    def test_no_production_key(self):
        with patch.object(release.os, "name", "nt"):
            with self.assertRaisesRegex(ValueError, "production signing key is missing"):
                release.sign(self.api, self.args)
        self.api.json.assert_not_called()

    def draft(self, assets):
        return {
            "id": 42, "draft": True, "prerelease": False, "tag_name": "v0.4.1",
            "target_commitish": self.args.commit, "body": release.check_notes(self.directory / release.NOTES), "assets": assets,
        }

    def test_publication_requires_confirmation(self):
        self.args.confirm = None
        with self.assertRaisesRegex(ValueError, "publication requires"):
            release.publish(self.api, self.args, {})
        self.api.json.assert_not_called()
        self.api.upload.assert_not_called()

    def test_existing_public_release(self):
        self.api.json.return_value = {"draft": False}
        with self.assertRaisesRegex(ValueError, "public release already exists"):
            release.publish(self.api, self.args, {})
        self.api.json.assert_called_once_with("/releases/tags/v0.4.1", missing=True)
        self.api.upload.assert_not_called()

    def test_existing_tag(self):
        self.api.pages.return_value = []
        self.api.json.side_effect = [None, {"object": {"sha": self.args.commit, "type": "commit"}}]
        with self.assertRaisesRegex(ValueError, "tag or release already exists"):
            release.publish(self.api, self.args, {})
        self.api.upload.assert_not_called()

    def test_resume_refuses_overwrite(self):
        release.prepare(self.api, self.args)
        metadata = release.verify_again(self.api, self.args, signed=False)
        name = self.platforms["macos-arm64"][0]
        draft = self.draft([{"name": name, "state": "uploaded", "size": 1, "digest": "sha256:bad"}])
        self.args.resume_draft = draft["id"]
        self.api.pages.return_value = [draft]
        self.api.json.side_effect = [None, None, draft]
        with self.assertRaisesRegex(ValueError, "refusing to overwrite existing asset"):
            release.publish(self.api, self.args, metadata)
        self.api.upload.assert_not_called()

    def test_publish_and_resume_with_matching_assets(self):
        release.prepare(self.api, self.args)
        metadata = release.verify_again(self.api, self.args, signed=False)
        for name in release.SIGNATURE_FILES:
            (self.directory / name).write_bytes(b"test signature or manifest")
        obj = {"object": {"sha": self.args.commit, "type": "commit"}}
        name = self.platforms["macos-arm64"][0]
        file = self.directory / name
        same = {"name": name, "state": "uploaded", "size": file.stat().st_size,
                "digest": "sha256:" + ci.package_hash(file)}
        for resume in (False, True):
            with self.subTest(resume=resume), patch.object(release, "verify_assets") as verify_assets, \
                    patch.object(release, "verify_public") as verify_public:
                draft = self.draft([same] if resume else [])
                api = Mock(token="test-token")
                api.pages.return_value = [draft] if resume else []
                self.args.resume_draft = draft["id"] if resume else None
                api.json.side_effect = [None, obj, draft, obj, draft, obj, {}] if resume else [
                    None, None, draft, draft, {}, obj, {},
                ]
                release.publish(api, self.args, metadata)
                uploaded = {call.args[1].name for call in api.upload.call_args_list}
                self.assertEqual(len(uploaded), 7 if resume else 8)
                self.assertEqual(name in uploaded, not resume)
                verify_assets.assert_called_once()
                verify_public.assert_called_once()
                self.assertEqual(api.json.call_args.kwargs["method"], "PATCH")

    def test_verify_public_compares_latest_and_downloaded_bytes(self):
        release.prepare(self.api, self.args)
        metadata = release.verify_again(self.api, self.args, signed=False)
        for name in release.SIGNATURE_FILES:
            (self.directory / name).write_bytes(b"test signature or manifest")
        files = {
            path.name: path.read_bytes() for path in self.directory.iterdir()
            if path.name != "build-metadata.json"
        }
        tag = "v0.4.1"
        base = f"https://github.com/{release.REPO}/releases/download/{tag}/"
        published = self.draft([
            {"name": name, "size": len(data), "state": "uploaded", "browser_download_url": base + name,
             "digest": "sha256:" + hashlib.sha256(data).hexdigest()}
            for name, data in files.items()
        ])
        published["draft"] = False
        obj = {"object": {"sha": self.args.commit, "type": "commit"}}
        api = Mock()

        def download(route, path, limit, *, public):
            self.assertEqual(route, base + path.name)
            self.assertTrue(public)
            path.write_bytes(files[path.name])

        api.download.side_effect = download
        with patch.object(release, "manifest_tool") as verifier:
            api.json.side_effect = [obj, published, {"id": 23}]
            with self.assertRaisesRegex(ValueError, "not the latest"):
                release.verify_public(api, self.args, metadata)
            api.download.assert_not_called()
            api.json.side_effect = [obj, published, {"id": published["id"]}]
            release.verify_public(api, self.args, metadata)
            verifier.assert_called_once()
            api.json.side_effect = [obj, published, {"id": published["id"]}]
            broken = release.NOTES
            files[broken] = b"broken"
            with self.assertRaisesRegex(ValueError, "asset bytes mismatch"):
                release.verify_public(api, self.args, metadata)



if __name__ == "__main__":
    unittest.main()
