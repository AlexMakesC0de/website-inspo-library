#!/usr/bin/env node
/* Website Inspo Library — motion capture.

   A screenshot can't show hover, scroll reveals, or easing. But every entry has
   a URL, so this visits the real site headlessly and reads the actual values:
   computed transitions, @keyframes, hover end-states, scroll behaviour, and
   which motion library is driving it.

   The result is better than a video for rebuilding, because it's numbers.

     node motion.mjs                  capture every entry that has none
     node motion.mjs lama-lama        one entry by id
     node motion.mjs --refresh        re-capture everything
     node motion.mjs --list           show what's captured so far              */

import { readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DATA = join(ROOT, 'data.json');
const LOG = join(ROOT, 'watcher', 'motion.log');
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const MODEL = process.env.MOTION_MODEL || 'sonnet';

const BROWSE = [
  join(ROOT, '.claude/skills/gstack/browse/dist/browse'),
  join(homedir(), '.claude/skills/gstack/browse/dist/browse'),
].find((p) => existsSync(p));

const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const only = args.find((a) => !a.startsWith('--'));

const log = async (m) => {
  const line = `${new Date().toISOString()}  ${m}\n`;
  process.stdout.write(line);
  try { await appendFile(LOG, line); } catch { /* first run */ }
};

const B = (...a) => run(BROWSE, a, { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });

/* ── In-page extraction ────────────────────────────────────────────────── */

// Runs inside the site. Computed styles are the reliable path — cross-origin
// stylesheets throw on .cssRules, so @keyframes are best-effort only.
const EXTRACT = `(() => {
  const out = { transitions: [], keyframes: [], libs: [], reducedMotion: false, scrollBehavior: '' };
  const seen = new Set();

  const describe = (el) => {
    const t = el.tagName.toLowerCase();
    const c = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    return (t + c).slice(0, 60);
  };

  for (const el of Array.from(document.querySelectorAll('*')).slice(0, 1200)) {
    const s = getComputedStyle(el);
    const dur = s.transitionDuration || '';
    const anim = s.animationName || '';
    if (dur && dur !== '0s' && !dur.split(',').every(d => d.trim() === '0s')) {
      const key = s.transitionProperty + '|' + dur + '|' + s.transitionTimingFunction;
      if (!seen.has(key) && out.transitions.length < 24) {
        seen.add(key);
        out.transitions.push({
          on: describe(el),
          property: s.transitionProperty,
          duration: dur,
          easing: s.transitionTimingFunction,
          delay: s.transitionDelay,
        });
      }
    }
    if (anim && anim !== 'none' && out.keyframes.length < 16) {
      const key = 'a|' + anim + s.animationDuration;
      if (!seen.has(key)) {
        seen.add(key);
        out.keyframes.push({
          on: describe(el), name: anim,
          duration: s.animationDuration, easing: s.animationTimingFunction,
          iteration: s.animationIterationCount,
        });
      }
    }
  }

  // @keyframes bodies, where the stylesheet is same-origin.
  try {
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) {
        if (r.type === CSSRule.KEYFRAMES_RULE && out.keyframes.length < 24) {
          const steps = Array.from(r.cssRules).map(k => k.keyText + ' {' +
            (k.style.cssText || '').slice(0, 120) + '}').slice(0, 3);
          out.keyframes.push({ name: r.name, steps });
        }
      }
    }
  } catch {}

  const LIBS = { gsap:'GSAP', ScrollTrigger:'ScrollTrigger', Lenis:'Lenis', lenis:'Lenis',
                 Motion:'Motion One', barba:'Barba', LocomotiveScroll:'Locomotive',
                 AOS:'AOS', Swiper:'Swiper', SplitType:'SplitType', anime:'anime.js', Rive:'Rive' };
  for (const [k, name] of Object.entries(LIBS)) if (window[k] && !out.libs.includes(name)) out.libs.push(name);
  for (const s of document.querySelectorAll('script[src]')) {
    const src = s.src.toLowerCase();
    for (const n of ['gsap','lenis','framer','locomotive','barba','aos','swiper','three','rive','lottie'])
      if (src.includes(n) && !out.libs.includes(n)) out.libs.push(n);
  }
  if (document.querySelector('canvas')) out.libs.push('canvas/WebGL present');

  out.reducedMotion = Array.from(document.styleSheets).some(sh => {
    try { return Array.from(sh.cssRules).some(r => (r.conditionText||'').includes('prefers-reduced-motion')); }
    catch { return false; }
  });
  out.scrollBehavior = getComputedStyle(document.documentElement).scrollBehavior;
  return JSON.stringify(out);
})()`;

// Hover ground-truth: what actually changes, measured rather than guessed.
const HOVER_PROBE = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'null';
  const s = getComputedStyle(el);
  return JSON.stringify({ color: s.color, background: s.backgroundColor, transform: s.transform,
    opacity: s.opacity, borderColor: s.borderColor, textDecoration: s.textDecorationLine,
    letterSpacing: s.letterSpacing, filter: s.filter });
})()`;

const HOVER_TARGETS = `(() => {
  const out = [];
  const pick = (sel, label) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const t = el.tagName.toLowerCase();
    const cls = (el.className && typeof el.className==='string')
      ? '.' + el.className.trim().split(/\\s+/)[0] : '';
    out.push({ label, sel: cls ? t + cls : sel });
  };
  pick('nav a, header a', 'nav link');
  pick('button, .btn, [class*="button"]', 'button');
  pick('a[class*="card"], article a, .card', 'card');
  pick('main img, section img', 'image');
  pick('h1 a, h2 a', 'heading link');
  return JSON.stringify(out.slice(0, 5));
})()`;

/* ── Capture one site ──────────────────────────────────────────────────── */

async function captureSite(url) {
  await B('goto', url);
  await new Promise((r) => setTimeout(r, 2500));   // let entry animations finish

  const raw = JSON.parse((await B('js', EXTRACT)).stdout.trim());

  // Hover each candidate and diff the computed style before/after.
  raw.hover = [];
  try {
    const targets = JSON.parse((await B('js', HOVER_TARGETS)).stdout.trim());
    for (const t of targets) {
      try {
        const before = JSON.parse((await B('js', HOVER_PROBE(t.sel))).stdout.trim());
        if (!before) continue;
        await B('hover', t.sel);
        await new Promise((r) => setTimeout(r, 500));
        const after = JSON.parse((await B('js', HOVER_PROBE(t.sel))).stdout.trim());
        const changed = Object.fromEntries(
          Object.entries(after).filter(([k, v]) => v !== before[k]).map(([k, v]) => [k, `${before[k]} → ${v}`])
        );
        if (Object.keys(changed).length) raw.hover.push({ target: t.label, changed });
      } catch { /* element vanished or is not hoverable */ }
    }
  } catch { /* no targets found */ }

  // Scroll reveal: what enters differently further down the page.
  try {
    await B('js', 'window.scrollTo({top: window.innerHeight * 1.5, behavior: "instant"}); "ok"');
    await new Promise((r) => setTimeout(r, 1200));
    const after = JSON.parse((await B('js', EXTRACT)).stdout.trim());
    const names = new Set(raw.keyframes.map((k) => k.name));
    raw.scrollRevealed = after.keyframes.filter((k) => !names.has(k.name)).slice(0, 8);
  } catch { raw.scrollRevealed = []; }

  return raw;
}

/* ── Condense to a usable brief ────────────────────────────────────────── */

const SYSTEM = `You turn raw browser motion measurements into a short character
read of how a site moves. You never claim more than the measurements support.
Output raw JSON only — no prose, no markdown fence.`;

async function condense(entry, raw) {
  const prompt = `These are measurements taken from a single automated visit to ${entry.url} (${entry.title}).

