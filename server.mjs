#!/usr/bin/env node
/* Website Inspo Library — local server.
   Serves the grid and owns every write to data.json, so the browser and the
   CLI search never diverge. Node standard library only; nothing to install. */

import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import { join, extname, resolve, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as studio from './studio.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DATA = join(ROOT, 'data.json');
const SHOTS = join(ROOT, 'screenshots');
const INSPECTOR = join(ROOT, 'assets', 'inspector-frame.js');
const PORT = Number(process.env.PORT) || 4610;

const IMAGE_RE = /\.(png|jpe?g|webp|avif|gif)$/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

/* ── data.json ─────────────────────────────────────────────────────────── */

async function readData() {
  let raw;
  try {
    raw = await readFile(DATA, 'utf8');
  } catch (err) {
    // A clone has no library. data.json is deliberately not in the repo — it is
    // one person's taste, and shipping it would hand every new user someone
    // else's. Start an empty one rather than refusing to boot.
    if (err.code !== 'ENOENT') throw err;
    return writeData({ groups: [], entries: [] });
  }
  const data = JSON.parse(raw);
  data.groups ??= [];
  data.entries ??= [];
  return data;
}

// Write to a sibling temp file and rename, so a crash mid-write can never
// leave a truncated library behind.
async function writeData(data) {
  const tmp = `${DATA}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, DATA);
  return data;
}

const slug = (s) => String(s).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'entry';

function uniqueId(base, entries, ignore) {
  let id = base;
  let n = 2;
  while (entries.some((e) => e.id === id && e.id !== ignore)) id = `${base}-${n++}`;
  return id;
}

const FIELDS = ['title', 'descriptor', 'url', 'group', 'screenshot', 'recipe', 'copyBrief', 'imagePrompt', 'note', 'status'];

function shape(body, existing) {
  const out = { ...existing };
  for (const f of FIELDS) if (typeof body[f] === 'string') out[f] = body[f];
  if (Array.isArray(body.tags)) out.tags = body.tags.map(String).filter(Boolean);
  // An empty status means "live" — drop the key rather than storing "".
  if (!out.status) delete out.status;
  return out;
}

// Approving an entry also confirms the group the capture job proposed for it.
function settleGroup(data, entry) {
  if (entry.status === 'draft') return;
  const g = data.groups.find((x) => x.id === entry.group);
  if (g?.proposed) delete g.proposed;
}

/* ── Routing ───────────────────────────────────────────────────────────── */

const json = (res, code, payload) => {
  res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) {
    chunks.push(c);
    if (chunks.reduce((n, b) => n + b.length, 0) > 2_000_000) throw new Error('payload too large');
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

/* ── Live updates ──────────────────────────────────────────────────────── */

const listeners = new Set();

function broadcast(event = 'data', payload = Date.now()) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of listeners) {
    try { res.write(frame); } catch { listeners.delete(res); }
  }
}

// Watch the DIRECTORY, not the file: every writer here replaces data.json via
// rename(), which swaps the inode and silently kills a watch on the file.
let notifyTimer;
try {
  watch(ROOT, (_event, filename) => {
    if (filename !== 'data.json') return;
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(broadcast, 120);   // coalesce write+rename
  });
} catch (err) {
  console.warn(`  Live updates unavailable (${err.message}); clients will poll instead.`);
}

function stream(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  listeners.add(res);

  // Comment frames keep the connection from being reaped while idle.
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* closed */ }
  }, 25_000);

  const drop = () => { clearInterval(ping); listeners.delete(res); };
  req.on('close', drop);
  req.on('error', drop);
}

/* ── Studio ────────────────────────────────────────────────────────────── */

// One generation per project at a time. Two overlapping fan-outs would write
// the same project.json from two places and race each other's variant states.
const running = new Map();

const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;

async function studioApi(req, res, url) {
  const rest = url.pathname.slice('/api/studio/'.length);

  if (rest === 'search' && req.method === 'GET') {
    const ids = await studio.proposeReferences(url.searchParams.get('q') || '', 8);
    return json(res, 200, ids);
  }

  if (rest === 'projects' && req.method === 'GET') {
    return json(res, 200, await studio.listProjects());
  }

  if (rest === 'projects' && req.method === 'POST') {
    const body = await readBody(req);
    if (!String(body.brief || '').trim()) return json(res, 400, { error: 'a brief is required' });
    const project = await studio.createProject(body.brief, {
      references: Array.isArray(body.references) ? body.references : null,
      variants: Number(body.variants) || 4,
    });
    broadcast('studio', { type: 'project:new', id: project.id });
    return json(res, 201, project);
  }

  const parts = rest.split('/');
  if (parts[0] !== 'projects' || !parts[1]) return json(res, 404, { error: 'unknown endpoint' });

  const id = decodeURIComponent(parts[1]);
  if (!SAFE_ID.test(id)) return json(res, 400, { error: 'bad project id' });

  let project;
  try {
    project = await studio.readProject(id);
  } catch {
    return json(res, 404, { error: 'no such project' });
  }

  const action = parts[2] || '';

  if (!action && req.method === 'GET') return json(res, 200, project);

  if (!action && req.method === 'DELETE') {
    if ([...running.keys()].some((k) => k.startsWith(`${id}:`))) {
      return json(res, 409, { error: 'a generation is still running' });
    }
    await studio.deleteProject(id);
    broadcast('studio', { type: 'project:deleted', id });
    return json(res, 200, { ok: true });
  }

  if (action === 'references' && req.method === 'PUT') {
    const body = await readBody(req);
    if (!Array.isArray(body.references)) return json(res, 400, { error: 'references must be an array' });
    const data = await readData();
    // Silently drop ids that no longer exist rather than failing the save.
    project.references = body.references.filter((r) => data.entries.some((e) => e.id === r && e.status !== 'draft'));
    if (typeof body.brief === 'string' && body.brief.trim()) project.brief = body.brief.trim();
    await studio.writeProject(project);
    return json(res, 200, project);
  }

  if (action === 'generate' && req.method === 'POST') {
    const body = await readBody(req);
    const n = Number(body.generation) === 2 ? 2 : 1;
    const key = `${id}:${n}`;
    if (running.has(key)) return json(res, 409, { error: `generation ${n} is already running` });

    running.set(key, true);
    // Fire and forget: the fan-out outlives the request, so a browser reload
    // mid-run rejoins from project.json rather than killing four Claudes.
    studio.runGeneration(project, n, {
      reroll: body.reroll === true,
      onEvent: (e) => broadcast('studio', { id, ...e }),
    })
      .catch((err) => broadcast('studio', { id, type: 'generation:error', generation: n, error: err.message }))
      .finally(() => {
        running.delete(key);
        broadcast('studio', { id, type: 'generation:settled', generation: n });
      });

    return json(res, 202, { started: n });
  }

  // The inspector sends the whole page back, patched. It is written as-is;
  // the server's only jobs are keeping the generator's original aside and
  // refusing anything that stopped being a self-contained page.
  if (action === 'pages' && req.method === 'GET') {
    try {
      return json(res, 200, await studio.listPages(project, url.searchParams.get('path')));
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (action === 'comments') {
    const id2 = parts[3] ? decodeURIComponent(parts[3]) : null;

    if (req.method === 'GET') {
      return json(res, 200, studio.listComments(project, url.searchParams.get('path')));
    }
    if (req.method === 'POST' && !id2) {
      try {
        return json(res, 201, await studio.addComment(project, await readBody(req)));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (req.method === 'DELETE' && id2) {
      try {
        return json(res, 200, await studio.deleteComment(project, id2));
      } catch (err) {
        return json(res, 404, { error: err.message });
      }
    }
    return json(res, 405, { error: 'unsupported method' });
  }

  /* One tweak takes seconds rather than the minutes a generation takes, so it
     answers on its own request instead of over the event stream. The page is
     saved by the inspector's own save, not here — this only returns the patch
     and records what was said. */
  if (action === 'tweak') {
    if (req.method === 'GET') {
      return json(res, 200, studio.listTweaks(project, url.searchParams.get('path')));
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      try {
        return json(res, 200, await studio.runTweak(project, body.path, {
          message: body.message,
          refs: Array.isArray(body.refs) ? body.refs : [],
          patch: String(body.patch || ''),
        }));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (req.method === 'DELETE') {
      try {
        return json(res, 200, await studio.clearTweaks(project, url.searchParams.get('path')));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    return json(res, 405, { error: 'unsupported method' });
  }

  /* The asset pass. Slower than a tweak (it runs a generator N times), so the
     panel shows its own waiting state rather than pretending this is instant. */
  if (action === 'assets' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      return json(res, 200, await studio.generateAssets(project, body.path, {
        request: body.request,
        count: body.count,
        aspect: body.aspect,
      }));
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (action === 'edit' && req.method === 'GET') {
    try {
      return json(res, 200, await studio.isEdited(project, url.searchParams.get('path')));
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (action === 'edit' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const out = await studio.saveEdit(project, body.path, String(body.html || ''));
      // A studio tab may be previewing this same page on the board.
      broadcast('studio', { id, type: 'edit', path: body.path });
      return json(res, 200, out);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (action === 'revert' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      return json(res, 200, await studio.revertEdit(project, body.path));
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (action === 'pick' && req.method === 'POST') {
    const body = await readBody(req);
    const n = Number(body.generation) === 2 ? 2 : 1;
    try {
      await studio.pickWinner(project, n, String(body.key || ''));
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    broadcast('studio', { id, type: 'pick', generation: n, key: body.key });
    return json(res, 200, project);
  }

  return json(res, 404, { error: 'unknown endpoint' });
}

/* ── Routing ───────────────────────────────────────────────────────────── */

async function api(req, res, url) {
  const { pathname } = url;

  if (pathname.startsWith('/api/studio/')) return studioApi(req, res, url);

  if (pathname === '/api/stream' && req.method === 'GET') {
    return stream(req, res);
  }

  if (pathname === '/api/data' && req.method === 'GET') {
    return json(res, 200, await readData());
  }

  if (pathname === '/api/screenshots' && req.method === 'GET') {
    let files = [];
    try {
      files = (await readdir(SHOTS)).filter((f) => IMAGE_RE.test(f)).sort();
    } catch { /* folder may not exist yet */ }
    return json(res, 200, files);
  }

  if (pathname === '/api/entries' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.title?.trim()) return json(res, 400, { error: 'title is required' });
    const data = await readData();
    const entry = shape(body, {
      id: uniqueId(slug(body.title), data.entries),
      tags: [],
      addedAt: new Date().toISOString().slice(0, 10),
    });
    data.entries.push(entry);
    await writeData(data);
    return json(res, 201, data);
  }

  const match = pathname.match(/^\/api\/entries\/(.+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const data = await readData();
    const i = data.entries.findIndex((e) => e.id === id);
    if (i === -1) return json(res, 404, { error: 'no such entry' });

    if (req.method === 'PUT') {
      const body = await readBody(req);
      data.entries[i] = shape(body, data.entries[i]);
      settleGroup(data, data.entries[i]);
      await writeData(data);
      return json(res, 200, data);
    }
    if (req.method === 'DELETE') {
      // The screenshot file is deliberately left on disk.
      data.entries.splice(i, 1);
      await writeData(data);
      return json(res, 200, data);
    }
  }

  return json(res, 404, { error: 'unknown endpoint' });
}

/* ── Static ────────────────────────────────────────────────────────────── */

// The inspector is injected on the way out and only when asked for, so the
// generated file on disk never carries a line of it and stays exportable.
// Inlined rather than linked: the frame is sandboxed into an opaque origin, and
// a same-origin URL is the one thing it cannot be trusted to resolve.
async function inspected(html) {
  const js = await readFile(INSPECTOR, 'utf8');
  const tag = `\n<script data-inspector>\n${js}\n</${'script'}>\n`;
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, () => `${tag}</body>`)
    : html + tag;
}

async function serveStatic(req, res, url) {
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const file = rel === '' ? join(ROOT, 'index.html') : resolve(ROOT, rel);

  // Refuse anything that resolves outside the project directory.
  if (file !== ROOT.replace(/[/\\]$/, '') && !file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(file);
    const target = info.isDirectory() ? join(file, 'index.html') : file;
    let buf = await readFile(target);

    if (url.searchParams.get('inspect') === '1'
        && rel.startsWith('builds/') && extname(target).toLowerCase() === '.html') {
      buf = Buffer.from(await inspected(buf.toString('utf8')), 'utf8');
    }

    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': MIME['.html'] });
    res.end('<!doctype html><meta charset="utf-8"><title>404</title><p>Not found.');
  }
}

/* ── Boot ──────────────────────────────────────────────────────────────── */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await serveStatic(req, res, url);
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n  Port ${PORT} is already in use.\n\n` +
      `  The library is probably already running — open http://localhost:${PORT}\n` +
      `  To use a different port:      PORT=${PORT + 1} node server.mjs\n` +
      `  To stop whatever holds it:    lsof -ti :${PORT} | xargs kill\n`
    );
    process.exit(1);
  }
  console.error(`\n  Could not start the server: ${err.message}\n`);
  process.exit(1);
});

// A run that died with the last server would otherwise sit at "running"
// forever, so the board is settled before anything can read it.
const reaped = await studio.reapInterrupted().catch(() => 0);
if (reaped) console.log(`\n  Marked ${reaped} interrupted studio run${reaped === 1 ? '' : 's'} as failed.`);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Website Inspo Library → http://localhost:${PORT}\n`);
});
