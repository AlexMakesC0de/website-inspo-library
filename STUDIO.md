# Studio — design generation by natural selection

> Planning document, written 2026-07-26 so a fresh session can pick this up
> without re-deciding anything. **Phases 1 and 2 are built and verified.**
> Phase 3 is next. Read "State of play" first, then "Principle 0", then skip to
> Phases.

---

## State of play — Phase 2, 2026-07-26

**The inspector is shipped, and it lives in a workspace tab of its own.** Open a
design from the board or the Final step and it opens at `view.html` with the
page full-bleed under one 44px bar: reload and a page switcher on the left;
zoom, comment, present and edit on the right. Press Edit and the panel comes in
on the right — click anything to change its type, colour, space and motion,
double-click to rewrite its words. Every change goes into the file on disk
within a second, and Revert restores the page the generator wrote.

New files: `view.html` and `assets/workspace.js` (the tab), plus
`assets/inspector-frame.js` (injected into the page) and `assets/inspector.js`
(the panel). `server.mjs` gained `?inspect=1` injection, `GET/POST …/edit`,
`POST …/revert`, `GET …/pages` and `GET/POST/DELETE …/comments`; `studio.mjs`
gained `saveEdit`, `revertEdit`, `isEdited`, `listPages` and the comment store.
`DESIGN.md` gained the Workspace Bar and Inspector Panel components.

### The workspace

- **Reload** re-fetches the design. Useful when Claude Code has been editing the
  same file from the other direction.
- **Pages** is one control over two groups: the HTML pages this design contains,
  then the other designs in the project. The first group reads the folder rather
  than assuming one page, so a design that ever comes back as home + about needs
  no change here; the second is the jump you actually want when you are looking
  at one design full-screen.
- **Zoom** sizes the frame up and scales it down — 50% gives the page a viewport
  twice as wide, the way a browser's own zoom behaves, rather than a smaller
  picture of the same layout. ⌘− / ⌘+ / ⌘0.
- **Comment** arms the same picker the inspector uses, and a pick opens a
  composer instead of the panel. A comment is a landmark on an element: it is
  kept in `project.json`, keyed by the same selector the inspector uses, and is
  **never written into the page** — an exported design carries none of them.
  Pins are numbered, follow their element through every scroll, and open their
  thread when clicked.
- **Present** hides the chrome in this tab, goes fullscreen, or opens the clean
  page — with no chrome and no inspector — in a new tab. Pins disappear while
  presenting; a design being presented has no annotations on it.
- **Edit** does not reload the frame. The page is always served with
  `?inspect=1` and the injected script sits dormant until something arms it, so
  toggling a mode never costs the scroll position.

**The modal viewer no longer edits.** It kept its job — comparing four designs
and picking one — and hands editing to the workspace rather than trying to be
both in a dialog that was too small for it. Two ways to edit the same file was
the confusing product.

**Edits propagate between tabs.** A save broadcasts on the existing SSE channel,
and a studio tab re-keys that variant's preview — but only once it is looked at
again, because reloading a preview nobody is watching is how the board ended up
flickering the first time round.

### How an edit reaches the file

This is the decision worth not re-litigating.

1. The panel never touches the frame's DOM. The page is sandboxed without
   `allow-same-origin` — see the Phase 1 note about keeping generated pages out
   of the library document — so the injected script owns the DOM and the panel
   owns the file. They talk over `postMessage`.
2. Each edit is recorded as `selector → property → value`, where the selector is
   an `#id` anchor if there is a unique one and an `:nth-child` chain otherwise.
3. On save the panel **re-fetches the file, parses it inert with `DOMParser`,
   applies the recorded edits to that, and writes the whole document back.** It
   does *not* serialise the live document. No generated page carries a script
   today, but the moment one does — a clock, an observer — serialising the live
   DOM would bake a little more runtime state into the file on every write.
4. Values are written as inline `style` attributes, which is why the panel
   accepts any CSS value: `clamp(2rem, 5vw, 4rem)` typed into Size keeps a page
   fluid where `34px` would freeze it.

Three consequences, all deliberate:

- **The first save normalises the file's HTML.** `crossorigin` becomes
  `crossorigin=""`, `&` becomes `&amp;`, `<path/>` becomes `<path></path>`. It
  is a parse-and-serialise round trip and it is idempotent — verified
  byte-identical across three saves — but the first diff is bigger than the
  edit. The alternative was writing an HTML parser, which is not worth it.