${JSON.stringify(raw).slice(0, 6000)}

Return ONE JSON object:

{
  "summary": "2-4 sentences on the CHARACTER of this site's motion: is it snappy or cinematic, incidental or choreographed, restrained or maximal? Concrete, not poetic.",
  "signature": "the single motion idea most worth learning from, in one sentence",
  "timings": ["at most 6 strings like 'nav link — color 180ms cubic-bezier(.4,0,.2,1)', as EXAMPLES of the feel"],
  "hover": ["at most 4 strings describing measured hover behaviour"],
  "libraries": ["motion libraries detected, plain names"],
  "reducedMotion": true or false,
  "coverage": "signal" | "thin"
}

WHAT THIS IS FOR — read this before writing anything.

This is a character signal for a designer, not a specification to rebuild from.
Nobody will reconstruct this site from your timings. What matters is whether a
reader comes away knowing it feels like "snappy micro-interactions, nothing
choreographed" or "cinematic, scroll-driven, everything eased".

NEVER CLAIM ABSENCE. This is one scripted visit with a fixed viewport and a
2.5-second wait. It misses scroll choreography, JS-driven easing, canvas work,
lazy sections, and anything below the fold. So:

  Allowed:  "No scroll animation was measured."
  Allowed:  "Nothing beyond a loading spinner surfaced in CSS."
  BANNED:   "Nothing animates on scroll."
  BANNED:   "The site has no motion."

