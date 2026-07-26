#!/usr/bin/env node
/* Website Inspo Library — CLI search.
   Reads data.json and prints matching entries as markdown for an agent to
   consume. Same source of truth as the browser; no server required.

   node search.mjs "minimal hero"
   node search.mjs --group dither-mono
   node search.mjs --list
   node search.mjs "editorial" --limit 3 --json                             */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const query = args.filter((a, i) =>
  !a.startsWith('--') && !(i > 0 && ['--group', '--limit'].includes(args[i - 1]))
).join(' ').trim();

const limit = Number(flag('limit', 5));
const group = flag('group');

const data = JSON.parse(await readFile(join(ROOT, 'data.json'), 'utf8'));
const groups = data.groups || [];
const all = data.entries || [];

// Drafts are captured but not yet reviewed by Alex — they may carry a wrong
// group, no source URL, or tags he'd reject. Never serve them as references.
const entries = all.filter((e) => e.status !== 'draft');
const draftCount = all.length - entries.length;

const groupName = (id) => groups.find((g) => g.id === id)?.name || 'Ungrouped';

// Motion is a character read taken from one scripted visit, never a spec, and
// never evidence that a site is still. The label says so wherever it appears.
const coverageLabel = (c) => ({
  signal: 'a character read from one automated visit, not a spec',
  thin: 'barely anything was measurable; open the live site',
}[c] || 'measured from one automated visit; treat as character, not spec');

/* ── Scoring ───────────────────────────────────────────────────────────── */

// Weighted so a term in a tag beats the same term buried in prose.
const WEIGHTS = [
  ['title', 6], ['descriptor', 5], ['tags', 5], ['group', 4],
  ['recipe', 3], ['imagePrompt', 2], ['copyBrief', 2], ['note', 2], ['url', 1],
];

function fieldText(entry, field) {
  if (field === 'tags') return (entry.tags || []).join(' ');
  if (field === 'group') return groupName(entry.group);
  return entry[field] || '';
}

function score(entry, terms) {
  if (!terms.length) return 1;
  let total = 0;
  for (const term of terms) {
    let best = 0;
    for (const [field, weight] of WEIGHTS) {
      const text = fieldText(entry, field).toLowerCase();
      if (!text) continue;
      if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)) best = Math.max(best, weight);
      else if (text.includes(term)) best = Math.max(best, weight * 0.6);
    }
    total += best;
  }
  return total;
}

/* ── Output ────────────────────────────────────────────────────────────── */

if (has('list')) {
  const counts = new Map();
  for (const e of entries) counts.set(e.group, (counts.get(e.group) || 0) + 1);
  console.log(`# ${data.collection} — ${entries.length} entries\n`);
  for (const g of groups) console.log(`- ${g.name}  (--group ${g.id})  ${counts.get(g.id) || 0}`);
  if (draftCount) console.log(`\n${draftCount} draft${draftCount === 1 ? '' : 's'} awaiting review (not searchable until approved).`);
  process.exit(0);
}

const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

let hits = entries
  .filter((e) => !group || e.group === group)
  .map((e) => ({ e, s: score(e, terms) }))
  .filter((h) => h.s > 0)
  .sort((a, b) => b.s - a.s)
  .slice(0, Math.max(1, limit))
  .map((h) => h.e);

if (has('json')) {
  console.log(JSON.stringify(hits, null, 2));
  process.exit(0);
}

if (!entries.length) {
  console.log('The inspo library is empty — no saved references to draw on yet.');
  process.exit(0);
}

if (!hits.length) {
  console.log(`No entries in the inspo library match "${query}".`);
  console.log(`The library holds ${entries.length} entries across: ${groups.map((g) => g.name).join(', ')}.`);
  process.exit(0);
}

const label = query ? `matching "${query}"` : 'in the library';
console.log(`# ${hits.length} reference${hits.length === 1 ? '' : 's'} ${label}\n`);

for (const e of hits) {
  console.log(`## ${e.title}${e.descriptor ? ` — ${e.descriptor}` : ''}`);
  console.log(`**Group:** ${groupName(e.group)}`);
  if (e.url) console.log(`**Source:** ${e.url}`);
  if (e.screenshot) console.log(`**Screenshot:** screenshots/${e.screenshot}`);
  if (e.tags?.length) console.log(`**Tags:** ${e.tags.join(' · ')}`);
  if (e.recipe) console.log(`\n**Image recipe**\n${e.recipe}`);
  if (e.copyBrief) console.log(`\n**Copy brief**\n${e.copyBrief}`);
  if (e.imagePrompt) console.log(`\n**Asset prompt**\n${e.imagePrompt}`);
  if (e.motion) console.log(`\n**Motion** — ${coverageLabel(e.motion.coverage)}\n${e.motion.summary}${e.motion.timings?.length ? '\n' + e.motion.timings.map(t => '- ' + t).join('\n') : ''}`);
  if (e.note) console.log(`\n**Why it was saved**\n${e.note}`);
  console.log('\n---\n');
}
