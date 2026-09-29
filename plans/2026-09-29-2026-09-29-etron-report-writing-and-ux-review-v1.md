# The Wired Car: writing and UI/UX review

## Objective

Make the report read as if one careful engineer wrote it (clear, accurate, no em dashes, no machine-sounding patterns), and make the interface legible, predictable and easy to explore. Recommendations are ranked by importance. The rationale for each rank is in the task text.

## Scope of the review

- Static prose: `src/index.html` (hero, beats 01 to 04, chapters 05 to 10, footer, palette)
- Generated prose: `data/etron.json` (meta, domains, buses, udsServices, privilegeLadder, module roles and `location.basis`, flow labels, scenario captions, udsPhases, udsTrace `say`/`meaning`, secrets, accessGroups)
- Prose inside code: `src/chapters.js:16-21` (criticality labels), `src/chapters.js:115` (matrix column captions), `src/chapters.js:132` (ladder "unlocks:" label), `src/main.js:317` (confidence labels), `src/main.js:139-142` (view and layer names), `src/trace.js:38-44`
- UI: `styles/tokens.css`, `styles/app.css`, interaction code in `src/main.js`, `src/chapters.js`, `src/trace.js`

## Assumptions

- British spelling stays (licence, colour, behaviour, centre). It is used consistently now.
- The author's voice should be first person singular, because the footer says "my own 2022 e-tron" (`src/index.html:319`).
- The single-file budget (`build.py:32`, 1200 KiB) still applies, so any added media must be small.
- The VIN model-year character and the duplicate airbag address are facts the author can check on the car. The plan says "verify" wherever the author has to confirm something.

## Implementation Plan

### Rank 1. Fix factual contradictions and overclaims (Writing)
The report's whole premise is "read from a real car". An expert reader will find these errors first, and each one weakens trust in everything else on the page.

- [ ] 1.1 Hero overclaim. `src/index.html:105-107` says every "address, part number and behaviour" was read from the car. The positions, harness routes and every entry in `flows[]` are inferred. `meta.note` (`data/etron.json:12`) and the footer (`src/index.html:319-321`) already admit this. Rewrite the hero lead to separate what was read from what was inferred.
- [ ] 1.2 "Teardown" (`src/index.html:103`, `src/index.html:319`). Nothing was taken apart. Call it a diagnostic scan or survey.
- [ ] 1.3 Model year. The VIN prefix `WAUZZZGE6MB` (`data/etron.json:5`) has `M` at position 10, which encodes model year 2021. The page says 2022 in `data/etron.json:6`, `src/index.html:103` and `src/index.html:319`. Verify against the registration documents and make all three agree.
- [ ] 1.4 "Forty computers". The count comes from `kind: "ecu"` (`src/chapters.js:33`), and it includes `0x40F1`, which the data itself calls a second logical address of the airbag unit, with the same part number (`data/etron.json:1276-1298`). Either say "40 diagnostic addresses" or count 39 physical units. Apply this to the headline, the title tag, the meta description, `meta.subtitle`, and the scenario and trace captions that say "forty".
- [ ] 1.5 F198/F199 naming conflicts. These DIDs have three different descriptions: "programming date and shop code" (`src/index.html:269`, and the order there does not match F198/F199), "service-interval DIDs" (`src/index.html:285-287`), and "service-interval parameter" and "service date" (`data/etron.json:2788`, `data/etron.json:2809`). In ISO 14229-1, F198 is the repair-shop code or tester serial number, and F199 is the programming date. The bytes `26 09 27` are also a date. Pick one correct name per DID and use it everywhere.
- [ ] 1.6 The privilege ladder's "unlocks:" label (`src/chapters.js:132`) renders the `blocks` field. The result is "unlocks: nothing yet" for the session step and "unlocks: swapping modules between cars" for component protection, which is the opposite of what that step does. Rename the field in the data and the label in the code so they say what each step allows or prevents.
- [ ] 1.7 SFD contradiction. The matrix column caption says writes are "behind SFD" (`src/chapters.js:115`). The ladder says SFD was not enforced on this car (`data/etron.json:242-243`). Make them agree.
- [ ] 1.8 Criticality framing. The heading "The more it can hurt you, the more locks it has" (`src/index.html:204`) describes the car's design. The data shows something else: read-only on critical modules was the author's own policy ("never attempted", `src/chapters.js:115`), and SFD was not enforced. Change the heading to describe the author's policy, or split the table into "refused by the car" and "not attempted by choice".
- [ ] 1.9 Confidence labels. `high` renders as "measured / certain" (`src/main.js:317`), but `meta.note` says the car exposes no location data, so nothing was measured. Use "known", "likely" and "rough".
- [ ] 1.10 Hero facts. The label "message flows" (`src/chapters.js:39`) implies captured traffic. Use "mapped flows" or "modelled flows".
- [ ] 1.11 Check that "Coming-home lighting" on unlock (`data/etron.json:2428`) should not be "leaving-home" lighting, which is what Audi calls the unlock sequence.

