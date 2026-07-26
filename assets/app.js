/* Website Inspo Library — grid, detail sheet, editor.
   data.json is the single source of truth; every write goes through the local
   server so the browser and the CLI never diverge. */

import { mountStudio } from './studio.js';

const $ = (id) => document.getElementById(id);

const state = {
  data: { collection: 'Website Inspo Library', owner: '', groups: [], entries: [] },
  group: 'all',
  query: '',
  view: 'library',
  expanded: new Set(),
  readOnly: false,
  editingId: null,
};

let studio = null;

const groupById = (id) => state.data.groups.find((g) => g.id === id);
const inkOf = (id) => groupById(id)?.ink || 'var(--ink)';

/* ── Data ──────────────────────────────────────────────────────────────── */

async function load() {
  try {
    const res = await fetch('/api/data', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.statusText);
    state.data = await res.json();
  } catch {
    // No server: read the file directly and disable every write path.
    try {
      const res = await fetch('data.json', { cache: 'no-store' });
      state.data = await res.json();
    } catch {
      state.data = { ...state.data };
    }
    state.readOnly = true;
    showServerNotice();
  }
  state.data.groups ??= [];
  state.data.entries ??= [];
}

function showServerNotice() {
  if ($('serverNotice')) return;
  const el = document.createElement('div');
  el.className = 'notice';
  el.id = 'serverNotice';
  el.innerHTML =
    '<strong>Read-only.</strong> The library server is not running, so edits ' +
    'cannot be saved. Start it with <code>node server.mjs</code> and reload.';
  document.querySelector('.masthead').after(el);
}

/* ── Filtering ─────────────────────────────────────────────────────────── */

function matchesQuery(entry, q) {
  if (!q) return true;
  const hay = [
    entry.title, entry.descriptor, entry.url, entry.note,
    entry.recipe, entry.copyBrief, entry.imagePrompt,
    groupById(entry.group)?.name,
    ...(entry.tags || []),
  ].filter(Boolean).join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every((term) => hay.includes(term));
}

function visibleEntries() {
  return state.data.entries
    .filter((e) => (state.group === 'all' || e.group === state.group) && matchesQuery(e, state.query))
    // Drafts need reviewing, so they surface first regardless of filter.
    .sort((a, b) => (a.status === 'draft' ? 0 : 1) - (b.status === 'draft' ? 0 : 1));
}

/* ── Chips ─────────────────────────────────────────────────────────────── */

function renderChips() {
  const bar = $('chips');
  const scoped = state.data.entries.filter((e) => matchesQuery(e, state.query));
  const counts = new Map();
  for (const e of scoped) counts.set(e.group, (counts.get(e.group) || 0) + 1);

  const chips = [
    { id: 'all', name: 'All', ink: 'var(--ink)', count: scoped.length, diamond: false },
    ...state.data.groups.map((g) => ({
      id: g.id, name: g.name, ink: g.ink, count: counts.get(g.id) || 0,
      diamond: true, proposed: g.proposed === true,
    })),
  ];

  bar.replaceChildren(...chips.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = c.proposed ? 'chip chip--proposed' : 'chip';
    b.style.setProperty('--chip-ink', c.ink);
    b.setAttribute('aria-pressed', String(state.group === c.id));
    if (c.proposed) b.title = 'Group proposed at capture — confirmed when you approve an entry in it';
    if (c.diamond) {
      const d = document.createElement('span');
      d.className = 'chip__diamond';
      b.append(d);
    }
    b.append(document.createTextNode(c.name));
    const n = document.createElement('span');
    n.className = 'chip__count';
    n.textContent = String(c.count);
    b.append(n);
    b.addEventListener('click', () => {
      location.hash = c.id;
    });
    return b;
  }));
}

/* ── Grid ──────────────────────────────────────────────────────────────── */

