# The Wired Car: redesign around a 3D engineering-drawing stage

## Objective

Rebuild `report/` so that the **car is the main event**. It becomes one to-scale, recognisable Audi e-tron (GE), drawn as an engineering drawing: axonometric line art, hidden lines, section and dimension lines, balloons and a parts list. It shows the gateway (the router), the five buses routed through a real harness, the traction motors, HV battery, doors, headlamps and rear light bar, radars and charge port, each tied to its ECU. Information flow is animated as packets moving along the harness and stopping at the gateway when they change bus. The rest of the page gets a restrained, editorial, modern design system in place of the current card-heavy 2024 look. The output stays one self-contained `dist/index.html` with no network requests.

### Findings that drive this plan (from the research)

| # | Finding | Source | Implication |
|---|---|---|---|
| 1 | Side and plan views use different position sources: the `MOUNT` table in code for side, JSON `location.top` for plan. They disagree (for example, the gateway is at 1700 mm vs ≈2156 mm) | `src/app.js:178-213`, `src/app.js:564-567` | Keep **one 3D position per module**, in data |
| 2 | The harness is vertical drops to an unrelated spine and ignores buses and the gateway. Flow arcs go ECU to ECU, bypassing the gateway | `src/app.js:572-600`, `src/app.js:625-639` | Model a real topology: buses → gateway ports → routed harness |
| 3 | Bus and domain palettes share hex values, so node colour changes meaning | `styles/tokens.css:39-54`, `src/app.js:39-43` | One channel per meaning: colour = bus only |
| 4 | Every click re-renders the whole SVG, which restarts animations | `src/app.js:641-677` | Keep the scene persistent and update state only |
| 5 | The schematic duplicates the gateway and multi-bus chips | `src/app.js:492-497` | Rebuild the schematic from the topology model |
| 6 | Fonts are named but never shipped; the page falls back to system-ui | `styles/tokens.css:9-10` | Self-host and inline woff2 files (rain-check already has OFL files, `src/web/atlas/atlas.css:7-11` there) |
| 7 | Content lives in code (`TIER`, `TRACE`, `ACCESS_GROUPS`, `COMPONENT`) | `src/app.js:764-774`, `src/app.js:994-1011` | Move it into `etron.json` so facts stay in data |
| 8 | No libraries and a single-file inline build | `build.py:48-55` | Adding three.js needs a bundling step, but the single-file output is kept |
| 9 | The honesty rule: positions are inferred and carry a confidence level | `data/etron.json:2-13`, `data/etron.json:1609-1622` | The drawing must show uncertainty visually, not hide it |

Priority of risks, highest first: (1) the car must *look like an e-tron*, which is the whole point of the request; (2) the topology must be honest, not decorative; (3) performance and size of a single-file WebGL page; (4) readability on mobile.

### Rendering decision: stay SVG, or not?

**Decision: hybrid. three.js (WebGL2) renders the car and harness. An HTML/SVG overlay renders all text, balloons, leaders and the inspector. SVG stays for the 2D system schematic, and also serves as the fallback and print output (the same 3D line data, projected).**

Why pure SVG is not enough:
- It can't give side, plan, front and axonometric views from one model, so they keep diverging (finding 1).
- It can't do hidden-line rendering, opening doors, exploded views, or a harness routed through the body in depth.

Why not a downloaded GLTF car:
- Licensing is unclear, and files are 5–20 MB against a single-file budget.
- Photoreal meshes fight the drawing style and need heavy cleanup.
- Proportions can't be verified against the real dimensions.

Why the hybrid works:
- The same pattern is proven in rain-check (WebGL stage, projected SVG marker overlay, chapter-driven camera: `design/proto/stage.js:414-508`, `design/proto/proto.js:616-624`).
- RTR slides supplies glow without postprocessing, exponential camera smoothing, a Canvas/SVG twin fallback and an fps watchdog (`components/glRenderer.ts:44-52`, `components/stageScene.ts:90-140`, `components/ParticleBackground.vue:94-105`).
- Text stays crisp, selectable, accessible and themeable.

### How it will look realistic

"Realistic" here means a **precise technical illustration**, not a photograph.

1. **A procedural body built from real dimensions.** Loft cross-sections along X, using:
   - the side profile (sill, beltline, shoulder, roof) and plan half-width tables (already started in `src/app.js:300-313`, `src/app.js:394-400`);
   - superelliptic sections with roof tumblehome.

   The hull mesh is used only for depth and faint tonal shading, never shown as a flat grey solid.
