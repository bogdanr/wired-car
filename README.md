<div align="center">

# The Wired Car

### How the 40 computers in an Audi e-tron talk to each other

An interactive engineering drawing of a real 2021 Audi e-tron 55 quattro.<br>
Forty control units, five networks, one gateway — where each computer sits, what it does,<br>
and how a single message crosses the car to reach it. Every address, part number and<br>
UDS exchange was read from the car through its own diagnostic port.

<a href="https://github.com/bogdanr/wired-car/actions/workflows/pages.yml"><img src="https://img.shields.io/github/actions/workflow/status/bogdanr/wired-car/pages.yml?branch=main&amp;style=flat-square&amp;label=pages&amp;labelColor=0b1018" alt="Pages deploy status"></a>
<img src="https://img.shields.io/badge/ECUs-40-1f6fb4?style=flat-square&amp;labelColor=0b1018" alt="40 ECUs">
<img src="https://img.shields.io/badge/networks-5-3aa981?style=flat-square&amp;labelColor=0b1018" alt="5 networks">
<img src="https://img.shields.io/badge/findings-8-555049?style=flat-square&amp;labelColor=0b1018" alt="8 findings">
<img src="https://img.shields.io/badge/python-3.12-555049?style=flat-square&amp;labelColor=0b1018" alt="Python 3.12">

<a href="https://bogdanr.github.io/wired-car/"><b>Read the report</b></a> ·
<a href="#what-it-found">Findings</a> ·
<a href="#how-it-works">Method</a> ·
<a href="#reproduce-it">Reproduce</a> ·
<a href="#data-and-licences">Data &amp; licences</a>

</div>

A car is not one computer. It is forty, wired into five networks that cannot all speak to each
other, with a single gateway as the only door in or out. This report draws that car: a 3D stage you
can turn, explode and filter, a parts list of every module with its address and part number, the
five buses compared side by side, and a stepper that walks one real UDS exchange byte by byte. Pick
any module on the car to see where it lives and what it is allowed to do.

> **Live report: <https://bogdanr.github.io/wired-car/>**
> Two themes (Graphite, Vellum), a scenario player, and a self-contained page. No tracking, no CDN.

## Sixty seconds

Three things carry the report:

| Thing | What it is | How to read it |
|-------|------------|----------------|
| **The gateway** | Module `0x4010`, under the dash. It has a port on every bus and is the only module that does. | Every message that changes wire passes through it. A tester on the OBD socket can only ever talk to the gateway. |
| **The five buses** | CAN, CAN FD, FlexRay, LIN and Automotive Ethernet. | Cheap and slow where that is enough, fast and deterministic where lives depend on it. No single wire can carry a brake command and a radar stream at once. |
| **UDS (ISO 14229)** | One language, nine verbs, four locks. | Reading is open almost everywhere. Writing is gated, and on safety and high-voltage modules it is simply not done. |

```
tester (0x0E00) ──DoIP──▶ gateway (0x4010) ──┬─▶ CAN · CAN FD · FlexRay · LIN · Ethernet
   over Ethernet                             └─  the only router; nothing crosses a bus without it
```

The car is a **2021 e-tron 55 quattro (GE)**. The gateway answers at `0x4010`, the tester at
`0x0E00`, and DoIP runs over Ethernet. Forty ECUs answer on `0x4000–0x40FF`; the report lists each
one with its part number, domain, bus membership, criticality and whether it is read-only or
read+write.

## What it found

Everything below was read from the car. Findings are numbered as they appear in the report's
*What I found* chapter, and each one is shown there with its evidence and why it matters.

- 🔑 **The cluster wants two writes before it accepts coding.** The coding write `2E 0600` is refused with `7F 2E 24` (request sequence error) until two other values are written in the same extended session. It needs no security access and no SFD token. No documentation I found mentions this order — once I knew it, every coding write I needed went through.
- 💡 **The taillight animation is sold as a licence.** It is a Functions-on-Demand feature: it needs a licence on the gateway plus one routing bit. The coding alone was not enough. The feature was already in the firmware; the car only needed permission to run it.
- 📋 **The car keeps a list of its feature licences.** The gateway holds them as a list, each with a state: locked, unlocked, or unlocked-but-inactive. Reading that list shows the light functions are licensed features, not just coding.
- 🔒 **A written licence also has to be activated.** Writing the licence is only half of it; the car also has to be told to activate it. The exact session and routine are part of what I am not publishing.
- 🧩 **The licence list is written as a whole.** It is written as a set, not one entry at a time, so a careless write can drop features the car already owns. The exact mechanism is part of what I am not publishing.
- 🚫 **The one finding I am not publishing.** There is a way the car's paid light functions get switched on. I worked out how the licence is written and activated, but I am not describing it here: it is a vendor-signed, paid feature, and I don't want troubles. If you want the feature, buy it from Audi.
- 🧰 **Seven modules reject a raw `0x14`.** Addresses `0x4013 0x4042 0x4044 0x4076 0x407B 0x407C 0x40B8` answer `serviceNotSupported` to a plain clear-fault command; they need the ODX-defined clear routine. A probe against every address showed 33 accept it and these seven do not.
- 🌩️ **A licence write produces a transient DTC storm.** Writing the licence triggers a burst of DTCs with status `0x2E` ("all ECUs restarted") until the car settles. It looks alarming but is expected.

