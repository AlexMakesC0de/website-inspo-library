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
  let data;
  try {
    data = JSON.parse(await readFile(DATA, 'utf8'));
  } catch (err) {
    // Same reason as the server's reader: a clone starts with no library.
    if (err.code !== 'ENOENT') throw err;
    data = {};
  }
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

  THE STAND-IN IS THE PART THAT USUALLY FAILS. A two-stop linear-gradient in a
  rectangle is not a stand-in. At the size these frames run, it becomes the
  largest dead area on the page and it reads as unfinished work. Build the
  stand-in from the same world as everything else, at the frame's own scale:
  registration marks, a halftone or dither field, a ruled grid, sprocket
  perforations, a duotone SVG figure, a caption plate, a torn edge. Use at
  least three CSS techniques in it and give it something with a hard edge.
  Cropped out of the page and shown alone, it should still look designed.
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

/* The runs are spawned with --disable-slash-commands and no MCP, so no skill can
   reach them. Anything the generator needs to know about craft has to be in this
   string. The floor below is the mechanical half of Impeccable's craft floor,
   rewritten for a pipeline that builds one page and stops. */
const SYSTEM = `You are a designer who builds. You produce complete, self-contained
HTML pages with inline CSS and no dependencies, and you commit fully to a
direction rather than hedging between several.

## The floor

These are checks on the built result, not intentions. Each is cheap to satisfy
and each one is conspicuous when it is missing.

- CONTRAST: body and placeholder text at 4.5:1 or better, large text at 3:1.
  On a coloured ground, tint secondary text from that hue — never flat grey.
- SPACING: tight inside a group, generous between groups, more room above a
  heading than below it. A page whose sections are all separated by the same
  gap has no rhythm, only padding.
- TYPE: body measure 65–75ch. Build an obvious scale — if your display size and
  your body size sit within 3x of each other there is no hierarchy, only sizes.
  Tracking floor -0.04em. Balance headline line breaks.
- DEPTH: a shadow carries an offset and a soft blur. A zero-offset coloured
  halo is decoration, not depth.
- MOTION: one authored moment the page is built around, not the same entrance
  fired on every section. Ease out from an already-visible default so nothing
  sits invisible waiting to animate.
- STATES: hover and keyboard focus on everything interactive, and real content
  in every slot — no container left waiting for data that never arrives.
- FILL THE FRAME: if a composition leaves a large area empty, that emptiness
  has to be doing something. Dead space beside a hero is not restraint.

## What not to reach for

The brief or a reference can earn any of these. Reaching for one because the
axis was free means you were not deciding.

- A row of same-size cards — icon, heading, three lines — as the page's
  structure. Cards are the lazy container, and nested cards are always wrong.
- The hero-metric template: big number, small label, supporting stats.
- A tracked uppercase eyebrow over every section. One named kicker is a
  system; an eyebrow everywhere is grammar you did not choose.
- Gradient text. Emphasis is weight, size, or colour.
- Glass and blur as decoration rather than as a specific effect.
- A coloured border-left thicker than 1px on cards, callouts, or alerts.
- Monospace as a costume for "technical". Mono belongs on things that are
  measured, counted, timed, filed or coded. If it labels nothing real, it is
  a costume.
- Section numbers unless the sequence carries information the reader needs.

With the floor green, spend the page on the world you committed to. When torn
between refined and committed, commit.

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

/* Techniques that build a surface. Plain linear-gradient is deliberately absent:
   a page whose only texture is a two-stop fade is the exact failure this list
   exists to catch, so counting it would defeat the check. */
const TEXTURE = [
  /repeating-linear-gradient/i,
  /repeating-radial-gradient/i,
  /conic-gradient/i,
  /radial-gradient/i,
  /mix-blend-mode/i,
  /feTurbulence/i,
  /feDisplacementMap/i,
  /clip-path/i,
  /mask-image/i,
  /backdrop-filter/i,
];

// Structural checks, plus the rules the prompt states outright and used to ask
// for on trust. Taste is still Alex's job; a variant that failed one of these
// did not make a judgement call, it dropped an instruction.
function validate(html) {
  const problems = [];
  if (html.length < 1500) problems.push('suspiciously short');
  if (!/<!doctype html/i.test(html)) problems.push('no doctype');
  if (!/<\/html>/i.test(html)) problems.push('truncated — no closing </html>');
  if (!/<style[\s>]/i.test(html)) problems.push('no inline <style>');
  const external = html.match(/<script[^>]+src=["']https?:/gi);
  if (external) problems.push(`${external.length} external script${external.length === 1 ? '' : 's'} — the page must be self-contained`);

  const h1 = (html.match(/<h1[\s>]/gi) || []).length;
  if (h1 !== 1) problems.push(h1 === 0 ? 'no <h1>' : `${h1} <h1> elements — there must be exactly one`);

  if (!/@media[^{]*prefers-reduced-motion/i.test(html)) problems.push('no prefers-reduced-motion block');
  if (!/@media[^{]*\((?:max|min)-width/i.test(html)) problems.push('no responsive breakpoint');

  const placeholder = html.match(/lorem ipsum|your headline here|\[(?:your|placeholder|insert)\b[^\]]*\]/i);
  if (placeholder) problems.push(`placeholder copy — "${placeholder[0].slice(0, 40)}"`);

  if (/data-asset-prompt=["']\s*["']/i.test(html)) problems.push('an asset frame has an empty data-asset-prompt');

  // A proxy, and the only one here: the stand-in art is where these pages go
  // flat, and a page built from two-stop fills is the shape that takes.
  const techniques = TEXTURE.filter((re) => re.test(html)).length;
  if (techniques < 3) {
    problems.push(`only ${techniques} texture technique${techniques === 1 ? '' : 's'} — the page is built out of flat fills`);
  }

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

/* ── Tweak ──────────────────────────────────────────────────────────────────
   The workspace's chat. Generating owns building a page; this owns adjusting
   the one in front of you, and the difference that matters is latency: a tweak
   answers in seconds because it returns a stylesheet rather than a file.

   The patch is always returned whole, never as a delta. The panel replaces its
   one <style> tag with whatever comes back, so a model that forgets a previous
   rule deletes it — which is why the current patch goes into every prompt and
   the contract below says so twice.                                          */

const TWEAK_MODEL = process.env.TWEAK_MODEL || 'sonnet';
const TWEAK_EFFORT = process.env.TWEAK_EFFORT || 'medium';

export const TWEAK_SYSTEM = `You are adjusting one finished landing page, in place, for the
designer who is looking at it. You answer with a stylesheet and nothing else.

