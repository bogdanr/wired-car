# System schematic redesign: from a membership table to a real network schematic

## Objective

Replace the current System schematic (`src/chapters.js:171-227`, styles at `styles/app.css:394-414`) with a diagram a reader recognises as a network or electronics schematic in a couple of seconds:

- the gateway sits in the centre as the router;
- each bus is drawn in its **real topology**: CAN and CAN FD as terminated two-wire lines, FlexRay as a star around the gateway's star coupler, Ethernet as a switch with one link per port, and LIN as a single wire hanging off its master;
- every ECU is drawn once, as a component block with a pin for each bus it is on;
- standard schematic symbols are used, with a legend, so no reader has to guess what a line or dot means;
- hovering or selecting shows exactly how that module reaches the rest of the car, and a message flow can be traced through the gateway.

It stays SVG, one self-contained file, with no new dependencies.

## What is wrong today (from `tools/shots/schematic.jpg` and the code)

1. **It reads as a spreadsheet, not a network.** There are 40 rows with dots on vertical lanes (`src/chapters.js:203-219`). It is about 1000 px tall and has to be scrolled to see the whole thing.
2. **The topology is wrong on paper.** Ethernet and FlexRay are drawn as shared lanes, although the data calls them a switched star and an active star (`data/etron.json:113`, `data/etron.json:145`, `data/etron.json:1933-1936`). CAN has no terminations, so it doesn't look like a CAN bus.
3. **Crossings and connections look alike.** Every row's stub line runs across all the lanes up to its right-most bus (`src/chapters.js:216`). Only a dot tells a connection apart from a crossing, and the Ethernet lane runs through all the powertrain rows it has nothing to do with.
4. **LIN is an orphan.** Its header has no port, and the line starts partway down the table (`src/chapters.js:191-195`). The local LIN sub-buses behind the matrix headlamps and 0x4064 (`data/etron.json:1946-1950`) are not shown at all.
5. **Multi-bus modules are hard to spot.** The gear selector 0x4053 (CAN + CAN FD) and the three CAN + local-LIN modules look like every other row.
6. **Labels are truncated** ("Front drive-motor control module (…"), and the domain legend in the top right (`src/index.html:172`) isn't connected to anything in the diagram.
7. **Nothing moves.** Flows and scenarios exist in the data but the schematic can't show a single message path.

## Design

### Layout (desktop, landscape, fits in about one viewport: 1280 × 720 viewBox)

```
            ┌──────────────── CAN comfort / body (16) ────────────────┐
  ⏚120Ω ════╪══╪══╪══╪══╪══╪══╪══╪══╪══╪══╪══╪══╪══╪══╪══╪═══ 120Ω⏚
            [ ][ ][ ][ ] … block row above / below the line …   [BCM2]──LIN──[rear lights]
                                   ║
   FlexRay star (7)   ┌────────────╨────────────┐   Ethernet switch (8)
   [EPS]──┐           │   GATEWAY 0x4010         │          ┌──[zFAS]
   [MK C1]┼──◇ star ──┤  CAN  CANFD  FR  ETH LIN │── switch ┼──[radar]
   [ELV]──┘  coupler  │   store · check · forward│          └──[…]
                      └────────────╥────────────┘
  ⏚120Ω ════╪══╪══╪══╪══╪══╪══╪══╪══╪═══ 120Ω⏚  CAN FD powertrain (9)
            [VCU][BECM][inverters]…[gear selector ⇄ also on CAN]
   ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ vehicle boundary ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
   [OBD socket] ── DoIP ── (laptop / tester, off-board)
```

- **Gateway block** in the centre, drawn like an IC: one labelled port per bus on the face closest to that bus. The FlexRay star coupler and the Ethernet switch are drawn *inside* its outline, since the data places them there, with a "schematic" footnote.
- **Linear buses (CAN, CAN FD):** a double line (CAN-H / CAN-L) with a 120 Ω termination symbol at each end. Nodes sit on short stubs with junction dots and alternate above and below the line to save width. **Nodes are ordered front → rear by `location.mm.x`**, with a small "FRONT ← → REAR" axis, so the schematic keeps a clear link to the car drawing.
- **Stars (FlexRay, Ethernet):** point-to-point spokes from the coupler or switch, one per node. There are no junction dots on the spokes, because each is its own link. This is exactly what makes a star look different from a bus.
- **LIN:** a single-wire line from the master pin on BCM2 (0x408B) to its slave (rear lights), marked **M** and **S**. The local LIN sub-buses are short single-wire tails on 0x4064, 0x4096 and 0x4097, labelled "local LIN".
- **Multi-bus modules** (0x4053 today, and any added later) are drawn once and placed between their two buses, with one pin for each bus. They must never appear twice.
- **Diagnostics:** the OBD socket, then DoIP, then the gateway, with the tester outside a dashed "vehicle boundary". This shows the reader that the only way in is through the gateway.
- **HV power is not drawn.** This is a data-network schematic, and the car drawing already shows HV. A one-line note points to it.

### Symbols and styling

