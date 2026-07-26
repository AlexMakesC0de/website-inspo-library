/* Website Inspo Library — Studio.
   Brief → references → four concepts → pick → four worlds → pick → final.
   Every write goes to the server; project.json on disk is the source of truth,
   so a reload mid-generation rejoins the run instead of losing it. */

const $ = (id) => document.getElementById(id);

const st = {
  project: null,
  projects: [],
  library: () => ({ entries: [], groups: [] }),
  busy: false,
  open: new Set(),      // variant keys whose influence block is expanded
  clock: null,
  viewing: null,        // { variant, n } currently in the viewer
  stale: new Map(),     // variant file → when a workspace tab last wrote it
  edited: new Map(),    // `${n}${key}` → the stamp its preview is keyed on
};

// Turn "this file changed" into "this tile's preview is out of date". Held
// until the board is actually on screen; see the visibilitychange hook.
function applyEdits() {
  for (const [path, at] of st.stale) {
    for (const gen of st.project?.generations || []) {
      const v = gen.variants.find((x) => x.file === path);
      if (v) st.edited.set(`${gen.n}${v.key}`, at);
    }
  }
  st.stale.clear();
  render();
}

const PREVIEW_WIDTH = 1440;   // the width generated pages are designed at

const api = async (path, options) => {
  const res = await fetch(`/api/studio${path}`, {
    headers: options?.body ? { 'content-type': 'application/json' } : undefined,
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.status === 204 ? null : res.json();
};

const entryById = (id) => st.library().entries.find((e) => e.id === id);
const genOf = (n) => st.project?.generations.find((g) => g.n === n) || null;

/* ── Recent projects ───────────────────────────────────────────────────── */

async function loadProjects() {
  try { st.projects = await api('/projects'); } catch { st.projects = []; }
  renderRecent();
}

function renderRecent() {
  const box = $('studioRecent');
  const others = st.projects.filter((p) => p.id !== st.project?.id).slice(0, 6);
  box.hidden = !others.length;
  if (!others.length) return;

  box.replaceChildren();
  const label = document.createElement('span');
  label.className = 'field__label';
  label.textContent = 'Pick up where you left off';
  box.append(label);

  const list = document.createElement('div');
  list.className = 'studio__recentList';
  for (const p of others) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tag';
    b.textContent = p.brief.length > 54 ? `${p.brief.slice(0, 54)}…` : p.brief;
    b.title = `${p.brief}\n${p.createdAt.slice(0, 10)}`;
    b.addEventListener('click', () => { location.hash = `studio/${p.id}`; });
    list.append(b);
  }
  box.append(list);
}

/* ── Step 1 — brief ────────────────────────────────────────────────────── */

async function submitBrief(ev) {
  ev.preventDefault();
  const brief = $('briefText').value.trim();
  if (!brief || st.busy) return;

  setBusy($('briefGo'), true, 'Searching…');
  try {
    const project = await api('/projects', { method: 'POST', body: JSON.stringify({ brief }) });
    st.project = project;
    history.replaceState(null, '', `#studio/${project.id}`);
    await loadProjects();
    render();
  } catch (err) {
    note($('briefNote'), `Could not start — ${err.message}`);
  } finally {
    setBusy($('briefGo'), false, 'Find references');
  }
}

/* ── Step 2 — references ───────────────────────────────────────────────── */

function refCard(entry, { onRemove } = {}) {
  const card = document.createElement('article');
  card.className = 'refcard';
  card.style.setProperty('--group-ink', st.library().groups.find((g) => g.id === entry.group)?.ink || 'var(--ink)');

  const plate = document.createElement('div');
  plate.className = 'refcard__plate';
  if (entry.screenshot) {
    const img = document.createElement('img');
    img.src = `screenshots/${entry.screenshot}`;
    img.alt = '';
    img.loading = 'lazy';
    plate.append(img);
  }
  card.append(plate);

  const cap = document.createElement('div');
  cap.className = 'refcard__cap';
  const h = document.createElement('p');
  h.className = 'refcard__title';
  h.textContent = entry.title;
  const d = document.createElement('p');
  d.className = 'refcard__desc';
  d.textContent = entry.descriptor || '';
  cap.append(h, d);
  card.append(cap);

  if (onRemove) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'refcard__drop';
    x.setAttribute('aria-label', `Remove ${entry.title}`);
    x.textContent = '×';
    x.addEventListener('click', onRemove);
    card.append(x);
  }
  return card;
}