- **An inline style beats a `:hover` rule and a media query.** That is inherent
  to a visual inspector; the fluid-value escape hatch above is the answer.
- **`index.baseline.html` is written next to the page before the first edit.**
  Revert is a file copy, never an attempt to undo in reverse. A re-roll into
  that slot deletes it, because it belongs to a design that no longer exists.

### Two things the plan called for that the build changed

1. **The panel is docked, not floating.** The plan drew a draggable,
   minimisable panel over the page. A panel that occludes the design you are
   judging is a panel you spend the session moving. It takes 320px from the
   right of the workspace instead and minimises to a rail. Below 900px it moves
   underneath.
2. **Text commits `textContent`, never `innerText`.** Caught in testing:
   `innerText` returns the words as *rendered*, so committing an edit under a
   `text-transform: uppercase` rule burned the uppercase permanently into the
   source. The words in the file are now the words you typed.

### Gotchas Phase 2 added

- **`blur` fires for the element losing focus, not the one gaining it.** The
  first version ended each in-place text edit on the same tick it started,
  because `focus()` blurred whatever held focus and the capture-phase listener
  took that as "done". Check `ev.target === editing`.
- **`.insp__f input` outspecifies `.insp__swatch`.** The colour swatch stretched
  to full width and squeezed its value field to nothing. It needs
  `.insp__f input.insp__swatch`.
- **Do not probe for the baseline with a `HEAD` request.** A 404 is the honest
  answer but it logs a console error every time the inspector opens, in the one
  tool whose job is inspecting pages. `GET …/edit?path=` answers instead.
- **`[hidden]` loses to any author `display`.** `.insp` and `.ws__composer` both
  set `display: flex`, so both ignored the attribute and showed on load. This
  interface shows and hides half of itself by `hidden`; there is now one global
  `[hidden] { display: none !important }` near the top of the stylesheet.

### Verified

Selection and breadcrumb climb, live apply, autosave (~700ms after the last
keystroke), undo, reset element, revert, minimise, arrow-key nudging, path
traversal refused, invalid HTML refused, and a clean console throughout. In the
workspace: the page switcher across both generations, zoom at every step,
commenting and pin persistence across a reload, pins hidden while presenting,
all three present modes, editing without a reload, and a board tile in another
tab re-keying itself after a save. The file served without `?inspect=1` carries
no trace of any of it.

## State of play — Phase 1, 2026-07-26

**Phase 1 is shipped, working, and verified end to end.** A brief goes in, four
complete landing pages come out in parallel, you pick one, four restylings of it
come out, you pick the final. Verified with a real run: `builds/a-landing-page-
for-a-small-batch-coffee-roaster/`, four genuinely divergent concepts, and four
restylings that kept 100% of the winner's copy while changing the world
completely.

Cost and time, measured at `sonnet` with `--effort high`: **~3.5 minutes and
~$1.80 per round of four.**

New files: `studio.mjs` (the generator), `assets/studio.js` (the surface),
`/api/studio/*` in `server.mjs`, `builds/` for output. `index.html`,
`assets/app.js` and `assets/styles.css` gained tabs and the studio view.
`DESIGN.md` gained three documented type steps and four component entries.

### Two failures worth remembering, both fixed

1. **Generation 2 silently invented pages.** Each variant ran in its own folder,
   so it could not `Read` the winner in a sibling folder. Three variants failed
   loudly; the fourth built an entirely new page from the brief instead — same
   subject, same voice, different page, and completely invisible in a thumbnail.
   Restyles now run from the project root, *and* the output's copy is diffed
   against the winner's. Below 60% overlap is reported as failed rather than
   offered as a choice. Measured: a real restyle scores 100, the invented one
   scored 20.
2. **The board rebuilt every tile on every poll**, reloading all eight iframes
   every five seconds and leaking a ResizeObserver per tile. Tiles are now
   reconciled against a signature and reused.

Also fixed: a re-pick or regeneration of generation 1 now invalidates
generation 2 (those pages are restylings of a winner that no longer exists);
interrupted runs are reaped at server start so a Ctrl-C cannot leave a board
spinning forever; and the studio keeps polling slowly when idle, so a run
started from the CLI or another tab is not invisible.

