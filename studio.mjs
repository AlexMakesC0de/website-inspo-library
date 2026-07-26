#!/usr/bin/env node
/* Website Inspo Library — Studio.

   Design generation by selection. Instead of describing what's wrong to Claude
   Code round after round, this fans out N headless Claude Code runs at once,
   each building one complete self-contained landing page, and lets you pick.

   Generation 1 varies CONCEPT — four different structural theses.
   Generation 2 varies WORLD only — the winner's layout and words are kept.

   It is a library (the server drives it) and a CLI:

     node studio.mjs "a landing page for a small-batch coffee roaster"
     node studio.mjs "…" --refs lama-lama,vaulk --variants 4
     node studio.mjs --list                                                  */

import { readFile, writeFile, rename, mkdir, readdir, rm, copyFile, access } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export const ROOT = fileURLToPath(new URL('.', import.meta.url));
export const BUILDS = join(ROOT, 'builds');
const DATA = join(ROOT, 'data.json');
const SEARCH = join(ROOT, 'search.mjs');

const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const MODEL = process.env.STUDIO_MODEL || 'sonnet';
const EFFORT = process.env.STUDIO_EFFORT || 'high';
const TIMEOUT = Number(process.env.STUDIO_TIMEOUT || 900_000);

export const VARIANT_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'];

/* ── Divergence pools ───────────────────────────────────────────────────────

   Open question 1 answered: neither a fixed set nor a per-prompt derivation,
   but a fixed POOL sampled per project. A fixed four would make every project
   structurally identical; asking a model to invent four angles costs a serial
   round-trip and tends to produce four rewordings of one idea. Twelve theses
   drawn four at a time is 495 combinations, seeded off the prompt so the same
   brief is reproducible and a re-roll can exclude what was already rejected.

   These are STRUCTURAL — about page architecture and pacing. Nothing here
   names a colour, a typeface or a texture; that is generation 2's job.        */

export const THESES = [
  'THE HELD FRAME — the hero is one full viewport holding almost nothing: a single line, enormous, and air. Everything below it is dense, fast and packed, so the page reads as one held breath followed by the whole argument at once.',
  'THE MANIFESTO — no cards, no grids, no boxes. The page is one continuous argument set as running text, and the sections are its paragraphs. Hierarchy comes only from scale, weight and rule placement.',
  'THE REGISTER — the page presents itself as a catalogue or index: numbered rows, a ruled register, content as entries with fields. The reader scans a table, not a brochure.',
  'THE SPINE — a persistent two-column split where one side holds absolutely still and the other scrolls past it. The still side is the argument; the moving side is the evidence.',
  'TYPE AS THE IMAGE — typography is the artwork. Set at sizes that break the frame, cropped by the viewport, overlapping itself. Imagery is incidental, small, or absent entirely.',
  'THE SPECIMEN SHEET — the subject is shown as a specimen under examination: measurements, callouts, leader lines, part numbers, an apparatus of labels around a central object.',
  'THE PULL-BACK — every section widens the frame. Extreme detail, then the object, then its context, then the world it sits in. The page zooms out as you scroll.',
  'CLAIM AND PROOF — strict alternation. Each section makes one bold assertion, and the next section is nothing but the evidence for it. The rhythm never varies, and that is the whole design.',
  'THE FLOOD — every section is edge to edge and fills the viewport. No container, no gutter, no max-width anywhere. Scrolling is a sequence of whole rooms, not a column of blocks.',
  'MARGINALIA — a narrow main column carrying the argument, and a wide margin carrying figures, asides, footnotes and numbers. The margin is where the design lives.',
  'THE DISSOLVE — the page opens as a rigid, obvious grid and breaks it a little more with each section, so the last screen has no grid left at all.',
  'THE LEDGER — dense, left-aligned, apparatus first. Data, counts, timestamps and labels carry the page; prose appears only where a number cannot say it.',
];

/* Generation 2 changes the world and nothing else. These are visual, and each
   is deliberately a full commitment rather than a tweak. */
