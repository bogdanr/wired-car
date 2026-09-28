#!/usr/bin/env python3
"""Prepare the licensed body model for the build.

    python3 report/tools/model.py ~/Downloads/2023_audi_sq8_e_tron.zip [--ratio 0.1]

Takes the Sketchfab glTF download (scene.gltf + scene.bin + license.txt),
simplifies it with the pinned gltfpack to about 150k triangles, merges it
into one primitive per material (≈ 11 draw calls), quantizes it and applies
EXT_meshopt_compression. Writes:

    assets/model/etron.glb           — embedded by build.py
    assets/model/etron.LICENSE.txt   — required by build.py, credited in the footer

The fit to the published dimensions, the materials and the lighting are
done at runtime (src/stage/model-gltf.js), so the source file is not edited.
"""
from __future__ import annotations

import json
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vendor  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "model" / "etron.glb"


def glb_stats(path: Path) -> tuple[int, int]:
    b = path.read_bytes()
    n = struct.unpack("<I", b[12:16])[0]
    g = json.loads(b[20:20 + n])
    prims = [p for m in g["meshes"] for p in m["primitives"]]
    return sum(g["accessors"][p["indices"]]["count"] // 3 for p in prims), len(prims)


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    ratio = float(sys.argv[sys.argv.index("--ratio") + 1]) if "--ratio" in sys.argv else 0.1
    src = Path(args[0]).expanduser()
    exe = vendor.gltfpack()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        with zipfile.ZipFile(src) as z:
            z.extractall(tmp)
        gltf = next(tmp.rglob("*.gltf"), None) or next(tmp.rglob("*.glb"), None)
        lic = next(tmp.rglob("license.txt"), None)
        if not gltf:
            sys.exit(f"model: no .gltf/.glb inside {src.name} (download the glTF format, not FBX/USDZ)")
        if not lic:
            sys.exit(f"model: no license.txt inside {src.name}; the build refuses a model without one")
        OUT.parent.mkdir(parents=True, exist_ok=True)
        # -se: cap the geometric error so thin trim survives; -vn 10: 8-bit normals band on paint
        cmd = [str(exe), "-i", str(gltf), "-o", str(OUT), "-si", str(ratio), "-se", "0.004", "-vn", "10", "-cc"]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit(f"model: gltfpack failed\n{r.stderr}")
        shutil.copyfile(lic, OUT.with_suffix(".LICENSE.txt"))
    tris, prims = glb_stats(OUT)
    print(f"model: {OUT.relative_to(ROOT)}  {OUT.stat().st_size / 1024:.0f} KiB  {tris} triangles  {prims} draw calls")
    return 0


if __name__ == "__main__":
    sys.exit(main())
