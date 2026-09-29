# "One real exchange": from a flat list of 16 arrows to a story you can read at a glance

## Objective

Redesign the UDS sequence diagram in chapter 08 (`src/index.html:238-246`, rendered by `src/chapters.js:133-147`, styled by `styles/app.css:576-603`, data in `data/etron.json:2661-2790`) so that a reader can see three things in a few seconds without reading all 16 rows:

1. A tester never talks to an ECU directly. Every message changes wire at the gateway: DoIP/Ethernet on one side, CAN on the other.
2. Reading is free. Two requests identify the module, and forty repeats of this made the inventory.
3. **The finding:** the coding write is refused (`7F 2E 24`), and it is accepted only after `F198`/`F199` have been written *in the same extended session*.

It stays one self-contained file with no new dependencies. It has to follow the page's colour rule (`styles/tokens.css:7-10`: colour means bus, and `--hv` is the only accent), work in both themes and in print, and be usable at 390 px.

## What is wrong today (from `tools/shots/trace.jpg` and the code)

Ranked by how much each one hurts the section's purpose:

1. **The finding is buried.** All 16 rows have equal weight and height (`styles/app.css:588`, 58 px each), so the diagram is about 1000 px tall. At 1440×900 the refused write (row 10) is at the bottom edge and the fix (rows 11-16) is below the fold. The section's headline point never appears on the first screen.
2. **No phases.** Connect, identify, write refused, precondition, write accepted: all of these run on as one list. The intro copy (`src/index.html:241-242`) promises two stories, and the diagram doesn't separate them.
3. **The key condition, "same extended session", isn't drawn.** `10 03` at row 03 is what makes rows 11-16 work, but nothing links them visually. Note 2 (`src/index.html:276-283`) has to explain it in prose.
4. **Colour means two things at once.** Green is used both for "positive response" and for some *requests* (`2E F198` and `2E F199` have `state: "ok"`, `data/etron.json:2743-2765`). So the green right-pointing arrows at rows 11 and 13 read as replies. Direction and outcome are packed into one `state` field.
5. **The wire change at the gateway, the lesson of chapter 02, is invisible.** Every through-arrow gets the same neutral hollow square (`styles/app.css:599`). The Tester→Gateway half (DoIP over Ethernet) and the Gateway→Cluster half (ISO-TP over CAN) look the same, although the page already has bus colours (`--bus-eth`, `--bus-can`) for exactly this.
6. **Row 02 is a pseudo-message.** "routes the request to the addressed ECU" is an arrow with no bytes, drawn before any request exists. It reads as a real frame.
7. **Inconsistent hex.** DIDs appear as `F198` in requests and `F1 98` in responses. `50 03 00 32 01 F4` is decoded only halfway (P2 = 50 ms, but P2* = 5000 ms from `01 F4` is left out). Bytes, meaning and notes all sit on one centred line (`styles/app.css:591`) with `overflow: hidden; text-overflow: ellipsis`, so long rows can get clipped silently.
8. **The lane header doesn't stay on screen.** `.seq-lanes` is `position: sticky` inside an `overflow-x: auto` box (`styles/app.css:577-578`), so it sticks to that box and not to the page. Once you scroll past row 3 you lose track of which line is which.
9. **The "Play it on the car" button promises more than it does.** It plays the 3-step `diag` scenario (`src/main.js:540-543`, `data/etron.json:2618-2659`), which covers only the read. The write story, the point of the section, is never played. The button also leaves the section.
10. **Mobile and accessibility.** There is no rule for this section at or below 899 px, so `min-width: 720px` (`styles/app.css:578`, `styles/app.css:583`) forces sideways scrolling on phones. Arrows are CSS-only, and the `who` field (`data/etron.json:2664` etc.) is never rendered, so a screen reader hears "01 DoIP routing activation…" with no sender or receiver. `t.what` is also injected as raw HTML (`src/chapters.js:145`), unlike the `esc()` used everywhere else.
11. Minor: the step number sits 8 px above its arrow (`styles/app.css:589` top 26 px vs `styles/app.css:594` top 34 px). The step number is also in a class named `.seq-t` ("time"), which suggests timestamps that don't exist.

## Design

### Structure: five phases, the finding first