You have taste and you use it. When the request is loose — "give this more air",
"make it feel colder" — choose specific values and commit to them rather than
asking which ones. When the request would hurt the page, say so in one sentence
in your reply, then do the closest thing that would not.

Hold the page's own world. Read the fonts, the palette, the spacing rhythm and
the rules it already has, and stay inside them unless the request is explicitly
to change one. A tweak that looks bolted on has failed even when it does what
it was asked.

Separate what you WON'T do from what you CAN'T. You emit CSS: you cannot draw
or photograph, and you cannot add an element. Never argue about whether a
picture suits the page — dressing a limit up as a design objection is the one
thing that makes this tool useless to the person using it.

Pictures have exactly two paths, and prose is neither of them:

- A file listed under "Images on disk beside this page" is real. Place it with
  a relative url().
- A picture that does not exist yet goes in an \`\`\`image fence, described in
  one line. Something downstream generates it. Do not ask for the file, do not
  say you need it supplied, and do not offer a CSS substitute — emitting the
  fence IS how you ask for it.

You answer in two parts: a sentence or two of plain prose, then the complete
patch in one fenced css block. Never put the stylesheet inside a JSON string.`;

/* The stylesheet gets its own fence rather than a string inside a JSON object.
   Asked for the JSON shape, the model escapes the inner quotes correctly and
   then writes raw newlines anyway — invalid JSON, roughly a third of the time,
   and worse the longer the patch. A fenced block makes newlines legal, so the
   payload cannot break the envelope. */