function plate(entry, total) {
  const wrap = document.createElement('button');
  wrap.type = 'button';
  wrap.className = 'card__plate';
  wrap.setAttribute('aria-label', `Open ${entry.title}`);
  if (entry.screenshot) {
    const img = document.createElement('img');
    img.src = `screenshots/${entry.screenshot}`;
    img.alt = `${entry.title} — ${entry.descriptor || 'saved design'}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      wrap.classList.add('card__plate--empty');
      wrap.replaceChildren(document.createTextNode('Screenshot missing'));
    });
    wrap.append(img);
  } else {
    wrap.classList.add('card__plate--empty');
    wrap.textContent = 'No screenshot';
  }
  wrap.addEventListener('click', () => openDetail(entry.id, total));
  return wrap;
}

function renderGrid() {
  const grid = $('grid');
  const blank = $('blank');
  const entries = visibleEntries();
  const total = entries.length;

  $('colophonCount').textContent =
    `${state.data.entries.length} entr${state.data.entries.length === 1 ? 'y' : 'ies'} in the collection`;

  if (!total) {
    grid.replaceChildren();
    blank.hidden = false;
    blank.innerHTML = state.data.entries.length
      ? `<h2>Nothing matches.</h2><p>No entry in this filter matches
         <code>${escapeHtml(state.query)}</code>. Clear the filter or pick another group.</p>`
      : `<h2>The collection is empty.</h2>
         <p>Drop a screenshot into <code>screenshots/</code>, then ask Claude Code:
         <em>&ldquo;add this to my inspo library&rdquo;</em> with the source URL. It writes the
         tags, recipe, copy brief, and image prompt straight into <code>data.json</code>.</p>
         <p>Or press <strong>Add entry</strong> and write one yourself.</p>`;
    return;
  }

  blank.hidden = true;
  grid.replaceChildren(...entries.map((entry, i) => {
    const card = document.createElement('article');
    card.className = entry.status === 'draft' ? 'card card--draft' : 'card';
    // Arrived since the last render — flash once so it's noticed even if you
    // are scrolled away. Silent: no toast, no scroll jump.
    if (state.seen && !state.seen.has(entry.id)) card.classList.add('card--new');
    card.style.setProperty('--group-ink', inkOf(entry.group));

    card.append(plate(entry, total));

    const cap = document.createElement('div');
    cap.className = 'card__caption';

    const line = document.createElement('div');
    line.className = 'card__line';
    const h = document.createElement('h2');
    h.className = 'card__title';
    const titleBtn = document.createElement('button');
    titleBtn.type = 'button';
    titleBtn.textContent = entry.title;
    titleBtn.addEventListener('click', () => openDetail(entry.id, total));
    h.append(titleBtn);
    line.append(h);
    if (entry.descriptor) {
      const d = document.createElement('p');
      d.className = 'card__desc';
      d.textContent = entry.descriptor;
      line.append(d);
    }
    cap.append(line);

    cap.append(tagList(entry));

    const foot = document.createElement('div');
    foot.className = 'card__foot';
    const g = document.createElement('span');
    g.className = 'group-mark';
    g.textContent = groupById(entry.group)?.name || 'Ungrouped';
    const idx = document.createElement('span');
    idx.className = 'card__index';
    idx.textContent = entry.status === 'draft'
      ? 'Draft'
      : `${String(i + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    foot.append(g, idx);
    cap.append(foot);

    card.append(cap);
    return card;
  }));
}

function tagList(entry) {
  const tags = entry.tags || [];
  const list = document.createElement('div');
  list.className = 'tags';
  const open = state.expanded.has(entry.id);
  const shown = open ? tags : tags.slice(0, 3);

  for (const t of shown) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tag';
    b.textContent = t;
    b.title = `Filter by “${t}”`;
    b.addEventListener('click', () => {
      $('q').value = t;
      state.query = t;
      render();
    });
    list.append(b);
  }

  if (tags.length > 3) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'tag';
    more.textContent = open ? '− less' : `+${tags.length - 3}`;
    more.setAttribute('aria-expanded', String(open));
    more.addEventListener('click', () => {
      open ? state.expanded.delete(entry.id) : state.expanded.add(entry.id);
      renderGrid();
    });
    list.append(more);
  }
  return list;
}

/* ── Detail sheet ──────────────────────────────────────────────────────── */