```
 ┌ Tester ─────────── DoIP · Ethernet ───────── Gateway ───── CAN · ISO-TP ───── Cluster ┐
 │ A  CONNECT         routing activation ──────▶ □                                         │
 │ B  IDENTIFY  ×40   22 F187 ─────────(eth)────▶ □ ──────(can)──────▶                     ┃ ← extended
 │                    ◀ ─ ─ ─ ─ 62 F187 "4KE920795D" ─ ─ ─ ─ ─ ─ ─ ─ ─                     ┃   session
 │                    22 F19E  …  62 F19E "EV_DashBoardAU65X"   [collapsed pair]          ┃   (10 03)
 │ C  WRITE           2E 0600 ───────────────────────────────────────▶                     ┃
 │                    ◀ ─ ─ 7F 2E 24  requestSequenceError ✕ ─ ─ ─ ─                        ┃
 │ D  PRECONDITION    2E F198 … ▶  ◀ 6E F198      2E F199 … ▶  ◀ 6E F199   [Note 2 ↗]    ┃
 │ E  WRITE AGAIN     2E 0600 ▶   ◀ 6E 0600 ✓   read back ✓                                 ┃
 └──────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Phase bands** down the left margin: letter, short title, and a one-line gist, drawn like the zone labels on the drawing sheet. Each phase is its own group, so spacing and rules separate the story beats.
- **Request/response pairs as the unit.** A request is a solid arrow. Its reply is a **dashed return arrow** (the UML convention) directly under it, with tighter spacing inside a pair than between pairs. This alone tells direction apart without colour.
- **Wire colour by segment.** The half of each arrow between Tester and Gateway uses `--bus-eth` and is labelled "DoIP · Ethernet" once in the header. The half between Gateway and Cluster uses `--bus-can`, labelled "CAN · ISO-TP". The gateway marker becomes a small two-colour port (like the ports in chapter 02, `styles/app.css:343-346`). Colour keeps meaning "bus", as it does everywhere else on the page.
- **Outcome by glyph and weight, not by hue on the arrow.** A positive response gets a small ✓ tick in `--ok`, as in `.ticks` (`styles/app.css:610`). The negative response `7F 2E 24` is the one row with the `--hv` accent (a tinted row background plus a ✕), because it is the page's single "stop" moment, the same way the danger note uses `--hv` (`styles/app.css:549`).
- **Session activation bar.** A thin vertical bar on the Cluster lifeline from `50 03` to the last row, labelled "extended session · 0x03". Rows 11-16 fall visibly inside it. This draws Note 2's key condition.
- **The gateway as an annotation, not a message.** Row 02 is removed as an arrow. Its content ("logical address rewritten, DoIP → ISO-TP") becomes a small note on the gateway lifeline at the first through-message.
- **Message typography in three columns.** Hex bytes in mono with consistent byte spacing (`2E F1 98 …`, with the service and DID emphasised). The meaning in sans ("ReadDataByIdentifier · spare part number"). The note as a quiet mono tag. The decoded response value (`4KE920795D`, `EV_DashBoardAU65X`) is shown as a quoted "value chip", because those values are the payoff of the read.
- **Collapse the repetition.** The `F19E` pair is shown collapsed under `F187` with a "×40 modules" badge on phase B, and can be expanded. This cuts the height by about 30%, so phases C-E fit on the first screen at 1440×900.
- **Cross-reference.** Phase D carries a "Note 2" tag that links to `#story`'s note. Note 2 gets a back-link, so the diagram and the prose support each other instead of repeating each other.

### Interaction