2. **Authored character lines** are drawn as 3D polylines, and they are what make it read as an e-tron:
   - the octagonal Singleframe grille with vertical slats and the four-rings plate;
   - the headlamp graphic with its LED signature;
   - the flared quattro wheel-arch blisters, the shoulder line, the coupé-tapered D-pillar and roof spoiler;
   - the **full-width rear light bar**, the charge flaps on the front fenders, the door cut lines and handles, the mirror, and multi-spoke 21" wheels with brake discs.
3. **Drawing grammar:**
   - Visible edges: solid, variable weight (silhouette thick, features medium, details thin).
   - Occluded edges: dashed at low alpha. This is a second depth pass with inverted depth test, the classic "hidden line" look.
   - Axis centrelines, section-cut hatching on the battery and floor, dimension lines with arrowheads.
   - An ISO-style title block, **numbered balloons** and a **parts list (BOM)** that is the module roster.
4. **An orthographic camera throughout,** with named shots: isometric/dimetric three-quarter (default), side elevation, plan, front, rear, **exploded** (systems lift out along Z with leader lines) and X-ray (body at 10 %, systems at full). Orthographic keeps it an engineering drawing and makes overlay projection exact.
5. **Components as simplified but correct solids:**
   - traction motors as stator/rotor cylinders on the axles, with the rotor turning when active;
   - the HV battery as a tray of 36 modules under the floor;
   - four doors hinged on their real axes that swing open;
   - headlamps and the rear bar that "light" (emissive stroke plus a soft beam cone);
   - radar cones, the OBD port, the gateway as a box with visible ports.
6. **Uncertainty drawn honestly.** High-confidence positions get a solid leader. Inferred ones get a dashed leader and a tolerance ring. The inspector states the basis.

## Implementation Plan

### Phase 0: Toolchain and data model (prerequisite)

- [ ] 1. **Add a minimal JS toolchain without losing the single-file output.** Add a `report/package.json` pinning `three` (the current release, ≥ 0.170 as in RTR slides) and `esbuild`. `build.py` stays the orchestrator: it calls esbuild to bundle `src/main.js` (ES modules, tree-shaken, minified) into a string and inlines it where `/*__APP_JS__*/` is now. *Why:* three no longer ships a UMD build, and tree-shaking keeps the page small.
- [ ] 2. **Self-host and inline the fonts.** Copy the OFL woff2 files (Inter variable plus JetBrains Mono 400/700, the same files rain-check uses) into `report/assets/fonts/` with their licence. `build.py` inlines them as base64 `@font-face` data URLs. Optionally add a technical-lettering face (for example osifont, ISO 3098 style) for drawing annotations only. *Why:* the current fonts never load (finding 6).
- [ ] 3. **Extend `etron.json` so it drives the whole drawing** (finding 7):
  - `modules[].location.mm {x,y,z}` replaces both `MOUNT` and `location.top`, keeping `confidence`/`basis`.
  - `components[]`: physical parts (headlamp L/R, rear light bar, doors FL/FR/RL/RR, front/rear motor, battery, charge flap(s), radars, OBD port, tailgate), each with `ecu` link(s), anchor mm, and a behaviour type (`swing`, `emit`, `spin`, `fill`, `sweep`).
  - `topology`: gateway ports per bus, `lin.master` (for example BCM2 → rear lights), and multi-bus nodes listed once.
  - `harness[]`: named routes as mm waypoints (left/right sill, centre tunnel, A-pillars, roof rail, tailgate, front-end carrier), plus which buses run along each.
  - `scenarios[]`: ordered steps, each naming flows/modules/components, a caption and a camera shot.
  - Also move `TIER`, `TRACE` and `ACCESS_GROUPS` here.
- [ ] 4. **Move the vehicle geometry into data:** `data/vehicle.json` with real dimensions, side and plan profile tables, section parameters and character-line definitions. Verify the key dimensions (L 4901, W 1935, H 1629, WB 2928, track widths, wheel size) against Audi technical data and record the source in `provenance`. *Why:* geometry becomes checkable and editable without touching the renderer.
- [ ] 5. **Harden the `build.py` validation:**
  - `buses[].members` ⊆ modules, and consistent with `modules[].bus`;
  - every component's `ecu` exists;
  - every harness route references known buses;
  - every scenario step references known ids;
  - the gateway is excluded from member lists;
  - a size budget (fail if `dist/index.html` is above ~1.2 MB).

  Print a per-asset size table.