async function saveReferences(next) {
  st.project.references = next;
  renderRefs();
  try {
    st.project = await api(`/projects/${st.project.id}/references`,
      { method: 'PUT', body: JSON.stringify({ references: next }) });
  } catch { /* the strip already shows the intent; a reload re-reads disk */ }
}

function renderRefs() {
  const refs = st.project.references.map(entryById).filter(Boolean);
  $('refCount').textContent = `${String(refs.length).padStart(2, '0')} selected`;

  const strip = $('refStrip');
  if (!refs.length) {
    strip.replaceChildren(Object.assign(document.createElement('p'), {
      className: 'studio__note',
      textContent: 'No references. Generation will invent a world from the brief alone — which is rarely what you want here.',
    }));
  } else {
    strip.replaceChildren(...refs.map((e) => refCard(e, {
      onRemove: () => saveReferences(st.project.references.filter((r) => r !== e.id)),
    })));
  }

  $('generateBtn').textContent = genOf(1)
    ? `Regenerate ${st.project.variants} concepts`
    : `Generate ${st.project.variants} concepts`;
}

let searchTimer;
function onRefSearch(ev) {
  clearTimeout(searchTimer);
  const q = ev.target.value.trim();
  const box = $('refResults');
  if (!q) { box.replaceChildren(); return; }

  searchTimer = setTimeout(async () => {
    let ids = [];
    try { ids = await api(`/search?q=${encodeURIComponent(q)}`); } catch { /* offline */ }
    const hits = ids.filter((id) => !st.project.references.includes(id)).map(entryById).filter(Boolean);
    box.replaceChildren(...hits.map((e) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tag';
      b.textContent = `+ ${e.title}`;
      b.title = e.descriptor || '';
      b.addEventListener('click', () => {
        saveReferences([...st.project.references, e.id]);
        $('refSearch').value = '';
        box.replaceChildren();
      });
      return b;
    }));
    if (!hits.length) {
      box.replaceChildren(Object.assign(document.createElement('p'),
        { className: 'studio__note', textContent: `Nothing else in the library matches “${q}”.` }));
    }
  }, 180);
}

/* ── Generation ────────────────────────────────────────────────────────── */

async function generate(n, reroll = false) {
  const btn = n === 1 ? $('generateBtn') : $(`gen2Btn`);
  if (btn) setBusy(btn, true, 'Starting…');
  try {
    // The 202 body describes the project as it was before the fan-out started.
    // Adopting it would race the generation:start event already on the wire and
    // could roll the board back to empty. Read the state instead.
    await api(`/projects/${st.project.id}/generate`,
      { method: 'POST', body: JSON.stringify({ generation: n, reroll }) });
    scheduleRefresh();
  } catch (err) {
    note($(n === 1 ? 'generateNote' : 'g2Count'), err.message);
  } finally {
    if (btn) setBusy(btn, false, null);
  }
}

const isRunning = (gen) => gen?.variants.some((v) => v.status === 'running' || v.status === 'pending');

function elapsed(variant) {
  if (variant.seconds != null) return fmt(variant.seconds);
  const started = variant.startedAt ? Date.parse(variant.startedAt) : null;
  return started ? fmt(Math.round((Date.now() - started) / 1000)) : '';
}

