#!/usr/bin/env node
/* Website Inspo Library — capture job.

   Finds screenshots on disk that no entry references, sends each to a headless
   Claude Code for analysis, and writes the result back as a DRAFT entry.

   Drafts are deliberately not live: the CLI hides them from search, so Claude
   never surfaces an un-reviewed entry as a real reference. You add the source
   URL and approve the proposed group in the browser, and the entry goes live.

   Run by launchd whenever screenshots/ changes (see watcher/), or by hand:

     node capture.mjs              process every unreferenced screenshot
     node capture.mjs --dry-run    list what it would process, analyze nothing  */

import { readFile, writeFile, readdir, stat, rename, open, unlink, appendFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DATA = join(ROOT, 'data.json');
const SHOTS = join(ROOT, 'screenshots');
const LOCK = join(ROOT, '.capture.lock');
const LOG = join(ROOT, 'watcher', 'capture.log');

const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const MODEL = process.env.CAPTURE_MODEL || 'sonnet';
const IMAGE_RE = /\.(png|jpe?g|webp|avif|gif)$/i;
const DRY = process.argv.includes('--dry-run');

const log = async (msg) => {
  const line = `${new Date().toISOString()}  ${msg}\n`;
  process.stdout.write(line);
  try { await appendFile(LOG, line); } catch { /* log dir may not exist yet */ }
};

/* ── Analysis prompt ───────────────────────────────────────────────────── */

// Replaces Claude Code's default system prompt entirely. Keeping this small is
// what stops each capture from re-sending the whole harness context.
const SYSTEM = `You analyze screenshots of website designs and return structured JSON.
You never write files. You read the image and answer. Output raw JSON only — no
prose, no explanation, no markdown code fence.`;

function buildPrompt(imagePath, groups) {
  const list = groups.map((g) => `  - ${g.id} — ${g.name}`).join('\n');
  return `Read the image at ${imagePath}. It is a screenshot of a website hero or page section.

Return ONE JSON object with exactly these keys:

{
  "title": "the site or section name as it presents itself",
  "descriptor": "a short x-joined phrase, e.g. 'warm editorial x print DNA'",
  "group": "one id from the list below, or a NEW kebab-case id if none fit",
  "groupName": "Title Case name — only if you proposed a new group id",
  "tags": ["8-12 strings"],
  "recipe": "how the visual is constructed: ground, texture, palette behaviour, type pairing, grid, signature treatment",
  "copyBrief": "how the words work: voice, headline construction, length, rhythm, what it refuses to say",
  "imagePrompt": "see ASSET PROMPT RULE below",
  "note": "one line on why this is worth keeping"
}

Existing groups:
${list}

TAG RULES — these are the search index, so they decide whether this entry is ever
found again. Each tag names ONE concrete, reusable visual move.
  Good: "halftone CMYK dot texture", "mono coordinate labels", "topographic line illustration"
  Bad:  "modern", "clean", "nice typography", "good use of space"
Eight to twelve tags. Lowercase. No vague adjectives.

ASSET PROMPT RULE — this is where these entries usually go wrong.

"imagePrompt" describes ONLY the generatable artwork sitting inside the design:
the photograph, texture, illustration, or render. It is fed to an image model.

It must NEVER mention interface or layout: no navbars, buttons, headlines, menus,
labels, timestamps, widgets, panels, thumbnails, footers, or where things sit on
the page. Those are built in HTML and belong in "recipe". An image model asked
for a navbar produces a fake, useless one.

Test it: if the prompt were run and the result had any UI in it, the prompt is
wrong. Rewrite until it describes a single photograph or illustration you would
place behind or beside the interface.

  Right: "Extreme macro photograph of pore-textured skin filling the frame,
          warm sepia-brown, heavy fine film grain, shallow depth of field,
          soft directional light."
  Wrong: "...with a floating navbar top-center and a headline in the lower left."

If the design's imagery is purely CSS (gradients, dot fields, generated pattern)
and there is no photographic or illustrated asset to make, set "imagePrompt" to
an empty string. An empty field is better than a restatement of the recipe.

Keep the three distinct: recipe is the build, copyBrief is the words, imagePrompt
is one makeable asset. If two of them say the same thing, one of them is wrong.

Output the JSON object and nothing else.`;
}

/* ── Claude Code call ──────────────────────────────────────────────────── */

async function analyze(imagePath, groups) {
  const { stdout } = await run(CLAUDE, [
    '-p', buildPrompt(imagePath, groups),
    '--system-prompt', SYSTEM,
    '--allowedTools', 'Read',
    '--permission-mode', 'dontAsk',
    '--disable-slash-commands',
    '--model', MODEL,
    '--output-format', 'json',
  ], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024, timeout: 180_000 });

  const envelope = JSON.parse(stdout);
  if (envelope.is_error) throw new Error(envelope.result || 'claude reported an error');

  // The model's answer is a JSON string inside the envelope; tolerate a fence.
  const raw = String(envelope.result ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`no JSON object in response: ${raw.slice(0, 200)}`);
  return JSON.parse(raw.slice(start, end + 1));
}

/* ── data.json ─────────────────────────────────────────────────────────── */

const slug = (s) => String(s).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'entry';

const INKS = ['#B4471C', '#2C6551', '#2B4A87', '#93325A', '#5E4491', '#7C5A10', '#24657F', '#7A3A2A'];