If the measurements are thin, say the measurements are thin — never say the site
is still. A near-empty capture on a site with canvas or a motion library almost
always means the motion is somewhere these numbers cannot reach.

"coverage" has exactly two honest values:
- "signal" — enough was measured to describe the character with confidence.
- "thin"   — barely anything surfaced; the summary must say so and point at the
             live site.

Other rules:
- Use the measured numbers. Never invent a duration or easing that isn't in the data.
- Empty arrays are fine. An honest empty field beats an invented one.

Output the JSON object and nothing else.`;

  const { stdout } = await run(CLAUDE, [
    '-p', prompt, '--system-prompt', SYSTEM,
    '--disable-slash-commands', '--model', MODEL, '--effort', 'medium', '--output-format', 'json',
  ], { cwd: ROOT, maxBuffer: 8 * 1024 * 1024, timeout: 420_000 });

  const env = JSON.parse(stdout);
  if (env.is_error) throw new Error(env.result || 'claude error');
  const text = String(env.result ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

/* ── Main ──────────────────────────────────────────────────────────────── */

if (!BROWSE) {
  console.error('\n  Could not find the browse binary (gstack). Motion capture needs it.\n');
  process.exit(1);
}

const data = JSON.parse(await readFile(DATA, 'utf8'));

if (has('list')) {
  for (const e of data.entries) {
    const m = e.motion;
    console.log(`${e.id.padEnd(30)} ${m ? `${String(m.coverage || '?').padEnd(8)} ${m.timings?.length || 0} timings  ${(m.libraries || []).join(', ')}` : '—'}`);
  }
  process.exit(0);
}

let queue = data.entries.filter((e) => e.url);
if (only) queue = queue.filter((e) => e.id === only);
if (!has('refresh') && !only) queue = queue.filter((e) => !e.motion);

if (!queue.length) { await log('nothing to capture'); process.exit(0); }
await log(`capturing motion for ${queue.length} site${queue.length === 1 ? '' : 's'}`);

for (const entry of queue) {
  const t0 = Date.now();
  try {
    const raw = await captureSite(entry.url);
    const motion = await condense(entry, raw);
    // Only two levels are honest here. Anything else — including the old
    // "full", which never was — collapses to the one the data supports.
    if (!['signal', 'thin'].includes(motion.coverage)) {
      motion.coverage = (motion.timings?.length || motion.hover?.length) ? 'signal' : 'thin';
    }
    motion.capturedAt = new Date().toISOString().slice(0, 10);

    // Re-read so a browser edit landing mid-capture isn't clobbered.
    const fresh = JSON.parse(await readFile(DATA, 'utf8'));
    const target = fresh.entries.find((e) => e.id === entry.id);
    if (!target) { await log(`${entry.id} — vanished, skipping`); continue; }
    target.motion = motion;

    const tmp = `${DATA}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(fresh, null, 2)}\n`, 'utf8');
    await rename(tmp, DATA);

    await log(`${entry.id} — ${motion.coverage}, ${motion.timings?.length || 0} timings${motion.libraries?.length ? `, ${motion.libraries.join('/')}` : ''} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  } catch (err) {
    await log(`${entry.id} — FAILED: ${err.message.slice(0, 200)}`);
  }
}