### Phase 1: The engineering-drawing stage (main event)

- [ ] 6. **Scene core** (`src/stage/scene.js`): a WebGL2 renderer with an orthographic camera, render on demand (dirty flag, as in rain-check), capped DPR, and a pause when off-screen. Named shots with eased transitions: exponential smoothing and short-path rotation, honouring `prefers-reduced-motion`. Constrained orbit, zoom and pan for the explorer.
- [ ] 7. **Body generator** (`src/stage/hull.js`): loft the hull from the profile tables in `vehicle.json`, with wheel arches, greenhouse, and a separate door panel mesh per door so doors can swing. Only faint tonal shading.
- [ ] 8. **Line-art renderer** (`src/stage/lines.js`): fat lines (`Line2`/`LineMaterial`) for authored character lines plus silhouette/feature edges extracted from the hull. Two passes: visible solid, hidden dashed. Three line weights. All colours come from CSS custom properties, so themes restyle the WebGL scene (the pattern from rain-check `design/proto/stage.js:316-328`).
- [ ] 9. **e-tron identity details:** Singleframe octagon with slats, headlamp LED signature, full-width rear bar, quattro blisters, D-pillar taper, charge flap(s), wheels with spokes and discs. Review against reference photos at the side, front, rear and 3/4 shots until it reads as an e-tron at a glance. *Why:* this is the user's main complaint.
- [ ] 10. **Systems layer** (`src/stage/components.js`): motors, battery tray and modules, doors, lamps, radars, OBD port, and the gateway with labelled ports. Each ECU is a small housing with a connector stub at its `location.mm`. Each has a behaviour driven by selection or scenario (door swings, lamps emit, rotor spins, battery fills, radar sweeps).
- [ ] 11. **Harness and topology** (`src/stage/harness.js`):
  - Build bus wires as bundled 3D polylines along the `harness[]` routes, with each ECU's drop leaving the nearest route.
  - Every bus terminates at its gateway port.
  - LIN hangs off its master, not off the gateway.
  - Ethernet is drawn point-to-point/switched rather than as a shared line.
  - Colour means bus only (finding 3). *Why:* this makes the "router" visible and honest (finding 2).
- [ ] 12. **Packet flow** (`src/stage/packets.js`): instanced glowing sprites travel the arc-length of the harness path (additive halo plus core, the RTR technique). Speed is log-scaled to bus bitrate (LIN slow → Ethernet fast). A cross-bus flow is routed ECU → gateway (brief store-and-forward pause and a port flash) → other bus → ECU. Flow kinds are told apart by glyph and cadence (value = steady stream, command = single burst, power = thick orange HV line), not by a second colour.
- [ ] 13. **Overlay** (`src/stage/overlay.js`): HTML/SVG layer projected from 3D each frame.
  - Numbered **balloons** with leader lines that lay out into left/right label columns with collision avoidance (engineering callout style).
  - Hover shows the full label.
  - A tolerance ring and dashed leader for inferred positions.
  - Dimension lines and title block as crisp SVG.
  - Nearest-hit picking within N px.
- [ ] 14. **Explorer UI around the stage:**
  - Segmented view switcher (3/4 · Side · Plan · Front · Rear · Exploded · X-ray).
  - Layer toggles (body, hidden lines, harness, packets, labels).
  - Bus filter (colour chips), domain filter (text chips).
  - A **parts list / BOM** panel (item no., address, name, bus, criticality) that is keyboard navigable and two-way bound with the balloons.
  - An inspector side sheet: role, basis and confidence, address, part, buses, access, in/out flows with "play this flow".
  - Deep links through the URL hash (`#map/0x4076`).
- [ ] 15. **Scenario player** (from `scenarios[]`), which merges the old Map and Flow chapters. Suggested scenarios, drawn from existing flows:
  - "Unlock and open the door": key/BCM → door modules → lights.
  - "Press the accelerator": pedal → VCU → gateway → motors.
  - "DC fast charge": charge port → OBC/BECM → cluster via BAP.
  - "ACC follows a car": radar → zFAS → VCU/brakes.
  - "A tester reads an ECU": OBD/DoIP → gateway → ECU, which reuses the UDS trace.

  Steps advance by timeline scrubber, arrow keys or scroll, each with a caption and a camera shot.