const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function tile(variant, n, gen) {
  const card = document.createElement('article');
  card.className = 'tile';
  card.dataset.status = variant.status;
  card.dataset.winner = String(gen.winner === variant.key);

  /* head */
  const head = document.createElement('header');
  head.className = 'tile__head';
  const key = document.createElement('span');
  key.className = 'tile__key';
  key.textContent = variant.key.toUpperCase();
  const state = document.createElement('span');
  state.className = 'tile__state';
  // Both boards use the keys a–d, so the generation has to be part of the id
  // or the clock updates the wrong board's tile.
  state.dataset.key = `${n}${variant.key}`;
  state.textContent = gen.winner === variant.key ? 'Picked'
    : variant.status === 'done' ? elapsed(variant)
    : variant.status === 'failed' ? 'Failed'
    : (variant.phase || 'queued');
  head.append(key, state);
  card.append(head);

  /* plate */
  const plate = document.createElement('div');
  plate.className = 'tile__plate';

  if (variant.status === 'done') {
    const frame = document.createElement('iframe');
    // Keyed on when this variant started, not how long it took: two re-rolls
    // can take the same number of seconds and would then show a cached page.
    // An inspector session moves the key on too, so the board stops showing the
    // page as it was generated once it has been edited.
    const stamp = st.edited.get(`${n}${variant.key}`) || variant.startedAt || '';
    frame.src = `builds/${st.project.id}/${variant.file}?v=${encodeURIComponent(stamp)}`;
    frame.title = `${variant.header?.title || `Variant ${variant.key}`} preview`;
    frame.loading = 'lazy';
    // No allow-same-origin: a generated page can render and animate, but it
    // cannot reach back into this document.
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.width = `${PREVIEW_WIDTH}px`;
    plate.append(frame);
    scaleToFit(plate, frame);

    const veil = document.createElement('button');
    veil.type = 'button';
    veil.className = 'tile__veil';
    veil.setAttribute('aria-label', `Open ${variant.header?.title || variant.key} full size`);
    veil.addEventListener('click', () => openViewer(variant, n));
    plate.append(veil);
  } else {
    plate.classList.add('tile__plate--waiting');
    const angle = document.createElement('p');
    angle.className = 'tile__angle';
    angle.textContent = variant.status === 'failed'
      ? variant.error || 'Generation failed.'
      : variant.angle;
    plate.append(angle);
  }
  card.append(plate);

  /* caption */
  const cap = document.createElement('div');
  cap.className = 'tile__cap';

  const title = document.createElement('h3');
  title.className = 'tile__title';
  title.textContent = variant.header?.title || (variant.status === 'done' ? 'Untitled' : '—');
  cap.append(title);

  const world = document.createElement('p');
  world.className = 'tile__world';
  world.textContent = variant.header?.world || variant.header?.angle || '';
  cap.append(world);

  const foot = document.createElement('div');
  foot.className = 'tile__foot';

  if (variant.status === 'done') {
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = gen.winner === variant.key ? 'btn btn--solid' : 'btn';
    pick.textContent = gen.winner === variant.key ? 'Picked' : 'Pick';
    pick.disabled = gen.winner === variant.key;
    pick.addEventListener('click', () => pick_(n, variant.key));
    foot.append(pick);

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn btn--quiet';
    open.textContent = 'Open';
    open.addEventListener('click', () => openViewer(variant, n));
    foot.append(open);

    if (variant.header?.influences || variant.header?.refused) {
      const why = document.createElement('button');
      why.type = 'button';
      why.className = 'tile__why';
      const shown = st.open.has(`${n}${variant.key}`);
      why.textContent = shown ? 'Hide sources' : 'Sources';
      why.setAttribute('aria-expanded', String(shown));
      why.addEventListener('click', () => {
        const id = `${n}${variant.key}`;
        st.open.has(id) ? st.open.delete(id) : st.open.add(id);
        renderBoard(n);
      });
      foot.append(why);
    }
  }
  cap.append(foot);

  if (st.open.has(`${n}${variant.key}`)) {
    cap.append(sources(variant));
  }
  card.append(cap);
  return card;
}

