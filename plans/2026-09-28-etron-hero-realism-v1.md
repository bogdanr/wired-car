# e-tron hero: from wireframe to a realistic technical illustration

## Objective

Bring the hero and the drawing stage up to the standard of the two references. The first is the Audi Q8 55 e-tron press illustration "Network of the chassis, brake and drive control system". The second is the dimensioned four-view blueprint. The car must be recognisably an e-tron at first glance, look like a real product render, and turn smoothly into the engineering drawing: X-ray, ECUs, harness, packets. The page must stay fast: 60 fps on an integrated GPU at 1440p, one self-contained HTML file, and no network access at runtime.

Expected outcome: three visual states rendered by one scene, all from the same geometry.
- **Studio**: a shaded, reflective car on a soft contact shadow. This is the hero.
- **X-ray**: glassy body, solid shaded components and a tube harness with orthogonal routing. This matches the press image.
- **Blueprint**: the current line drawing, with feature lines taken from the real surface.

## Diagnosis (from the current screenshots against the references)

1. **Proportions are wrong in the data.** `data/vehicle.json:6` sets `frontOverhang: 1000`. The blueprint gives 928 / 2928 / 1045, which adds up to the published 4901 length. Our front axle sits 72 mm too far back and the rear overhang is 72 mm too short, so the car looks nose-heavy. Every ECU position near an axle inherits the error (motor-front at x 1000, motor-rear at 3928).
2. **The front does not read as an e-tron.** The Singleframe is drawn as a tall box of vertical slats that sticks out forward. It looks like a BMW i7 or a Rolls-Royce. On the real car the grille is a wide, low, flat octagon. It has chamfered upper corners, sits between the lamps, carries a plate recess at the bottom, and has the vertical struts inset.
3. **A lofted hull cannot carry shading.** The hull built from `profile` tables is fine as a silhouette. Shaded, it looks lumpy, because the real surfaces (shoulder blisters, the tapered greenhouse, the concave lower door blade) cannot be expressed by six 1D tables. The press image looks realistic mostly because of its surfaces and lighting, not its lines.
4. **The body's shading and the lines fight each other.** The tyres behind the body show through as grey smudges (hero, rear-left). The mirrors float as boxes. The hood carries random construction lines.
5. **The hero annotation is noisy.** The 2928 and 4901 dimension texts sit on top of each other. The 1629 dimension is detached from the body. The eyebrow wraps onto two lines at a very wide letter-spacing. The four hero figures have mismatched label baselines.
6. **The X-ray lacks hierarchy.** The press image works because it shows few, solid, shaded parts, thin coloured wires routed at right angles along the floor, and light text callouts on vertical leaders. Ours shows about 40 translucent wire boxes, diagonal harness "spaghetti" and heavy boxed labels.

## Key decision: where the realistic geometry comes from

A realistic shaded render needs a real surface model. I recommend a **licensed, pre-segmented glTF model** of the e-tron (GE, 2019–2022), processed at build time into a compressed, embedded asset. The procedural construction stays as the no-model fallback and as the SVG/print path.

Why not keep improving the procedural hull: it would reach "good silhouette" at best, never the press-render look, and every hour spent on it is lost once shading is switched on.

Why this fits the constraints:
- meshopt compression via `gltfpack` brings a 60–90k-triangle car to about 0.8–1.3 MB.
- Decoding takes tens of milliseconds.
- `gltfpack` is a standalone native binary, so it can be vendored and hash-verified exactly like esbuild in `tools/vendor.py`. No Node is required.

## Implementation Plan

### Phase A: correct the reference data (needed by every option)

- [ ] A1. Correct the overhangs in `data/vehicle.json`: front 928, rear 1045, wheelbase unchanged. Add `rearOverhang`. Check the remaining blueprint figures against Audi's own published technical data before adopting them: rear track 1652 vs our 1651, the 2043 overall width in the rear view vs 2189 with mirrors, and the 800 mm load-sill height. Record the source of each value under `sources`. Rationale: the axles set the whole side view, and the blueprint is stock art (Alamy), so it can only guide us; Audi data must confirm it.
- [ ] A2. Move every module position, component anchor and harness node tied to an axle by the axle delta: motors, inverters, EPS, rear radars, and the chassis control unit. Keep a build check that motors sit on the axle lines. Rationale: positions must stay consistent with the corrected axles, or the honesty claims in the overlay fail.
- [ ] A3. Add a local-only reference-compare mode to `tools/shoot.py`. It renders orthographic side, front, rear and plan views at a known mm/px and lays them 50 % over a traced reference silhouette. The reference lives in a git-ignored folder and is never shipped. It reports silhouette overlap (IoU) per view. Rationale: "looks like an e-tron" becomes measurable, so progress can be checked.

