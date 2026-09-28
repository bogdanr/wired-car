#!/usr/bin/env python3
"""Build the static report.

Bundles src/main.js (ES modules + three.js) with esbuild, then inlines the
bundle, the CSS, the woff2 fonts and data/{etron,vehicle}.json into a single
self-contained dist/index.html. No runtime network access, no CDN.

    python3 report/build.py            # build
    python3 report/build.py --dev      # unminified bundle with inline sourcemap

Build-time dependencies (esbuild binary, three.js) are pinned in
tools/vendor.py and fetched on first run; Node.js is not required.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "tools"))
import vendor  # noqa: E402

SRC = ROOT / "src"
STYLES = ROOT / "styles"
FONTS = ROOT / "assets" / "fonts"
DATA = ROOT / "data"
DIST = ROOT / "dist"
BUDGET_KIB = 1200


def read(path: Path) -> str:
    if not path.exists():
        sys.exit(f"missing required file: {path}")
    return path.read_text(encoding="utf-8")


def fail(msg: str) -> None:
    sys.exit(f"build: data check failed: {msg}")


# --------------------------------------------------------------------------
# data checks — the drawing is only honest if the data is consistent
# --------------------------------------------------------------------------
def validate(d: dict, v: dict) -> None:
    ids = [m["id"] for m in d["modules"]]
    if len(ids) != len(set(ids)):
        fail("duplicate module ids")
    mods = {m["id"]: m for m in d["modules"]}
    buses = {b["id"] for b in d["buses"]}
    topo = d["topology"]
    gw = topo["gateway"]
    if gw not in mods:
        fail(f"gateway {gw} is not a module")

    for m in d["modules"]:
        mm = m.get("location", {}).get("mm")
        if not mm or not all(k in mm for k in "xyz"):
            fail(f"{m['id']}: location.mm {{x,y,z}} missing")
        if m["id"] != "tester" and not (0 <= mm["x"] <= v["dimensions"]["length"]):
            fail(f"{m['id']}: location.mm.x outside the car")
        if m.get("location", {}).get("confidence") not in ("high", "medium", "low"):
            fail(f"{m['id']}: location.confidence must be high/medium/low")
        for b in m.get("bus", []):
            if b not in buses:
                fail(f"{m['id']}: unknown bus {b}")

    for b in d["buses"]:
        if gw in b["members"]:
            fail(f"bus {b['id']}: the gateway must not be listed as a member (it sits on every bus)")
        for mid in b["members"]:
            if mid not in mods:
                fail(f"bus {b['id']}: unknown member {mid}")
            if b["id"] not in mods[mid].get("bus", []):
                fail(f"bus {b['id']}: member {mid} does not list the bus in modules[].bus")
    # the reverse direction: every module's bus list must be backed by membership
    lin_slaves = {s for seg in topo["lin"] for s in seg["slaves"]}
    for m in d["modules"]:
        for b in m.get("bus", []):
            if m["id"] == gw or (b == "lin" and m["id"] in lin_slaves):
                continue
            if m["id"] not in next(x for x in d["buses"] if x["id"] == b)["members"]:
                fail(f"{m['id']} lists bus {b} but is not in buses[{b}].members")
    for seg in topo["lin"]:
        if seg["master"] not in mods:
            fail(f"LIN master {seg['master']} unknown")
        for s in seg["slaves"]:
            if s not in mods:
                fail(f"LIN slave {s} unknown")

    # schematic: every networked module must have exactly one home row (drawn once)
    primary = ("can", "canfd", "flexray", "eth")
    for m in d["modules"]:
        if m["id"] in (gw, "tester") or not m.get("bus"):
            continue
        if not any(b in primary for b in m["bus"]) and m["id"] not in lin_slaves:
            fail(f"schematic: {m['id']} is only on LIN but is not a slave of any LIN master")
        if m["id"] in topo.get("localLin", []) and "lin" not in m["bus"]:
            fail(f"schematic: {m['id']} is listed as localLin but not on LIN")

    for f in d["flows"]:
        for end in (f["from"], f["to"]):
            if end not in mods:
                fail(f"flow references unknown module: {end}")
    flow_pairs = {(f["from"], f["to"]) for f in d["flows"]}

    comps = {c["id"] for c in d["components"]}
    for c in d["components"]:
        for e in c["ecus"]:
            if e not in mods:
                fail(f"component {c['id']}: unknown ecu {e}")
    for a, b in topo["hv"]:
        for e in (a, b):
            if e not in mods and e not in comps:
                fail(f"HV link references unknown id {e}")

    dim = v["dimensions"]
    if dim["frontOverhang"] + dim["wheelbase"] + dim.get("rearOverhang", 0) != dim["length"]:
        fail("vehicle: frontOverhang + wheelbase + rearOverhang must equal length")
    axles = {"motor-front": dim["frontOverhang"], "motor-rear": dim["frontOverhang"] + dim["wheelbase"]}
    for mid, ax in axles.items():
        if mid in mods and abs(mods[mid]["location"]["mm"]["x"] - ax) > 5:
            fail(f"{mid} must sit on its axle line (x={ax} mm ±5)")
    for key, ax in (("front", axles["motor-front"]), ("rear", axles["motor-rear"])):
        if abs(v["motors"][key]["x"] - ax) > 5:
            fail(f"vehicle.motors.{key}.x must sit on its axle line (x={ax} mm ±5)")

    h = d["harness"]
    for a, b in h["edges"]:
        if a not in h["nodes"] or b not in h["nodes"]:
            fail(f"harness edge {a}-{b} references an unknown node")

    for s in d["scenarios"]:
        for i, st in enumerate(s["steps"]):
            for pair in st.get("flows", []):
                if tuple(pair) not in flow_pairs:
                    fail(f"scenario {s['id']} step {i}: {pair} is not a flow in flows[] (scenarios may only sequence existing flows)")
            for e in st.get("path", []):
                if e not in mods:
                    fail(f"scenario {s['id']} step {i}: unknown path node {e}")
            for c in st.get("components", []):
                if c not in comps:
                    fail(f"scenario {s['id']} step {i}: unknown component {c}")
    for t in d["udsTrace"]:
        for e in (t["from"], t["to"]):
            if e not in mods:
                fail(f"udsTrace references unknown module {e}")

    dims = v["dimensions"]
    if dims["length"] - dims["wheelbase"] - dims["frontOverhang"] <= 0:
        fail("vehicle: rear overhang must be positive")


# --------------------------------------------------------------------------
def bundle(dev: bool) -> str:
    three_dir, esbuild = vendor.ensure()
    cmd = [str(esbuild), str(SRC / "main.js"), "--bundle", "--format=iife", "--target=es2020",
           "--platform=browser", "--charset=utf8", "--legal-comments=eof", "--log-level=warning"]
    cmd += ["--sourcemap=inline"] if dev else ["--minify"]
    # optional licensed body model: without it, the loader (and GLTFLoader) never enter the bundle
    impl = "model-gltf.js" if MODEL.exists() else "model-none.js"
    cmd += [f"--alias:etron-model=./src/stage/{impl}"]
    env = dict(os.environ, NODE_PATH=str(three_dir.parent))
    r = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=ROOT)
    if r.returncode != 0:
        sys.exit(f"esbuild failed:\n{r.stderr}")
    if r.stderr.strip():
        print(r.stderr.strip())
    return r.stdout


MODEL = ROOT / "assets" / "model" / "etron.glb"
MODEL_BUDGET_KIB = 1400


def model_tag() -> tuple[str, int]:
    """<script id=model> with the base64 .glb, or an empty string when no model is supplied."""
    if not MODEL.exists():
        return "", 0
    b = MODEL.read_bytes()
    if len(b) / 1024 > MODEL_BUDGET_KIB:
        sys.exit(f"build: {MODEL.name} is {len(b) / 1024:.0f} KiB; compress it (gltf-transform draco/meshopt) "
                 f"under {MODEL_BUDGET_KIB} KiB")
    lic = MODEL.with_suffix(".LICENSE.txt")
    if not lic.exists():
        sys.exit(f"build: {MODEL.name} needs a licence file next to it ({lic.name}) before it can ship")
    return f'<script id="model" type="application/octet-stream">{base64.b64encode(b).decode()}</script>', len(b)


def fonts_inline(css: str) -> tuple[str, int]:
    total = 0
    for f in sorted(FONTS.glob("*.woff2")):
        b = f.read_bytes()
        total += len(b)
        css = css.replace(f'url("font:{f.name}")',
                          f'url("data:font/woff2;base64,{base64.b64encode(b).decode()}")')
    if 'url("font:' in css:
        sys.exit("build: a font placeholder has no matching file in assets/fonts")
    return css, total


def main() -> int:
    dev = "--dev" in sys.argv
    tokens = read(STYLES / "tokens.css")
    app_css = read(STYLES / "app.css")
    html = read(SRC / "index.html")

    data = json.loads(read(DATA / "etron.json"))
    vehicle = json.loads(read(DATA / "vehicle.json"))
    validate(data, vehicle)
    data["vehicle"] = vehicle

    js = bundle(dev)
    tokens, font_bytes = fonts_inline(tokens)

    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("</", "<\\/").replace("<!--", "<\\!--")
    if "</script" in js.lower():
        sys.exit("build: bundle contains '</script' and cannot be inlined")

    parts = {"tokens.css": tokens, "app.css": app_css, "data": payload, "bundle.js": js}
    html = html.replace("/*__TOKENS__*/", tokens)
    html = html.replace("/*__APP_CSS__*/", app_css)
    html = html.replace("/*__DATA__*/", payload)
    html = html.replace("/*__APP_JS__*/", js)
    mtag, model_bytes = model_tag()
    if mtag:
        html = html.replace("</body>", mtag + "\n</body>", 1)
        parts["model.glb"] = mtag

    DIST.mkdir(parents=True, exist_ok=True)
    out = DIST / "index.html"
    out.write_text(html, encoding="utf-8")

    kib = out.stat().st_size / 1024
    ecus = sum(1 for m in data["modules"] if m.get("kind") == "ecu")
    head = html.split("<body")[0].lower()
    external = any(s in html for s in ('src="http', "src='http", 'href="http', "url(http", '@import'))
    print(f"built {out.relative_to(ROOT.parent)}{' (dev)' if dev else ''}")
    print(f"  modules={len(data['modules'])} (ecus={ecus})  flows={len(data['flows'])}  buses={len(data['buses'])}"
          f"  components={len(data['components'])}  scenarios={len(data['scenarios'])}")
    for k, v in parts.items():
        extra = f"  (fonts {font_bytes / 1024:.0f} KiB raw)" if k == "tokens.css" else ""
        print(f"  {k:<10} {len(v.encode()) / 1024:8.1f} KiB{extra}")
    shown = BUDGET_KIB + (MODEL_BUDGET_KIB * 4 / 3 if model_bytes else 0)
    print(f"  total      {kib:8.1f} KiB   budget {shown:.0f} KiB   external refs: {'YES' if external else 'none'}")
    if external or "http" in head.replace("http-equiv", ""):
        sys.exit("build: output is not self-contained")
    print(f"  body model: {MODEL.relative_to(ROOT) if model_bytes else 'none (procedural hull)'}")
    budget = BUDGET_KIB + (MODEL_BUDGET_KIB * 4 / 3 if model_bytes else 0)
    if not dev and kib > budget:
        sys.exit(f"build: {kib:.0f} KiB exceeds the {budget:.0f} KiB budget")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