// The variant's own account of what it borrowed. A page that leaned too hard on
// one reference is visible here before you have to look for it in the pixels.
function sources(variant) {
  const box = document.createElement('dl');
  box.className = 'sources';
  for (const [label, value] of [
    ['Angle', variant.header?.angle],
    ['Influences', variant.header?.influences],
    ['Refused', variant.header?.refused],
  ]) {
    if (!value) continue;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    box.append(dt, dd);
  }
  return box;
}

// Generated pages are designed at 1440px. The tile shows that page shrunk, not
// a page reflowed into a narrow column — a squeezed preview would be a lie
// about the design you are picking between.
//
// One observer for every plate on the page. A per-tile observer holds a strong
// reference to its element, so re-rendering the board during a four-minute run
// would pile up observers on plates that no longer exist.
const plates = new WeakMap();
const scaler = new ResizeObserver((entries) => {
  for (const { target } of entries) {
    const frame = plates.get(target);
    if (!frame) continue;
    const scale = target.clientWidth / PREVIEW_WIDTH;
    if (!scale) continue;
    frame.style.height = `${target.clientHeight / scale}px`;
    frame.style.transform = `scale(${scale})`;
  }
});

function scaleToFit(plate, frame) {
  plates.set(plate, frame);
  scaler.observe(plate);
}

// Everything a tile's appearance depends on. If this hasn't changed, the tile
// hasn't either — and rebuilding it would reload its iframe, which during a
// live run means every finished preview flickers on every poll.
const signature = (v, n, gen) => JSON.stringify([
  v.status, v.phase, v.startedAt, v.seconds, v.error,
  v.header?.title, v.header?.world, v.header?.influences,
  gen.winner === v.key, st.open.has(`${n}${v.key}`), st.edited.get(`${n}${v.key}`),
]);

const tiles = new Map();   // `${n}${key}` → { node, sig }

function renderBoard(n) {
  const board = $(n === 1 ? 'g1Board' : 'g2Board');
  const count = $(n === 1 ? 'g1Count' : 'g2Count');
  const gen = genOf(n);

  document.querySelector(`.studio__reroll[data-gen="${n}"]`).hidden = !gen || isRunning(gen);

  if (!gen) {
    count.textContent = '';
    for (const id of [...tiles.keys()]) if (id.startsWith(String(n))) tiles.delete(id);
    board.replaceChildren(cta(n));
    return;
  }

  const done = gen.variants.filter((v) => v.status === 'done').length;
  const failed = gen.variants.filter((v) => v.status === 'failed').length;
  count.textContent = isRunning(gen)
    ? `${String(done).padStart(2, '0')} / ${String(gen.variants.length).padStart(2, '0')} built`
    : `${String(done).padStart(2, '0')} built${failed ? `, ${failed} failed` : ''}`;

  board.replaceChildren(...gen.variants.map((v) => {
    const id = `${n}${v.key}`;
    const sig = signature(v, n, gen);
    const cached = tiles.get(id);
    if (cached?.sig === sig) return cached.node;
    const node = tile(v, n, gen);
    tiles.set(id, { node, sig });
    return node;
  }));
}

function cta(n) {
  const box = document.createElement('div');
  box.className = 'studio__cta';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn--solid';
  b.id = n === 2 ? 'gen2Btn' : 'gen1Btn';
  b.textContent = `Generate ${st.project.variants} ${n === 1 ? 'concepts' : 'worlds'}`;
  b.addEventListener('click', () => generate(n));
  const p = document.createElement('p');
  p.className = 'studio__note';
  p.textContent = n === 1
    ? 'Four complete pages, in parallel. Roughly two minutes.'
    : `Four restylings of ${genOf(1)?.winner?.toUpperCase() || 'the winner'}. Its layout and words are kept.`;
  box.append(b, p);
  return box;
}