- **Component block:** a rounded rectangle with the address in mono on a header strip, and the name on up to two lines instead of being truncated, using the full-name tooltip. A small domain glyph and a criticality tick sit in the corner. Colour always means **bus only**, as on the rest of the page; the domain is shown by the glyph, never by colour.
- **Wire conventions:** a junction dot means a connection, and a plain crossing means no connection. Crossings get a small gap (the "hop" convention) wherever the layout can't avoid them. Wire weight goes up with bitrate, from LIN thin to Ethernet thick, so speed can be read at a glance and matches the packet speeds in the 3D view.
- **Symbol legend** built into the drawing's title block: junction, crossing, 120 Ω termination, star coupler, switch, LIN master/slave, off-board device, and "schematic / inferred". It replaces the domain word list (`src/index.html:172`).
- Both themes (Graphite and Vellum) come only from existing tokens, and print cleanly in Vellum.

### Interaction (the "intuitive" part)

- **Hover or focus a module:** its pins, stubs, bus and path to the gateway light up and the rest dims to about 20%. A compact card shows the name, address, buses, and the number of flows in and out.
- **Hover a bus** (its line or legend chip): the whole bus lights up and the card shows speed, topology and the "why" text (`data/etron.json:67` etc.).
- **Click a module:** keeps today's behaviour (`hooks.showModule`, jumps to it on the car). Shift-click, or the card's "trace flows" button, animates its flows on the schematic.
- **Trace mode:** a small scenario picker above the diagram reuses `D.scenarios`. Packets travel sender → bus → gateway port → (pause: store-check-forward) → bus → receiver. Messages that stay on one bus skip the gateway pause, and LIN goes master → slave. It uses the same timing rules as `src/stage/packets.js`, so the 3D car and the schematic tell the same story.
- **Reduced motion:** the paths are drawn statically, with no travelling packets.
- **Keyboard:** roving tabindex. The arrow keys move along a bus, and Tab moves between buses and the gateway. Enter selects a module, Esc clears.

### Responsive

Below about 900 px the diagram switches to a **stacked** layout rather than scrolling sideways. The gateway card sits at the top, followed by one panel per bus, each drawn in its own topology (line, star or chain) at phone width. They are the same symbols and data, just arranged vertically.

## Implementation Plan

- [ ] Task 1. **Pull the layout out of `renderSchematic`.** Split `src/chapters.js:171-227` into a pure layout function (data in, positioned blocks, ports, wires, crossings and bounding boxes out) and an SVG renderer. Rationale: the layout can then be tested and reused for the stacked mobile variant, and the renderer stays simple.
- [ ] Task 2. **Linear-bus layout for CAN and CAN FD.** Sort members by `location.mm.x`, alternate them above and below the line, compute stub x-positions with a minimum pitch, and place 120 Ω symbols at both ends. Rationale: this is the most recognisable bus form, and ordering front to rear ties the schematic to the car.
- [ ] Task 3. **Star layouts for FlexRay and Ethernet.** Fan the spokes from coupler and switch nodes drawn inside the gateway outline, spread over an arc or column, and route them at right angles with rounded corners. Rationale: this shows the star topology the data already states and removes the fake shared lanes.
- [ ] Task 4. **LIN and local-LIN.** Draw the master and slave chain from `D.topology.lin` and the local tails from `D.topology.localLin`, with M/S pin marks. Rationale: this fixes the orphaned lane and shows sub-buses that are currently invisible.
- [ ] Task 5. **Multi-bus placement.** Detect modules with more than one bus, place them in the band between those buses, give them one pin per bus, and add a layout check that every module is drawn exactly once. Rationale: it removes the "which row is on two buses?" guessing.
- [ ] Task 6. **Diagnostic path and vehicle boundary.** Draw the OBD socket, DoIP and the tester outside a dashed boundary, from `D.topology.diag`. Rationale: it makes "the gateway is the only way in" visible.
- [ ] Task 7. **Symbol set and wire conventions.** Add small reusable SVG `<symbol>`s (block, termination, coupler, switch, junction, hop, M/S, off-board), bitrate-scaled wire weights, and crossing hops wherever the layout reports one. Rationale: standard notation is what makes the diagram read like a schematic.
- [ ] Task 8. **Legend and title block.** Replace the domain word list with the symbol legend and a mini title block (buses, module count, "schematic" provenance note), and update the intro copy in `src/index.html:166-174` to describe the new drawing. Rationale: a legend is part of every engineering drawing and makes the diagram self-explanatory.
- [ ] Task 9. **Hover and focus highlighting.** Add module-, bus- and gateway-path highlighting with dimming, plus the info card. Use CSS classes on the root, not a re-render. Rationale: highlighting is the fastest route to "intuitive", and toggling classes avoids the re-render problem the old map had.
- [ ] Task 10. **Trace mode.** Add a scenario picker and packets animated along the schematic wire paths, using the same routing rules as the 3D stage (a gateway pause for cross-bus messages, none for same-bus ones), `requestAnimationFrame` only while playing, and a static fallback for reduced motion. Rationale: it connects the schematic to the "In motion" chapter and explains routing better than any caption.
- [ ] Task 11. **Stage sync.** Clicking still calls `hooks.showModule`. Also highlight the schematic node when a module is selected elsewhere (parts list, palette), through a small `highlight(id)` export. Rationale: one selection model across the page.
- [ ] Task 12. **Stacked mobile layout.** At ≤ 900 px use the per-bus panel arrangement from the same layout output, with no horizontal scrolling. Rationale: the current `min-width: 680px` (`styles/app.css:395`) forces sideways scrolling on phones.
- [ ] Task 13. **Accessibility.** Roving tabindex, arrow-key navigation along buses, an `aria-label` per block ("0x4076 Vehicle Control Unit, CAN FD"), a text summary of the topology for screen readers, and visible focus rings. Rationale: every ECU must stay reachable by keyboard, as on the rest of the page.
- [ ] Task 14. **Styles.** Rewrite the `.sc-*` rules in `styles/app.css:394-414` and `styles/app.css:620` for blocks, wires, symbols, dim and highlight states and the stacked mode, using tokens only and checked in both themes and in print. Rationale: this matches the page's design system and the "colour means bus only" rule.
- [ ] Task 15. **Build check.** In `build.py`, fail if any module is missing from the schematic or appears twice, or if a bus member has no position for ordering. Rationale: the schematic stays honest as the data changes.
- [ ] Task 16. **Screenshots.** Add `schematic`, `schematic-hover` (VCU), `schematic-bus` (FlexRay), `schematic-trace` (doors scenario, mid-flight), `schematic-vellum` and `mobile-schematic` to `tools/shoot.py`, and review each one. Rationale: visual regressions are the main risk.