### Phase B: the asset pipeline

- [ ] B1. Source the model under a licence that explicitly allows embedding in a public web page, where the file can technically be extracted. CC-BY, or a commercial licence with real-time/web redistribution, qualifies; standard "editorial render only" licences do not. Selection requirements:
  - separate nodes for the four doors, tailgate, both charge flaps and the four wheels;
  - a separate glass material;
  - under 300k source triangles;
  - the GE facelift-free front (octagonal grille with vertical struts).
  Record the author, licence and URL in `data/vehicle.json` `sources`, and credit it in the page footer. Rationale: the licence is the main risk, so it is settled before any engineering.
- [ ] B2. Add `gltfpack` (pinned version, sha256) to `tools/vendor.py`. Add a `tools/model.py` step that does the following:
  - normalises the model to the car frame (x behind the front bumper, y left, z up, mm) and scales it to the corrected length, width and height;
  - renames nodes to the component ids already in `data/etron.json` (`door-fl`, `tailgate`, `charge-l`, …);
  - collapses materials to a small fixed set: paint, glass, trim-black, chrome/aluminium, tyre, rim, lamp-lens, lamp-emitter, caliper;
  - removes the interior below a size threshold, keeping seats and the steering wheel as low-poly;
  - simplifies to a triangle budget of 70k (hero) with meshopt, 12-bit positions and octahedral normals.

  Output goes to a build cache, which `build.py` embeds as base64. Rationale: one reproducible, offline command, consistent with the existing toolchain.
- [ ] B3. Make `build.py` treat the model as optional. With a model present it embeds the model and the meshopt decoder. Without one it builds the current procedural car. Raise the size budget to 2.5 MiB when a model is embedded and print the model's share separately. Rationale: the report never breaks, and the size cost is visible on every build.
- [ ] B4. Derive a curated line set from the model at build time rather than at runtime:
  - silhouette-prone boundary edges;
  - creases steeper than about 35°;
  - panel gaps (edges between different nodes);
  - lamp and grille outlines (from material boundaries).

  Store them as compact polylines. Keep the hand-authored identity lines (Singleframe, four-bar DRL, light bar, lower blade), re-fitted to the model surface. Rationale: raw edges from a dense mesh draw thousands of noisy lines; a curated set is what makes a drawing read as a drawing. Build-time extraction also costs nothing at runtime.

### Phase C: rendering the three states (one scene, one pass)

- [ ] C1. **Lighting without assets.** Build the environment procedurally at startup: three's RoomEnvironment through PMREM, plus two soft area "softbox" strips placed to give the long highlight along the shoulder line seen in press shots. Use AgX tone mapping and sRGB output. Rationale: realistic reflections are what make paint read as paint, and this costs one PMREM bake at load with no texture download.
- [ ] C2. **Materials.** Each theme gets its own values:
  - Paint: metallic-roughness. Graphite uses a dark gunmetal close to Daytona grey; Vellum uses the light Glacier-white/grey of the press image.
  - Glass: dark, tinted, with a Fresnel edge.
  - Trim: satin black.
  - Rims: machined aluminium.
  - Calipers: e-tron orange, which ties the car to the page accent.
  - Lamp emitters: self-lit and driven by the existing `emit` behaviour, so DRLs and the rear bar actually glow.

  No clearcoat or transmission, which keeps the shader cheap. Rationale: this is the most visible realism gain for the least GPU cost.
- [ ] C3. **Contact shadow and floor.** Render a one-off top-down depth pass at load, blur it into a texture, and keep it static. Recompute only while doors are open. Add a faint radial floor reflection fade: a mirrored, low-opacity copy of the car's lower half, clipped at the tyres, shown only in the hero, with an option to switch it off. Rationale: grounding is what separates "render" from "model on a background". Baking it once removes any real-time shadow cost.
- [ ] C4. **X-ray material.** One custom shader for the body in the X-ray state. Opacity follows Fresnel, so edges stay visible and faces go clear. It uses a subtle screen-space dither instead of sorted transparency, and writes depth only for the silhouette shell. Wheels, brakes and the chassis stay solid, as in the press image. Rationale: sorted transparency on a 70k mesh is slow and full of artefacts; Fresnel plus dither looks like the reference and costs one pass.
- [ ] C5. **Blueprint state.** Hide the shaded surfaces. Draw the curated line set (B4) in three line weights plus dashed hidden lines, but only for the systems layer, not the body, to limit noise. Keep the existing drafting-sheet grid, title block and dimensions. Rationale: this keeps the engineering-drawing identity the user asked for originally.
- [ ] C6. **One-uniform transitions.** Drive studio → X-ray → blueprint with a single `look` value from 0 to 2, blended in the shaders: paint fades into Fresnel glass, and glass fades into lines only. Scroll beats set the target value. The existing draw-on intro becomes a scan plane that sweeps nose to tail, drawing lines ahead of it and resolving shaded paint behind it. Rationale: this is the showpiece moment of the hero, and it needs no extra geometry.