- **In-place stepper replaces "leave the section".** The button becomes "Step through". It reveals and highlights one pair at a time (the rest dims, as the schematic's focus does at `styles/app.css:420`), shows a one-line caption, and supports ←/→ and space. A secondary text link, "Show the read on the car", keeps today's jump to the `diag` scenario, so nothing is lost.
- **Hover or focus a pair** to highlight both of its arrows and its phase.
- **Reduced motion:** there are no reveals and every row is shown. The stepper only moves the highlight.

### Responsive (≤ 899 px)

The layout switches to a **vertical message log**, not a scaled-down diagram. Each pair becomes a card showing sender → receiver as two small lane pills, with the Ethernet and CAN hop shown as a two-colour mini bar, then the hex, then the meaning. Phase headers become sticky section dividers, and the session bar becomes a continuous left border over the cards inside the session. There is no horizontal scrolling.

## Implementation Plan

- [ ] Task 1. **Restructure `udsTrace` in `data/etron.json:2661-2790`.** Replace the mixed `state`/`what` HTML with explicit fields: `phase` (A-E), `dir` (req/resp), `outcome` (positive/negative/none), `sid`, `did`, `data` (bytes), `meaning`, `value` (decoded answer), `note`, `from`, `to`. Add a small top-level `udsPhases` list (id, title, gist, optional `repeat: 40`, optional `noteRef`) and a `session` object (opened-by index, label). Delete the byte-less row 02 and carry its text as a gateway annotation. Complete the `50 03` decode (P2 = 50 ms, P2* = 5000 ms). Rationale: direction and outcome are separate facts, and structured bytes allow consistent formatting and no raw HTML. **Status: Not Started**
- [ ] Task 2. **Extend `validate()` in `build.py:147-150`.** Check that every trace row names a known phase, that `dir`/`outcome` are valid values, that every `req` is followed by a `resp` with the same `from`/`to` pair reversed, that a response's SID equals request SID + 0x40 or is `7F <sid>`, and that the session opener index exists. Rationale: this keeps the diagram honest the same way the rest of the dataset is protected, and catches typos like `F1 98` vs `F198`. **Status: Not Started**
- [ ] Task 3. **Rewrite the renderer at `src/chapters.js:133-147`.** Output one grouped structure per phase containing request/response pairs. Drop the raw-HTML `what`, escape everything, and format hex through a single helper. Keep it pure DOM like the rest of the file. Also emit a visually hidden sentence per message ("Tester to cluster, through the gateway: ReadDataByIdentifier F187") from `from`/`to`. Rationale: phases and pairs are the new unit of reading, and the screen-reader text fixes problem 10. **Status: Not Started**
- [ ] Task 4. **Header lanes with wire labels.** Put the "DoIP · Ethernet" and "CAN · ISO-TP" segment labels between the lane headings in bus colours, and make the header sticky relative to the page. On desktop that means replacing `overflow-x: auto` on `.seq` (`styles/app.css:577`) with `overflow-x: clip`, and giving `.seq-lanes` `top: var(--bar-h)`. Rationale: fixes problem 8 and states the wire change once, where the eye starts. **Status: Not Started**
- [ ] Task 5. **Arrow system in `styles/app.css:590-602`.** Draw solid request arrows and dashed return arrows. Colour the two arrow halves with `--bus-eth`/`--bus-can` via the existing `[data-bus]` → `--c` pattern (`styles/app.css:35-40`). Use a two-colour gateway port marker and outcome glyphs (✓ in `--ok`, ✕ plus a tinted row in `--hv`, only on the `7F` row). Remove the `.s-ok` and `.s-gate` arrow recolouring. Rationale: colour goes back to meaning "bus" and outcome becomes a glyph, which fixes problems 4 and 5. **Status: Not Started**
- [ ] Task 6. **Message typography.** Split `.seq-msg` into hex, meaning and note columns. Use a value chip for decoded answers, align the step number to the arrow baseline, and rename `.seq-t` to reflect "step". Allow wrapping to a second line instead of an ellipsis. Rationale: fixes problems 7 and 11, and the answers become the visual payoff. **Status: Not Started**
- [ ] Task 7. **Phase bands and pair spacing.** Build the left-margin phase column (letter, title, gist, "×40" badge on B, "Note 2" link on D) with tighter spacing inside a pair and more between pairs and phases. Rationale: this creates the story structure behind problems 1 and 2. **Status: Not Started**
- [ ] Task 8. **Session activation bar.** Draw it on the Cluster lifeline from the `50 03` response to the end, labelled "extended session · 0x03". Rationale: this makes the undocumented precondition visible, fixing problem 3. **Status: Not Started**
- [ ] Task 9. **Collapse the repeated read.** Show the `F19E` pair collapsed under `F187` behind a `<details>`-style toggle, with the "×40" badge. Rationale: brings phases C-E above the fold at 1440×900. **Status: Not Started**
- [ ] Task 10. **Stepper.** Replace the button in `src/index.html:244` with "Step through" plus a secondary "Show the read on the car" link that reuses `src/main.js:540-543`. Add step state, a caption line, ←/→/space keys, pair dimming, and a reduced-motion fallback. Use no `requestAnimationFrame` loop, only class toggles. Rationale: the action plays the whole story in place, fixing problem 9. **Status: Not Started**
- [ ] Task 11. **Cross-links with Note 2.** Link phase D to Note 2 (`src/index.html:276-283`) and add a back-link from Note 2 to `#trace`. Trim the intro copy (`src/index.html:241-242`) to one sentence that names the three takeaways. Rationale: the diagram and the prose support each other without repeating each other. **Status: Not Started**
- [ ] Task 12. **Mobile message log.** At `@media (max-width: 899px)` (`styles/app.css:659`), switch to stacked pair cards with lane pills, a two-colour hop bar, sticky phase dividers, and the session shown as a left border. Remove the `min-width: 720px`. Rationale: fixes horizontal scrolling on phones. **Status: Not Started**
- [ ] Task 13. **Print and themes.** Check Vellum and print (`styles/app.css:727-734`): expand all pairs, show every row, hide the stepper, and keep the dashed returns and glyphs legible in monochrome. Rationale: the report is also a print document. **Status: Not Started**
- [ ] Task 14. **Screenshots.** Add `trace-vellum`, `trace-step` (stepper on the `7F` row), `trace-expanded` and `mobile-trace` next to the existing `trace` entry in `tools/shoot.py:51`, and review each one. Rationale: visual regressions are the main risk. **Status: Not Started**

## Verification Criteria

- At 1440×900, when the section heading reaches the top of the viewport, the `7F 2E 24` row and the start of phase D are visible without scrolling.
- The collapsed diagram is at least 30% shorter than today's (about 1000 px).
- No request arrow is drawn in green or orange. Every arrow half is coloured only by its bus (Ethernet or CAN). The only `--hv` element is the negative-response row.
- Every response is a dashed arrow directly under its request, and the build fails if a request has no matching response or the SID arithmetic is wrong.
- Hex is formatted the same way everywhere: `F198` appears in the same form in the request and the response.
- The session bar visibly spans every row from `50 03` to the final `6E 06 00`.
- The lane header stays visible while scrolling through the diagram on desktop.
- The stepper visits every pair with ←/→, works with reduced motion, and never leaves the section. The car link still starts the `diag` scenario.
- At 390 px there is no horizontal scrolling, and every message is readable.
- A screen reader announces the sender, receiver and meaning of each message.
- No raw HTML from the data reaches the DOM unescaped.
- The page stays self-contained with no external references, and its size grows by no more than about 6 KiB.

## Potential Risks and Mitigations

1. **Colouring the arrow halves by bus implies transport facts the data may not state explicitly.**
   Mitigation: take the segment labels from `D.topology.diag` and the cluster's `bus: ["can"]` (`data/etron.json:388-397`), not hard-coded strings, and mark the ISO-TP/DoIP split as "schematic" with the existing provenance wording if it isn't sourced.
2. **Collapsing F19E hides a row that is quoted in the story ("F187 and F19E", `src/index.html:262`).**
   Mitigation: keep the value chip `EV_DashBoardAU65X` visible on the collapsed row, and show the toggle as "+1 read".
3. **The sticky header fails because an ancestor has overflow set.**
   Mitigation: desktop uses `overflow-x: clip` (which doesn't create a scroll container), and mobile uses the stacked layout, which needs no sticky lanes.
4. **The data schema change breaks other consumers of `udsTrace`.**
   Mitigation: the only consumers are `src/chapters.js:138` and `build.py:147` (the `.js~` backup is not built). Update both together.
5. **The design gets busier: phases, bars, glyphs and chips all at once.**
   Mitigation: use a strict hierarchy (hex and value chips at full ink, everything else `--ink-3`), hairline rules only, and a review against the drawing-sheet look of the rest of the page in both themes.

## Alternative Approaches

1. **Keep the diagram and only fix what's broken** (consistent state colours, sticky header, hex formatting, remove row 02): about a day of work and low risk, but the finding stays below the fold and the story stays flat.
2. **Annotated hex log instead of a sequence diagram** (a terminal-style transcript with margin notes and phase headers): very compact, and it prints well. It loses the gateway as a visible middle station, which is what ties this section to chapters 02 and 05.
3. **Play the whole trace on the car/schematic** by extending the `diag` scenario with the write steps (paths only, which the validator allows, `build.py:141-143`): cinematic, but it takes the reader away from the bytes, and the 3D stage can't show the session condition. Better added later as the secondary "Show on the car" link.
4. **Two separate diagrams, "The read" and "The write"**: very clear, but it repeats the lanes and the session opener, and the key point, that the write depends on the same session, is weakened when the diagrams are split.

## Assumptions

- The byte values in `data/etron.json:2661-2790` are real captures and stay unchanged. Only their structure and formatting change. P2* = 5000 ms is derived from `01 F4` in 10 ms units (ISO 14229-2).
- There are no real timestamps, so none are shown. Step numbers stay.
- `--hv` for the single negative response follows the page's existing "danger" convention (`styles/app.css:549-550`).
