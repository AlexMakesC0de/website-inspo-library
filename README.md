# Website Inspo Library

A curated, filterable library of website designs — and a memory Claude Code
reads before it builds anything.

Every entry carries a screenshot, a source URL, at least six tags, an **image
recipe** (how the visual is built), a **copy brief** (how the words work), and a
ready-to-run **image prompt**. `data.json` is the single source of truth: the
browser grid, the CLI, and the Claude Code skill all read and write the same file.

No framework. No build step. No dependencies. Node 24+.

---

## Run it

```bash
node server.mjs          # → http://localhost:4610
```

The server owns every write, so edits made in the browser land in `data.json`
rather than in browser storage. Opening `index.html` directly off the filesystem
works too, but the library becomes read-only and says so.

Set a different port with `PORT=5000 node server.mjs`. If the port is already
taken, the server says so and tells you how to free it instead of throwing.

**The page updates itself.** The server watches `data.json` and pushes over
Server-Sent Events, so a capture, an edit in another tab, or a hand-edit of the
JSON appears immediately — no reload. A 10-second poll backs it up if the stream
drops. Refreshes never disturb you: your filter, search text, scroll position and
open sheet all survive, half-typed form fields are never overwritten (the update
applies when you close the form), and a newly arrived card flashes once in its
group's ink instead of announcing itself.

**Desktop shortcut.** `~/Desktop/Inspo Screenshots` is a symlink to `screenshots/`
— drop captures straight onto it and they land in the repo. Recreate it with:

```bash
ln -sfn "$PWD/screenshots" ~/Desktop/"Inspo Screenshots"
```

---

## Add a design

**Automatic (recommended).** Install the watcher once:

```bash
node watcher/install.mjs
```

Now just drop a screenshot into `screenshots/` (or onto the Desktop shortcut).
macOS `launchd` watches the folder and starts a headless Claude Code the moment
anything lands — nothing runs while you're idle. Claude reads the image, writes
8–12 tags plus the recipe, copy brief, and image prompt, and proposes a group.

The result lands as a **draft**: dashed border, `DRAFT` where the index goes,
sorted to the top of the grid. Open it, add the source URL, correct anything
wrong, and press **Approve entry**.

Drafts are deliberately not live — `search.mjs` filters them out, so Claude
never cites an entry you haven't reviewed. Approving also confirms the group it
proposed.

```bash
node watcher/install.mjs --status   # is it loaded?
node watcher/install.mjs --remove   # uninstall
node capture.mjs                    # run a capture by hand
node capture.mjs --dry-run          # list what would be processed
tail -f watcher/capture.log         # watch it work
```

Takes roughly 45s per screenshot. Set `CAPTURE_MODEL=opus` for deeper analysis,
or `sonnet` (the default) for the speed/quality balance.

**By hand** — press **Add entry** in the grid and fill the fields yourself. Any
entry can be edited later from its detail view.

---

## Studio — generate by selection

The **Studio** tab turns the library into a generator. Instead of prompting
Claude Code round after round and describing what's wrong, you pick.

```
brief ──▶ references ──▶ 4 complete landing pages ──▶ pick 1
                                                        │
                          4 restylings of the winner ◀──┘ ──▶ pick 1
```

1. **Write one sentence.** The library is searched for what fits.
2. **Adjust the references.** Drop what doesn't belong, add what's missing.
3. **Generate.** Four headless Claude Code runs go out in parallel, each
   building one complete, self-contained landing page from a *different
   structural thesis* — a ledger, a manifesto, type-as-image, a flood of
   full-viewport rooms. Each lands in the board as it finishes.
4. **Pick one**, then generate four **worlds**: the same layout and the same
   words, restyled — type, colour, texture, motion.

Roughly 3–4 minutes and about $2 per round of four, at `sonnet`. Override with
`STUDIO_MODEL=opus`, `STUDIO_EFFORT=medium`, `STUDIO_TIMEOUT=900000`.

**References are inspiration, never a template.** Each variant is handed
character, principles and moves — recipes, copy briefs, tags, motion character —
and is explicitly forbidden from reproducing a reference's layout. Screenshots
and URLs are deliberately withheld from the generator for the same reason. Every
page states in its own header comment which references influenced what, and
names one thing it *refused* to take. **Sources** on any tile shows it, so a
variant that leaned too hard on one reference is visible before you go looking.

A restyle that quietly rebuilds the page instead of reskinning it is rejected:
the generated copy is compared against the winner's, and a variant that kept
less than 60% of it is reported as failed rather than offered as a choice.

Also runs headless:

```bash
node studio.mjs "a landing page for a small-batch coffee roaster"
node studio.mjs "…" --refs vaulk,lama-lama --variants 4
node studio.mjs --list
```

Everything lands in `builds/<project>/`, self-contained and dependency-free —
open the file, copy it, or hand it to Claude Code.

---

## Connect it to Claude Code

```bash
node install-skill.mjs
```

This symlinks the `design-library` skill into `~/.claude/skills/`, so it works in
**every** project, not just this one. Start a new Claude Code session afterward.

From then on, asking Claude for a hero, a landing page, or any visual direction
makes it search this library first and build from references you already chose.
Because it's a symlink, editing `skill/design-library/SKILL.md` takes effect
immediately.

Remove it with `node install-skill.mjs --remove`.

---

## Search from the terminal

```bash
node search.mjs "minimal editorial hero"
node search.mjs --group dither-mono
node search.mjs --list
node search.mjs "halftone" --limit 3 --json
```

Searches titles, descriptors, tags, group names, recipes, copy briefs, prompts,
and notes — weighted so a tag match outranks a match buried in prose.

---

## Keyboard

| Key | Action |
|---|---|
| `/` | Focus the filter |
| `Esc` | Close the open sheet |
| `Tab` | Move through cards, chips, and copy buttons |

Clicking any tag filters the library by it. Clicking `+N` on a card expands the
full tag set in place.

---

## Files

```
index.html            the grid, detail sheet, editor, studio, and viewer
assets/styles.css     the design system, implemented
assets/app.js         rendering, filtering, copy, CRUD, tab routing
assets/studio.js      brief → references → generate → pick
server.mjs            static server + write API + studio API (stdlib only)
studio.mjs            the generator: fan-out, prompts, validation
search.mjs            CLI search for agents and humans
capture.mjs           screenshot → draft entry
motion.mjs            live-site motion character capture
install-skill.mjs     installs the skill at user level
data.json             ← the single source of truth
builds/               generated projects, one folder each
screenshots/          your captures
skill/design-library/ the Claude Code skill
PRODUCT.md            what this is and who it serves
DESIGN.md             the visual system, normative
STUDIO.md             the studio's plan and its confirmed decisions
```

---

## Data shape

```jsonc
{
  "collection": "Website Inspo Library",
  "owner": "Alexandros Karayiannis",
  "groups": [
    { "id": "dither-mono", "name": "Dither Mono", "ink": "#2C6551" }
  ],
  "entries": [
    {
      "id": "stillpage",              // kebab-case, unique
      "title": "Stillpage",
      "descriptor": "warm editorial x print DNA",
      "url": "https://…",
      "screenshot": "stillpage.png",  // relative to screenshots/
      "group": "dither-mono",         // exactly one
      "tags": ["…", "…"],             // six minimum
      "recipe": "how the visual is constructed",
      "copyBrief": "how the words work",
      "imagePrompt": "ready to run",
      "note": "why you saved it",
      "addedAt": "2026-07-25"
    }
  ]
}
```

Each group owns one ink, used for its diamond, its active chip, and its card
labels. Deleting an entry leaves its screenshot file on disk.