async function writeData(data) {
  const tmp = `${DATA}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, DATA);
}

// A file still being copied reports a growing size. Wait until it settles.
async function settled(path) {
  const a = await stat(path);
  await new Promise((r) => setTimeout(r, 400));
  const b = await stat(path);
  return a.size === b.size && b.size > 0;
}

/* ── Main ──────────────────────────────────────────────────────────────── */

async function main() {
  const data = JSON.parse(await readFile(DATA, 'utf8'));
  data.groups ??= [];
  data.entries ??= [];

  const referenced = new Set(data.entries.map((e) => e.screenshot).filter(Boolean));
  let files = [];
  try {
    files = (await readdir(SHOTS)).filter((f) => IMAGE_RE.test(f) && !f.startsWith('.'));
  } catch {
    await log('screenshots/ not found — nothing to do');
    return;
  }

  const orphans = files.filter((f) => !referenced.has(f));
  if (!orphans.length) return;

  await log(`${orphans.length} unreferenced screenshot${orphans.length === 1 ? '' : 's'}: ${orphans.join(', ')}`);
  if (DRY) return;

  await processAll(data, orphans);
}

/* Files that land while a run holds the lock would otherwise sit forever:
   the second launchd trigger exits on the lock and never fires again. So a
   run re-scans after each pass and picks up whatever arrived meanwhile.
   `attempted` stops a permanently failing file from looping. */
async function processAll(data, first) {
  const attempted = new Set();
  let batch = first;

  for (let pass = 0; pass < 20 && batch.length; pass++) {
    if (pass > 0) await log(`${batch.length} more arrived mid-run: ${batch.join(', ')}`);
    await processBatch(data, batch, attempted);

    const referenced = new Set(data.entries.map((e) => e.screenshot).filter(Boolean));
    const files = (await readdir(SHOTS)).filter((f) => IMAGE_RE.test(f) && !f.startsWith('.'));
    batch = files.filter((f) => !referenced.has(f) && !attempted.has(f));
  }
}

async function processBatch(data, orphans, attempted) {
  for (const file of orphans) {
    attempted.add(file);
    const path = join(SHOTS, file);
    if (!(await settled(path))) {
      await log(`${file} — still being written, leaving for the next run`);
      continue;
    }

    try {
      const t0 = Date.now();
      const r = await analyze(path, data.groups);

      // Re-read: a browser edit may have landed while Claude was thinking.
      const fresh = JSON.parse(await readFile(DATA, 'utf8'));
      fresh.groups ??= [];
      fresh.entries ??= [];
      if (fresh.entries.some((e) => e.screenshot === file)) {
        await log(`${file} — entry appeared while analyzing, skipping`);
        continue;
      }

      // Claude may propose a group that does not exist yet. Create it as a
      // draft group; approving the entry in the browser confirms it.
      let group = String(r.group || '').trim();
      if (group && !fresh.groups.some((g) => g.id === group)) {
        fresh.groups.push({
          id: group,
          name: r.groupName || group.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          ink: INKS[fresh.groups.length % INKS.length],
          proposed: true,
        });
        await log(`${file} — proposed new group "${group}"`);
      }
      if (!group) group = fresh.groups[0]?.id || '';

      // A title in a non-Latin script slugs away to nothing, and "entry" is not
      // an id anyone can find again. Fall back to the descriptor, which is
      // always written in English, before giving up on a generic.
      const base = [r.title, String(r.descriptor || '').split(/\s+/).slice(0, 5).join(' '),
        basename(file, extname(file))]
        .map((s) => slug(s || ''))
        .find((s) => s && s !== 'entry') || 'entry';

      let id = base;
      let n = 2;
      while (fresh.entries.some((e) => e.id === id)) id = `${base}-${n++}`;

      fresh.entries.push({
        id,
        status: 'draft',
        title: String(r.title || '').trim() || basename(file, extname(file)),
        descriptor: String(r.descriptor || '').trim(),
        url: '',
        screenshot: file,
        group,
        tags: Array.isArray(r.tags) ? r.tags.map(String).filter(Boolean) : [],
        recipe: String(r.recipe || '').trim(),
        copyBrief: String(r.copyBrief || '').trim(),
        imagePrompt: String(r.imagePrompt || '').trim(),
        note: String(r.note || '').trim(),
        addedAt: new Date().toISOString().slice(0, 10),
      });

      await writeData(fresh);
      data.groups = fresh.groups;
      data.entries = fresh.entries;
      await log(`${file} — drafted "${id}" with ${fresh.entries.at(-1).tags.length} tags in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (err) {
      await log(`${file} — FAILED: ${err.message}`);
    }
  }
}

/* Single-flight: launchd can fire several times for one batch of drops. */
let lock;
try {
  lock = await open(LOCK, 'wx');
} catch {
  try {
    const age = Date.now() - (await stat(LOCK)).mtimeMs;
    if (age < 10 * 60_000) process.exit(0);       // another run is live
    await unlink(LOCK);                            // stale lock from a crash
    lock = await open(LOCK, 'wx');
  } catch { process.exit(0); }
}

try {
  await main();
} catch (err) {
  await log(`capture aborted: ${err.stack || err.message}`);
  process.exitCode = 1;
} finally {
  await lock.close();
  await unlink(LOCK).catch(() => {});
}