### Phase D: systems in the press-image style

- [ ] D1. Replace the translucent ECU wire boxes with small solid, shaded housings. Merge them into one instanced mesh so all ECUs cost one draw call.
  - Housings are bevelled boxes with a connector and rib detail, coloured by bus in a matte finish.
  - Size classes (small, medium, large) come from the module kind.
  - Power electronics (inverters, OBC, DC/DC) are drawn larger and in HV orange, as in the press image.
  - The gateway keeps its five port sockets.

  Rationale: solid parts give the X-ray a clear visual hierarchy.
- [ ] D2. Give the battery a proper slab: rounded housing, a visible 36-module grid, orange HV connectors at the front. Model both motors as housings with gearbox, half-shafts to the wheel hubs and a hint of subframe. All of these stay low-poly and procedural. Rationale: the press image's realism comes from recognisable drivetrain masses; procedural low-poly is enough under X-ray.
- [ ] D3. Re-route the harness orthogonally, as in the reference. Trunks run along the floor, sills and tunnel on a right-angle grid with filleted corners, and rise vertically to each ECU. Render the trunks as thin shaded tubes, one instanced tube mesh per bus, with the bus colour as a stripe. Keep packets riding the tube centrelines. The routing change lives in `harness` data only. Rationale: the diagonal routes are what make the current X-ray look chaotic.
- [ ] D4. Restyle callouts to the press convention:
  - a small dot on the part;
  - a hairline vertical leader to a baseline row above or below the car;
  - plain sans-serif text with no box, optional mono address, and a bus-coloured tick.

  Keep the boxes only for the selected item. Keep the existing collision relaxation in `src/stage/overlay.js:110-120`. Rationale: lighter annotation lets the car stay the main event.

### Phase E: hero composition and typography

- [ ] E1. Stage the hero shot like the press image, but with the page's own composition:
  - 3/4 front, camera about 18° up, with a very long lens (orthographic, or perspective at FOV ≤ 18°, to keep the "technical" feel);
  - the car fills about 58 % of the width, on the right, with a soft contact shadow and grille and DRLs lit;
  - a slow ±6° azimuth drift following the pointer, off under reduced motion.

  Rationale: first impression.
- [ ] E2. Keep exactly three hero dimensions (L 4901, WB 2928, H 1629), each on its own tier with extension lines touching the body. Show a small "1:20" scale bar. Fix the stacked labels by giving each dimension its own offset. Rationale: fixes diagnosis 5; dimensions become an accent, not clutter.
- [ ] E3. Typography fixes:
  - the eyebrow sits on one line, with tracking reduced to about 0.08em at that size;
  - the four hero figures get top-aligned values and single-line labels ("control units", "networks", "flows", "gateway");
  - the headline stays but is 8–10 % smaller at 1440 px, so the car gets more room.

  Rationale: fixes the visible layout defects.
- [ ] E4. Add a poster frame: show a pre-rendered blueprint SVG of the hero view (from the existing SVG export path) immediately, then cross-fade to WebGL once the model has decoded and the environment has baked. Rationale: good first paint while the model decodes, and no blank box.

### Phase F: performance guard-rails

- [ ] F1. Set budgets and enforce them in `tools/shoot.py`, which logs `renderer.info` per shot:
  - about 150k triangles in the hero, at most 60 draw calls;
  - a single render pass with MSAA and no post-processing;
  - DPR capped at 2 on desktop and 1.5 on mobile;
  - render on demand only (already the case), and pause when the stage is off-screen.

  Rationale: the user asked for decent performance explicitly, so the limits are written down and checked.
- [ ] F2. Tier by device. Low-power devices, detected by the existing frame-rate probe or by `devicePixelRatio × area`, get Studio without the floor reflection and with a lower-level-of-detail mesh (gltfpack second LOD at about 25k triangles). If WebGL2 is missing, show Blueprint as SVG. Rationale: graceful degradation instead of a slow page.
- [ ] F3. Time the model decode plus PMREM bake. The target is under 250 ms on a mid laptop. If it is slower, run the decode in a worker with the meshopt decoder's worker mode. Rationale: keeps the time to interactive short.

### Phase G: verification pass

