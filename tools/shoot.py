#!/usr/bin/env python3
"""Screenshot the built report with headless Chromium (visual review).

    python3 tools/shoot.py                       # full review set -> tools/shots/
    python3 tools/shoot.py --url "?shot=side" --name side   # one ad-hoc shot
    python3 tools/shoot.py --only hero,explore   # subset of the review set

WebGL runs on SwiftShader, so it is slow but deterministic. Console errors
are printed and make the run exit non-zero.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = (ROOT / "dist" / "index.html").as_uri()
OUT = ROOT / "tools" / "shots"

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]

# name, viewport, theme, js to run after load, wait ms
SET = [
    ("hero", (1440, 900), "graphite", "", 3800),
    ("hero-vellum", (1440, 900), "vellum", "", 3800),
    ("inside", (1440, 900), "graphite", "go('inside')", 2600),
    ("router", (1440, 900), "graphite", "go('router')", 2600),
    ("explore", (1440, 900), "graphite", "go('explore')", 2600),
    ("explore-select", (1440, 900), "graphite", "go('explore'); setTimeout(()=>__app.select('0x4076'),600)", 3200),
    ("explore-side", (1440, 900), "graphite", "go('explore'); setTimeout(()=>__app.view('side'),600)", 3200),
    ("explore-plan", (1440, 900), "graphite", "go('explore'); setTimeout(()=>__app.view('plan'),600)", 6400),
    ("explore-front", (1440, 900), "graphite", "go('explore'); setTimeout(()=>__app.view('front'),600)", 3200),
    ("explore-rear", (1440, 900), "graphite", "go('explore'); setTimeout(()=>__app.view('rear'),600)", 3200),
    ("explore-exploded", (1440, 900), "graphite", "go('explore'); setTimeout(()=>__app.view('exploded'),600)", 3400),
    ("explore-vellum", (1440, 900), "vellum", "go('explore')", 2600),
    ("scen-doors", (1440, 900), "graphite", "go('scenarios'); setTimeout(()=>__app.scenario('doors',1),600)", 3600),
    ("scen-drive", (1440, 900), "graphite", "go('scenarios'); setTimeout(()=>__app.scenario('drive',2),600)", 3600),
    ("scen-acc", (1440, 900), "graphite", "go('scenarios'); setTimeout(()=>__app.scenario('acc',1),600)", 3600),
    ("scen-diag", (1440, 900), "graphite", "go('scenarios'); setTimeout(()=>__app.scenario('diag',1),600)", 3600),
    ("network", (1440, 900), "graphite", "go('network')", 1400),
    ("schematic", (1440, 900), "graphite", "go('schematic')", 1400),
    ("modules", (1440, 900), "graphite", "go('modules')", 1400),
    ("critical", (1440, 900), "graphite", "go('critical')", 1400),
    ("uds", (1440, 900), "graphite", "go('uds')", 1400),
    ("trace", (1440, 900), "graphite", "go('trace')", 2600),
    ("story", (1440, 900), "vellum", "go('story')", 1400),
    ("mobile-hero", (390, 844), "graphite", "", 3800),
    ("mobile-explore", (390, 844), "graphite", "go('explore')", 2600),
    ("mobile-modules", (390, 844), "graphite", "go('modules')", 1400),
    ("tablet-explore", (820, 1180), "graphite", "go('explore')", 2600),
    ("wide-hero", (1920, 1080), "graphite", "", 3800),
]

GO = """window.go = (id) => { const el = document.getElementById(id); if (!el) return;
  const y = el.getBoundingClientRect().top + scrollY - (el.dataset.beat ? 0 : 64);
  window.scrollTo(0, y + (el.dataset.beat ? Math.min(el.offsetHeight * 0.35, innerHeight * 0.5) : 0)); };"""


def run(items, full=False):
    OUT.mkdir(parents=True, exist_ok=True)
    errors = 0
    with sync_playwright() as p:
        exe = os.environ.get("CHROMIUM") or shutil.which("chromium") or shutil.which("chromium-browser")
        try:
            b = p.chromium.launch(args=ARGS)
        except Exception:
            if not exe:
                raise
            b = p.chromium.launch(args=ARGS, executable_path=exe)
        for name, vp, theme, js, wait in items:
            ctx = b.new_context(viewport={"width": vp[0], "height": vp[1]}, device_scale_factor=1)
            ctx.add_init_script(f"try{{localStorage.setItem('etron-theme','{theme}')}}catch(e){{}}")
            pg = ctx.new_page()
            msgs = []
            pg.on("console", lambda m: msgs.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
            pg.on("pageerror", lambda e: msgs.append(f"[pageerror] {e}"))
            url = DIST + (js if js.startswith("?") else "")
            pg.goto(url)
            pg.wait_for_timeout(600)
            if js and not js.startswith("?"):
                pg.evaluate(GO)
                pg.evaluate(js)
            pg.wait_for_timeout(wait)
            # software GL is slow: wait for the body model, then settle the layer fades so the
            # capture shows the resting state, not a frame mid-transition
            pg.evaluate("""async()=>{const s=window.__stage;if(!s)return;await s.modelReady;
              const st=s.state;['studio','sys','ghost'].forEach(k=>st[k]=st[k+'Goal']);s.invalidate()}""")
            pg.wait_for_timeout(900)
            path = OUT / f"{name}.jpg"
            pg.screenshot(path=str(path), full_page=full, type="jpeg", quality=68)
            bad = [m for m in msgs if "GPU stall" not in m and "SwiftShader" not in m and "WebGL" not in m]
            print(f"{name:<18} {vp[0]}x{vp[1]} {theme:<8} -> {path.relative_to(ROOT)}" + (f"  !! {len(bad)} console" if bad else ""))
            for m in bad[:8]:
                print("    ", m[:400])
            errors += len([m for m in bad if m.startswith("[pageerror]") or m.startswith("[error]")])
            ctx.close()
        b.close()
    return errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=None, help="query string or js for an ad-hoc shot")
    ap.add_argument("--name", default="adhoc")
    ap.add_argument("--size", default="1440x900")
    ap.add_argument("--theme", default="graphite")
    ap.add_argument("--wait", type=int, default=3000)
    ap.add_argument("--only", default=None)
    ap.add_argument("--full", action="store_true")
    a = ap.parse_args()
    if a.url is not None:
        w, h = map(int, a.size.split("x"))
        items = [(a.name, (w, h), a.theme, a.url, a.wait)]
    else:
        items = SET if not a.only else [s for s in SET if s[0] in a.only.split(",")]
    return 1 if run(items, a.full) else 0


if __name__ == "__main__":
    sys.exit(main())
