/* Website Inspo Library — the inspector, frame side.

   Injected into a generated page only when the server is asked for it with
   ?inspect=1, so the file on disk never carries a line of this.

   The page runs in an iframe sandboxed WITHOUT allow-same-origin — a generated
   page must not be able to reach into the library — so the panel cannot touch
   this document directly. Everything crosses by postMessage: this side owns the
   DOM and knows nothing about files, the panel side owns the file and knows
   nothing about the DOM. */

(() => {
  'use strict';
  if (window.__inspoInspector) return;
  window.__inspoInspector = true;

  // Every property the panel can set. Reported back on selection as both the
  // computed value (what you see) and the inline value (what you set), because
  // the difference is the whole of "have I touched this yet".
  const PROPS = [
    'font-family', 'font-size', 'font-weight', 'letter-spacing', 'line-height',
    'color', 'background-color',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'border-radius',
    'transition-property', 'transition-duration', 'transition-timing-function',
  ];

  const VOID = new Set(['IMG', 'SVG', 'INPUT', 'TEXTAREA', 'BR', 'HR', 'CANVAS', 'VIDEO', 'IFRAME']);

  const send = (msg) => { try { parent.postMessage({ from: 'inspo', ...msg }, '*'); } catch { /* closed */ } };

  // '' when the page is only being looked at, 'inspect' while it is being
  // edited, 'comment' while an element is being chosen to comment on. Picking
  // is the same gesture in both armed modes; what happens next is the panel's
  // business, not this side's.
  let mode = '';
  const armed = () => mode !== '';
  let selected = null;
  let editing = null;

  /* ── Overlay ───────────────────────────────────────────────────────────
     Drawn in here rather than mirrored in the panel: the frame scrolls, and a
     rect measured on the other side of the boundary is out of date the moment
     it arrives. */

  const layer = document.createElement('div');
  layer.setAttribute('data-inspector', '');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';

  const rect = (border) => {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;border:${border};display:none;pointer-events:none;`;
    return el;
  };
  const hoverBox = rect('1px dashed rgba(23,21,15,.5)');
  const selBox = rect('1px solid #17150F');
  selBox.style.boxShadow = '0 0 0 1px rgba(242,239,230,.7)';

  const badge = document.createElement('span');
  badge.style.cssText = 'position:fixed;display:none;pointer-events:none;'
    + 'font:500 10px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em;'
    + 'text-transform:uppercase;background:#17150F;color:#F2EFE6;padding:1px 6px;white-space:nowrap;';

  layer.append(hoverBox, selBox, badge);

  const mount = () => (document.body || document.documentElement).append(layer);
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  function place(box, el) {
    if (!el || !el.isConnected) { box.style.display = 'none'; return null; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: 'block',
      left: `${r.left}px`, top: `${r.top}px`,
      width: `${Math.max(r.width, 1)}px`, height: `${Math.max(r.height, 1)}px`,
    });
    return r;
  }

  function paint() {
    const r = place(selBox, selected);
    if (r && armed()) {
      badge.style.display = 'block';
      badge.textContent = name(selected);
      badge.style.left = `${Math.max(0, r.left)}px`;
      badge.style.top = r.top > 18 ? `${r.top - 18}px` : `${r.bottom}px`;
    } else {
      badge.style.display = 'none';
    }
  }

  let frameQueued = false;
  const repaint = () => {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => { frameQueued = false; paint(); place(hoverBox, hover); placePins(); });
  };
  addEventListener('scroll', repaint, true);
  addEventListener('resize', repaint);

  /* ── Identity ──────────────────────────────────────────────────────────
     A path the panel can resolve against a fresh parse of the file on disk,
     not against this live DOM — so it must not depend on anything a script on
     this page did after load. An id anchor when there is a unique one, an
     :nth-child chain otherwise. */

  const ID_OK = /^[A-Za-z][\w-]*$/;

  function pathOf(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      if (node === document.documentElement) { parts.unshift('html'); break; }
      if (node.id && ID_OK.test(node.id) && document.querySelectorAll(`#${node.id}`).length === 1) {
        parts.unshift(`#${node.id}`);
        break;
      }
      const parent = node.parentElement;
      if (!parent) break;
      const i = Array.prototype.indexOf.call(parent.children, node) + 1;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${i})`);
      node = parent;
    }
    return parts.join('>');
  }

  function name(el) {
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0];
    return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : cls ? `.${cls}` : '');
  }

  // The ancestor chain, so the panel can offer a breadcrumb. Clicking a small
  // element and then climbing is faster than trying to hit its container.
  function crumbs(el) {
    const out = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      out.unshift({ sel: pathOf(node), label: name(node) });
      if (node === document.documentElement) break;
    }
    return out.slice(-6);
  }

  const editable = (el) => !VOID.has(el.tagName)
    && el.children.length === 0
    && el.textContent.trim().length > 0;

  /* Families the page actually loads, so the panel can offer them before it
     offers anything generic. Google Fonts links are the reliable source; a
     stylesheet from another origin cannot be read from here. */
  function fonts() {
    const found = new Set();
    for (const link of document.querySelectorAll('link[href*="fonts.googleapis.com"]')) {
      const q = link.href.split('?')[1] || '';
      for (const part of q.split('&')) {
        if (!part.startsWith('family=')) continue;
        const fam = decodeURIComponent(part.slice(7).split(':')[0]).replace(/\+/g, ' ').trim();
        if (fam) found.add(fam);
      }
    }
    for (const el of [document.body, document.querySelector('h1'), document.querySelector('p')]) {
      if (!el) continue;
      for (const fam of getComputedStyle(el).fontFamily.split(',')) {
        const clean = fam.trim().replace(/^["']|["']$/g, '');
        if (clean && !/^(ui-|system-|-apple)/.test(clean)) found.add(clean);
      }
    }
    return [...found].slice(0, 12);
  }

  function report(el) {
    const computed = getComputedStyle(el);
    const out = { computed: {}, inline: {} };
    for (const prop of PROPS) {
      out.computed[prop] = computed.getPropertyValue(prop).trim();
      out.inline[prop] = el.style.getPropertyValue(prop).trim();
    }
    send({
      t: 'selected',
      sel: pathOf(el),
      crumbs: crumbs(el),
      label: name(el),
      tag: el.tagName.toLowerCase(),
      textOnly: editable(el),
      text: editable(el) ? el.textContent : null,
      asset: el.hasAttribute('data-asset-prompt') || !!el.closest('[data-asset-prompt]'),
      fonts: fonts(),
      ...out,
    });
  }

  /* ── Selection ─────────────────────────────────────────────────────────── */

  let hover = null;

  const ours = (el) => !el || el === layer || layer.contains(el) || el.hasAttribute?.('data-inspector');

  function select(el) {
    if (!el || ours(el)) return;
    selected = el;
    paint();
    report(el);
  }

  addEventListener('mousemove', (ev) => {
    if (!armed() || editing) return;
    const el = ev.target;
    if (ours(el) || el === hover) return;
    hover = el.nodeType === 1 ? el : null;
    place(hoverBox, hover);
  }, true);

  addEventListener('mouseleave', () => { hover = null; hoverBox.style.display = 'none'; });

  // Capture phase, and stopped dead: an armed page must not navigate, submit,
  // or fire the page's own handlers while it is being picked apart.
  addEventListener('click', (ev) => {
    if (!armed() || editing) return;
    if (ours(ev.target)) return;
    ev.preventDefault();
    ev.stopPropagation();
    select(ev.target);
  }, true);

  addEventListener('dblclick', (ev) => {
    if (!armed() || ours(ev.target)) return;
    ev.preventDefault();
    ev.stopPropagation();
    select(ev.target);
    startEditing(ev.target);
  }, true);

  addEventListener('submit', (ev) => { if (armed()) ev.preventDefault(); }, true);

  /* ── Text ──────────────────────────────────────────────────────────────
     plaintext-only where it exists, so pasting a paragraph of styled text into
     a headline cannot smuggle markup into the file. */

  function startEditing(el) {
    if (!el || !editable(el) || editing) return;
    editing = el;
    el.contentEditable = 'plaintext-only';
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.spellcheck = false;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    hoverBox.style.display = 'none';
    send({ t: 'editing', on: true });
  }

  function stopEditing(commit = true) {
    const el = editing;
    if (!el) return;
    editing = null;
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
    // textContent, never innerText: innerText reports the words as RENDERED, so
    // committing it under a text-transform: uppercase rule would burn the
    // uppercase permanently into the source. Non-breaking spaces, which
    // contenteditable inserts freely, collapse back to ordinary ones.
    if (commit) {
      const value = el.textContent.split(String.fromCharCode(160)).join(' ');
      if (value !== el.textContent) el.textContent = value;
      send({ t: 'text', sel: pathOf(el), value: el.textContent });
    }
    send({ t: 'editing', on: false });
    paint();
  }

  // Only the element being edited. focus() moving away from whatever held focus
  // fires a blur too, and treating that one as "done" ends the edit on the same
  // tick it started.
  addEventListener('blur', (ev) => { if (editing && ev.target === editing) stopEditing(true); }, true);
  addEventListener('keydown', (ev) => {
    if (!armed()) return;
    if (ev.key === 'Escape') {
      if (editing) { ev.preventDefault(); stopEditing(true); }
      else { selected = null; paint(); send({ t: 'deselected' }); }
    }
    if (editing && ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      editing.blur();
    }
    // Undo and save have to work while the pointer is over the page, and the
    // keystroke lands in here rather than in the panel.
    if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'z' || ev.key === 's')) {
      ev.preventDefault();
      send({ t: ev.key === 'z' ? 'undo' : 'save' });
    }
  }, true);

  /* ── Comment pins ──────────────────────────────────────────────────────
     A landmark on an element, drawn at its top-left corner and following it
     through every scroll. Pins stay visible when nothing is armed — a comment
     you cannot see while looking at the page is a comment you forget. */

  let pins = [];

  function setPins(list) {
    for (const pin of pins) pin.node.remove();
    pins = list.map((c) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.setAttribute('data-inspector', '');
      node.textContent = String(c.n);
      node.title = c.text || '';
      node.style.cssText = 'position:fixed;display:none;pointer-events:auto;cursor:pointer;'
        + 'min-width:20px;height:20px;padding:0 5px;border:1px solid #F2EFE6;background:#17150F;'
        + 'color:#F2EFE6;font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;'
        + 'letter-spacing:.06em;border-radius:0;';
      node.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const el = find(c.sel);
        if (el) select(el);
        send({ t: 'pin', id: c.id });
      }, true);
      layer.append(node);
      return { ...c, node };
    });
    placePins();
  }

  function placePins() {
    for (const pin of pins) {
      const el = find(pin.sel);
      if (!el || !el.isConnected) { pin.node.style.display = 'none'; continue; }
      const r = el.getBoundingClientRect();
      // Off-screen pins are hidden rather than clamped: a marker pinned to the
      // top edge would claim an element is there when it is not.
      const off = r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth;
      pin.node.style.display = off ? 'none' : 'block';
      // Straddling the corner rather than sitting on it, so the pin marks the
      // element without covering the thing it is a comment about.
      pin.node.style.left = `${Math.max(0, r.left - 10)}px`;
      pin.node.style.top = `${Math.max(0, r.top - 10)}px`;
    }
  }

  /* ── Commands ──────────────────────────────────────────────────────────── */

  const find = (sel) => { try { return document.querySelector(sel); } catch { return null; } };

  addEventListener('message', (ev) => {
    const msg = ev.data;
    if (!msg || msg.to !== 'inspo') return;

    if (msg.t === 'arm') {
      mode = msg.on === false ? '' : (msg.mode || 'inspect');
      document.documentElement.style.cursor = armed() ? 'crosshair' : '';
      if (!armed()) { selected = null; hover = null; stopEditing(false); }
      hoverBox.style.display = 'none';
      paint();
      return;
    }

    if (msg.t === 'pins') { setPins(msg.list || []); return; }

    if (msg.t === 'style') {
      const el = find(msg.sel);
      if (!el) return;
      if (msg.value === '' || msg.value == null) el.style.removeProperty(msg.prop);
      else el.style.setProperty(msg.prop, msg.value);
      if (!el.getAttribute('style')) el.removeAttribute('style');
      repaint();
      if (msg.echo && el === selected) report(el);
      return;
    }

    if (msg.t === 'text') {
      const el = find(msg.sel);
      if (el) el.textContent = msg.value;
      repaint();
      return;
    }

    if (msg.t === 'select') {
      const el = find(msg.sel);
      if (el) {
        select(el);
        if (msg.reveal) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      return;
    }

    if (msg.t === 'edit-text') { startEditing(find(msg.sel) || selected); return; }
  });

  send({ t: 'ready' });
})();