function openDetail(id, total) {
  const entries = visibleEntries();
  const i = entries.findIndex((e) => e.id === id);
  const entry = entries[i] || state.data.entries.find((e) => e.id === id);
  if (!entry) return;

  const sheet = $('detail');
  sheet.dataset.entry = entry.id;
  sheet.style.setProperty('--group-ink', inkOf(entry.group));
  $('detailGroup').innerHTML = '';
  const mark = document.createElement('span');
  mark.className = 'group-mark';
  mark.textContent = groupById(entry.group)?.name || 'Ungrouped';
  $('detailGroup').append(mark);

  $('detailTitle').textContent = entry.title;
  $('detailDesc').textContent = entry.descriptor || '';
  $('detailIndex').textContent = i >= 0
    ? `${String(i + 1).padStart(2, '0')} / ${String(total ?? entries.length).padStart(2, '0')}`
    : '';

  const link = $('detailUrl');
  if (entry.url) {
    link.href = entry.url;
    link.textContent = entry.url.replace(/^https?:\/\//, '');
    link.hidden = false;
  } else {
    link.hidden = true;
  }

  const fig = $('detailPlate');
  fig.className = 'plate';
  if (entry.screenshot) {
    const img = document.createElement('img');
    img.src = `screenshots/${entry.screenshot}`;
    img.alt = `${entry.title} — ${entry.descriptor || 'saved design'}`;
    img.addEventListener('error', () => {
      fig.className = 'plate plate--empty';
      fig.replaceChildren(document.createTextNode('Screenshot missing'));
    });
    fig.replaceChildren(img);
  } else {
    fig.className = 'plate plate--empty';
    fig.replaceChildren(document.createTextNode('No screenshot'));
  }

  const tagBox = $('detailTags');
  tagBox.replaceChildren(...(entry.tags || []).map((t) => {
    const s = document.createElement('span');
    s.className = 'tag';
    s.textContent = t;
    return s;
  }));

  // The recipe is what you came for; the rest collapse so the sheet reads as
  // one artifact plus its supporting material, not a wall of four.
  const fields = [
    ['Image recipe', entry.recipe, true, true],
    ['Copy brief', entry.copyBrief, false, true],
    // Asset prompt is legitimately empty when a design's imagery is pure CSS.
    ['Asset prompt', entry.imagePrompt, false, Boolean(entry.imagePrompt)],
    ['Motion', motionText(entry.motion), false, Boolean(entry.motion)],
    ['Why I saved it', entry.note, false, Boolean(entry.note)],
  ].filter(([, , , show]) => show);

  $('detailArtifacts').replaceChildren(...fields.map(([label, text, open]) => {
    const box = document.createElement('section');
    box.className = 'artifact';
    box.dataset.open = String(open);

    const head = document.createElement('div');
    head.className = 'artifact__head';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'artifact__toggle';
    toggle.setAttribute('aria-expanded', String(open));
    const l = document.createElement('span');
    l.className = 'artifact__label';
    l.textContent = label;
    const mark = document.createElement('span');
    mark.className = 'artifact__mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = open ? '−' : '+';
    toggle.append(l, mark);
    toggle.addEventListener('click', () => {
      const next = box.dataset.open !== 'true';
      box.dataset.open = String(next);
      toggle.setAttribute('aria-expanded', String(next));
      mark.textContent = next ? '−' : '+';
    });
    head.append(toggle);

    if (text) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy';
      btn.textContent = 'Copy';
      // Copy without expanding — the button is the point, not the reading.
      btn.addEventListener('click', () => copy(text, btn));
      head.append(btn);
    }
    box.append(head);

    const p = document.createElement('p');
    p.className = 'artifact__text';
    p.textContent = text || '';
    box.append(p);
    return box;
  }));

  const isDraft = entry.status === 'draft';
  $('draftNotice').hidden = !isDraft;
  $('approveBtn').hidden = !isDraft || state.readOnly;
  $('editBtn').hidden = state.readOnly;
  $('deleteBtn').hidden = state.readOnly;
  if (!sheet.open) sheet.showModal();   // re-rendering an open sheet must not throw
}