### Rank 2. Remove repetition and restructure the ending (Writing, IA)
Repetition is the biggest cause of both reader fatigue and the "AI wrote this" feel. The best material, the licence finding and the payoff, sits at the very end and is told four times.

- [ ] 2.1 The precondition finding appears in the trace intro (`src/index.html:242-243`), the trace captions, Note 2 (`src/index.html:285-289`) and secret 1 (`data/etron.json:2853-2857`). Keep the full version in one place (Note 2, next to the trace) and cut the rest down to cross-links.
- [ ] 2.2 The licence and payoff story appears in the chapter 09 heading, the chapter 09 lead, a bullet, Note 3 (`src/index.html:291-296`), secret 2 and secret 9. The heading and lead at `src/index.html:258-261` repeat each other almost word for word. Merge chapter 09 ("What we actually did") and chapter 10 ("The secrets") into a single findings chapter: what worked, what was blocked, then the notes. Delete "The payoff" as a separate secret.
- [ ] 2.3 Rename "The secrets" and "Nine things the manuals do not say" to something plainer, such as "Findings" and "What I learned by writing to the car". The lead at `src/index.html:305-306` says these findings appear "once you write to it", but two of the nine (the raw 0x14 clear and the DTC storm) are not about writing in that sense. Make the lead match the contents.
- [ ] 2.4 Mention the outcome in the hero (one sentence saying the taillight animation now runs). Readers then know why the drawing matters before they spend ten screens on it.
- [ ] 2.5 Rewrite the secrets' "Why it matters" lines, or drop them. Most restate the finding in slogan form (`data/etron.json:2857`, `2864`, `2892`, `2899`, `2913`). Keep a line only if it adds a consequence the reader could not have inferred.
- [ ] 2.6 Relabel the footer eyebrow "Revisions" (`src/index.html:318`). The paragraph under it is a methods and sources note. Then split `src/index.html:319-324` into two or three short sentences.

### Rank 3. Strip machine-sounding patterns and em dashes (Writing)
These are what the user specifically asked about. They are ranked third because fixing ranks 1 and 2 first will remove many of them anyway.

- [ ] 3.1 Remove every user-facing em dash (about 80). Locations:
  - `src/index.html:6`, `258`, `259-260`, `269`, `294`, `323`
  - `data/etron.json`: subtitle, domain blurbs, bus `why`, service roles, ladder details, 7 module roles, about 40 `location.basis` strings in the pattern "name — place" (swap the dash for a colon, or drop the redundant name), 6 flow labels and 4 scenario captions
  - `src/chapters.js:17-20` (the criticality `long` labels). `src/chapters.js:116` splits on `'— '`, so change the data shape (separate `label` and `gloss` fields) rather than just the character.
  - `src/main.js:310`, `333`, `422` use "—" as an empty-value placeholder. Replace it with "none" or "n/a", or with an en dash if a typographic placeholder is wanted.