function tweakContract(patch) {
  return `## How to answer

Two parts, in this order, and nothing else.

**First**, one or two plain sentences saying what you changed. No heading, no
label, no preamble — just the sentences.

**Then** the complete patch, in one fenced css block:

\`\`\`css
.hero { ... }
\`\`\`

- The css block REPLACES the entire patch. It is not a diff. Everything from
  the current patch that should still apply must appear in it again, or it is
  gone. ${patch.trim() ? 'The current patch is above — carry it forward.' : 'There is no patch yet, so this is the whole of it.'}
- Write real CSS: rules, media queries, keyframes, pseudo-elements, custom
  properties. Newlines and quotes are fine — it is a css block, not a string.
- It is injected as a stylesheet at the end of the head, so it wins ties
  against the page's own rules without needing !important. Reach for
  !important only where the page sets that property inline.
- Selectors must match the page's actual markup. Prefer the classes it already
  has over long chains of nth-child.

**Only if** some words on the page need to change, add one more fenced block
after the css:

\`\`\`json
[{ "sel": "css selector", "value": "the new text" }]
\`\`\`

Leave it out entirely when nothing needs rewording, which is most of the time.

**If the request wants a picture that is not already on disk**, add this block
instead of arguing about it:

\`\`\`image
one line describing what the picture should be, in this page's own world
\`\`\`

Do not say whether it suits the page and do not offer a CSS substitute for it.
Something downstream can actually make the image; your job is to name it. Write
that line as a subject and a treatment, not as a prompt — the palette and the
framing get added later. Still emit your css block: leave it as the current
patch if nothing else changed.

You cannot add sections, reorder the page, or change its markup. If the request
needs that, say so in your sentences and leave the css block exactly as the
current patch is.`;
}

export function buildTweakPrompt({ message, history = [], refs = [], patch = '', source = '', images = [] }) {
  const said = history.length
    ? history.slice(-8).map((m) => `${m.role === 'you' ? 'DESIGNER' : 'YOU'}: ${m.text}`).join('\n\n')
    : null;

  /* The path is an nth-child chain: exact, and close to unreadable. The markup
     is what actually lets the model find the thing and pick a selector a human
     would have written, so both go in and the markup goes first. */
  const pointed = refs.map((r) => [
    `- ${r.label || r.sel}`,
    r.html ? `  \`\`\`html\n  ${String(r.html).replace(/\n/g, ' ').slice(0, 400)}\n  \`\`\`` : null,
    `  path: \`${r.sel}\``,
  ].filter(Boolean).join('\n')).join('\n\n');

  return `${refs.length
    ? `## The elements being pointed at\n\n${pointed}\n\nThe request is about these unless it plainly is not. Write selectors the page\nalready supports — its own classes — rather than repeating the paths above.`
    : '## Scope\n\nNothing is selected, so this is about the page as a whole.'}

## The page

\`\`\`html
${source}
\`\`\`

${images.length ? `## Images on disk beside this page

${images.map((f) => `- \`${f}\``).join('\n')}

These are real files in the same folder as the page. Reach for one with a
relative \`url()\` — \`background-image: url(${images[0]})\` — whenever the
request wants a picture. You cannot make an image, but you can place these.
` : ''}${patch.trim() ? `## The current patch\n\n\`\`\`css\n${patch.trim()}\n\`\`\`\n` : ''}${said ? `## What has been said so far\n\n${said}\n` : ''}
## The request

${message}

