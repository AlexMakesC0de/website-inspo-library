/* Website Inspo Library — the workspace.

   One generated page in its own tab, at full width, with a bar of chrome over
   it: reload, the pages this design contains and the other designs in the
   project, zoom, comments, present, edit.

   The frame always loads with ?inspect=1. The injected script is dormant until
   something arms it — editing or commenting — and the file on disk never
   carries it either way, so there is nothing to reload when a mode changes.

   URL: view.html?p=<project id>&f=g2/b/index.html                            */

import { mountInspector } from './inspector.js';
import { mountTweak } from './tweak.js';

const $ = (id) => document.getElementById(id);

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5];

const st = {
  projectId: null,
  path: null,
  project: null,
  pages: [],
  comments: [],
  zoom: 1,
  commenting: false,
  editing: false,
  presenting: false,
  pending: null,      // the element a comment is being written about
  open: null,         // the comment whose thread is showing
  inspector: null,
  tweak: null,
};

const api = async (path, options) => {
  const res = await fetch(`/api/studio${path}`, {
    headers: options?.body ? { 'content-type': 'application/json' } : undefined,
    ...options,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.status === 204 ? null : res.json();
};

const frame = () => $('wsFrame');
const post = (msg) => frame().contentWindow?.postMessage({ to: 'inspo', ...msg }, '*');

const pageUrl = (inspect = true) =>
  `builds/${st.projectId}/${st.path}${inspect ? `?inspect=1&v=${Date.now()}` : ''}`;

/* ── Zoom ────────────────────────────────────────────────────────────────
   Sized up and scaled down, exactly like the comparison tiles: the frame gets
   a viewport of stage ÷ zoom and is then scaled to fill the stage. Zooming out
   therefore shows more page rather than a smaller picture of the same page,
   which is what a browser's own zoom does and what the control is expected to
   mean. */

function applyZoom() {
  const f = frame();
  const pct = 100 / st.zoom;
  f.style.width = `${pct}%`;
  f.style.height = `${pct}%`;
  f.style.transform = st.zoom === 1 ? '' : `scale(${st.zoom})`;
  $('wsZoomLabel').textContent = `${Math.round(st.zoom * 100)}%`;
}

function setZoom(z) {
  st.zoom = Math.min(Math.max(z, ZOOMS[0]), ZOOMS[ZOOMS.length - 1]);
  applyZoom();
  closePops();
}

const stepZoom = (dir) => {
  const i = ZOOMS.findIndex((z) => Math.abs(z - st.zoom) < 0.001);
  setZoom(ZOOMS[Math.min(Math.max((i === -1 ? 2 : i) + dir, 0), ZOOMS.length - 1)]);
};

/* ── Menus ───────────────────────────────────────────────────────────────── */

function closePops(except) {
  for (const pop of document.querySelectorAll('.ws__pop')) {
    if (pop === except) continue;
    pop.hidden = true;
    pop.previousElementSibling?.setAttribute('aria-expanded', 'false');
  }
}

function menu(button, pop, items) {
  pop.replaceChildren(...items.map((item) => {
    if (item.rule) {
      const hr = document.createElement('hr');
      hr.className = 'ws__popRule';
      return hr;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ws__popItem';
    b.dataset.on = String(!!item.on);
    b.textContent = item.label;
    if (item.note) {
      const note = document.createElement('span');
      note.className = 'ws__popNote';
      note.textContent = item.note;
      b.append(note);
    }
    b.addEventListener('click', () => { closePops(); item.run(); });
    return b;
  }));
}

function togglePop(button, pop) {
  const open = pop.hidden;
  closePops(open ? pop : null);
  pop.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
}

/* ── Pages ───────────────────────────────────────────────────────────────
   Two groups under one control. The first is the pages this design contains —
   one today, because the generator writes one file, but the folder is read
   rather than assumed. The second is the other designs in this project, which
   is the jump you actually want when you are looking at one full-screen. */

function variants() {
  const out = [];
  for (const gen of st.project?.generations || []) {
    for (const v of gen.variants) {
      if (v.status !== 'done') continue;
      out.push({
        path: v.file,
        label: `${gen.n === 1 ? 'Concept' : 'World'} ${v.key.toUpperCase()}`,
        title: v.header?.title || '',
        winner: gen.winner === v.key,
      });
    }
  }
  return out;
}

function renderPages() {
  const here = st.pages.find((p) => p.path === st.path);
  $('wsPageName').textContent = here?.name || 'Page';

  const others = variants().filter((v) => v.path !== st.path);
  const items = st.pages.map((p) => ({
    label: p.name,
    note: p.title,
    on: p.path === st.path,
    run: () => go(p.path),
  }));
  if (others.length) {
    items.push({ rule: true });
    for (const v of others) {
      items.push({ label: v.label + (v.winner ? ' ·' : ''), note: v.title, run: () => go(v.path) });
    }
  }
  menu($('wsPages'), $('wsPagesPop'), items);
}

function renderId() {
  const v = variants().find((x) => x.path === st.path);
  $('wsId').textContent = [v?.label, v?.title].filter(Boolean).join(' — ');
  document.title = `${v?.title || st.project?.brief || 'Workspace'} — Workspace`;
}

async function go(path) {
  if (path === st.path) return;
  st.path = path;
  history.replaceState(null, '', `?p=${encodeURIComponent(st.projectId)}&f=${encodeURIComponent(path)}`);
  if (st.editing) await setEdit(false);
  closeComposer();
  await loadPage();
}

async function loadPage() {
  frame().src = pageUrl();
  st.pages = await api(`/projects/${st.projectId}/pages?path=${encodeURIComponent(st.path)}`).catch(() => []);
  st.comments = await api(`/projects/${st.projectId}/comments?path=${encodeURIComponent(st.path)}`).catch(() => []);
  renderPages();
  renderId();
  renderComments();
}

/* ── Comments ────────────────────────────────────────────────────────────── */

function renderComments() {
  const mine = st.comments.filter((c) => c.path === st.path);
  $('wsCommentCount').textContent = mine.length ? String(mine.length).padStart(2, '0') : '';
  // Presenting shows the design, not the notes on it.
  post({
    t: 'pins',
    list: st.presenting ? [] : mine.map((c, i) => ({ id: c.id, n: i + 1, sel: c.sel, text: c.text })),
  });
}

function setCommenting(on) {
  st.commenting = on;
  $('wsComment').setAttribute('aria-pressed', String(on));
  if (!on) closeComposer();
  // Editing wins the arm if both are on: its panel needs the selection.
  post({ t: 'arm', on: on || st.editing, mode: st.editing ? 'inspect' : 'comment' });
}

function openComposer({ sel, label, comment }) {
  st.pending = comment ? null : { sel, label };
  st.open = comment || null;

  const mine = st.comments.filter((c) => c.path === st.path);
  const thread = comment ? [comment] : mine.filter((c) => c.sel === sel);

  $('wsComposerMark').textContent = comment ? comment.label : label || 'element';
  $('wsThread').replaceChildren(...thread.map((c) => {
    const box = document.createElement('article');
    box.className = 'ws__note';
    const body = document.createElement('p');
    body.className = 'ws__noteText';
    body.textContent = c.text;
    const foot = document.createElement('p');
    foot.className = 'ws__noteFoot';
    foot.textContent = new Date(c.createdAt).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'ws__noteDrop';
    drop.textContent = 'Delete';
    drop.addEventListener('click', () => removeComment(c.id));
    foot.append(drop);
    box.append(body, foot);
    return box;
  }));

  $('wsComposer').hidden = false;
  $('wsCommentText').value = '';
  if (!comment) $('wsCommentText').focus();
}

function closeComposer() {
  $('wsComposer').hidden = true;
  st.pending = null;
  st.open = null;
}

async function saveComment(ev) {
  ev?.preventDefault();
  const text = $('wsCommentText').value.trim();
  const target = st.pending || (st.open ? { sel: st.open.sel, label: st.open.label } : null);
  if (!text || !target) return;
  try {
    const comment = await api(`/projects/${st.projectId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ path: st.path, sel: target.sel, label: target.label, text }),
    });
    st.comments.push(comment);
    renderComments();
    openComposer({ sel: target.sel, label: target.label });
  } catch (err) {
    $('wsCommentText').placeholder = `Not saved — ${err.message}`;
  }
}

async function removeComment(id) {
  try {
    await api(`/projects/${st.projectId}/comments/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch { /* already gone */ }
  st.comments = st.comments.filter((c) => c.id !== id);
  renderComments();
  closeComposer();
}

/* ── Present ─────────────────────────────────────────────────────────────
   Three ways to get the chrome out of the way, in increasing order of how much
   they take with them. All of them keep the frame exactly where it is: a
   reload here would cost the scroll position, which is the one thing you were
   looking at when you decided to present. */

function setPresenting(on) {
  st.presenting = on;
  document.body.dataset.presenting = String(on);
  $('wsPresenting').hidden = !on;
  if (on) {
    closeComposer();
    setTimeout(() => { $('wsPresenting').hidden = true; }, 2200);
  }
  renderComments();
}

function present(how) {
  if (how === 'tab') {
    // The clean page, with no inspector and no chrome — what ships.
    window.open(pageUrl(false), '_blank', 'noopener');
    return;
  }
  setPresenting(true);
  if (how === 'full' && !document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
}

function leavePresenting() {
  setPresenting(false);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

/* ── Edit ────────────────────────────────────────────────────────────────── */

async function setEdit(on) {
  st.editing = on;
  $('wsEdit').setAttribute('aria-pressed', String(on));
  $('wsEdit').textContent = on ? 'Done' : 'Edit';
  if (on) {
    closeComposer();
    await st.inspector.attach({ projectId: st.projectId, path: st.path });
    await st.tweak.attach({ projectId: st.projectId, path: st.path });
  } else {
    st.tweak.detach();
    await st.inspector.detach();
    // detach disarms the frame; commenting may still want it armed.
    if (st.commenting) post({ t: 'arm', on: true, mode: 'comment' });
  }
}

/* ── Mount ───────────────────────────────────────────────────────────────── */

const params = new URLSearchParams(location.search);
st.projectId = params.get('p');
st.path = params.get('f') || 'g2/a/index.html';

st.inspector = mountInspector({
  frame: frame(),
  onSaved: () => { /* the file is the record; nothing else to keep in step */ },
});

// Tweak shares the dock, the patch, the undo stack and the save. It is a second
// way to say what should change, not a second thing that changes it.
st.tweak = mountTweak({ inspector: st.inspector, frame: frame() });

addEventListener('message', (ev) => {
  if (ev.source !== frame().contentWindow || ev.data?.from !== 'inspo') return;
  const msg = ev.data;

  if (msg.t === 'ready') {
    applyZoom();
    renderComments();
    if (st.editing) post({ t: 'arm', on: true, mode: 'inspect' });
    else if (st.commenting) post({ t: 'arm', on: true, mode: 'comment' });
    return;
  }

  // A pick while commenting belongs to the composer; while editing it belongs
  // to the panel, which reads it straight off the frame itself.
  if (msg.t === 'selected' && st.commenting && !st.editing) {
    openComposer({ sel: msg.sel, label: msg.label });
    return;
  }

  if (msg.t === 'pin') {
    const comment = st.comments.find((c) => c.id === msg.id);
    if (comment) openComposer({ comment });
  }
});

$('wsReload').addEventListener('click', () => { frame().src = pageUrl(); });

$('wsPages').addEventListener('click', () => togglePop($('wsPages'), $('wsPagesPop')));
$('wsZoom').addEventListener('click', () => {
  menu($('wsZoom'), $('wsZoomPop'), [
    ...ZOOMS.map((z) => ({ label: `${Math.round(z * 100)}%`, on: z === st.zoom, run: () => setZoom(z) })),
  ]);
  togglePop($('wsZoom'), $('wsZoomPop'));
});
$('wsPresent').addEventListener('click', () => {
  menu($('wsPresent'), $('wsPresentPop'), [
    { label: 'In this tab', note: 'hide the chrome', run: () => present('here') },
    { label: 'Fullscreen', note: 'the whole screen', run: () => present('full') },
    { label: 'New tab', note: 'the clean page', run: () => present('tab') },
  ]);
  togglePop($('wsPresent'), $('wsPresentPop'));
});

$('wsComment').addEventListener('click', () => setCommenting(!st.commenting));
$('wsEdit').addEventListener('click', () => setEdit(!st.editing));
$('wsComposerClose').addEventListener('click', closeComposer);
$('wsCommentForm').addEventListener('submit', saveComment);
$('wsCommentText').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) saveComment(ev);
});

addEventListener('click', (ev) => {
  if (!ev.target.closest('.ws__menu')) closePops();
});

addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if (st.presenting) return leavePresenting();
    if (!$('wsComposer').hidden) return closeComposer();
    closePops();
  }
  if ((ev.metaKey || ev.ctrlKey) && (ev.key === '=' || ev.key === '+')) { ev.preventDefault(); stepZoom(1); }
  if ((ev.metaKey || ev.ctrlKey) && ev.key === '-') { ev.preventDefault(); stepZoom(-1); }
  if ((ev.metaKey || ev.ctrlKey) && ev.key === '0') { ev.preventDefault(); setZoom(1); }
});

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && st.presenting) setPresenting(false);
});

(async () => {
  if (!st.projectId) {
    $('wsId').textContent = 'No project in the address.';
    return;
  }
  try {
    st.project = await api(`/projects/${encodeURIComponent(st.projectId)}`);
  } catch {
    $('wsId').textContent = 'That project is not in builds/ any more.';
    return;
  }
  await loadPage();
})();