- [ ] 3.2 Remove the "not X, but Y" antitheses. This is the most frequent tell on the page: "a licence, not firmware" (four times), "Power, not data", "by choice rather than failure", "not the animation", "the feature was not missing, the permission was", "by writing, not by waiting for firmware", "It is the difference between … and …". State the positive fact once.
- [ ] 3.3 Remove the fragment stacks and slogan closers: "No security access, no SFD token, no dwell time. Just a sequence." (`src/index.html:288`), "The honest version:" (`src/index.html:259`), "The precondition nobody documents", "The electric heart" (`data/etron.json:23`), "This rule shaped every decision in the project behind this page" (`src/index.html:206`).
- [ ] 3.4 Vary the headline formulas. "Forty computers. Five networks. One car.", "One language, nine verbs, four locks.", "Five radars, one picture" and "Read everything. Wrote the parts that mattered" all follow the same count-and-contrast pattern. Keep one (the hero, if wanted) and make the others plain declarative sentences.
- [ ] 3.5 Use one voice throughout. The page currently mixes "my own" (footer), "we found" (Note 2), "this project" (chapter 09 lead) and "Your tester" (`data/etron.json:1374`). Use first person singular for what the author did, and neutral third person for how the car works.
- [ ] 3.6 Clarity rewrites where a sentence is vague or wrong:
  - "changes wire" (`src/index.html:127`, `242`): say "crosses from one bus to another".
  - "The pulses that stop here are doing exactly that." (`src/index.html:130-131`): say what the reader sees.
  - "No single wire can carry a brake command and a radar stream at once" (`src/index.html:161`): Ethernet could carry both. The real reasons are cost, timing guarantees and fault isolation.
  - The three-clause run-on at `src/index.html:242-243`.
  - "reject a raw UDS 0x14 clear" (`src/index.html:278`, `data/etron.json:2897`): say "refuse the standard clear-fault-memory command (0x14)".
  - "42/42 FS-IDs unlocked", "the routing bit" and "the taillight animation" (`src/index.html:271-272`, `294`, `data/etron.json:2911`): say which animation, and what the routing bit is and where it lives.

### Rank 4. Define jargon on first use (Writing, UX)
The page assumes the reader already knows about 20 acronyms. That shuts out the curious non-specialist the scroll story is built for.

- [ ] 4.1 Expand on first use in the prose: UDS, DID, DoIP, ISO-TP, NRC, SFD, FoD, SWaP, FS-ID, ODX, BAP, DTC, ECU, zFAS, BECM, VCU, MLB evo, GE, HV.
- [ ] 4.2 Add `abbr` elements with titles, or a small glossary, rendered from a `glossary` entry in `data/etron.json` so the renderers can reuse it. Keep the glossary short and link to it from the chapter 08 heading.
- [ ] 4.3 "Hidden lines" (`src/main.js:142`) and "Proj" and "Sheet" in the title block are drafting terms. Keep them for the look, but give each a tooltip or title that explains it.

### Rank 5. Contrast and type size (UX, accessibility)
This affects every screen and fails WCAG AA. It is the top UI item because it hurts every reader, not only people exploring the drawing.

- [ ] 5.1 `--ink-3` measures about 4.1:1 on the dark background (`styles/tokens.css:58`) and about 3.5:1 on vellum (`styles/tokens.css:101`). `--ink-4` measures about 2.2:1 and 2.0:1 (`styles/tokens.css:59`, `102`). Both carry real content: eyebrows, table headers, bus-chip counts, axis labels, keyboard hints, matrix counts, title-block keys and captions. Raise `--ink-3` to at least 4.5:1 on both themes. Keep `--ink-4` for decoration only (rules, inactive ticks), and move any text that uses it up to `--ink-3`.
- [ ] 5.2 Raise the smallest text. `--t-micro` is 0.66rem (`styles/tokens.css:32`), and many rules go down to 0.56 to 0.62rem (`styles/app.css:311`, `387`, `376`, `395`, `528`, `591`). Set a floor of about 0.72rem (11.5px) for mono caps text and 0.8rem for anything a reader must read. Increase letter-spacing only where the uppercase text needs it.
- [ ] 5.3 Touch targets. `.icon.sm` is 32px (`styles/app.css:53`) and the seg buttons are 26 to 30px. Make them at least 40px on coarse pointers, using a `pointer: coarse` query.