${tweakContract(patch)}`;
}

const wordChanges = (value) => (Array.isArray(value) ? value : [])
  .filter((t) => t && typeof t.sel === 'string' && typeof t.value === 'string')
  .slice(0, 40);

/* Three shapes, in falling order of preference: the fenced css the contract
   asks for, the old single JSON object in case a model still reaches for it,
   and — when neither is there — the reply on its own. That last case is not a
   failure: "that needs new markup, so I did nothing" is a real answer, and
   throwing it away to raise a parse error loses the one useful thing in it. */
export function parseTweak(out) {
  const text = String(out || '').trim();
  if (!text) throw new Error('the model returned nothing');

  const fences = [...text.matchAll(/```([a-z]*)[^\S\n]*\r?\n([\s\S]*?)```/gi)]
    .map((m) => ({ lang: m[1].toLowerCase(), body: m[2], at: m.index }));

  // A named picture the page does not have yet. The panel turns this into a
  // count control rather than another sentence, so choosing costs nothing.
  const wants = fences.filter((f) => f.lang === 'image').pop()?.body.trim().slice(0, 300) || null;

  const css = fences.filter((f) => f.lang === 'css').pop();
  if (css) {
    let changes = [];
    const json = fences.filter((f) => f.lang === 'json').pop();
    if (json) {
      // The words are optional; the patch is not. A malformed block here must
      // not cost the stylesheet that parsed perfectly well beside it.
      try { changes = wordChanges(JSON.parse(json.body)); } catch { /* skip */ }
    }
    return {
      reply: text.slice(0, fences[0].at).trim() || 'Done.',
      css: css.body.trim(),
      text: changes,
      image: wants,
    };
  }

  if (wants) {
    return { reply: text.slice(0, fences[0].at).trim() || 'That needs a picture.', css: null, text: [], image: wants };
  }

  const object = fences.filter((f) => f.lang === 'json').pop()?.body
    ?? (text.startsWith('{') ? text : null);
  if (object) {
    try {
      const data = JSON.parse(object);
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        return {
          reply: String(data.reply || '').trim() || 'Done.',
          css: typeof data.css === 'string' ? data.css : null,
          text: wordChanges(data.text),
          image: null,
        };
      }
    } catch { /* fall through to the reply on its own */ }
  }

  const rescued = salvage(text);
  if (rescued) return rescued;

  // No patch came back. Hand over what it did say, and change nothing.
  return { reply: text.replace(/```[\s\S]*?```/g, '').trim() || text.slice(0, 400), css: null, text: [], image: null };
}

/* The failure the fenced format was introduced to stop: a JSON object whose css
   string carries raw newlines. The envelope is invalid but both fields are
   still sitting there in full, and lifting them out turns a dead turn into a
   working one. Kept as a floor under the format, not as the way in. */
function salvage(text) {
  const css = text.match(/"css"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"(?:text|reply)"|,?\s*\})/)?.[1];
  if (!css || !css.trim()) return null;
  const unescape = (s) => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
    .replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const reply = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  return {
    reply: reply ? unescape(reply).trim() : 'Done.',
    css: unescape(css).trim(),
    text: [],
  };
}

export function listTweaks(project, path) {
  return (project.tweaks || []).filter((t) => !path || t.path === path);
}

async function addTweak(project, entry) {
  project.tweaks ??= [];
  const row = {
    id: `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    createdAt: new Date().toISOString(),
    ...entry,
  };
  project.tweaks.push(row);
  return row;
}

export async function clearTweaks(project, path) {
  if (!path) throw new Error('clearing a thread needs a page');
  const before = (project.tweaks || []).length;
  project.tweaks = (project.tweaks || []).filter((t) => t.path !== path);
  await writeProject(project);
  return { cleared: before - project.tweaks.length };
}

/* ── The asset pass ─────────────────────────────────────────────────────────
   The step studio.mjs has promised since the first build rules: something that
   reads an asset frame and puts a real picture in it.

   Two rules earned the hard way. A reference contributes CHARACTER, never its
   own image prompt — SKYCLINICS' prompt is a cool blue photograph, and pasted
   onto a warm printed-matter page it fights everything and no CSS filter saves
   it. And a generation model, asked for "a duotone halftone print", will hand
   back a PHOTOGRAPH OF ONE: paper edges, drop shadow, ornate frame, a title
   baked into the plate. Both failures are prompt-shaped, so both are fixed
   here rather than in whoever is reading the picture afterwards.             */