- [ ] 16. **2D system schematic, rebuilt** (SVG): an ISO-style wiring diagram generated from `topology`. The gateway sits in the centre with ports, buses are orthogonal trunks, each node appears once with stubs to each of its buses, and LIN sits under its master. It shares selection and packet animation with the 3D stage. It is offered as a view tab and is the accessible alternative.
- [ ] 17. **Fallbacks and output:**
  - If WebGL2 is missing, or the fps watchdog drops below ~28 fps, switch to an SVG render of the same line data projected orthographically (the RTR twin approach).
  - Print CSS and a "Download drawing (SVG)" action use the same projector.
  - `<noscript>` shows a static note.

### Phase 2: Page-wide redesign

- [ ] 18. **New design system** (`styles/tokens.css` rewritten):
  - Two themes only: **Graphite** (dark, default: near-black warm grey, drawing lines in cool off-white) and **Vellum** (light drafting paper, blue-black ink, for print). Drop Garage, Blueprint and Oscilloscope.
  - One accent, e-tron orange, reserved for HV and live data.
  - Five distinct bus hues, tuned for contrast in both themes.
  - Criticality shown by ring weight and tick marks, not by hue.
  - A strict type scale: Inter variable with tight tracking for display, JetBrains Mono small caps for annotations.
  - A 12-column grid, a restrained spacing scale, and one easing curve.
- [ ] 19. **Page architecture as a scroll-driven story with a persistent stage** (the rain-check chapter pattern; sticky pinning in CSS, no scroll library):
  - The hero is the car **drawing itself on** (line draw-on) in 3/4 view, with a one-line thesis and live counters.
  - Chapter 01 X-rays the body to reveal ECUs and buses.
  - Chapter 02 hands over to the full explorer (pinned, interactive).
  - Chapter 03 runs the scenarios.
  - Later chapters dock the stage small or release it.
- [ ] 20. **Replace card soup with editorial layouts:**
  - Network chapter: a bus comparison as one aligned spec table with bitrate bars on a log scale, instead of five cards.
  - Modules: a dense sortable data table plus a **⌘K command palette** (native `<dialog>`, as in rain-check) that flies the camera to any ECU.
  - Criticality: one matrix (criticality × access) instead of four cards.
  - UDS: the privilege ladder as a step diagram, and the 16-step trace as a packet timeline (hex bytes, direction, latency) that plays tester → gateway → ECU on the stage.
  - Story: editorial prose with margin notes.
  - Remove gradient headline text, decorative glows and repeated callouts.
- [ ] 21. **Navigation and micro-interaction:** a slim top bar with a chapter progress rail, theme toggle and ⌘K hint. Consistent focus rings, tooltips, keyboard shortcuts (V view, H harness, P packets, arrow keys to step, Esc to close). Staggered reveal only where it explains something.
- [ ] 22. **Responsive and mobile:** under ~900 px the stage becomes a full-width non-pinned block, balloons collapse to numbers, the BOM and inspector become a bottom sheet, gestures are pinch/drag, and scenario steps become swipeable cards. Test at 360, 768, 1280 and 1920 px widths.
- [ ] 23. **Accessibility:**
  - Every ECU is reachable through the BOM and schematic by keyboard.
  - An `aria-live` region announces selection and scenario steps.
  - WCAG AA contrast in both themes.
  - Reduced motion jumps to end states and stops packets (they are shown as static arrows).
  - Colour is never the only channel: bus names are always on chips, with dash patterns per bus in the schematic.

### Phase 3: Quality gates

- [ ] 24. **Visual regression:** a Playwright screenshot script (modelled on `design/shoot.py` in rain-check / `scripts/shoot.mjs` in RTR). It captures every named shot, each scenario step, both themes and the mobile layout into `report/tools/shots/` for review.
- [ ] 25. **Performance and size checks:** measure first render, steady fps on an integrated GPU, idle CPU (it must be ~0 when nothing animates), and the bundle/font/data split in `build.py` output.
- [ ] 26. **Honesty review:** every drawn position traces to `location.mm` plus basis, every wire to `topology`/`harness`, and every animated flow to `flows[]`. The footer provenance is extended to cover the vehicle geometry and scenarios.