async function pick_(n, key) {
  try {
    st.project = await api(`/projects/${st.project.id}/pick`,
      { method: 'POST', body: JSON.stringify({ generation: n, key }) });
    render();
    $(n === 1 ? 'stepG2' : 'stepFinal').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    note($(n === 1 ? 'g1Count' : 'g2Count'), err.message);
  }
}

/* ── Final ─────────────────────────────────────────────────────────────── */

function renderFinal() {
  const step = $('stepFinal');
  step.hidden = !st.project?.final;
  if (step.hidden) return;

  const gen = genOf(2);
  const variant = gen.variants.find((v) => v.key === gen.winner);
  const body = $('finalBody');
  body.replaceChildren();

  const h = document.createElement('p');
  h.className = 'studio__finalTitle';
  h.textContent = variant.header?.title || st.project.brief;
  body.append(h);

  const path = document.createElement('p');
  path.className = 'studio__note';
  path.textContent = `builds/${st.project.id}/${st.project.final}`;
  body.append(path);

  const row = document.createElement('div');
  row.className = 'studio__row';

  const workspace = document.createElement('button');
  workspace.type = 'button';
  workspace.className = 'btn btn--solid';
  workspace.textContent = 'Open the workspace';
  workspace.addEventListener('click', () => openWorkspace(variant));
  row.append(workspace);

  const open = document.createElement('a');
  open.className = 'btn';
  open.href = `builds/${st.project.id}/${st.project.final}`;
  open.target = '_blank';
  open.rel = 'noopener';
  open.textContent = 'Open the page';
  row.append(open);

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn';
  copy.textContent = 'Copy path';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(`builds/${st.project.id}/${st.project.final}`).catch(() => {});
    copy.textContent = 'Copied';
    setTimeout(() => { copy.textContent = 'Copy path'; }, 1400);
  });
  row.append(copy);
  body.append(row);

  const next = document.createElement('p');
  next.className = 'studio__note';
  next.textContent = 'The workspace opens the page in its own tab: zoom it, leave comments pinned to elements, present it, and press Edit to change type, colour, spacing, timing and words in place. Every change is written back into the file, and Revert restores the page the generator wrote.';
  body.append(next);
}

/* ── Viewer ────────────────────────────────────────────────────────────── */

// The workspace is a tab of its own: the page at full width with its own
// chrome. The modal viewer stays what it was — somewhere to judge and pick —
// and hands editing over rather than trying to be both.
const workspaceUrl = (variant) =>
  `view.html?p=${encodeURIComponent(st.project.id)}&f=${encodeURIComponent(variant.file)}`;

const openWorkspace = (variant) => window.open(workspaceUrl(variant), '_blank', 'noopener');

function openViewer(variant, n) {
  const dlg = $('viewer');
  $('viewerKey').textContent = `Variant ${variant.key.toUpperCase()}`;
  $('viewerTitle').textContent = variant.header?.title || 'Untitled';
  $('viewerWorld').textContent = variant.header?.world || '';

  $('viewerSources').replaceChildren(sources(variant));

  st.viewing = { variant, n };

  const pick = $('viewerPick');
  const gen = genOf(n);
  pick.textContent = gen.winner === variant.key ? 'Picked' : 'Pick this one';
  pick.disabled = gen.winner === variant.key;
  pick.onclick = async () => { dlg.close(); await pick_(n, variant.key); };

  const open = $('viewerOpen');
  open.href = `builds/${st.project.id}/${variant.file}`;

  $('viewerWorkspace').onclick = () => { dlg.close(); openWorkspace(variant); };

  if (!dlg.open) dlg.showModal();
  $('viewerFrame').src = `builds/${st.project.id}/${variant.file}`;
}

function closeViewer() {
  $('viewerFrame').src = 'about:blank';
  st.viewing = null;
  // A workspace tab may have edited this page while the board was open.
  render();
}

/* ── Render ────────────────────────────────────────────────────────────── */