### Rank 6. Stop yanking readers up the page (UX)
Selecting a roster row, a matrix chip or a bus row, or pressing "Show the read on the car", scrolls the reader back to the explorer, often several screens up. There is no way to return (`src/main.js:462-475`, `src/main.js:544-547`, `src/chapters.js:71`, `107-109`, `121`). The reader loses their place in the report at the moment they showed interest.

- [ ] 6.1 In the roster, show details in place first: expand the row, or open a side drawer that reuses `renderInspector`. Offer "Show on the car" as an explicit secondary action.
- [ ] 6.2 Whenever a jump does happen, show a floating "Back to [chapter]" pill that restores the previous scroll position. Clear it once the reader scrolls on their own.
- [ ] 6.3 Clicking anywhere in a bus-spec row currently triggers a jump (`src/chapters.js:71`). Give the row a visible "Show on the drawing" affordance, or give it proper semantics: a real button, plus a cursor and hover style that signal navigation.
- [ ] 6.4 Roster rows are `tr tabindex="0"` with click handlers but no role (`src/chapters.js:79`). Put a real button in the module-name cell, so screen readers announce it as actionable.

### Rank 7. Explorer onboarding and controls (UX)
The explorer is the centrepiece, but its instructions do not match what the reader sees.

- [ ] 7.1 The hint says "click a balloon" (`src/index.html:141`), but the Labels layer is off by default (`src/main.js:141`), so explore mode shows plain dots and no balloons. The roster lead also says item numbers "match the balloons". Turn Labels on by default in explore mode, or change the copy to "click a dot".
- [ ] 7.2 The `⌘K` hint is hard-coded (`src/index.html:27`). Detect the platform and show `Ctrl K` outside Apple devices.
- [ ] 7.3 Wheel zoom only works with Ctrl or Cmd held, or in full screen (`src/main.js:248-251`), and the page never says so. Add this to the hint line and to the zoom button titles.
- [ ] 7.4 The scroll runways are 190svh for explore and 230svh for scenarios (`styles/app.css:347-348`). Readers drag the car while the page scrolls under them, and the mode changes without warning. Shorten the runways and promote full screen ("Open the explorer") to a labelled primary button on the explore card. The icon in the tool cluster is easy to miss.
- [ ] 7.5 On screens under 900px the Layers control is hidden completely (`styles/app.css:752`), so mobile readers cannot hide the body or the harness. Move Layers into the bottom sheet, or into an overflow menu.
- [ ] 7.6 Tooltip placement clamps only horizontally (`src/main.js:262`). Add a vertical clamp so the tip never runs off the bottom of the stage.

### Rank 8. Scenario pacing (UX)
Every step lasts 5.6 s (`src/main.js:363`). Several captions run to 25 or more words, which is about 6 to 8 s of reading, so steps move on before a reader finishes. Playback also rolls into the next scenario on its own (`src/main.js:401`).

- [ ] 8.1 Set each step's duration from its caption length (a base time plus time per word), with a minimum and a maximum.
- [ ] 8.2 Pause while the player has hover or focus, and when the tab is hidden.
- [ ] 8.3 At the end of a scenario, stop and offer "Next: [title]" instead of switching automatically.
- [ ] 8.4 Trim the captions to one idea each (see 3.2 and 3.6). This also shortens the durations from 8.1.

### Rank 9. Show evidence for the payoff (UX, Writing)
The climax, "the taillight animation now runs", has no visual. Everything before it is richly drawn, so the ending falls flat.