export const WORLDS = [
  'PRINTED MATTER — a warm off-white stock, ink that was never quite black, 1px hairline rules doing all the dividing, and zero radius anywhere. Depth is border weight and tonal lift, never shadow.',
  'NIGHT FIELD — a near-black ground with heavy grain, one saturated accent used structurally, and light that seems to come from inside the type.',
  'WHITE-OUT — extreme value compression. Everything pale, nothing louder than a whisper, and exactly one hard black element that carries the whole page.',
  'TWO INKS — a duotone world. Two colours, no third, with ordered dither or halftone texture standing in for every tone between them.',
  'ONE HUE — a single hue held across eight values and nothing else. No second colour appears anywhere, including in imagery.',
  'THE TWO VOICES — a high-contrast editorial serif at extreme scale, against a mono apparatus doing every label, count and caption. No third face, no sans.',
  'INDUSTRIAL — grotesk only, tight tracking, signage logic. Type set as if it were painted on a wall or stencilled onto a crate.',
  'SUN-BLEACHED — analogue warmth. Film grain, faded chroma, soft bloom in the highlights, everything looking a decade old and better for it.',
  'BLUEPRINT — cold and technical. Graph-paper ground, plotter linework, measured rules, everything drawn rather than styled.',
  'DEPTH AND GLASS — layered translucency and gradient depth, held in check by severe typographic restraint so it never becomes decoration.',
];

/* ── Deterministic sampling ────────────────────────────────────────────────── */

// FNV-1a. Same prompt, same angles — so a project is reproducible and a re-roll
// can be told exactly which directions were already rejected.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function sample(pool, n, seed, exclude = []) {
  const rest = pool.filter((x) => !exclude.includes(x));
  const items = rest.length >= n ? rest : pool.slice();
  let s = seed || 1;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const shuffled = items.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

/* ── References ────────────────────────────────────────────────────────────── */

export async function readLibrary() {
  const data = JSON.parse(await readFile(DATA, 'utf8'));
  data.groups ??= [];
  data.entries ??= [];
  return data;
}

// Shell out to search.mjs rather than reimplementing its weights. The CLI and
// the studio must never disagree about what "the best reference" means, and a
// second copy of the scoring is exactly how they would.
export async function proposeReferences(query, limit = 5) {
  if (!query.trim()) return [];
  try {
    const { stdout } = await exec('node', [SEARCH, query, '--json', '--limit', String(limit)],
      { cwd: ROOT, maxBuffer: 8 * 1024 * 1024, timeout: 20_000 });
    const hits = JSON.parse(stdout);
    return Array.isArray(hits) ? hits.map((h) => h.id) : [];
  } catch {
    return [];
  }
}

// Motion is a CHARACTER signal, never a spec to rebuild from. Timings are
// passed as examples of feel, capped at three, and always labelled as such.
function motionCharacter(m) {
  if (!m) return '';
  const bits = [m.summary].filter(Boolean);
  if (m.libraries?.length) bits.push(`Driven by ${m.libraries.join(', ')}.`);
  if (m.timings?.length) bits.push(`Timings measured there, as a feel and not a spec: ${m.timings.slice(0, 3).join('; ')}.`);
  bits.push(`Respects prefers-reduced-motion: ${m.reducedMotion ? 'yes' : 'no'}.`);
  return bits.join(' ');
}

function referenceBrief(entry, groups) {
  const group = groups.find((g) => g.id === entry.group)?.name;
  const out = [`### ${entry.title}${entry.descriptor ? ` — ${entry.descriptor}` : ''}${group ? `  [${group}]` : ''}`];
  if (entry.tags?.length) out.push(`Moves: ${entry.tags.join(' · ')}`);
  if (entry.recipe) out.push(`How it is built: ${entry.recipe}`);
  if (entry.copyBrief) out.push(`How it speaks: ${entry.copyBrief}`);
  const motion = motionCharacter(entry.motion);
  if (motion) out.push(`How it moves: ${motion}`);
  if (entry.note) out.push(`Why it was saved: ${entry.note}`);
  return out.join('\n');
}

// Deliberately no URL and no screenshot path. The model has no browser and no
// Read tool here, and handing it either would invite the one failure mode this
// whole system exists to avoid.
function referencesBlock(refs, groups) {
  if (!refs.length) return 'No references were selected. Work from the brief alone, and invent a world rather than reaching for a default one.';
  return refs.map((e) => referenceBrief(e, groups)).join('\n\n');
}

/* ── The prompt ────────────────────────────────────────────────────────────── */