**What I could not do, or chose not to.** Clear faults on those seven modules (reversible, but not a
priority). And I never wrote to the brakes, airbag, steering or any high-voltage module — I never
tried. A wrong coding can silently disable a safety system or brick an ECU that then needs a factory
tool to recover, so everything that *was* written was written only where it was reversible and
verified by reading the value back.

## How it works

The report is one self-contained page with no runtime network access. It is built from a single
dataset, and the build refuses to ship data that contradicts itself.

- **Everything is drawn from data, not hard-coded.** `data/etron.json` holds the modules, buses, topology, flows, scenarios and the UDS trace; `data/vehicle.json` holds the car's dimensions, battery, motors and body profile. The chapters render straight from that dataset.
- **One stage, pinned while the story plays.** A WebGL drawing (three.js) stays fixed on screen while the chapters scroll over it — under the skin, the gateway, the drawing, the scenarios — then the report continues below as text.
- **The body is optional.** The painted body is a licensed `.glb`; if it is absent the loader never enters the bundle and the car is drawn as a procedural hull. Nothing else changes.
- **Checks that can fail the build.** `build.py` validates the dataset before rendering: module ids are unique, every bus member agrees in both directions, LIN masters and slaves resolve, vehicle dimensions add up (front overhang + wheelbase + rear overhang = length), and the UDS trace obeys ISO 14229 (phases are contiguous, responses mirror requests, positive SIDs are `request + 0x40`, DIDs are echoed). A broken dataset stops the build rather than publishing a wrong drawing.
- **Self-contained output.** The build inlines the JS bundle, the CSS, the woff2 fonts, the data JSON and the base64 body model into a single `dist/index.html` — no CDN, no external references, and it fails if any appear.

## Reproduce it

**Build the report** (needs Python 3.12; no Node required):

```sh
python3 build.py            # minified, self-contained dist/index.html
python3 build.py --dev      # unminified bundle with an inline sourcemap
```

Build-time dependencies (esbuild and three.js) are pinned in `tools/vendor.py` and fetched on first
run, so the build needs network the first time but not Node.js. The output is a single
`dist/index.html` of about 2.1 MiB.

**Publishing.** [`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs `python3 build.py`
on a push to `main` and deploys `dist/` to GitHub Pages. `dist/` is git-ignored: CI always rebuilds
it from the committed sources, so a copy or CSS change cannot move a published figure.

**Screenshots.** `tools/shoot.py` drives a real browser over the built page and writes reference
shots under `tools/shots/` (git-ignored).

## Repository layout

| Path | What's there |
|------|--------------|
| `build.py` | The whole build: data checks, esbuild bundle, inlining, budget check |
| `src/` | Front-end: `index.html`, `main.js`, chapters, schematic, UDS trace, and the 3D `stage/` |
| `styles/` | `tokens.css` (themes, fonts) and `app.css` |
| `data/` | `etron.json` (modules, buses, flows, scenarios, UDS trace, findings) and `vehicle.json` |
| `assets/` | Inlined fonts (`fonts/`) and the optional body model (`model/`) |
| `tools/` | `vendor.py` (pinned build deps), `model.py` (body prep), `shoot.py` (screenshots) |
| `dist/` | The built site; not committed, the Pages workflow builds its own |

## Data

The car data — addresses, part numbers, bus membership, the UDS trace and the findings — was read
from the author's own 2021 e-tron through its diagnostic port. Positions, harness routes and bus
membership are inferred from each module's role and the platform's known layout, and drawn as such.

## Status

This is a personal teardown, published as a working edition. It is a drawing of how the car is
wired, not a guide to changing it: the one finding that would amount to unlocking paid features is
deliberately withheld. Corrections are welcome, especially ones that break a claim.

## Contact

Built by [Bogdan Radulescu](https://bogdan.nimblex.net/). Get in touch at
[bogdan@nimblex.org](mailto:bogdan@nimblex.org) or open an issue.