- [ ] 9.1 Add a small poster frame, or a short, heavily compressed clip, of the animation to the findings chapter. Keep it within `BUDGET_KIB` (`build.py:32`), or give it its own budget the way the model has one (`build.py:227-228`).
- [ ] 9.2 Optionally, show a before-and-after of the decoded 0x3C00 record statuses, drawn in the same style as the trace diagram.

### Rank 10. Small polish
- [ ] 10.1 The tester's item number shows as "T" in the roster and the inspector, with no explanation (`src/chapters.js:80`, `src/main.js:325`). Add a legend entry or a title.
- [ ] 10.2 The ladder's colour ramp suggests escalating danger (`styles/app.css:570-571`), while the copy says SFD was not enforced. Mark "not enforced on this car" visually, for example with a muted style.
- [ ] 10.3 The brand subline "Audi e-tron · GE" (`src/index.html:21`): readers will not know that GE is the platform code. Expand it or drop it.
- [ ] 10.4 Remove the stray backup files (`src/index.html~`, `src/chapters.js~`, `styles/app.css~`, `data/etron.json~`), or ignore them, so they never ship by accident.

## Verification Criteria

- A search for "—" across `src/`, `data/` and `styles/` finds none in user-facing strings. Code comments are exempt.
- A search for the antithesis patterns (", not ", "rather than", "not the ") in `data/etron.json` and `src/index.html` returns only sentences that are literally about negation.
- The model year, the ECU count and the F198/F199 names agree everywhere they appear, including the title tag and meta description.
- `python3 build.py` passes all data checks, and the build stays within budget.
- Automated contrast check: every text colour token is at least 4.5:1 against `--bg`, `--bg-2` and `--surface` in both themes. No rendered text is below 11.5px.
- From the roster, selecting a module and returning brings the reader back to the same row in one action.
- In explore mode, the default view shows exactly what the hint line describes.
- No scenario step advances before its caption can be read at 200 words per minute.
- A reader unfamiliar with UDS can find the meaning of every acronym on the page within one click.

## Potential Risks and Mitigations

1. **Criticality text is parsed in code.** `src/chapters.js:116` splits `CRIT.long` on `'— '`. Removing the dash breaks the matrix row captions.
   Mitigation: store the label and the gloss as separate fields, and update both renderers together.
2. **Changing the ECU count breaks copy that hard-codes "40" or "forty".** The count appears in `src/index.html`, `data/etron.json` captions and `phase.repeat` ("×40 modules").
   Mitigation: derive counts from data wherever possible, and search for hard-coded numbers after the change.
3. **Raising contrast and type sizes can crowd the pinned stage panels and the title block.**
   Mitigation: re-run `tools/shoot.py` at the desktop and mobile breakpoints, and adjust `insetsFor` (`src/main.js:53-66`) if callouts collide.
4. **Media for the payoff can blow the single-file budget.**
   Mitigation: use a still image first. Add a clip only with a separate, enforced budget.
5. **Merging chapters 09 and 10 changes anchors** (`#story`, `#secrets`, `#note-2`) used by the rail (`src/main.js:502`) and `udsPhases.noteRef`.
   Mitigation: keep the old ids as aliases, or update the rail and the data references in the same change.

## Alternative Approaches

1. **Full copy rewrite in one pass versus staged fixes.** A single editorial rewrite of all prose gives the most consistent voice, but it is hard to review against the data. Staged fixes (facts, then structure, then style) are easier to check, but they touch some strings twice.
2. **Glossary as a separate chapter versus inline `abbr`.** A chapter is easy to maintain but pulls readers away from the text. Inline tooltips keep readers in place but do not work well on touch screens. A hybrid (inline expansion on first use plus a compact glossary at the end) covers both.
3. **Keep the jump-to-explorer model but add a return pill, or move details into the chapters.** The return pill is cheap and keeps one inspector. Details inside the chapters are better UX, but they duplicate the inspector UI.