### Gotchas a fresh session will otherwise rediscover

- **`--permission-mode acceptEdits`, not `dontAsk`.** `dontAsk` denies `Write`
  outright. `capture.mjs` gets away with it only because it just reads.
- **`motion.mjs` and any browser QA share one gstack browse daemon.** Run them
  at the same time and the second one silently steals the browser out from
  under the first. Symptoms look like an app bug and are not.
- **The generator never sees a screenshot or a URL.** Generation 1 has no `Read`
  tool at all. That is deliberate — see Principle 0 — not an oversight.

### Not done

- `.impeccable/design.json` is stale relative to `DESIGN.md`. Run
  `/impeccable document` to resync the design hook.
- Nothing in the repo is committed.

## The goal

Stop the back-and-forth. Today, making a website means many rounds of prompting
Claude Code, describing what's wrong, and waiting. The studio replaces that with
**selection**: generate several complete designs at once, pick the one that's
closest, generate variations of *that*, pick again, then adjust the winner
directly in the browser instead of describing changes in prose.

```
prompt + references ──▶ 4 full landing pages ──▶ pick 1
                                                   │
                        4 restylings of the winner ◀┘ ──▶ pick 1
                                                   │
                              live inspector: type, colour, size,
                              text, spacing, transition timing
```

Fewer tokens, far less describing, and the taste input is Alex's own library
rather than whatever the model reaches for by default.

---

## Principle 0 — inspiration, not replication

**This is the one that governs every other decision.** It is an *inspo* library,
not a replica library. The output should feel like it learned from the
references, not like it copied them.

Concretely, for the generator:

- References contribute **character, principles and moves** — never layout.
  "Halftone dot texture over warm paper, mono labels used as apparatus" is the
  useful part. "Nav pill top-centre, headline lower-left, three-column footer"
  is not, and must not be transplanted.
- **Never reproduce a reference's structure.** If a generated page could be
  mistaken for a reference with the copy swapped out, it has failed.
- Combine across references rather than following one. Each of the four variants
  should draw on the set *differently*.
- The generated page must be honestly new. Alex is building his own sites, not
  clones of other people's.
- Ask the generator to state, in one line, which references influenced what —
  so a variant that leaned too hard on one is visible immediately.

### What this means for motion data

Motion capture (`motion.mjs`) exists and has run over the library, but its role
is **narrower than originally built**. Treat it as a *character signal*:

- Useful: "snappy micro-interactions, 150–400ms, no scroll choreography" versus
  "cinematic, scroll-driven, Lenis + GSAP + Lottie".
- Useful: which libraries a site leans on, and whether it respects
  `prefers-reduced-motion`.
- **Not** useful: a per-element timing spec to rebuild from.

**Known defect — fixed.** The `coverage` field overstated itself. Crav Burger
was labelled `full` and its summary asserted "nothing loops or animates on
scroll" — the site is in fact full of easing the measurement missed. The label
read as authoritative and was not.

- Levels are now `signal` (a character read) and `thin` (barely anything
  measured). `full` is gone; nothing was ever full. An out-of-range value from
  the model collapses to whichever of the two the data supports.
- The condense prompt now asks for a *character* paragraph plus example
  timings, and forbids claiming absence: "no scroll animation was measured" is
  allowed, "nothing animates on scroll" is not.
- Every reader states the caveat before the content — `search.mjs`, the detail
  sheet, and the generator's reference brief.
- `node motion.mjs --refresh` re-run after the prompt change.

---

## Confirmed decisions

Settled with Alex; do not reopen.

| Decision | Choice |
|---|---|
| Unit of a generated design | **Full landing page** — hero + 3–5 sections + footer, one scrollable page |
| Reference selection | **Auto-search from the prompt, then Alex adjusts** before generating |
| Variants per generation | **4** (default, configurable) |
| Generation 1 varies | **Concept** — different worlds, different structures |
| Generation 2 varies | **Visual world only** — winner's layout kept; type, palette, texture, motion change |
| Inspector may edit | Type, colour, size, spacing, text content, transition timing |
| Inspector may **not** | Replace images. Assets come from Higgsfield separately |
| Model access | Headless `claude -p`, same as capture — no API key, uses the existing subscription |

---

## Architecture