const ASSET_SYSTEM = `You write prompts for an image generator, then run them.

The picture has to belong to one specific page. You are given that page's own
visual world, its palette, the design references behind it, and the words the
designer actually used. Compose from all four:

- THE PAGE'S WORLD decides medium and palette. A printed-matter page gets a
  printed artefact; a night-field page gets something that glows. Name the
  page's actual ink and paper colours in the prompt.
- THE REFERENCES contribute character and moves only — atmosphere, scale,
  what the subject is doing. Never copy a reference's own image prompt, and
  never carry its palette across. A reference is how it feels, not what it is.
- THE DESIGNER'S WORDS decide the subject and are not up for negotiation. If
  they asked for a mountain, every variation is a mountain.
- EACH VARIATION takes a genuinely different medium or treatment. Four
  rewordings of one idea is a failed pass.

Every prompt you write must end with the framing rules, because the model's
default is to hand back a photograph of a printed object rather than the thing
itself:

  FULL BLEED, fills the entire frame edge to edge. No border, no paper edge,
  no torn edge, no mount, no drop shadow, no surrounding surface, no vignette
  frame. No text, no title, no lettering, no caption, no watermark.

Generate every variation, wait for all of them, and report the URLs.`;

export function buildAssetPrompt({ world, palette, request, refs = [], count, aspect }) {
  return `Make ${count} image${count === 1 ? '' : 's'} for one page.

## What the designer asked for

${request}

## The page's world

${world || '(not stated — read it from the palette below)'}

${palette.length ? `Its palette, which the picture must live inside:\n\n${palette.map((c) => `- \`${c.name}\`: ${c.value}`).join('\n')}` : ''}

${refs.length ? `## The design references behind this page

${refs.map((r) => `- **${r.title}** — ${r.descriptor || ''}\n  character: ${(r.recipe || '').slice(0, 260)}`).join('\n\n')}

Take atmosphere and scale from these. Do not take their palette, and do not
reuse any image prompt they carry.` : ''}

## How to do it

1. Write ${count} distinct prompt${count === 1 ? '' : 's'} — different medium or treatment each,
   same subject, all inside the page's palette, each ending with the framing rules.
2. Call generate_image once per prompt with model "nano_banana_pro" and
   aspect_ratio "${aspect}".
3. Poll job_status with sync true until each is completed.

## Answer with

One fenced json block and nothing else:

\`\`\`json
{ "assets": [ { "style": "two or three words naming the treatment", "prompt": "the prompt you used", "url": "the completed rawUrl" } ] }
\`\`\``;
}

/* The page's own account of itself, which the generator wrote into its header,
   plus whatever custom properties it settled on. Together these are a better
   brief than anything a second model would infer from the markup. */
export function pageWorld(source) {
  const world = parseHeader(source).world || '';
  const seen = new Map();
  for (const m of source.matchAll(/(--[a-z][a-z0-9-]*)\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\)|oklch\([^)]+\))/gi)) {
    if (!seen.has(m[1])) seen.set(m[1], m[2]);
  }
  return { world, palette: [...seen].slice(0, 12).map(([name, value]) => ({ name, value })) };
}

/* No --tools allowlist here, deliberately. Naming the MCP tools in it does not
   allow them, it silently removes them: the run then narrates "I'll call that
   tool now" and returns having called nothing, which looks exactly like a model
   failure and is not one. The permission mode has to be bypassPermissions for
   the same reason dontAsk cannot write a page — it denies rather than asks. The
   run is given the page's own folder as its cwd and a system prompt with one
   job, which is the containment that is actually available. */

