/* Website Inspo Library — the inspector, panel side.

   The generated page is sandboxed with no allow-same-origin, so this side never
   touches its DOM. It sends commands over postMessage and keeps the record of
   what was changed; the file on disk is the source of truth and every change is
   written back into it.

   Persistence deliberately does NOT serialise the live document. A generated
   page may run a little inline script — a clock, an observer — and saving the
   live DOM would bake its runtime state into the file a bit more on every
   write. Instead the pristine file is re-fetched, parsed inert with DOMParser,
   patched with the recorded changes, and written back whole. */

const $ = (id) => document.getElementById(id);

/* Offered in the Easing field's autocomplete. The field takes any CSS value, so
   this is not a menu — it is a set of defaults, and a default is a taste
   statement. No overshoot curve is listed: a back-ease reads as dated on almost
   everything, and anyone who genuinely wants one can still type it. */
const EASES = [
  'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out',
  'cubic-bezier(0.2, 0, 0, 1)', 'cubic-bezier(0.4, 0, 0.2, 1)',
  'cubic-bezier(0.16, 1, 0.3, 1)', 'cubic-bezier(0.25, 1, 0.5, 1)',
  'steps(6, end)',
];

const SAVE_DELAY = 700;

export function mountInspector({ frame, onSaved }) {
  const panel = $('inspector');

  const st = {
    ctx: null,          // { projectId, path }
    sel: null,          // the selected element's path
    snap: new Map(),    // sel → { inline, text } as first seen this session
    edits: new Map(),   // sel → { style: {prop: value}, text?: string }
    css: '',            // the tweak patch — one stylesheet, always complete
    undo: [],           // { sel, kind, prop, from }
    baseline: false,    // is a copy of the generated original kept on disk
    timer: null,
    saving: null,
    pending: false,
  };

  const fields = [...panel.querySelectorAll('[data-prop]')];
  const post = (msg) => frame.contentWindow?.postMessage({ to: 'inspo', ...msg }, '*');

  /* ── Status ──────────────────────────────────────────────────────────── */

  const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  function state(text, alert = false) {
    const el = $('inspState');
    el.textContent = text;
    el.dataset.alert = String(alert);
  }

  const changeCount = () => [...st.edits.values()]
    .reduce((n, e) => n + Object.keys(e.style).length + (e.text != null ? 1 : 0), 0)
    + (st.css.trim() ? 1 : 0);

  function refreshFoot() {
    $('inspUndo').disabled = !st.undo.length;
    $('inspResetEl').disabled = !st.sel || !st.edits.has(st.sel);
    $('inspRevert').hidden = !st.baseline;
  }

  /* ── The record ──────────────────────────────────────────────────────── */

  function entry(sel) {
    let e = st.edits.get(sel);
    if (!e) { e = { style: {} }; st.edits.set(sel, e); }
    return e;
  }

  const currentValue = (sel, prop) =>
    st.edits.get(sel)?.style?.[prop] ?? st.snap.get(sel)?.inline?.[prop] ?? '';

  function setProp(sel, prop, value, { record = true } = {}) {
    const from = currentValue(sel, prop);
    if (from === value) return;
    if (record) st.undo.push({ sel, kind: 'style', prop, from });
    entry(sel).style[prop] = value;
    post({ t: 'style', sel, prop, value });
    queueSave();
  }

  function setText(sel, value, { record = true } = {}) {
    const from = st.edits.get(sel)?.text ?? st.snap.get(sel)?.text ?? null;
    if (from === value) return;
    if (record) st.undo.push({ sel, kind: 'text', from });
    entry(sel).text = value;
    queueSave();
  }

  /* A tweak's patch rides the same undo stack as a hand-made change, so one
     Undo walks back through both kinds in the order they happened. The panel
     holds the whole patch rather than a delta, which is what makes undoing it
     a single assignment. */
  function setCss(text, { record = true } = {}) {
    const next = String(text || '');
    if (next === st.css) return;
    if (record) st.undo.push({ kind: 'css', from: st.css });
    st.css = next;
    post({ t: 'css', css: st.css });
    queueSave();
  }

  function undo() {
    const last = st.undo.pop();
    if (!last) return;
    if (last.kind === 'css') {
      st.css = last.from;
      post({ t: 'css', css: st.css });
    } else if (last.kind === 'style') {
      entry(last.sel).style[last.prop] = last.from;
      post({ t: 'style', sel: last.sel, prop: last.prop, value: last.from, echo: true });
    } else {
      entry(last.sel).text = last.from;
      post({ t: 'text', sel: last.sel, value: last.from });
    }
    // A patch undo belongs to no single element, so there is nothing to reveal.
    if (last.sel && last.sel !== st.sel) post({ t: 'select', sel: last.sel, reveal: true });
    queueSave();
    refreshFoot();
  }

  // Back to how this element left the generator — for the properties touched in
  // this session. Everything on the page is handled by Revert, which restores
  // the file the generator wrote.
  function resetElement() {
    const sel = st.sel;
    const e = st.edits.get(sel);
    if (!sel || !e) return;
    for (const prop of Object.keys(e.style)) {
      const original = st.snap.get(sel)?.inline?.[prop] ?? '';
      st.undo.push({ sel, kind: 'style', prop, from: currentValue(sel, prop) });
      e.style[prop] = original;
      post({ t: 'style', sel, prop, value: original, echo: true });
    }
    if (e.text != null) {
      const original = st.snap.get(sel)?.text ?? null;
      st.undo.push({ sel, kind: 'text', from: e.text });
      e.text = original;
      if (original != null) post({ t: 'text', sel, value: original });
    }
    queueSave();
    refreshFoot();
  }

  /* ── Persistence ─────────────────────────────────────────────────────── */

  function queueSave() {
    const n = changeCount();
    state(`${n} change${n === 1 ? '' : 's'} — saving…`);
    st.pending = true;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => { save(); }, SAVE_DELAY);
    refreshFoot();
  }

  // Everything outside <html> — the doctype and the generator's own header
  // comment, which lives before <html> in some variants — is preserved by
  // walking the document's children rather than taking documentElement alone.
  function serialise(doc) {
    // The parser moves whitespace that followed </body> back inside the body.
    // Serialising it and then adding the file's trailing newline again would
    // grow the page by one blank line on every single save.
    while (doc.body?.lastChild?.nodeType === Node.TEXT_NODE && !doc.body.lastChild.data.trim()) {
      doc.body.lastChild.remove();
    }

    let out = '';
    for (const node of doc.childNodes) {
      if (node.nodeType === Node.DOCUMENT_TYPE_NODE) out += `<!DOCTYPE ${node.name}>\n`;
      else if (node.nodeType === Node.COMMENT_NODE) out += `<!--${node.data}-->\n`;
      else if (node.nodeType === Node.ELEMENT_NODE) out += node.outerHTML;
      else if (node.nodeType === Node.TEXT_NODE) out += node.data;
    }
    return `${out}\n`;
  }

  async function save() {
    /* Only st.pending decides. It is set by the one function every change goes
       through, so it already means "there is something to write" — where a
       count of edits does not: undoing a tweak back to nothing leaves zero of
       both and still has to reach the file, or the patch stays on disk after
       being taken off the page. */
    if (!st.ctx || !st.pending) return;
    if (st.saving) { await st.saving.catch(() => {}); }
    st.pending = false;
    st.saving = (async () => {
      const { projectId, path } = st.ctx;
      const src = await fetch(`builds/${projectId}/${path}`, { cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error(`could not read the page (${r.status})`);
        return r.text();
      });

      const doc = new DOMParser().parseFromString(src, 'text/html');
      let missed = 0;
      for (const [sel, e] of st.edits) {
        const el = doc.querySelector(sel);
        if (!el) { missed++; continue; }
        for (const [prop, value] of Object.entries(e.style)) {
          if (value) el.style.setProperty(prop, value);
          else el.style.removeProperty(prop);
        }
        if (!el.getAttribute('style')) el.removeAttribute('style');
        if (e.text != null) el.textContent = e.text;
      }

      /* The patch is one stylesheet at the end of the head, rewritten in place
         and carrying the same id the frame uses. st.css is always the whole
         patch, so writing it twice is writing it once — and a page whose patch
         has been undone back to nothing loses the tag rather than keeping an
         empty one. */
      const patch = doc.getElementById('inspo-tweak');
      if (st.css.trim()) {
        const tag = patch || doc.createElement('style');
        tag.id = 'inspo-tweak';
        tag.textContent = `\n${st.css.trim()}\n`;
        if (!patch) doc.head.append(tag);
      } else if (patch) {
        patch.remove();
      }

      const res = await fetch(`/api/studio/projects/${encodeURIComponent(projectId)}/edit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, html: serialise(doc) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || res.statusText);

      st.baseline = true;
      onSaved?.(path);
      state(missed
        ? `Saved ${clock()} — ${missed} change${missed === 1 ? '' : 's'} could not be located in the file`
        : `Saved ${clock()}`, missed > 0);
      refreshFoot();
    })().catch((err) => {
      // Left pending so closing the panel, or the next edit, tries again.
      st.pending = true;
      state(`Not saved — ${err.message}`, true);
    }).finally(() => { st.saving = null; });

    return st.saving;
  }

  async function flush() {
    clearTimeout(st.timer);
    if (st.saving) await st.saving.catch(() => {});
    if (st.pending) await save();
  }

  async function revert() {
    if (!st.ctx) return;
    clearTimeout(st.timer);
    if (st.saving) await st.saving.catch(() => {});
    try {
      const res = await fetch(`/api/studio/projects/${encodeURIComponent(st.ctx.projectId)}/revert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: st.ctx.path }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || res.statusText);
    } catch (err) {
      state(`Could not revert — ${err.message}`, true);
      return;
    }
    st.edits.clear();
    st.snap.clear();
    // The generator's page has no patch on it, so neither does this session.
    st.css = '';
    st.undo.length = 0;
    st.baseline = false;
    st.sel = null;
    onSaved?.(st.ctx.path);
    reload();
    state('Reverted to the page the generator wrote.');
  }

  const frameUrl = () => `builds/${st.ctx.projectId}/${st.ctx.path}?inspect=1&v=${Date.now()}`;

  function reload() {
    showFields(null);
    frame.src = frameUrl();
  }

  /* ── Panel ───────────────────────────────────────────────────────────── */

  function showFields(info) {
    $('inspFields').hidden = !info;
    $('inspEmpty').hidden = !!info;
    if (!info) { $('inspCrumbs').replaceChildren(); return; }

    for (const input of fields) {
      const prop = input.dataset.prop;
      input.value = info.inline[prop] || '';
      input.placeholder = shorten(prop, info.computed[prop]);
    }
    for (const sw of panel.querySelectorAll('[data-swatch]')) {
      const prop = sw.dataset.swatch;
      sw.value = hex(info.inline[prop] || info.computed[prop]) || '#000000';
    }

    const list = $('inspFonts');
    list.replaceChildren(...info.fonts.map((f) => Object.assign(document.createElement('option'), { value: f })));

    $('inspText').disabled = !info.textOnly;
    $('inspTextNote').textContent = info.textOnly
      ? 'Or double-click the text on the page.'
      : info.asset
        ? 'This is an asset frame — its artwork comes from the image pipeline, not from here.'
        : 'This element holds other elements, so its text is theirs to edit.';

    $('inspCrumbs').replaceChildren(...info.crumbs.map((c, i, all) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'insp__crumb';
      b.textContent = c.label;
      b.disabled = i === all.length - 1;
      b.addEventListener('click', () => post({ t: 'select', sel: c.sel }));
      return b;
    }));
  }

  // The computed value is a hint, not a value to be typed back in: a font stack
  // and a 6-decimal line height are both noise at this width.
  function shorten(prop, value) {
    if (!value) return '';
    if (prop === 'font-family') return value.split(',')[0].replace(/^["']|["']$/g, '');
    if (/^-?\d+\.\d{3,}/.test(value)) return String(Math.round(parseFloat(value) * 100) / 100) + value.replace(/^-?[\d.]+/, '');
    return value.length > 28 ? `${value.slice(0, 27)}…` : value;
  }

  function hex(value) {
    const m = String(value || '').match(/^rgba?\(([^)]+)\)/);
    if (m) {
      const [r, g, b] = m[1].split(/[,\s/]+/).map(Number);
      if ([r, g, b].some(Number.isNaN)) return null;
      return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    }
    if (/^#[0-9a-f]{6}$/i.test(value)) return value;
    if (/^#[0-9a-f]{3}$/i.test(value)) return `#${value.slice(1).split('').map((c) => c + c).join('')}`;
    return null;
  }

  /* Arrow keys nudge a numeric value in place — 1 step, 10 with Shift, a tenth
     with Alt, and a tenth of that again for em and rem. Typing a whole value
     still works, so clamp() and var() stay reachable. */
  function nudge(input, dir, ev) {
    const raw = (input.value || input.placeholder || '').trim();
    const m = raw.match(/^(-?[\d.]+)([a-z%]*)$/i);
    if (!m) return false;
    const unit = m[2];
    let step = unit === 'rem' || unit === 'em' ? 0.1 : 1;
    if (ev.shiftKey) step *= 10;
    if (ev.altKey) step /= 10;
    const next = Math.round((parseFloat(m[1]) + dir * step) * 1000) / 1000;
    input.value = `${next}${unit}`;
    return true;
  }

  /* ── Wiring ──────────────────────────────────────────────────────────── */

  for (const input of fields) {
    input.addEventListener('input', () => {
      if (!st.sel) return;
      const value = input.value.trim();
      setProp(st.sel, input.dataset.prop, value);
      // Keep a paired swatch honest when the colour was typed rather than
      // picked. A named colour or a var() simply leaves it where it was.
      const swatch = panel.querySelector(`[data-swatch="${input.dataset.prop}"]`);
      const picked = swatch && hex(value);
      if (picked) swatch.value = picked;
    });
    input.addEventListener('keydown', (ev) => {
      const dir = ev.key === 'ArrowUp' ? 1 : ev.key === 'ArrowDown' ? -1 : 0;
      if (!dir || !nudge(input, dir, ev)) return;
      ev.preventDefault();
      input.dispatchEvent(new Event('input'));
    });
  }

  for (const sw of panel.querySelectorAll('[data-swatch]')) {
    sw.addEventListener('input', () => {
      const prop = sw.dataset.swatch;
      const input = panel.querySelector(`[data-prop="${prop}"]`);
      input.value = sw.value;
      if (st.sel) setProp(st.sel, prop, sw.value);
    });
  }

  $('inspUndo').addEventListener('click', undo);
  $('inspResetEl').addEventListener('click', resetElement);
  $('inspText').addEventListener('click', () => post({ t: 'edit-text', sel: st.sel }));
  $('inspRevert').addEventListener('click', () => {
    if (confirm('Throw away every edit and restore the page the generator wrote?')) revert();
  });
  $('inspMin').addEventListener('click', () => {
    const min = panel.dataset.min !== 'true';
    panel.dataset.min = String(min);
    $('inspMin').setAttribute('aria-label', min ? 'Expand the inspector' : 'Minimise the inspector');
    $('inspMin').textContent = min ? '+' : '–';
  });

  $('inspEases').replaceChildren(
    ...EASES.map((e) => Object.assign(document.createElement('option'), { value: e })));

  /* ── From the frame ──────────────────────────────────────────────────── */

  addEventListener('message', (ev) => {
    if (ev.source !== frame.contentWindow || ev.data?.from !== 'inspo') return;
    // The frame stays armed for other things — picking an element to comment on
    // — while the panel is closed. None of that is the panel's business.
    if (!st.ctx) return;
    const msg = ev.data;

    if (msg.t === 'ready') {
      if (st.ctx) post({ t: 'arm', on: true });
      return;
    }

    if (msg.t === 'selected') {
      st.sel = msg.sel;
      if (!st.snap.has(msg.sel)) st.snap.set(msg.sel, { inline: { ...msg.inline }, text: msg.text });
      showFields(msg);
      refreshFoot();
      return;
    }

    if (msg.t === 'deselected') { st.sel = null; showFields(null); refreshFoot(); return; }

    if (msg.t === 'text' && st.sel) { setText(msg.sel, msg.value); refreshFoot(); return; }

    if (msg.t === 'undo') { undo(); return; }
    if (msg.t === 'save') { flush(); return; }
  });

  // Undo and save have to work while the pointer is over the page, which means
  // the keystroke lands in the frame; it forwards them here.
  panel.addEventListener('keydown', (ev) => {
    if (!(ev.metaKey || ev.ctrlKey)) return;
    if (ev.key === 'z') { ev.preventDefault(); undo(); }
    if (ev.key === 's') { ev.preventDefault(); flush(); }
  });

  return {
    async attach(ctx) {
      st.ctx = ctx;
      st.sel = null;
      st.edits.clear();
      st.snap.clear();
      st.css = '';
      st.undo.length = 0;
      st.pending = false;
      panel.hidden = false;
      panel.dataset.min = 'false';
      showFields(null);
      state('Click anything on the page.');

      // The page may already carry a patch from an earlier session. Read it
      // back, or this session's first save would erase every tweak on it.
      st.css = await fetch(`builds/${ctx.projectId}/${ctx.path}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.text() : ''))
        .then((src) => new DOMParser().parseFromString(src, 'text/html')
          .getElementById('inspo-tweak')?.textContent.trim() || '')
        .catch(() => '');

      // A kept original means this page has been edited before, which is the
      // only thing that makes Revert meaningful.
      st.baseline = await fetch(`/api/studio/projects/${encodeURIComponent(ctx.projectId)}/edit`
        + `?path=${encodeURIComponent(ctx.path)}`)
        .then((r) => r.json()).then((b) => !!b.edited).catch(() => false);
      refreshFoot();
      // A frame that is already showing the instrumented page — the workspace
      // keeps one loaded — arms now. One still loading arms on its ready.
      post({ t: 'arm', on: true, mode: 'inspect' });
      return frameUrl();
    },

    async detach() {
      if (!st.ctx) return;
      await flush();
      post({ t: 'arm', on: false });
      panel.hidden = true;
      st.ctx = null;
      st.sel = null;
      st.edits.clear();
      st.snap.clear();
      st.css = '';
      st.undo.length = 0;
    },

    /* What the Tweak tab needs from here. It owns the conversation; the patch
       and the saving stay the inspector's, so one Undo and one save serve both
       halves of the panel. */
    get patch() { return st.css; },

    applyTweak({ css, text = [] }) {
      if (typeof css === 'string') setCss(css);
      for (const change of text) {
        if (change?.sel && typeof change.value === 'string') setText(change.sel, change.value);
      }
      refreshFoot();
    },

    get selection() { return st.sel; },
    get active() { return !!st.ctx; },
  };
}