## Verification Criteria

- The default 3/4 shot is recognisable as an Audi e-tron without labels (grille octagon, rear light bar, blistered arches, roof taper). Checked against reference photos at side, front, rear and 3/4.
- Overall length, wheelbase, height and width measured in the drawing match `vehicle.json` within 1 %, and side, plan and 3/4 views place every module at the same `location.mm`.
- The gateway appears exactly once. Every bus terminates at a gateway port, LIN terminates at its master, no module is duplicated in the schematic, and `build.py` fails on any topology inconsistency.
- Every cross-bus flow visibly passes through the gateway. Selecting a door, lamp or motor ECU triggers the matching component behaviour (swing, emit, spin).
- Selecting in the BOM, a balloon, the schematic or ⌘K updates the same state without re-creating the scene (no restarted animations). The URL hash restores the selection.
- `dist/index.html` is self-contained (no external requests in the network panel) and under the size budget. Fonts render as Inter / JetBrains Mono.
- ≥ 55 fps while the stage animates on a mid-range laptop, ~0 % CPU when idle, and a working SVG fallback when WebGL is turned off.
- Lighthouse accessibility ≥ 95. All ECUs are keyboard reachable, and the page is usable with reduced motion and at 360 px width.
- The screenshot set covers every shot × theme × breakpoint and has been reviewed.

## Potential Risks and Mitigations

1. **The procedural body still looks generic.**
   Mitigation: put the effort into character lines rather than mesh detail, and iterate against reference photos at fixed shots (task 9). If it still fails, trace outlines from licensed or self-shot photos at known scale as spline guides. Keep the loft only for depth.
2. **Single-file size grows with three.js, fonts and geometry.**
   Mitigation: tree-shaken esbuild bundle, subset latin fonts, geometry generated at runtime from compact profile tables, and a size gate in `build.py`. Alternative: allow a two-file output (html + one hashed js) if the budget can't be met.
3. **Hidden-line rendering artefacts** (z-fighting, dashes crawling at shallow angles).
   Mitigation: polygon offset on the hull depth pass, screen-space dash sizing, and silhouettes precomputed per named shot for static views.
4. **Label clutter with 44 modules.**
   Mitigation: balloons as numbers only, full labels in the BOM and on hover. Label columns with leader routing, domain/bus filters, and progressive disclosure per scenario.
5. **Scroll-pinned WebGL is janky on mobile.**
   Mitigation: unpinned stage under 900 px, render on demand, DPR cap, fps watchdog to the SVG fallback.
6. **False precision: a beautiful drawing implies measured positions.**
   Mitigation: tolerance rings, dashed leaders and confidence badges, a persistent "positions inferred" stamp in the title block, and the basis text in the inspector.
7. **Scope creep across the whole page.**
   Mitigation: Phase 1 ships behind the current page first (map chapter only), then Phase 2 restyles the other chapters on the new tokens.

## Alternative Approaches

1. **Improved pure SVG (2.5D axonometric drawn by hand):** no dependencies and a tiny file. But views still diverge, there are no real hidden lines, doors and exploded views are fake, and it costs a lot of hand-tuning. Only suitable if a zero-dependency build is required.
2. **Licensed GLTF model plus edge extraction:** fastest route to realism, but licensing, file size and cleanup to get clean drawing lines are hard. The proportions can't be audited. Could be an optional build input (`assets/etron.glb`) that replaces the lofted hull while everything else stays.
3. **Raw WebGL2 shaders with no three.js (the rain-check style):** smallest bundle and full control, but you'd write fat lines, picking and camera maths by hand. Worth it only if the size budget is breached.
4. **Canvas2D projected line renderer (the RTR twin as primary):** light and crisp, but no depth buffer means no true hidden lines or occlusion. Kept as the fallback, not the main renderer.

## Assumptions

- The single self-contained HTML file stays a hard requirement. A small Node dev toolchain (esbuild, three) is acceptable because the output still needs no network.
- Audi trademarks (the four rings) appear only as a drawn outline on the grille plate. No official artwork is embedded.
- The existing content and wording are kept and moved into data. This redesign doesn't add new facts, except the verified vehicle dimensions.
- Flow semantics stay as currently curated in `flows[]`. Scenarios only sequence existing flows.