export async function generateAssets(project, path, { request, count = 4, aspect = '16:9' } = {}) {
  if (!VARIANT_PATH.test(String(path))) throw new Error('that is not a variant page');
  const want = Math.min(Math.max(Number(count) || 1, 1), 4);
  const asked = String(request || '').trim();
  if (!asked) throw new Error('an image needs a description');

  const file = editTarget(project, path);
  if (!await exists(file)) throw new Error('no such page');
  const source = await readFile(file, 'utf8');
  const { world, palette } = pageWorld(source);

  const data = await readLibrary();
  const refs = (project.references || [])
    .map((id) => data.entries.find((e) => e.id === id))
    .filter(Boolean)
    .slice(0, 4);

  const result = await runClaude({
    args: [
      '-p', buildAssetPrompt({ world, palette, request: asked, refs, count: want, aspect }),
      '--system-prompt', ASSET_SYSTEM,
      // The one step that needs MCP, so --strict-mcp-config is absent here.
      '--permission-mode', 'bypassPermissions',
      '--disable-slash-commands',
      '--model', TWEAK_MODEL,
      '--effort', TWEAK_EFFORT,
      '--output-format', 'stream-json',
      '--verbose',
    ],
    cwd: dirname(file),
  });

  const block = String(result.result || '').match(/```(?:json)?\s*\r?\n([\s\S]*?)```/);
  let assets = [];
  try {
    assets = JSON.parse(block ? block[1] : String(result.result))?.assets || [];
  } catch {
    throw new Error('the asset pass did not report any images');
  }
  assets = assets.filter((a) => a && typeof a.url === 'string' && /^https?:\/\//.test(a.url));
  if (!assets.length) throw new Error('the asset pass did not report any images');

  // Downloaded beside the page, because that is where a relative url() can
  // reach them and where the tweak pass already looks.
  const stamp = Date.now().toString(36);
  const out = [];
  for (const [i, asset] of assets.entries()) {
    const name = `asset-${stamp}-${String.fromCharCode(97 + i)}.png`;
    const res = await fetch(asset.url);
    if (!res.ok) continue;
    await writeFile(join(dirname(file), name), Buffer.from(await res.arrayBuffer()));
    out.push({ file: name, style: String(asset.style || '').slice(0, 60), prompt: String(asset.prompt || '').slice(0, 600) });
  }
  if (!out.length) throw new Error('every image failed to download');
  return { assets: out };
}

export async function runTweak(project, path, { message, refs = [], patch = '' }) {
  if (!VARIANT_PATH.test(String(path))) throw new Error('that is not a variant page');
  const said = String(message || '').trim();
  if (!said) throw new Error('a tweak needs something to ask for');

  const file = editTarget(project, path);
  if (!await exists(file)) throw new Error('no such page');
  const source = await readFile(file, 'utf8');

  /* Anything droppable into the page's own folder is fair game for a url().
     This is the whole reason a tweak can put a photograph on a page it could
     never have drawn: someone else made the file, and CSS can point at it. */
  const images = await readdir(dirname(file))
    .then((names) => names.filter((n) => /\.(png|jpe?g|webp|avif|gif|svg)$/i.test(n)).sort())
    .catch(() => []);

  const history = listTweaks(project, path);
  const prompt = buildTweakPrompt({ message: said, history, refs, patch, source, images });

  const result = await runClaude({
    args: [
      '-p', prompt,
      '--system-prompt', TWEAK_SYSTEM,
      // Nothing to read and nothing to write: the page is in the prompt and the
      // answer comes back as text. A tool here would only be a way to go wrong.
      '--tools', '',
      '--permission-mode', 'dontAsk',
      '--disable-slash-commands',
      '--strict-mcp-config',
      '--model', TWEAK_MODEL,
      '--effort', TWEAK_EFFORT,
      '--output-format', 'stream-json',
      '--verbose',
    ],
    cwd: projectDir(project.id),
  });

  const answer = parseTweak(result.result);

  await addTweak(project, { path, role: 'you', text: said, refs: refs.map((r) => r.label || r.sel) });
  const reply = await addTweak(project, {
    path,
    role: 'ai',
    text: answer.reply,
    changed: !!(answer.css || answer.text.length),
  });
  await writeProject(project);

  return { ...answer, id: reply.id };
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
