#!/usr/bin/env node
/* Installs the capture watcher as a macOS LaunchAgent.

   launchd's WatchPaths asks the kernel to watch screenshots/ and starts
   capture.mjs only when it changes — nothing runs while you're idle, and
   nothing has to be restarted after a reboot or logout.

     node watcher/install.mjs            install (or reinstall) and start
     node watcher/install.mjs --remove   stop and uninstall
     node watcher/install.mjs --status   show whether it is loaded             */

import { writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const LABEL = 'com.alexkar.inspo-capture';
const AGENTS = join(homedir(), 'Library', 'LaunchAgents');
const PLIST = join(AGENTS, `${LABEL}.plist`);
const DOMAIN = `gui/${process.getuid()}`;

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };
const bootout = () => run('launchctl', ['bootout', `${DOMAIN}/${LABEL}`]).catch(() => {});

/* ── status ────────────────────────────────────────────────────────────── */

if (process.argv.includes('--status')) {
  const installed = await exists(PLIST);
  console.log(`plist:     ${installed ? PLIST : 'not installed'}`);
  if (installed) {
    const { stdout } = await run('launchctl', ['print', `${DOMAIN}/${LABEL}`]).catch((e) => ({ stdout: e.stdout || '' }));
    const state = /state = (\S+)/.exec(stdout)?.[1] ?? 'not loaded';
    const last = /last exit code = (\S+)/.exec(stdout)?.[1];
    console.log(`launchd:   ${state}${last ? `  (last exit ${last})` : ''}`);
  }
  process.exit(0);
}

/* ── remove ────────────────────────────────────────────────────────────── */

if (process.argv.includes('--remove')) {
  await bootout();
  await rm(PLIST, { force: true });
  console.log(`\n  Watcher removed. Screenshots are no longer captured automatically.\n  Run captures by hand with: node capture.mjs\n`);
  process.exit(0);
}

/* ── install ───────────────────────────────────────────────────────────── */

// Resolve both binaries now: launchd runs jobs with a minimal PATH, so the
// plist has to name them absolutely.
const NODE = process.execPath;
let CLAUDE;
try {
  CLAUDE = (await run('which', ['claude'])).stdout.trim();
} catch {
  console.error('\n  Could not find the `claude` binary on PATH.\n  Install Claude Code, or set CLAUDE_BIN in the plist by hand.\n');
  process.exit(1);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${esc(NODE)}</string>
    <string>${esc(join(ROOT, 'capture.mjs'))}</string>
  </array>

  <!-- The whole point: the kernel watches this directory and starts the job
       only when it changes. Nothing is resident in between. -->
  <key>WatchPaths</key>
  <array>
    <string>${esc(join(ROOT, 'screenshots'))}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${esc(ROOT)}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>CLAUDE_BIN</key>
    <string>${esc(CLAUDE)}</string>
    <key>PATH</key>
    <string>${esc(`${dirname(CLAUDE)}:${dirname(NODE)}:/usr/local/bin:/usr/bin:/bin`)}</string>
    <key>HOME</key>
    <string>${esc(homedir())}</string>
  </dict>

  <!-- Fire on change only, never on load, and never respawn on exit. -->
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <false/>
  <!-- launchd coalesces rapid changes; the job also single-flights on a lock. -->
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>Nice</key>
  <integer>5</integer>

  <key>StandardOutPath</key>
  <string>${esc(join(HERE, 'launchd.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${esc(join(HERE, 'launchd.err.log'))}</string>
</dict>
</plist>
`;

await mkdir(AGENTS, { recursive: true });
await mkdir(HERE, { recursive: true });
await bootout();                       // idempotent reinstall
await writeFile(PLIST, plist, 'utf8');
await run('launchctl', ['bootstrap', DOMAIN, PLIST]);

console.log(
  `\n  Watcher installed and running.\n\n` +
  `    watching   ${join(ROOT, 'screenshots')}\n` +
  `    runs       ${join(ROOT, 'capture.mjs')}\n` +
  `    node       ${NODE}\n` +
  `    claude     ${CLAUDE}\n` +
  `    log        ${join(HERE, 'capture.log')}\n\n` +
  `  Drop a screenshot into screenshots/ and it becomes a draft entry.\n` +
  `  Remove with: node watcher/install.mjs --remove\n`
);