function render() {
  const p = st.project;
  $('stepRefs').hidden = !p;
  $('stepG1').hidden = !p;
  $('stepG2').hidden = !p || !genOf(1)?.winner;
  $('stepFinal').hidden = !p?.final;

  if (!p) { renderRecent(); return; }

  if ($('briefText').value.trim() !== p.brief) $('briefText').value = p.brief;
  renderRefs();
  renderBoard(1);
  if (genOf(1)?.winner) renderBoard(2);
  renderFinal();
  renderRecent();
  tickClock();
}

// One interval for both boards, only while something is running.
function tickClock() {
  const live = [1, 2].filter((n) => isRunning(genOf(n)));
  clearInterval(st.clock);
  if (!live.length) return;
  st.clock = setInterval(() => {
    for (const n of live) {
      for (const v of genOf(n)?.variants || []) {
        if (v.status !== 'running' || !v.startedAt) continue;
        const el = document.querySelector(`.tile__state[data-key="${n}${v.key}"]`);
        if (el) el.textContent = `${v.phase || 'working'} · ${elapsed(v)}`;
      }
    }
  }, 1000);
}

const setBusy = (btn, busy, label) => {
  st.busy = busy;
  btn.disabled = busy;
  if (label) btn.dataset.rest ??= btn.textContent;
  btn.textContent = busy ? label : (label || btn.dataset.rest || btn.textContent);
};

function note(el, text) {
  if (!el) return;
  el.textContent = text;
  el.dataset.alert = 'true';
  setTimeout(() => { el.dataset.alert = 'false'; }, 6000);
}

/* ── Live ──────────────────────────────────────────────────────────────── */

let refreshTimer;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    if (!st.project) return;
    try {
      st.project = await api(`/projects/${st.project.id}`);
      render();
    } catch { /* deleted elsewhere; leave what's on screen */ }
  }, 120);
}

/* ── Mount ─────────────────────────────────────────────────────────────── */

export function mountStudio({ source, library }) {
  st.library = library;

  $('briefForm').addEventListener('submit', submitBrief);
  $('refSearch').addEventListener('input', onRefSearch);
  $('generateBtn').addEventListener('click', () => generate(1));

  for (const b of document.querySelectorAll('.studio__reroll')) {
    b.addEventListener('click', () => generate(Number(b.dataset.gen), true));
  }

  // A workspace tab edits the same files this board is previewing. Its saves
  // arrive over the existing stream, and the affected tile is re-keyed when
  // this tab is next looked at — reloading a preview nobody is watching is how
  // the board ended up flickering the first time round.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && st.stale.size) applyEdits();
  });

  $('viewerClose').addEventListener('click', () => $('viewer').close());
  $('viewer').addEventListener('close', closeViewer);

  source?.addEventListener('studio', (ev) => {
    let msg = {};
    try { msg = JSON.parse(ev.data); } catch { /* keep-alive */ }
    if (msg.type === 'project:new' || msg.type === 'project:deleted') loadProjects();
    if (!msg.id || msg.id !== st.project?.id) return;
    if (msg.type === 'edit') {
      st.stale.set(msg.path, Date.now());
      if (document.visibilityState === 'visible') applyEdits();
      return;
    }
    scheduleRefresh();
  });

  // Backstop, and it must not stop when the board goes quiet. A four-minute
  // fan-out is a long time to trust one connection, and a run started from the
  // CLI, another tab, or after a server restart is invisible to a client that
  // only polls while it already believes something is running.
  let ticks = 0;
  setInterval(() => {
    if (!st.project) return;
    ticks++;
    if ([1, 2].map(genOf).some(isRunning) || ticks % 4 === 0) scheduleRefresh();
  }, 5000);

  loadProjects();

  return {
    async openProject(id) {
      if (!id) { st.project = null; render(); return; }
      if (st.project?.id === id) { render(); return; }
      try {
        st.project = await api(`/projects/${id}`);
      } catch {
        st.project = null;
        location.hash = 'studio';
        return;
      }
      st.open.clear();
      render();
    },
    refresh: () => { if (st.project) scheduleRefresh(); else render(); },
  };
}
