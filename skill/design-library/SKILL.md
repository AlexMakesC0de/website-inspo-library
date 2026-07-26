---
name: design-library
description: Search and extend Alex's personal website design library — a curated collection of website designs (hero sections, page sections) each carrying an image recipe, copy brief, image prompt, and 6+ tags. Use this BEFORE designing or building any web UI, landing page, hero, or page section, to ground the work in references Alex has already chosen and loved. Trigger on requests like "build me a hero", "design a landing page", "make this section look better", "give me a minimal/editorial/dithered/cinematic look", or any visual direction decision for a website. Also use to ADD to the library when Alex shares a screenshot and URL and says "add this to my library", "save this design", or "capture this".
---

# Design Library

A local, curated library of website designs Alex has saved. It lives at:

```
/Users/alex/Developer/website-inspo-library
```

`data.json` is the single source of truth. The browser grid, this skill, and the
CLI all read the same file.

---

## Searching — do this before designing web UI

When Alex asks for a hero, landing page, section, or any visual direction, search
the library **first** and let the results inform what you build. Do not ask
permission; it is read-only and fast.

```bash
node /Users/alex/Developer/website-inspo-library/search.mjs "minimal editorial hero"
```

Options:

| Flag | Effect |
|---|---|
| `--limit N` | Number of references to return (default 5) |
| `--group <id>` | Restrict to one design group |
| `--list` | Show all groups with entry counts |
| `--json` | Raw JSON instead of markdown |

Search covers titles, descriptors, tags, group names, recipes, copy briefs,
prompts, and notes, weighted so a tag match outranks a match buried in prose.

### Using what comes back

Each result carries three distinct artifacts. Keep them distinct:

- **Image recipe** — how the visual is constructed: texture, treatment, palette,
  grid, type pairing. Use this to drive CSS and layout decisions.
- **Copy brief** — how the *words* work: voice, headline structure, length,
  rhythm. Use this when writing the actual copy, not the visuals.
- **Asset prompt** (`imagePrompt`) — a prompt for the *artwork inside* the
  design: the photograph, texture, or illustration. Pass verbatim to an image
  model. It never describes UI, so never use it to generate a "page" — build the
  page from the recipe and drop the generated asset into it. Often empty, when a
  design's imagery is pure CSS.
- **Motion** (`motion`) — measured from the live site, not guessed: real
  durations, easing curves, hover end-states, and which library drives it. Use
  these exact numbers rather than inventing transitions. Check `motion.coverage`
  first: `full` means CSS explains the motion and you can rebuild it faithfully;
  `partial` or `none` means canvas/WebGL or a JS library is doing work that
  couldn't be decomposed — say so rather than pretending, and suggest Alex opens
  the site. Absent on entries not yet captured (`node motion.mjs`).

Tell Alex which references you drew on by name, and cite the source URL so the
original designer keeps credit. If the library returns nothing relevant, say so
plainly and design without it rather than forcing a weak match.

---

## Adding an entry

When Alex shares a screenshot and a URL and asks to save it:

1. **Confirm the screenshot is in place.** It must live in
   `/Users/alex/Developer/website-inspo-library/screenshots/`. If Alex points at
   a file elsewhere (Desktop, Downloads), copy it in and give it a descriptive
   kebab-case filename.

2. **Look at the image.** Actually read it — do not infer the design from the URL
   or the site's reputation.

3. **Write the metadata:**

   - `title` — the site or section name, as it presents itself.
   - `descriptor` — a short `x`-joined phrase in the library's voice, e.g.
     `warm editorial x print DNA`, `print-tech x data`.
   - `tags` — **at least six**, lowercase, each naming one concrete, reusable
     visual move. Good: `halftone CMYK dot texture`, `mono coordinate labels`,
     `topographic line illustration`. Bad: `modern`, `clean`, `nice typography`.
     Tags are what search runs on, so they must be specific.
   - `recipe` — how the visual is built. Name the ground, texture, palette
     behavior, type pairing, grid, and any signature treatment.
   - `copyBrief` — how the words work. Voice, headline construction, length,
     rhythm, what it refuses to say.
   - `imagePrompt` — the **asset** prompt: only the generatable artwork inside
     the design (photograph, texture, illustration, render). Never mention
     navbars, buttons, headlines, labels, panels, or placement — that is `recipe`,
     and an image model asked for a navbar produces a useless fake one. If the
     imagery is pure CSS with no makeable asset, leave this an empty string; an
     empty field beats a restatement of the recipe.
   - `note` — one line on why it is worth keeping.

4. **Choose the group.** Read the existing `groups` in `data.json` and the tags
   you just wrote, and propose the best fit. If nothing fits, propose a **new**
   group with a name in the library's register and an unused ink from the
   reserve below. **Always ask Alex to approve the group before writing** — the
   taxonomy is his call, and it is the one field you should never decide alone.

5. **Write it.** Append to `entries` in `data.json`, preserving 2-space
   indentation. `id` is a kebab-case slug of the title and must be unique.
   `addedAt` is today in `YYYY-MM-DD`.

```json
{
  "id": "stillpage",
  "title": "Stillpage",
  "descriptor": "warm editorial x print DNA",
  "url": "https://stillpage.example",
  "screenshot": "stillpage-hero.png",
  "group": "print-tech-paper",
  "tags": ["halftone CMYK dot texture", "warm paper ground", "mono coordinate labels"],
  "recipe": "…",
  "copyBrief": "…",
  "imagePrompt": "…",
  "note": "…",
  "addedAt": "2026-07-25"
}
```

### Reserve inks for new groups

Use one not already taken in `data.json`:

`#B4471C` minium · `#2C6551` viridian · `#2B4A87` ultramarine · `#93325A`
rose madder · `#5E4491` violet · `#7C5A10` ochre · `#24657F` cerulean ·
`#7A3A2A` oxide

---

## Rules

- **Never invent an entry.** Every entry corresponds to a real site Alex
  captured, with a real screenshot on disk. No placeholder or illustrative
  entries in `data.json`.
- **Never fabricate a URL.** If Alex did not give one, leave `url` empty.
- **Keep the three artifacts distinct.** A recipe that describes voice, or a copy
  brief that describes texture, makes the library useless for the job it exists
  to do.
- **Six tags is a floor, not a target.** Eight to twelve is better.
- Run the browser grid with `node server.mjs` from the library directory
  (`http://localhost:4610`) if Alex wants to look at it.
