#!/usr/bin/env python3
"""Fetch the pinned build-time dependencies into report/vendor/.

No Node.js required: esbuild is a single static Go binary published on npm
as @esbuild/<platform>, and three.js is plain ES-module source. Both are
downloaded from the npm registry, verified against the sha512 integrity
recorded below (the same value package-lock.json would hold), and unpacked.

    python3 report/tools/vendor.py          # idempotent
    python3 report/tools/vendor.py --force  # re-download

Versions here must match report/package.json.
"""
from __future__ import annotations

import base64
import hashlib
import io
import platform
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "vendor"

THREE = {
    "version": "0.186.1",
    "url": "https://registry.npmjs.org/three/-/three-0.186.1.tgz",
    "integrity": "sha512-blFeqb49wRCSGUGj7gtpfnSGHy2lwDk94RhUmS1c/hTby70kvChbWpkJ4Pm1390LqzzvTmzgXKHPEafJwCb8jA==",
}
ESBUILD_VERSION = "0.28.2"
ESBUILD = {
    "linux-x64": "sha512-4xTZr1FUmSoQW4XIWmit3tzQrUTZM+N3P0XV8xROKYF50XfI7xeO90+1bZvNwxIufQ9hDQVRJH5YhgPVF8A/HQ==",
    "linux-arm64": "sha512-pW4AC0P3it8c7do9MVM4p51FzHzdM/TZrerurgRcHJ2WTa1VQ1CIq18xncfpBJw4ojkiZZrKW2yIBWBP92j6Ug==",
    "darwin-arm64": "sha512-n4KqkOQrraxHJcgjM1RvwbigfQKIKJVpM7xp+KsxiyUSrRdIXnt73VhrPAx0fV44hgfmIVKjxMN9J1t5jySVkw==",
    "darwin-x64": "sha512-uq6suIWYP37qzGddBKPw5QEQPi6HiLGsO7UmkpfyaYNQ3D+rN6w6WfwH+nuqcGXWvawGwxOEroO4YGnFh95azw==",
}


# gltfpack (meshoptimizer) — only needed by tools/model.py to prepare the body model
GLTFPACK = {
    "version": "1.3",
    "linux-x64": ("https://github.com/zeux/meshoptimizer/releases/download/v1.3/gltfpack-ubuntu.zip",
                  "sha512-zbSVwi4OBgMW/qdgCBVgZ0K33MdH/EjlHmoeEFm2S7Ck18Ebu/Qtal+39c4MquZOp5F+oIeI9g5Cd+lH3hJnwg=="),
}

# three.js addons the bundle may import (everything else in the tarball is skipped)
THREE_KEEP = ("build/", "examples/jsm/lines/", "examples/jsm/loaders/GLTFLoader.js",
              "examples/jsm/utils/BufferGeometryUtils.js", "examples/jsm/utils/SkeletonUtils.js",
              "examples/jsm/libs/meshopt_decoder.module.js")


def platform_key() -> str:
    os_name = {"Linux": "linux", "Darwin": "darwin"}.get(platform.system())
    arch = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine().lower())
    key = f"{os_name}-{arch}"
    if key not in ESBUILD:
        sys.exit(f"vendor: no pinned esbuild binary for platform {key!r}; install esbuild {ESBUILD_VERSION} on PATH")
    return key


def fetch(url: str, integrity: str) -> bytes:
    print(f"vendor: fetching {url}")
    with urllib.request.urlopen(url, timeout=60) as r:
        blob = r.read()
    algo, want = integrity.split("-", 1)
    got = base64.b64encode(hashlib.new(algo, blob).digest()).decode()
    if got != want:
        sys.exit(f"vendor: integrity mismatch for {url}\n  want {want}\n  got  {got}")
    return blob


def extract(blob: bytes, dest: Path, keep) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        for m in tar.getmembers():
            if not m.isfile():
                continue
            rel = m.name.split("/", 1)[1] if "/" in m.name else m.name
            if not keep(rel):
                continue
            out = dest / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(tar.extractfile(m).read())
            out.chmod(0o755 if rel.startswith("bin/") else 0o644)


def three_path() -> Path:
    # a real node_modules layout, so esbuild resolves `three` and `three/addons/*`
    # through the package's own exports map (NODE_PATH=vendor/node_modules)
    return VENDOR / "node_modules" / "three"


def three_ok(tdir: Path) -> bool:
    import json
    pkg = tdir / "package.json"
    return (pkg.exists() and json.loads(pkg.read_text())["version"] == THREE["version"]
            and (tdir / "examples/jsm/utils/SkeletonUtils.js").exists())


def esbuild_path() -> Path:
    return VENDOR / f"esbuild-{ESBUILD_VERSION}-{platform_key()}" / "bin" / "esbuild"


def ensure(force: bool = False) -> tuple[Path, Path]:
    """Return (three_dir, esbuild_binary), downloading them if needed."""
    VENDOR.mkdir(exist_ok=True)
    tdir = three_path()
    if force or not three_ok(tdir):
        blob = fetch(THREE["url"], THREE["integrity"])
        extract(blob, tdir, lambda p: p.startswith(THREE_KEEP) or p in ("LICENSE", "package.json"))
    exe = esbuild_path()
    if force or not exe.exists():
        key = platform_key()
        url = f"https://registry.npmjs.org/@esbuild/{key}/-/{key}-{ESBUILD_VERSION}.tgz"
        extract(fetch(url, ESBUILD[key]), exe.parent.parent, lambda p: p.startswith("bin/") or p == "package.json")
    return tdir, exe


def gltfpack() -> Path:
    """Return the pinned gltfpack binary, downloading it if needed."""
    import zipfile
    key = platform_key()
    exe = VENDOR / f"gltfpack-{GLTFPACK['version']}-{key}" / "gltfpack"
    if exe.exists():
        return exe
    if key not in GLTFPACK:
        sys.exit(f"vendor: no pinned gltfpack for {key!r}; put gltfpack {GLTFPACK['version']} on PATH")
    url, integrity = GLTFPACK[key]
    with zipfile.ZipFile(io.BytesIO(fetch(url, integrity))) as z:
        exe.parent.mkdir(parents=True, exist_ok=True)
        exe.write_bytes(z.read("gltfpack"))
    exe.chmod(0o755)
    return exe


if __name__ == "__main__":
    t, e = ensure(force="--force" in sys.argv)
    print(f"vendor: three  -> {t.relative_to(ROOT)}")
    print(f"vendor: esbuild -> {e.relative_to(ROOT)}")