const PRINCIPLE_0 = `## Principle 0 — inspiration, not replication

This is an inspo library, not a replica library. The references above are here
for CHARACTER, PRINCIPLES and MOVES. Never for layout.

- "Halftone dot texture over warm paper, mono labels used as apparatus" is the
  useful part of a reference. "Nav pill top-centre, headline lower-left,
  three-column footer" is not, and must not be transplanted.
- Never reproduce a reference's structure. If your page could be mistaken for
  one of these sites with the copy swapped out, you have failed.
- Combine across the set rather than following one of them.
- The page must be honestly new. The person you are building for is making
  their own site, not a clone of someone else's.`;

const BUILD_RULES = `## What to build

- ONE scrollable landing page: a hero, three to five sections, and a footer.
  Every section must earn its place — no "Features / Testimonials / CTA"
  boilerplate unless the brief genuinely calls for exactly that.
- ONE file. All CSS inline in a <style> block. No build step, no framework, no
  external JavaScript, no CDN scripts. A <link> to Google Fonts is allowed and
  encouraged — type is most of the world.
- REAL COPY, written from the brief. Never lorem ipsum, never "Your headline
  here", never a bracketed placeholder. Choose a voice, name it to yourself,
  and hold it from the hero to the footer.
- IMAGERY: you cannot generate images, and a broken <img> is worse than none.
  Build texture in CSS — gradients, conic and repeating gradients, blend modes,
  box-shadow fields, inline SVG including feTurbulence and feDisplacementMap.
  Where a real photograph genuinely belongs, place a labelled frame instead:

      <figure class="asset" data-asset-prompt="one sentence describing the
      artwork only — no UI, no text, no layout"> … a CSS-built stand-in and a
      short caption naming what belongs there … </figure>

  Those data-asset-prompt values are read later by an image pipeline, so write
  them as real asset prompts: a photograph or illustration, never an interface.
- MOTION: give the page real motion in the character the references suggest —
  entrances, hover states, transitions with chosen durations and easing. CSS
  only. Wrap it all so that a @media (prefers-reduced-motion: reduce) block
  genuinely stills the page.
- RESPONSIVE: build it desktop-first at 1440px, but it must not break. Use
  fluid type (clamp), grids that collapse, and at least one narrow breakpoint.
  It should be honest at 390px, not merely unbroken.
- ACCESSIBLE: semantic landmarks, one h1, real heading order, alt text or
  aria-hidden on decoration, and text that holds contrast against its ground.`;

function outputContract(outFile, label, generation) {
  return `## Output contract

Write exactly one file, at this absolute path:

  ${outFile}

The file must begin with this comment block, every line filled in honestly:

<!--
  ${label} — generation ${generation}
  TITLE: the name this page gives itself
  ANGLE: your structural angle, in your own words, one line
  WORLD: the visual world, in one line — ground, type, colour, texture
  INFLUENCES: <reference> → what you took; <reference> → what you took
  REFUSED: one thing you deliberately did NOT take from a reference, and why
-->

INFLUENCES and REFUSED are not decoration. They are how a variant that leaned
too hard on one reference becomes visible immediately. Be specific and be honest.

Write the file. Do not explain it, do not summarise it, do not ask anything.`;
}

const SYSTEM = `You are a designer who builds. You produce complete, self-contained
HTML pages with inline CSS and no dependencies, and you commit fully to a
direction rather than hedging between several.

You write the file and stop. No prose, no summary, no questions, no follow-up.`;

export function buildConceptPrompt({ brief, refs, groups, thesis, lead, outFile, label, variantCount }) {
  return `Build one complete landing page.

## The brief

${brief}

## Your structural angle — this variant only

${thesis}

${variantCount > 1 ? `${variantCount - 1} other designers are building this same brief right now from different angles. Yours has to be unmistakably yours. Commit to it completely; a hedged version of this angle is worth nothing next to theirs.` : 'Commit to this angle completely.'}

${lead ? `Let ${lead} lead the character, and let the other references interrupt it rather than agree with it.\n` : ''}
## References from the library

These are designs the owner has chosen and loves.

${referencesBlock(refs, groups)}

${PRINCIPLE_0}

${BUILD_RULES}

${outputContract(outFile, label, 1)}`;
}

