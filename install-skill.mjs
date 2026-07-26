#!/usr/bin/env node
/* Installs the design-library skill at user level (~/.claude/skills), so Claude
   Code can search this library from any project — not just this one.

   Symlinks rather than copies, so edits to skill/design-library/SKILL.md take
   effect immediately. Rewrites the hardcoded library path first, so the skill
   stays correct if this repo ever moves.

   node install-skill.mjs            install or repair
   node install-skill.mjs --remove   uninstall                              */

import { symlink, readlink, rm, mkdir, stat, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(ROOT, 'skill', 'design-library');
const SKILL_MD = join(SOURCE, 'SKILL.md');
const DEST_DIR = join(homedir(), '.claude', 'skills');
const DEST = join(DEST_DIR, 'design-library');

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };
const linkTarget = async (p) => { try { return await readlink(p); } catch { return null; } };

if (process.argv.includes('--remove')) {
  if (await exists(DEST) || await linkTarget(DEST)) {
    await rm(DEST, { recursive: true, force: true });
    console.log(`Removed ${DEST}`);
  } else {
    console.log('Nothing installed.');
  }
  process.exit(0);
}

// Keep the absolute paths inside SKILL.md pointing at wherever this repo lives.
const md = await readFile(SKILL_MD, 'utf8');
const fixed = md.replace(/\/Users\/[^\s`)"]*?website-inspo-library/g, ROOT);
if (fixed !== md) {
  await writeFile(SKILL_MD, fixed, 'utf8');
  console.log(`Updated library path in SKILL.md → ${ROOT}`);
}

await mkdir(DEST_DIR, { recursive: true });

const current = await linkTarget(DEST);
if (current === SOURCE) {
  console.log(`Already installed → ${DEST}`);
  process.exit(0);
}

if (current !== null || await exists(DEST)) {
  console.error(
    `\n  ${DEST} already exists and is not a link to this repo.\n` +
    `  Inspect it, then remove it and re-run:\n\n    rm -rf "${DEST}"\n`
  );
  process.exit(1);
}

await symlink(SOURCE, DEST, 'dir');
console.log(
  `\n  Installed design-library → ${DEST}\n` +
  `  Claude Code will now search this library from any project.\n` +
  `  Start a new session to pick it up.\n`
);
