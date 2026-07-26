# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A single user — the owner — running the library locally on their own machine. No auth, no sharing, no second audience.

The library has two consumers, and this is the defining product fact:

1. **The owner, in a browser.** Browsing to get unstuck, scanning to find a specific remembered reference, and copying artifacts out of an entry to use elsewhere. All three modes are live; none may be starved.
2. **Claude Code, as a reader.** Invoked from *other* projects. Before building a surface ("make me a minimal hero"), it searches this library for related designs and uses the matching entries' recipes as direction.

## Product Purpose

Capture website designs the owner loves — hero sections and page sections, by URL and screenshot — and hold them in a form that is both browsable by eye and queryable by an agent.

Success: the owner adds a design in roughly one sentence, finds it again months later in seconds, and Claude Code independently surfaces the right references before writing any code.

**The library also generates.** The Studio takes a one-sentence brief, searches the library for fitting references, and fans out four headless Claude Code runs that each build one complete, self-contained landing page from a different structural thesis. The owner picks the closest, then picks again from four restylings of it. This replaces describing what is wrong in prose with choosing between things that exist. See `STUDIO.md`.

The governing rule there is **inspiration, not replication**: references contribute character, principles and moves, never layout. A generated page that could be mistaken for a reference with the copy swapped has failed. Every variant states which references influenced what, and names one thing it refused to take.

## Positioning

Existing inspiration galleries (Mobbin, Land-book, Savee, Pinterest, personal screenshot folders) store *pictures*. They are browse-only, they cannot be queried by a coding agent, and they leave the work of "what actually makes this look like this" to the viewer every time.

This library stores **executable artifacts**: every entry carries an image recipe, a copy brief, and an image prompt alongside the screenshot. The analysis happens once, at capture time, and is reusable forever — by a human reading it or an agent consuming it.

## Operating Context

- Runs locally; started with one command, viewed in a browser at localhost.
- Screenshots are captured by the owner and dropped into a local `/screenshots` folder.
- New entries are added by asking Claude Code to analyze a screenshot + URL; Claude writes the metadata, the owner edits it afterward in the browser.
- Retrieval happens in two places: the browser grid, and Claude Code sessions running in unrelated project directories.

## Capabilities and Constraints

**Confirmed:**

- Vanilla HTML/CSS/JS. No framework, no build step, no npm dependencies.
- `data.json` is the single source of truth, read and written by every surface: grid, add/edit form, CLI search, and the Claude Code skill.
- Persistence requires a local zero-dependency Node server (`node:http` + `node:fs`) so in-browser edits land in `data.json` rather than forking into `localStorage`. Node 24 is available.
- Screenshots live in a local `/screenshots` folder, referenced by filename.
- Library scale: 20–80 tightly curated entries. Everything fits one scrollable page; no pagination or virtualization needed.
- Claude Code reaches the library through a **user-level** skill at `~/.claude/skills/`, available in every project, plus a CLI search script pointed at this library's absolute path.
- Entry record: source URL, screenshot, title, one group, at least six tags, image recipe, copy brief, image prompt.
- **Image recipe** = how the visual is constructed (texture, treatment, palette, grid, type pairing). **Copy brief** = how the words work (voice, headline structure, length, rhythm). **Image prompt** = a ready-to-run generation prompt. These are three distinct fields and must not collapse into one another.
- Entries are authored by Claude from screenshot + URL, then editable by the owner in the browser.
- Groups are explicit and curated: Claude proposes the best-fitting existing group or a new one, informed by the entry's tags; the owner approves. Tags exist to help that decision, not to replace groups.

**Undecided / deliberately open:**

- Whether an entry may belong to more than one group.
- Whether deleting an entry also removes its screenshot file.
- Any deployment or hosting story — this is local-only for now.

## Brand Commitments

The owner pinned a reference screenshot of an existing build (from a Chase AI video) as the thing to recreate. Both its structure and its look are binding.

**Structure:**

- A filter chip row with per-group counts, including an "ALL" chip.
- A card grid where the screenshot dominates the card.
- Per-card: title, a short "x"-joined descriptor, visible tags with a `+N` overflow indicator, group label, and an `NN / TT` index.
- A detail view with the recipe, copy brief, copy-to-clipboard action for the image prompt, and a close control.

**Look — confirmed by the owner as a standing preference:**

- A light theme. Warm off-white paper ground, not a dark or high-contrast-white interface.
- Monospaced type for labels, tags, counts, and structural apparatus.
- Chips and tags as outlined rectangles with visible hairline borders.
- Card titles set in a serif, against the mono apparatus.

This pins the world, not its softest rendition: the craft ceiling — type scale, density, state design, motion, and detail work — is expected to go well past the reference. No existing name or logo is binding.

## Evidence on Hand

The library is empty. There are no entries, screenshots, URLs, groups, or tags yet — all real content must be supplied by the owner. Placeholder entries used for building and testing must be recognizable as placeholders and must never present invented sites, URLs, or attributions as real captures.

## Product Principles

1. **`data.json` is the single source of truth.** Grid, form, CLI, and skill all read and write the same file. Any surface that forks its own copy is broken.
2. **Capture must cost one sentence.** Friction is the only thing that kills a personal library. If adding an entry feels like data entry, entries stop getting added.
3. **Every entry must be actionable, not just admirable.** A screenshot alone is a bookmark; the recipe, brief, and prompt are what make it reusable.
4. **Curated over comprehensive.** This is a library of designs the owner genuinely loves. Growth is not a goal, and the interface should never optimize for volume.
5. **Machine-readable is a first-class surface.** What Claude Code can retrieve matters as much as what the grid can display; neither may be designed at the other's expense.
6. **Inspiration, not replication.** Everything generated from this library must be honestly new. References supply character and moves; a page that reproduces a reference's structure is a failure regardless of how good it looks.
7. **Selection over description.** The library's own UI is a working document and follows `DESIGN.md` exactly. What it generates must not: every generated page invents its own world.