export function buildRestylePrompt({ brief, refs, groups, world, lead, winnerFile, outFile, label }) {
  return `Restyle an existing landing page. Its structure has already been chosen and is not yours to change.

## The brief the page was built from

${brief}

## The page

Read this file first, before anything else:

  ${winnerFile}

If you cannot read it, STOP. Write nothing and say so. Building a fresh page
from the brief instead is the one outcome this step must never produce: it
looks like a success and silently throws away the structure that was chosen.

## What you may change, and what you may not

CHANGE the world entirely: typefaces and type scale, colour and ground, texture,
borders and rules, spacing rhythm, motion timing and easing, the treatment of
every asset frame.

KEEP the structure exactly: the same sections in the same order, the same layout
skeleton, the same words. If a headline reads badly at your new type scale you
may adjust its line breaks — you may not rewrite it.

The test: someone who saw the original should recognise the page instantly and
still feel they are looking at a different studio's work.

## Your world — this variant only

${world}

${lead ? `Let ${lead} lead the character here, more than the others.\n` : ''}
## References from the library

${referencesBlock(refs, groups)}

${PRINCIPLE_0}

## Carry these over

- One file, inline CSS, no external JavaScript. Google Fonts links are allowed.
- Real motion, and a @media (prefers-reduced-motion: reduce) block that stills it.
- The asset frames keep their data-asset-prompt values, rewritten only if your
  new world genuinely changes what the artwork should be.
- Still honest at 390px.

${outputContract(outFile, label, 2)}`;
}

/* ── Running one variant ───────────────────────────────────────────────────── */

// stream-json gives a phase to show while a variant is thinking, which is the
// difference between a two-minute wait and a two-minute stare.
function runClaude({ args, cwd, onPhase }) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    let err = '';
    let result = null;
    let timedOut = false;

    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, TIMEOUT);

    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === 'result') result = msg;
        else if (msg.type === 'assistant') {
          for (const block of msg.message?.content || []) {
            if (block.type === 'tool_use') onPhase?.(block.name === 'Write' ? 'writing' : 'reading');
            else if (block.type === 'thinking') onPhase?.('thinking');
          }
        }
      }
    });
    child.stderr.on('data', (chunk) => { err += chunk; });

    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`timed out after ${Math.round(TIMEOUT / 1000)}s`));
      if (result?.is_error) return reject(new Error(String(result.result || 'claude reported an error').slice(0, 300)));
      if (!result && code !== 0) return reject(new Error(err.trim().slice(0, 300) || `claude exited ${code}`));
      resolve(result || {});
    });
  });
}

const HEADER_KEYS = ['TITLE', 'ANGLE', 'WORLD', 'INFLUENCES', 'REFUSED'];

// The header comment is the variant's own account of itself, and the only
// artifact we parse out of the page. Missing keys are reported, never invented.
export function parseHeader(html) {
  const comment = html.slice(0, 4000).match(/<!--([\s\S]*?)-->/);
  const out = {};
  if (!comment) return out;
  for (const key of HEADER_KEYS) {
    const m = comment[1].match(new RegExp(`^\\s*${key}:\\s*([\\s\\S]*?)(?=\\n\\s*(?:${HEADER_KEYS.join('|')}):|$)`, 'm'));
    if (m) out[key.toLowerCase()] = m[1].trim().replace(/\s+/g, ' ');
  }
  return out;
}

