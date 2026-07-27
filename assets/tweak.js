/* Website Inspo Library — Tweak.

   The second tab in the workspace dock. You describe a change instead of typing
   a value, and it lands on the page the same way a hand-made one does: through
   the inspector's patch, its undo stack and its save. Nothing here writes a
   file.

   Clicking elements on the page adds them as references, which is the whole
   reason this lives beside the frame rather than in a terminal. With nothing
   referenced, a tweak is about the page as a whole.                          */

const $ = (id) => document.getElementById(id);

export function mountTweak({ inspector, frame }) {
  const st = {
    ctx: null,      // { projectId, path }
    thread: [],
    refs: [],       // { sel, label }
    pending: null,  // an image request waiting on a count
    busy: false,
  };

  const showing = () => $('inspTabTweak').getAttribute('aria-selected') === 'true';

  const api = async (path, options) => {
    const res = await fetch(`/api/studio${path}`, {
      headers: options?.body ? { 'content-type': 'application/json' } : undefined,
      ...options,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || res.statusText);
    return body;
  };

  /* ── Tabs ──────────────────────────────────────────────────────────────── */

  function showTab(which) {
    const tweak = which === 'tweak';
    $('inspTabTweak').setAttribute('aria-selected', String(tweak));
    $('inspTabFields').setAttribute('aria-selected', String(!tweak));
    $('inspPaneTweak').hidden = !tweak;
    $('inspPaneFields').hidden = tweak;
    // The crumbs name the selected element, which both tabs are about.
    if (tweak) $('twkText').focus();
  }

  /* ── References ────────────────────────────────────────────────────────── */

  function renderRefs() {
    const box = $('twkRefs');
    box.hidden = !st.refs.length;
    box.replaceChildren(...st.refs.map((r, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'twk__ref';
      chip.textContent = r.label || r.sel;
      chip.title = `${r.sel} — click to drop`;
      chip.addEventListener('click', () => {
        st.refs.splice(i, 1);
        renderRefs();
      });
      return chip;
    }));
  }

  function addRef(sel, label, html) {
    if (!sel) return;
    /* Clicking a small element and then climbing its crumbs re-selects the
       parent. That is one reference being refined, not two, so the whole
       lineage is dropped before the new one goes on. pathOf builds a strict
       descendant chain, which makes ancestry a prefix test. */
    const lineage = (a, b) => a === b || a.startsWith(`${b}>`) || b.startsWith(`${a}>`);
    st.refs = st.refs.filter((r) => !lineage(r.sel, sel));
    // Four is already more than one instruction usually means, and the chips
    // have one row to live in.
    st.refs.push({ sel, label, html });
    if (st.refs.length > 4) st.refs.shift();
    renderRefs();
  }

  /* ── The thread ────────────────────────────────────────────────────────── */

  function row(message) {
    const box = document.createElement('article');
    box.className = 'twk__msg';
    box.dataset.role = message.role;

    const head = document.createElement('p');
    head.className = 'twk__msgHead';
    head.textContent = message.role === 'you' ? 'You' : 'Tweak';
    if (message.refs?.length) {
      const on = document.createElement('span');
      on.className = 'twk__msgRefs';
      on.textContent = message.refs.join(', ');
      head.append(on);
    }

    const body = document.createElement('p');
    body.className = 'twk__msgText';
    body.textContent = message.text;

    box.append(head, body);
    return box;
  }

  /* ── Asking without spending a turn ──────────────────────────────────────
     A picture needs a count, and a count is a click, not a sentence. Both this
     and the picker below answer straight into the next request — no model runs
     to interpret "4". */

  function askCount(request) {
    const box = document.createElement('article');
    box.className = 'twk__msg twk__ask';
    box.dataset.role = 'ai';

    const head = document.createElement('p');
    head.className = 'twk__msgHead';
    head.textContent = 'How many?';

    const what = document.createElement('p');
    what.className = 'twk__msgText';
    what.textContent = request;

    const row = document.createElement('div');
    row.className = 'twk__choices';
    for (const n of [1, 2, 3, 4]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'twk__choice';
      b.dataset.on = String(n === 4);
      b.textContent = String(n);
      b.addEventListener('click', () => makeAssets(request, n));
      row.append(b);
    }

    const note = document.createElement('p');
    note.className = 'twk__askNote';
    note.textContent = 'variations to generate';

    box.append(head, what, row, note);
    return box;
  }

  function picker(assets) {
    const box = document.createElement('article');
    box.className = 'twk__msg';
    box.dataset.role = 'ai';

    const head = document.createElement('p');
    head.className = 'twk__msgHead';
    head.textContent = 'Pick one';

    const grid = document.createElement('div');
    grid.className = 'twk__plates';
    for (const asset of assets) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'twk__plate';
      b.title = asset.prompt || asset.file;
      const img = document.createElement('img');
      img.src = `builds/${st.ctx.projectId}/${st.ctx.path.replace(/[^/]+$/, '')}${asset.file}`;
      img.alt = asset.style || asset.file;
      img.loading = 'lazy';
      const cap = document.createElement('span');
      cap.className = 'twk__plateName';
      cap.textContent = asset.style || asset.file;
      b.append(img, cap);
      b.addEventListener('click', () => {
        $('twkText').value = `Use ${asset.file} — place it as the ${st.refs.length ? 'background of the element I referenced' : 'hero background'}, full bleed, sitting behind the existing content.`;
        send();
      });
      grid.append(b);
    }

    box.append(head, grid);
    return box;
  }

  async function makeAssets(request, count) {
    if (st.busy || !st.ctx) return;
    st.pending = null;
    setBusy(true, `Generating ${count}`);
    try {
      const out = await api(`/projects/${encodeURIComponent(st.ctx.projectId)}/assets`, {
        method: 'POST',
        body: JSON.stringify({ path: st.ctx.path, request, count }),
      });
      st.thread.push({ role: 'ai', text: `Made ${out.assets.length}. Pick one and it goes on the page.`, assets: out.assets });
    } catch (err) {
      st.thread.push({ role: 'ai', text: `No images — ${err.message}` });
    } finally {
      setBusy(false);
    }
  }

  function renderThread() {
    const thread = $('twkThread');
    thread.replaceChildren(...st.thread.flatMap((m) => (m.assets?.length ? [row(m), picker(m.assets)] : [row(m)])));
    if (st.pending) thread.append(askCount(st.pending));

    if (st.busy) {
      const wait = document.createElement('article');
      wait.className = 'twk__msg twk__msg--wait';
      wait.dataset.role = 'ai';
      const head = document.createElement('p');
      head.className = 'twk__msgHead';
      head.textContent = 'Tweak';
      const scan = document.createElement('span');
      scan.className = 'twk__scan';
      wait.append(head, scan);
      thread.append(wait);
    }

    $('twkEmpty').hidden = st.thread.length > 0 || st.busy || !!st.pending;
    thread.scrollTop = thread.scrollHeight;
  }

  function setBusy(on, label = 'Tweaking') {
    st.busy = on;
    $('twkSend').disabled = on;
    $('twkText').disabled = on;
    $('twkSend').textContent = on ? label : 'Tweak';
    renderThread();
  }

  /* ── Sending ───────────────────────────────────────────────────────────── */

  async function send(ev) {
    ev?.preventDefault();
    if (st.busy || !st.ctx) return;
    const message = $('twkText').value.trim();
    if (!message) return;

    const refs = st.refs.slice();
    st.thread.push({ role: 'you', text: message, refs: refs.map((r) => r.label || r.sel) });
    $('twkText').value = '';
    setBusy(true);

    try {
      const answer = await api(`/projects/${encodeURIComponent(st.ctx.projectId)}/tweak`, {
        method: 'POST',
        body: JSON.stringify({
          path: st.ctx.path,
          message,
          refs,
          // The inspector owns the patch; the model needs to see it to return
          // it whole, since what comes back replaces it.
          patch: inspector.patch,
        }),
      });

      st.thread.push({ role: 'ai', text: answer.reply });
      inspector.applyTweak({ css: answer.css, text: answer.text });
      // A named picture becomes a control, not another round of typing.
      st.pending = answer.image || null;
      // A tweak that landed keeps its references; the next instruction is
      // usually about the same thing.
    } catch (err) {
      st.thread.push({ role: 'ai', text: `Nothing changed — ${err.message}` });
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!st.ctx || st.busy) return;
    st.thread = [];
    st.refs = [];
    st.pending = null;
    renderRefs();
    renderThread();
    await api(`/projects/${encodeURIComponent(st.ctx.projectId)}/tweak`
      + `?path=${encodeURIComponent(st.ctx.path)}`, { method: 'DELETE' }).catch(() => {});
  }

  /* ── Wiring ────────────────────────────────────────────────────────────── */

  $('inspTabFields').addEventListener('click', () => showTab('fields'));
  $('inspTabTweak').addEventListener('click', () => showTab('tweak'));
  $('twkForm').addEventListener('submit', send);
  $('twkClear').addEventListener('click', clear);
  $('twkText').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) send(ev);
  });

  // The inspector listens for the same messages to fill its fields. This one
  // only wants the pick, and only while the tab that shows references is up.
  addEventListener('message', (ev) => {
    if (ev.source !== frame.contentWindow || ev.data?.from !== 'inspo') return;
    if (ev.data.t === 'selected' && showing()) addRef(ev.data.sel, ev.data.label, ev.data.html);
  });

  return {
    async attach(ctx) {
      st.ctx = ctx;
      st.refs = [];
      st.thread = [];
      renderRefs();
      renderThread();
      showTab('fields');
      st.thread = await api(`/projects/${encodeURIComponent(ctx.projectId)}/tweak`
        + `?path=${encodeURIComponent(ctx.path)}`).catch(() => []);
      renderThread();
    },

    detach() {
      st.ctx = null;
      st.thread = [];
      st.refs = [];
      showTab('fields');
    },
  };
}