Everything reuses the pattern already proven by `capture.mjs`: fan out to
headless Claude Code, validate the result, write it to disk, let the browser
watch the file and update itself.

```
builds/
  <project-slug>/
    project.json            prompt, chosen references, generations, winner
    g1/{a,b,c,d}/index.html four concepts
    g2/{a,b,c,d}/index.html four restylings of the g1 winner
    final/index.html        the picked design, inspector-editable
```

Each `index.html` is **self-contained** — inline CSS, no build step, no
dependencies — exactly like the library app itself. That keeps them viewable in
an iframe, editable by the inspector, and copyable straight out.

### Generation

1. Alex types a prompt in the Studio tab.
2. `search.mjs --json` runs against the library; top matches are proposed.
3. Alex adds or removes references, then hits generate.
4. **Four `claude -p` calls in parallel**, each with:
   - the prompt,
   - the chosen references (recipe, copy brief, tags, motion *character*),
   - Principle 0 stated explicitly,
   - a **different structural angle per variant** so the four genuinely diverge
     rather than being four samples of the same idea.
5. Each writes its own `index.html`. Progress streams to the browser over the
   existing SSE channel.
6. Four-up iframe comparison, hero viewport visible, click to expand and scroll.

Budget roughly 60–120s per variant; run them concurrently, show each as it lands
rather than waiting for all four.

### The inspector

A `<script>` injected into generated pages **only when served by our server**, so
the exported file stays clean.

- Click any element → floating panel, minimisable, draggable.
- Editable: font family / size / weight / letter-spacing / line-height, colour,
  background, padding, margin, border-radius, transition duration and easing,
  and text content (inline, `contenteditable`).
- **No image replacement.** Out of scope by decision.
- Changes apply live, then persist back into the source HTML through a server
  endpoint — so a reload keeps them and the file stays the source of truth.
- Undo stack, and a reset-element button.

### Tabs

The app gains top-level navigation, styled in the existing Pressroom Index world
(mono labels, hairline rules, square corners — see `DESIGN.md`):

| Tab | Purpose |
|---|---|
| **Library** | What exists today — the reference grid |
| **Studio** | Prompt, reference adjustment, generation, selection |
| **Builds** | Every project built, openable and re-editable |

---

## Phases

Each phase is independently useful. Ship in order.

**Phase 1 — the selection loop. SHIPPED.** Studio tab, auto-search plus
adjustment, four parallel generations, comparison board, pick a winner,
generation 2, pick a final. *Done when Alex can go from a sentence to a chosen
landing page without writing a prompt to Claude Code.*

Built as `studio.mjs` (generator), `/api/studio/*` in `server.mjs`, and
`assets/studio.js`. Two notes on what the build changed:

- **The board is two across, not four.** Four tiles at this page width are
  380px each — too small to judge a landing page by, which is the only thing
  they exist for. Two-up at ~760px is the smallest that still lets you decide.
- **Generation 2 is verified, not trusted.** A restyle that cannot read the
  winner will cheerfully build a whole new page from the brief instead: same
  subject, same voice, different page, and invisible in a thumbnail. It
  happened on the first run. The generated copy is now compared against the
  winner's and a variant below 60% overlap is reported as failed. Measured: a
  genuine restyle scores in the nineties, an invented page scores 20.

**Phase 2 — the inspector. SHIPPED.** Element picker, edit panel, live apply,
persist to file, undo. *Done when a colour, a typeface and a transition can be
changed on the final design without touching an editor.* See the Phase 2 state
of play above for how an edit reaches the file and what the build changed.

The sandbox stayed sealed as the plan asked: board tiles and the viewer are both
still `sandbox="allow-scripts"` with no `allow-same-origin`, and the inspector
crosses by `postMessage`. Asset frames are safe — a `<figure class="asset">` has
element children, so text editing is refused on it and the panel says why.

Editing is available on any variant, not only the final one. It costs nothing
extra and an edited generation-1 winner is a legitimate thing to want; note that
generation 2 will restyle whatever the file says at the time it runs.

**Phase 3 — the Builds tab. NEXT.** Browse past projects, reopen, re-edit,
duplicate, delete, export a folder. *Done when a project can be found and
reopened a week later.*

What Phase 2 leaves in place for it:

- `builds/<project>/` may now contain `index.baseline.html` next to an edited
  page. An export must not ship it, and a duplicate must carry it along or drop
  it deliberately — copying the page without its baseline silently removes the
  ability to revert.
- `isEdited(project, path)` already answers "has this page been touched", which
  is the flag a Builds list wants next to each variant.
- `project.comments` is a flat list keyed by page path. A Builds row wanting an
  open-comment count already has it; an export must leave it behind.
- The workspace is addressable — `view.html?p=<project>&f=<page>` — so Builds
  can link straight into a design rather than re-implementing a preview.

**Phase 4 — assets.** Higgsfield integration. Entries already carry an
`imagePrompt` written specifically as an *asset* prompt (artwork only, never UI),
so this slots in: generate the asset, drop it into the design.

---

## What already exists (the foundation)

Built and working; the studio builds on top rather than replacing any of it.

- `data.json` — single source of truth; 12 entries, all with URLs.
- `server.mjs` — zero-dependency static server + write API + **SSE live updates**
  (watches the directory, not the file, because writers `rename()`).
- `capture.mjs` + `watcher/` — macOS `launchd` `WatchPaths` fires headless Claude
  on any new screenshot; writes draft entries. **This is the pattern the
  generator should copy.**
- `search.mjs` — weighted search; excludes drafts so unreviewed entries never
  reach the generator.
- `motion.mjs` — live-site motion capture. See the correction above.
- `skill/design-library/` — user-level Claude Code skill, symlinked into
  `~/.claude/skills/`.
- `index.html` / `assets/` — the Pressroom Index design system, live-updating,
  draft states, collapsible artifacts.
- `PRODUCT.md`, `DESIGN.md` — product truth and the visual system. **The studio's
  own UI must follow `DESIGN.md`;** generated pages must not — each one invents
  its own world.

---

## Open questions — answered by the Phase 1 build

Decided while building. Reopen any of them if the output argues otherwise.

1. **Divergence — a fixed pool, sampled per project.** Neither extreme works: a
   fixed four makes every project structurally identical, and asking a model to
   invent four angles costs a serial round-trip and tends to return four
   rewordings of one idea. Twelve structural theses drawn four at a time gives
   495 combinations, seeded off the brief so a project is reproducible and a
   re-roll can exclude exactly what was rejected. Generation 2 draws from a
   separate pool of ten visual worlds. The theses are deliberately structural
   only — no thesis names a colour, a typeface or a texture.
2. **Copy — real, written from the brief.** Placeholder would undercut the whole
   premise: the copy brief is half of what each reference carries, and a page
   full of lorem cannot be judged against a page that means something. Variants
   are told to choose a voice, name it to themselves, and hold it.
3. **Responsive — desktop-first at 1440, but honest at 390.** Fluid type,
   collapsing grids, one narrow breakpoint. Cheap enough not to move generation
   time, and it avoids shipping a winner that has to be rebuilt for mobile.
4. **Regeneration — yes, and it remembers.** Re-roll on either generation draws
   fresh angles from the pool with the already-shown ones excluded, so a second
   round never re-offers a direction that was turned down.
5. **Export — still open.** For now `builds/<project>/` is the artifact: a plain
   folder of self-contained HTML. Phase 3 decides whether "done" means a zip, a
   repo push, or nothing more than this. Whatever it decides, it must leave
   `index.baseline.html` behind.
6. **Inspector edits are values, not a stylesheet.** Answered by the Phase 2
   build: an edit is an inline `style` attribute on the element, not a rule
   appended to a generated stylesheet. A rule block would have preserved hover
   states and media queries, at the cost of stamping every edited element with
   an identifier and a specificity argument in every direction. Reopen this if
   editing buttons starts to feel like it is eating their hover states.

---

## Notes

- `nicee.com.ua` was captured with the id `entry` — fixed, and so was the cause:
  a Cyrillic title (`НАЙС!`) slugged away to nothing and fell through to the
  generic. `capture.mjs` now falls back to the descriptor, which is always
  written in English, before it gives up on a generic id.
- The generator is given recipes, copy briefs, tags and motion character —
  never the screenshot and never the URL. It has no browser and no Read tool in
  generation 1. That is deliberate: handing it the picture is the shortest path
  to the one failure Principle 0 exists to prevent.
- Nothing in the repo is committed yet.