// Cheap structural checks only. Taste is Alex's job; this catches the page that
// never got written, got truncated, or quietly reached for a CDN.
function validate(html) {
  const problems = [];
  if (html.length < 1500) problems.push('suspiciously short');
  if (!/<!doctype html/i.test(html)) problems.push('no doctype');
  if (!/<\/html>/i.test(html)) problems.push('truncated — no closing </html>');
  if (!/<style[\s>]/i.test(html)) problems.push('no inline <style>');
  const external = html.match(/<script[^>]+src=["']https?:/gi);
  if (external) problems.push(`${external.length} external script${external.length === 1 ? '' : 's'} — the page must be self-contained`);
  return problems;
}

function words(html) {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase();
  return new Set((text.match(/[a-z][a-z'-]{3,}/g) || []));
}

/* Generation 2 keeps the winner's words by contract. A variant that cannot read
   the winner will happily build a whole new page from the brief instead — same
   subject, same voice, entirely different page — and that failure is invisible
   in a thumbnail. So the copy is compared, and a restyle that drifted too far
   is reported as failed rather than offered as a choice. */
const COPY_FLOOR = 0.6;

function copyOverlap(winnerHtml, html) {
  const before = words(winnerHtml);
  if (before.size < 40) return 1;                  // too little to judge
  const after = words(html);
  let kept = 0;
  for (const w of before) if (after.has(w)) kept++;
  return kept / before.size;
}

async function generateVariant({ prompt, dir, cwd, allowRead, keepCopyOf, onPhase }) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'index.html');
  await rm(file, { force: true });
  // A re-roll into this slot replaces the page, so any original kept by the
  // inspector belongs to a design that no longer exists here.
  await rm(join(dir, 'index.baseline.html'), { force: true });

  const args = [
    '-p', prompt,
    '--system-prompt', SYSTEM,
    '--tools', allowRead ? 'Write,Read' : 'Write',
    // acceptEdits, not dontAsk. capture.mjs gets away with dontAsk because it
    // only reads; dontAsk denies Write outright and the run fails with a
    // polite explanation instead of a page.
    '--permission-mode', 'acceptEdits',
    '--disable-slash-commands',
    // No MCP servers. Nothing here needs them and loading a handful of them
    // four times over is pure latency.
    '--strict-mcp-config',
    '--model', MODEL,
    '--effort', EFFORT,
    '--output-format', 'stream-json',
    '--verbose',
  ];

  const result = await runClaude({ args, cwd: cwd || dir, onPhase });

  let html;
  try {
    html = await readFile(file, 'utf8');
  } catch {
    // Keep whatever the model said instead of writing. Without it, a blocked
    // tool or a refusal both read as the same blank "nothing was written".
    const said = String(result.result || '').replace(/\s+/g, ' ').trim();
    throw new Error(`no index.html was written${said ? ` — ${said.slice(0, 220)}` : ''}`);
  }

  const problems = validate(html);
  if (problems.length) throw new Error(problems.join('; '));

  let kept = null;
  if (keepCopyOf) {
    kept = copyOverlap(await readFile(keepCopyOf, 'utf8'), html);
    if (kept < COPY_FLOOR) {
      throw new Error(
        `restyle rewrote the page instead of reskinning it — only ${Math.round(kept * 100)}% of the winner's copy survived`
      );
    }
  }

  return {
    header: parseHeader(html),
    bytes: html.length,
    keptCopy: kept === null ? undefined : Math.round(kept * 100),
    costUsd: result.total_cost_usd ?? null,
  };
}

/* ── Projects ──────────────────────────────────────────────────────────────── */

const slug = (s) => String(s).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').slice(0, 48).replace(/^-|-$/g, '') || 'project';

export const projectDir = (id) => join(BUILDS, id);
const projectFile = (id) => join(projectDir(id), 'project.json');

export async function readProject(id) {
  return JSON.parse(await readFile(projectFile(id), 'utf8'));
}

// Four variants land whenever they land, and every one of them saves. Writes
// are queued per project and given unique temp names, because parallel
// write-then-rename against one path is a race the loser reports as ENOENT.
const writeQueue = new Map();
let writeSeq = 0;

async function persist(project) {
  const dir = projectDir(project.id);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `project.json.${process.pid}.${writeSeq++}.tmp`);
  await writeFile(tmp, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  await rename(tmp, projectFile(project.id));
  return project;
}

export function writeProject(project) {
  const prev = writeQueue.get(project.id) || Promise.resolve();
  const next = prev.then(() => persist(project));
  writeQueue.set(project.id, next.catch(() => {}));
  return next;
}

export async function listProjects() {
  let dirs = [];
  try {
    dirs = (await readdir(BUILDS, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const out = [];
  for (const id of dirs) {
    try { out.push(await readProject(id)); } catch { /* not a project folder */ }
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function createProject(brief, { references = null, variants = 4 } = {}) {
  const text = String(brief || '').trim();
  if (!text) throw new Error('a brief is required');

  let id = slug(text);
  let n = 2;
  const taken = new Set((await listProjects()).map((p) => p.id));
  const base = id;
  while (taken.has(id)) id = `${base}-${n++}`;

  const project = {
    id,
    brief: text,
    createdAt: new Date().toISOString(),
    variants: Math.min(Math.max(2, variants), VARIANT_KEYS.length),
    references: references ?? await proposeReferences(text),
    generations: [],
    final: null,
  };
  return writeProject(project);
}

export async function deleteProject(id) {
  await rm(projectDir(id), { recursive: true, force: true });
}

/* ── Running a generation ──────────────────────────────────────────────────── */

function generationOf(project, n) {
  return project.generations.find((g) => g.n === n) || null;
}

// Every angle this project has already shown Alex, so a re-roll never offers a
// direction he has already turned down.
function usedAngles(project, n) {
  const gen = generationOf(project, n);
  return gen ? gen.variants.map((v) => v.angle) : [];
}

export async function planGeneration(project, n, { reroll = false } = {}) {
  const count = project.variants;
  const seed = hash(project.brief + (reroll ? `:reroll:${Date.now()}` : ':1'));
  const exclude = reroll ? usedAngles(project, n) : [];
  const pool = n === 1 ? THESES : WORLDS;
  const angles = sample(pool, count, seed, exclude);

  const data = await readLibrary();
  const refs = project.references
    .map((id) => data.entries.find((e) => e.id === id))
    .filter(Boolean);

  return VARIANT_KEYS.slice(0, count).map((key, i) => ({
    key,
    angle: angles[i],
    // Rotate which reference leads, so four variants read the set four ways
    // rather than all averaging it.
    lead: refs.length > 1 ? refs[i % refs.length].title : null,
    status: 'pending',
    phase: '',
    file: `g${n}/${key}/index.html`,
  }));
}

/**
 * Fan out one generation. Emits progress through `onEvent` and writes each
 * variant's status into project.json as it lands, so a browser that reloads
 * mid-run picks the run back up from disk.
 */
export async function runGeneration(project, n, { reroll = false, onEvent = () => {} } = {}) {
  const data = await readLibrary();
  const refs = project.references.map((id) => data.entries.find((e) => e.id === id)).filter(Boolean);

  const winnerFile = n === 2 ? join(projectDir(project.id), generationOf(project, 1)?.winnerFile || '') : null;
  if (n === 2 && (!generationOf(project, 1)?.winner)) throw new Error('generation 2 needs a generation 1 winner');

  const variants = await planGeneration(project, n, { reroll });
  const gen = { n, kind: n === 1 ? 'concept' : 'world', startedAt: new Date().toISOString(), variants, winner: null, winnerFile: null };

  // Rebuilding generation 1 orphans generation 2: those pages are restylings of
  // a winner that no longer exists at that path. Drop them rather than leave a
  // board of four designs quietly pointing at the wrong thing.
  project.generations = project.generations
    .filter((g) => g.n !== n && !(n === 1 && g.n === 2))
    .concat(gen)
    .sort((a, b) => a.n - b.n);
  // Comments are landmarks on elements of a specific page. The pages being
  // replaced here are about to stop existing, and a landmark on a page that is
  // gone is worse than no landmark.
  const dropped = n === 1 ? ['g1/', 'g2/'] : ['g2/'];
  project.comments = (project.comments || []).filter((c) => !dropped.some((p) => c.path.startsWith(p)));
  if (n === 1) {
    project.final = null;
    await rm(join(projectDir(project.id), 'g2'), { recursive: true, force: true });
  }
  await writeProject(project);
  onEvent({ type: 'generation:start', generation: n, variants });

  // A variant's own record is updated in place, then the whole project is
  // rewritten — cheap at this size, and it keeps disk and memory identical.
  const save = async () => { await writeProject(project); };

  await Promise.all(variants.map(async (variant) => {
    const dir = join(projectDir(project.id), `g${n}`, variant.key);
    const outFile = join(dir, 'index.html');
    const label = `VARIANT ${variant.key.toUpperCase()}`;
    const t0 = Date.now();

    variant.status = 'running';
    variant.phase = 'thinking';
    variant.startedAt = new Date(t0).toISOString();
    await save();
    onEvent({ type: 'variant:start', generation: n, key: variant.key });

    const prompt = n === 1
      ? buildConceptPrompt({
          brief: project.brief, refs, groups: data.groups, thesis: variant.angle,
          lead: variant.lead, outFile, label, variantCount: variants.length,
        })
      : buildRestylePrompt({
          brief: project.brief, refs, groups: data.groups, world: variant.angle,
          lead: variant.lead, winnerFile, outFile, label,
        });

    try {
      const out = await generateVariant({
        prompt, dir,
        // Generation 2 must read the generation 1 winner, which lives in a
        // sibling folder. Claude Code only reaches inside its working
        // directory, so a restyle runs from the project root instead.
        cwd: n === 2 ? projectDir(project.id) : dir,
        allowRead: n === 2,
        keepCopyOf: n === 2 ? winnerFile : null,
        onPhase: (phase) => {
          if (variant.phase === phase) return;
          variant.phase = phase;
          onEvent({ type: 'variant:phase', generation: n, key: variant.key, phase });
        },
      });
      Object.assign(variant, {
        status: 'done', phase: '', ...out, seconds: Math.round((Date.now() - t0) / 1000),
      });
    } catch (err) {
      Object.assign(variant, {
        status: 'failed', phase: '', error: err.message.slice(0, 300),
        seconds: Math.round((Date.now() - t0) / 1000),
      });
    }
    await save();
    onEvent({ type: 'variant:done', generation: n, key: variant.key, status: variant.status, error: variant.error });
  }));

  gen.finishedAt = new Date().toISOString();
  await save();
  onEvent({ type: 'generation:done', generation: n });
  return project;
}

/* ── Editing a generated page ───────────────────────────────────────────────
   The inspector edits a page in the browser and writes the whole file back.
   Before the first write, the page the generator produced is copied aside, so
   "revert" is always exact rather than an attempt to undo in reverse.          */

const VARIANT_PATH = /^g[12]\/[a-f]\/index\.html$/;

const baselineOf = (file) => file.replace(/index\.html$/, 'index.baseline.html');

function editTarget(project, path) {
  if (!VARIANT_PATH.test(String(path))) throw new Error('that is not a variant page');
  return join(projectDir(project.id), path);
}

const exists = (file) => access(file).then(() => true, () => false);

export async function saveEdit(project, path, html) {
  const file = editTarget(project, path);
  if (!await exists(file)) throw new Error('no such page');

  const problems = validate(html);
  if (problems.length) throw new Error(`refused to save — ${problems.join('; ')}`);

  const baseline = baselineOf(file);
  if (!await exists(baseline)) await copyFile(file, baseline);

  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, html, 'utf8');
  await rename(tmp, file);
  return { bytes: html.length, baseline: true };
}

// Whether the generator's original is still on disk, which is the only thing
// that makes a revert meaningful. Asked over the API rather than by probing for
// the file, so opening the inspector does not log a 404 every time.
export async function isEdited(project, path) {
  return { edited: await exists(baselineOf(editTarget(project, path))) };
}

/* ── Pages ──────────────────────────────────────────────────────────────────
   A design is one page today — the generator is told to write exactly one file
   — but the workspace's page switcher reads the folder rather than assuming
   that, so a design that ever comes back as home + about + contact needs no
   change here.                                                                */

const titleOf = (html) => (html.slice(0, 4000).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
  .replace(/\s+/g, ' ').trim();

const pageName = (file) => (file === 'index.html' ? 'Home'
  : file.replace(/\.html$/, '').replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()));

export async function listPages(project, path) {
  const dir = dirname(editTarget(project, path));
  const rel = path.slice(0, path.lastIndexOf('/'));

  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.html') && f !== 'index.baseline.html');
  } catch {
    return [];
  }
  // index.html is the entry, so it leads however the directory sorted.
  files.sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));

  const out = [];
  for (const f of files) {
    let title = '';
    try { title = titleOf(await readFile(join(dir, f), 'utf8')); } catch { /* unreadable */ }
    out.push({ path: `${rel}/${f}`, file: f, name: pageName(f), title });
  }
  return out;
}

/* ── Comments ───────────────────────────────────────────────────────────────
   A comment is a landmark on an element, not a change to it: it is kept in
   project.json and never written into the page, so an exported design carries
   none of them.                                                               */

export function listComments(project, path) {
  return (project.comments || []).filter((c) => !path || c.path === path);
}

export async function addComment(project, { path, sel, label, text }) {
  if (!VARIANT_PATH.test(String(path))) throw new Error('that is not a variant page');
  if (!String(sel || '').trim()) throw new Error('a comment needs an element');
  if (!String(text || '').trim()) throw new Error('a comment needs something to say');

  project.comments ??= [];
  const comment = {
    id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    path,
    sel: String(sel),
    label: String(label || '').slice(0, 80),
    text: String(text).trim().slice(0, 2000),
    createdAt: new Date().toISOString(),
  };
  project.comments.push(comment);
  await writeProject(project);
  return comment;
}

export async function deleteComment(project, id) {
  const before = (project.comments || []).length;
  project.comments = (project.comments || []).filter((c) => c.id !== id);
  if (project.comments.length === before) throw new Error('no such comment');
  await writeProject(project);
  return { ok: true };
}

export async function revertEdit(project, path) {
  const file = editTarget(project, path);
  const baseline = baselineOf(file);
  if (!await exists(baseline)) throw new Error('no generated original was kept for this page');
  await copyFile(baseline, file);
  await rm(baseline, { force: true });
  return { ok: true };
}

export async function pickWinner(project, n, key) {
  const gen = generationOf(project, n);
  if (!gen) throw new Error(`generation ${n} has not run`);
  const variant = gen.variants.find((v) => v.key === key);
  if (!variant || variant.status !== 'done') throw new Error(`variant ${key} is not available to pick`);

  // Changing your mind about generation 1 invalidates generation 2 for the same
  // reason a regeneration does: those four are restylings of the old winner.
  if (n === 1 && gen.winner && gen.winner !== key) {
    project.generations = project.generations.filter((g) => g.n !== 2);
    await rm(join(projectDir(project.id), 'g2'), { recursive: true, force: true });
  }

  gen.winner = key;
  gen.winnerFile = variant.file;
  project.final = n === 2 ? variant.file : null;
  return writeProject(project);
}

/* A local tool gets Ctrl-C'd mid-run. Without this, project.json keeps four
   variants at "running" forever: the board shows a scan line that never
   resolves and the client polls fast for as long as it is open. Called once at
   server start, before anything can read a project. */
export async function reapInterrupted() {
  let healed = 0;
  for (const project of await listProjects()) {
    let touched = false;
    for (const gen of project.generations || []) {
      for (const v of gen.variants || []) {
        if (v.status !== 'running' && v.status !== 'pending') continue;
        Object.assign(v, { status: 'failed', phase: '', error: 'interrupted — the server stopped while this was generating' });
        touched = true;
      }
    }
    if (touched) { await writeProject(project); healed++; }
  }
  return healed;
}

/* ── CLI ───────────────────────────────────────────────────────────────────── */

async function cli() {
  const args = process.argv.slice(2);
  const flag = (name, fallback = null) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
  };
  const has = (name) => args.includes(`--${name}`);

  if (has('list')) {
    const projects = await listProjects();
    if (!projects.length) { console.log('No builds yet.'); return; }
    for (const p of projects) {
      const done = p.generations.map((g) => `g${g.n}:${g.variants.filter((v) => v.status === 'done').length}/${g.variants.length}${g.winner ? `→${g.winner}` : ''}`).join('  ');
      console.log(`${p.id.padEnd(50)} ${p.createdAt.slice(0, 10)}  ${done || '—'}`);
    }
    return;
  }

  const brief = args.filter((a, i) =>
    !a.startsWith('--') && !(i > 0 && ['--refs', '--variants'].includes(args[i - 1]))).join(' ');

  if (!brief.trim()) {
    console.log('Usage: node studio.mjs "your brief" [--refs id,id] [--variants 4]');
    process.exitCode = 1;
    return;
  }

  const refs = flag('refs') ? flag('refs').split(',').map((s) => s.trim()).filter(Boolean) : null;
  const project = await createProject(brief, { references: refs, variants: Number(flag('variants', 4)) });

  console.log(`\n  ${project.id}`);
  console.log(`  references: ${project.references.join(', ') || 'none'}`);
  console.log(`  generating ${project.variants} concepts…\n`);

  await runGeneration(project, 1, {
    onEvent: (e) => {
      if (e.type === 'variant:start') console.log(`  ${e.key} — started`);
      if (e.type === 'variant:done') {
        console.log(`  ${e.key} — ${e.status}${e.error ? `: ${e.error}` : ''}`);
      }
    },
  });

  console.log(`\n  builds/${project.id}/g1/\n`);
  for (const v of generationOf(project, 1).variants) {
    if (v.status !== 'done') continue;
    console.log(`  ${v.key}  ${v.header?.title || '(untitled)'} — ${v.header?.world || ''}`.slice(0, 160));
  }
  console.log('');
}

// Only run the CLI when invoked directly; the server imports this module.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await cli();
}