- [ ] G1. Re-shoot the full review set in both themes and all sizes, plus new shots: `hero-studio`, `hero-xray`, `hero-blueprint`, and reference-compare views for side, front, rear and plan.
- [ ] G2. Re-run the build validation: topology, the new axle-alignment check, the size budget, and no external references. Confirm the licence credit is present in the output.
- [ ] G3. Check the frame rate at 1440p while scrolling through the hero, X-ray and explorer, and log the numbers.

## Verification Criteria

- Silhouette overlap with the traced reference is at least 0.95 for the side view and at least 0.92 for front, rear and plan.
- Front and rear axle centres are within ±5 mm of 928 and 3856 mm from the front bumper, and the build fails otherwise.
- The hero passes a blind "which car is this" check with no text visible (grille, DRL signature and light bar are recognisable). It is reviewed side by side with the press image in both themes.
- The hero uses ≤ 150k triangles and ≤ 60 draw calls. Frame time is ≤ 8 ms at 1440p on an Intel Iris Xe-class GPU, and ≤ 16 ms on a mid-range phone at DPR 1.5.
- A blueprint poster appears before first WebGL frame. Model decode plus environment bake takes ≤ 250 ms on a mid laptop.
- The single-file output is ≤ 2.5 MiB with the model and ≤ 1.2 MiB without it, and still has no external references.
- The licence and author credit appear in `data/vehicle.json` sources and in the page footer.
- Hero dimension texts never overlap at 1440, 1920, 820 and 390 px widths.

## Potential Risks and Mitigations

1. **No suitable model under a web-embeddable licence.**
   Mitigation: fall back to Alternative 1, a procedural hull v2 from traced sections, or commission or self-model a clean low-poly GE body in Blender (about 40k triangles, doors split). The pipeline in Phase B accepts any glTF, so only the source changes.
2. **The model's doors and flaps aren't separable.**
   Mitigation: make separated movable parts a selection requirement (B1). If that fails, do a one-time split in Blender, documented in `tools/model.py` notes, or drop swing animation for that part and highlight it instead.
3. **Tracing a stock blueprint creates derivative-work issues.**
   Mitigation: use it only as a local comparison overlay that is never shipped (A3). Take shipped dimensions from Audi's published technical data only.
4. **Real-mesh feature lines are too dense in the Blueprint state.**
   Mitigation: curate lines at build time (B4) with an angle threshold plus a minimum polyline length. Draw hidden lines only for systems (C5).
5. **Transparency artefacts in X-ray.**
   Mitigation: use a dithered Fresnel shader (C4) instead of sorted alpha, with solid chassis and wheels.
6. **File size and first paint regress.**
   Mitigation: meshopt, 12-bit quantisation, the poster frame (E4), the size budget enforced in `build.py`, and a second LOD for low-power devices.
7. **Theme mismatch: realistic paint looks wrong on the Vellum paper theme.**
   Mitigation: give each theme its own paint and environment exposure. Vellum uses the press-image light grey and a paler floor. Review both themes in G1.

## Alternative Approaches

1. **Procedural hull v2, no external model.** Author 18–24 cross-section curves (stations along x) from the front and rear views and loft between them with a proper surface (Catmull-Rom across stations). Add displacement curves for the shoulder blisters and the lower blade. Trade-offs: fully owned, about 30 KB, and fixes the silhouette and grille. But when shaded it stays visibly "CG sketch" rather than press render, and it takes several days of surfacing. Best if licensing blocks option B.
2. **Pre-rendered hero stills plus live systems.** Render the studio car offline (Blender Cycles) in a few fixed views, ship them as AVIF, and composite the live WebGL systems on top with a matching camera. Trade-offs: highest realism for the hero at a tiny runtime cost, but no free orbit in Studio, doors can't open, and still-to-live transitions need careful camera matching. Suitable as a hero-only layer on top of the recommended plan.
3. **Stay line-only and polish.** Fix proportions, grille and annotations only. Trade-offs: cheapest and fastest, but does not meet the "realistic, extremely visually appealing" bar the user set against the press reference.

## Assumptions

- The user accepts an embedded third-party model if its licence allows web embedding, and accepts a larger file (up to 2.5 MiB) in exchange for realism.
- Studio is the new hero default. Blueprint stays available in the explorer and for print and SVG export.
- The GE pre-facelift e-tron is the target (MY2021, matching the scanned car), not the Q8 e-tron shown in the press image. The press image is the reference for the illustration style only.
- Existing work from the earlier plan (data model, overlay, explorer, scenarios, chapters) is kept. This plan replaces its body and hero visuals and restyles systems and callouts.