async function approveEntry() {
  const entry = state.data.entries.find((e) => e.id === $('detail').dataset.entry);
  if (!entry) return;

  // A live entry without a source URL loses the original designer's credit,
  // which the library treats as structural rather than optional.
  let url = entry.url;
  if (!url) {
    url = (prompt(`Source URL for “${entry.title}”?\n\nThis credits the original designer and is what Claude cites.`, 'https://') || '').trim();
    if (!url || url === 'https://') return;
  }

  const res = await fetch(`/api/entries/${encodeURIComponent(entry.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, status: '' }),
  }).catch(() => null);

  if (!res || !res.ok) { alert('Approve failed — is the server running?'); return; }
  state.data = await res.json();
  $('detail').close();
  render();
}

// Motion is stored structured (for the generator) but read as prose. It comes
// from one scripted visit, so the caveat is stated first — a thin capture is
// evidence about the measurement, never evidence that the site holds still.
function motionText(m) {
  if (!m) return '';
  const out = [];
  const cov = {
    signal: 'A character read, taken from one automated visit. Not a spec.',
    thin: 'Barely anything was measurable here — open the live site before trusting this.',
  }[m.coverage] || 'Taken from one automated visit. Character, not specification.';
  out.push(cov, '', m.summary);
  if (m.signature && !/^n\/a/i.test(m.signature)) out.push('', `Signature move: ${m.signature}`);
  if (m.timings?.length) out.push('', 'Measured timings:', ...m.timings.map((t) => `  · ${t}`));
  if (m.hover?.length) out.push('', 'Hover, measured:', ...m.hover.map((t) => `  · ${t}`));
  if (m.libraries?.length) out.push('', `Driven by: ${m.libraries.join(', ')}`);
  out.push('', `Respects prefers-reduced-motion: ${m.reducedMotion ? 'yes' : 'no'}`);
  return out.join('\n');
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* nothing more to try */ }
    ta.remove();
  }
  btn.dataset.done = 'true';
  btn.textContent = 'Copied';
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    btn.dataset.done = 'false';
    btn.textContent = 'Copy';
  }, 1400);
}

/* ── Editor ────────────────────────────────────────────────────────────── */

async function openEditor(entry) {
  state.editingId = entry?.id || null;
  const f = $('editorForm');
  f.reset();
  $('editorTitle').textContent = entry ? 'Edit entry' : 'New entry';
  $('saveState').textContent = '';

  $('editorGroup').replaceChildren(...state.data.groups.map((g) => {
    const o = document.createElement('option');
    o.value = g.id;
    o.textContent = g.name;
    return o;
  }));

  const shotSelect = $('editorShot');
  let shots = [];
  try {
    const res = await fetch('/api/screenshots', { cache: 'no-store' });
    if (res.ok) shots = await res.json();
  } catch { /* leave the list empty; the field still accepts the current value */ }
  if (entry?.screenshot && !shots.includes(entry.screenshot)) shots.unshift(entry.screenshot);
  shotSelect.replaceChildren(
    Object.assign(document.createElement('option'), { value: '', textContent: '— none —' }),
    ...shots.map((s) => Object.assign(document.createElement('option'), { value: s, textContent: s }))
  );

  if (entry) {
    f.title.value = entry.title || '';
    f.descriptor.value = entry.descriptor || '';
    f.url.value = entry.url || '';
    f.group.value = entry.group || state.data.groups[0]?.id || '';
    f.screenshot.value = entry.screenshot || '';
    f.tags.value = (entry.tags || []).join('\n');
    f.recipe.value = entry.recipe || '';
    f.copyBrief.value = entry.copyBrief || '';
    f.imagePrompt.value = entry.imagePrompt || '';
    f.note.value = entry.note || '';
  } else if (state.group !== 'all') {
    f.group.value = state.group;
  }

  $('editor').showModal();
}

async function saveEntry(ev) {
  ev.preventDefault();
  const f = ev.target;
  const tags = f.tags.value.split('\n').map((s) => s.trim()).filter(Boolean);

  if (tags.length < 6 && !confirm(
    `This entry has ${tags.length} tag${tags.length === 1 ? '' : 's'}. ` +
    `The library expects at least 6 so search stays useful. Save anyway?`
  )) return;

  const body = {
    title: f.title.value.trim(),
    descriptor: f.descriptor.value.trim(),
    url: f.url.value.trim(),
    group: f.group.value,
    screenshot: f.screenshot.value,
    tags,
    recipe: f.recipe.value.trim(),
    copyBrief: f.copyBrief.value.trim(),
    imagePrompt: f.imagePrompt.value.trim(),
    note: f.note.value.trim(),
  };

  $('saveState').textContent = 'Saving…';
  const res = await fetch(
    state.editingId ? `/api/entries/${encodeURIComponent(state.editingId)}` : '/api/entries',
    {
      method: state.editingId ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  ).catch(() => null);

  if (!res || !res.ok) {
    $('saveState').textContent = 'Save failed — is the server running?';
    return;
  }

  state.data = await res.json();
  $('saveState').textContent = 'Saved';
  $('editor').close();
  render();
}

async function deleteEntry() {
  const id = $('detail').dataset.entry;
  const entry = state.data.entries.find((e) => e.id === id);
  if (!entry) return;
  if (!confirm(`Delete “${entry.title}” from the library?\n\nThe screenshot file stays in screenshots/.`)) return;

  const res = await fetch(`/api/entries/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
  if (!res || !res.ok) { alert('Delete failed — is the server running?'); return; }
  state.data = await res.json();
  $('detail').close();
  render();
}

/* ── Wiring ────────────────────────────────────────────────────────────── */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render() {
  renderChips();
  renderGrid();
  // After the first paint, anything not in `seen` is genuinely new and gets
  // the arrival flash. Populated here so the first render never flashes.
  state.seen = new Set(state.data.entries.map((e) => e.id));
}

/* ── Live updates ──────────────────────────────────────────────────────── */

let refreshTimer;
const scheduleRefresh = () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshData, 80);
};