## Verification Criteria

- At 1440 × 900 the whole schematic is visible without scrolling inside the section: one viewport high, compared with about 1000 px today.
- Each bus is drawn in the topology stated in `data/etron.json`: two terminated linear buses, two stars at the gateway, and one master/slave LIN chain plus three local-LIN tails.
- Every module in `D.modules` that has a bus appears exactly once. 0x4053 appears once, with a CAN pin and a CAN FD pin. The build fails otherwise.
- No wire passes through a block. Every unavoidable crossing has a hop, and every connection has a junction dot.
- No label is truncated with "…" at desktop width.
- Hovering the VCU dims everything except its CAN FD stub, the CAN FD bus and the gateway port. Hovering FlexRay lights all seven spokes.
- The doors scenario shows the BCM1 → door-module messages staying on CAN (no gateway pause), and the BCM2 → rear-lights message going out over LIN.
- Keyboard only: every module can be reached, selecting it jumps to it on the car, and Esc clears the selection.
- At 390 px wide there is no horizontal scrolling, and every bus panel is readable.
- The page stays one self-contained file with no external references, and the size grows by no more than about 15 KiB.

## Potential Risks and Mitigations

1. **The 16-node CAN bus gets too wide or cramped.**
   Mitigation: alternate nodes above and below the line and allow two-line names. If it still doesn't fit, split the comfort CAN visually into "front" and "rear" segments of the same bus, joined through, not as two buses.
2. **Termination placement could imply facts we don't have.**
   Mitigation: draw the terminations at the ends of the line only, not tied to named ECUs, and note "termination: standard practice, physical location unknown" in the legend.
3. **The star coupler and switch inside the gateway are schematic, not verified.**
   Mitigation: reuse the existing provenance wording (`data/etron.json:1663`) as a footnote and mark them with the "schematic" symbol.
4. **Hand-written layout code becomes brittle as the data changes.**
   Mitigation: keep the layout generic (driven by topology type, with pitch and collision checks) and back it with the Task 15 build check and the screenshot set.
5. **The animation costs performance next to the 3D stage.**
   Mitigation: run `requestAnimationFrame` only while a trace is playing and the section is on screen (IntersectionObserver), and animate only the packet transforms.
6. **Front-to-rear ordering fights ordering by domain.**
   Mitigation: physical order along each bus wins, and the domain is shown on each block by its glyph. If readers find it confusing, domain grouping can be an optional sort.

## Alternative Approaches

1. **Automatic graph layout (ELK / elkjs, or dagre):** gives orthogonal routing for free, but elkjs is about 1.5 MB (it would break the size budget) and it can't express "terminated bus line" or "star inside the gateway". The result would look generic. Not recommended.
2. **Improve the current matrix:** add hops, fix LIN, and draw stars as fans at the top. Cheap, but it is still a table, and tables don't read as networks. That fails the "intuitive" goal.
3. **Render the schematic in the WebGL stage** (a flat "schematic" camera shot): one engine and seamless morphing from car to schematic, but it loses crisp text, print, accessibility and the separate chapter. It could be added later as a transition, on top of the SVG schematic.
4. **Zone-architecture view** (group nodes by where they sit in the car, front / cabin / rear): intuitive physically, but it duplicates the car drawing and hides topology, which is this section's job.

## Assumptions

- The schematic stays a static-page chapter in SVG. It does not have to morph from the 3D stage.
- HV power wiring is left out of this diagram because the car drawing covers it.
- The reader is technical but not an automotive engineer, so symbols follow common electronics and network conventions, not a specific OEM drawing standard.