async function refreshData() {
  // Never stomp on half-typed fields; pick it up when the editor closes.
  if ($('editor').open) { state.refreshQueued = true; return; }

  const res = await fetch(state.readOnly ? 'data.json' : '/api/data', { cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) return;
  const next = await res.json();
  if (JSON.stringify(next) === JSON.stringify(state.data)) return;   // nothing moved

  // Preserve the open sheet: only re-render it if that entry actually changed,
  // so an unrelated update doesn't collapse the block you were reading.
  const openId = $('detail').open ? $('detail').dataset.entry : null;
  const openBefore = openId ? JSON.stringify(state.data.entries.find((e) => e.id === openId)) : null;

  state.data = next;
  render();                                    // filter, query and scroll survive
  if (state.view === 'studio') studio?.refresh();   // reference cards read data.json too

  if (openId) {
    const entry = next.entries.find((e) => e.id === openId);
    if (!entry) $('detail').close();                                   // deleted elsewhere
    else if (JSON.stringify(entry) !== openBefore) openDetail(openId); // changed elsewhere
  }
}

function connectLive() {
  // Push: the server watches data.json and tells us the moment it changes.
  let es = null;
  if (!state.readOnly && 'EventSource' in window) {
    es = new EventSource('/api/stream');
    es.addEventListener('data', scheduleRefresh);
    // EventSource reconnects on its own; the poll below covers the gap.
  }
  // Poll: backstop for a dropped stream, and the only path in read-only mode.
  setInterval(scheduleRefresh, 10_000);
  return es;
}

/* ── Views ─────────────────────────────────────────────────────────────── */

// One hash owns both concerns: a bare group id filters the library, anything
// under `studio` is the studio. So the back button, a bookmark and a reload
// all land where you left off.
function syncHash() {
  const raw = decodeURIComponent(location.hash.slice(1));
  const [head, ...rest] = raw.split('/');

  if (head === 'studio') {
    setView('studio');
    render();                                  // the colophon count is shared chrome
    studio?.openProject(rest.join('/') || null);
    return;
  }

  setView('library');
  const id = raw || 'all';
  state.group = (id === 'all' || groupById(id)) ? id : 'all';
  state.expanded.clear();
  render();
}

function setView(view) {
  state.view = view;
  $('viewLibrary').hidden = view !== 'library';
  $('viewStudio').hidden = view !== 'studio';
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.view === view));
  }
  // The filter searches the grid; in the studio it would do nothing.
  $('q').closest('.field').hidden = view !== 'library';
  $('addBtn').hidden = view !== 'library' || state.readOnly;
}

async function init() {
  await load();
  $('ownerName').textContent = state.data.owner || 'you';
  document.title = state.data.collection || document.title;
  $('addBtn').hidden = state.readOnly;

  $('q').addEventListener('input', (e) => { state.query = e.target.value.trim(); render(); });
  $('addBtn').addEventListener('click', () => openEditor(null));
  $('detailClose').addEventListener('click', () => $('detail').close());
  $('editorClose').addEventListener('click', () => $('editor').close());
  $('editorCancel').addEventListener('click', () => $('editor').close());
  $('editorForm').addEventListener('submit', saveEntry);
  $('approveBtn').addEventListener('click', approveEntry);
  $('deleteBtn').addEventListener('click', deleteEntry);
  $('editBtn').addEventListener('click', () => {
    const entry = state.data.entries.find((e) => e.id === $('detail').dataset.entry);
    $('detail').close();
    openEditor(entry);
  });

  // Click the backdrop to dismiss.
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  }

  // Any update that landed while you were typing applies once the form closes.
  $('editor').addEventListener('close', () => {
    if (state.refreshQueued) { state.refreshQueued = false; scheduleRefresh(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== $('q') && !e.metaKey && !e.ctrlKey) {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      if (!inField) { e.preventDefault(); $('q').focus(); $('q').select(); }
    }
  });

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      location.hash = tab.dataset.view === 'studio' ? 'studio' : (state.group || 'all');
    });
  }

  const source = connectLive();
  studio = mountStudio({ source, library: () => state.data });

  window.addEventListener('hashchange', syncHash);
  syncHash();
}

init();
