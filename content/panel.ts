import { getSelectors } from './selectors';
import { browser } from 'wxt/browser';
import type { UbiconMsg, UbiconReply } from '../shared/messages';
import type { DeviceRecord } from '../shared/types';
import { currentPanelMac } from './state';
import type { LayoutBreak } from '../shared/layout-state';
import { buildReport, detectBrowser } from '../shared/report';

const send = (msg: UbiconMsg) => browser.runtime.sendMessage(msg) as Promise<UbiconReply>;
const isDark = () => !!document.querySelector(getSelectors().darkTheme);

// Everything in this file is built node by node, never from an HTML string,
// so no markup is ever assigned through innerHTML. el() keeps that readable. Attributes are given the way the markup would
// spell them ('class', 'data-tab', '' for a boolean attribute); children are
// nodes, or strings that become text.
type Attrs = Record<string, string>;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

// SVG nodes need their namespace: createElement('svg') yields an unknown
// HTML element that lays out as nothing, without any error.
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag: string, attrs: Attrs, ...children: Node[]): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .overlay { position:fixed; inset:0; background:rgba(0,0,0,.35); z-index:2147483000; }
  .dlg { position:fixed; top:10vh; left:50%; transform:translateX(-50%); width:min(440px, 92vw);
    max-height:75vh; display:flex; flex-direction:column; border-radius:10px; overflow:hidden;
    z-index:2147483001; box-shadow:0 12px 40px rgba(0,0,0,.3);
    background:var(--bg); color:var(--fg); }
  .dlg { --bg:#fff; --fg:#212327; --muted:#6b7280; --line:#e5e7eb; --hover:#f4f2fd; }
  .dlg.dark { --bg:#1e222b; --fg:#e8eaf0; --muted:#9aa1b4; --line:#333949; --hover:#2a2440; }
  header { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid var(--line); font-weight:600; font-size:14px; }
  header button { border:0; background:none; color:var(--muted); font-size:16px; cursor:pointer; }
  .tabs { display:flex; border-bottom:1px solid var(--line); }
  .tabs button { flex:1; padding:9px; border:0; background:none; color:var(--muted); font-size:13px; cursor:pointer; border-bottom:2px solid transparent; }
  .tabs button.on { color:#5B3FD1; border-bottom-color:#5B3FD1; }
  .body { overflow:auto; padding:10px 16px 16px; }
  input[type=text], input[type=search] { width:100%; padding:7px 10px; border:1px solid var(--line);
    border-radius:6px; background:transparent; color:var(--fg); font-size:13px; }
  .list { margin-top:8px; }
  .item { display:flex; gap:10px; align-items:center; padding:7px 6px; border-radius:6px; cursor:pointer; }
  .item:hover { background:var(--hover); }
  .item img { width:28px; height:28px; object-fit:contain; }
  .item .n { font-size:13px; } .item .m { font-size:11px; color:var(--muted); }
  .grouphdr { font-size:10.5px; text-transform:uppercase; letter-spacing:.6px; color:var(--muted); margin:16px 6px 4px; }
  .grouphdr:first-child { margin-top:6px; }
  .remove { color:#c0392b; padding:8px 6px; cursor:pointer; font-size:13px; }
  .msg { color:var(--muted); font-size:12px; padding:10px 4px; }
  .toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:#5B3FD1; color:#fff;
    padding:10px 16px; border-radius:8px; font-size:13px; z-index:2147483002; max-width:80vw; }
  .custom { display:flex; flex-direction:column; gap:10px; }
  .custom img.preview { width:96px; height:96px; object-fit:contain; align-self:center;
    border:1px dashed var(--line); border-radius:8px; padding:8px; }
  .save { align-self:flex-end; background:#5B3FD1; color:#fff; border:0; border-radius:6px; padding:8px 16px; font-size:13px; cursor:pointer; }
  .save:disabled { opacity:.5; cursor:default; }
`;

const MODAL_BTN_HOST_ID = 'ubicon-modal-btn';
const DLG_HOST_ID = 'ubicon-dialog';
const TIP_HOST_ID = 'ubicon-tip';

const TIP_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:10px;
    background:#5B3FD1; color:#fff; padding:10px 16px; border-radius:8px; font-size:13px; z-index:2147483002; max-width:80vw; }
  .toast button { border:0; background:none; color:#fff; opacity:.8; font-size:14px; line-height:1; cursor:pointer; padding:0; }
  .toast button:hover { opacity:1; }
`;

export function showTip(text: string): void {
  document.getElementById(TIP_HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = TIP_HOST_ID;
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = TIP_CSS;
  const toast = document.createElement('div');
  toast.className = 'toast';
  const span = document.createElement('span');
  span.textContent = text;
  const close = document.createElement('button');
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '✕';
  close.addEventListener('click', () => {
    browser.storage.local.set({ tipShown: true });
    host.remove();
  });
  toast.append(span, close);
  shadow.append(style, toast);
  document.body.append(host);
}

// The Ubicon mark (design/ubicon-icon.svg), drawn at the given pixel size.
const ubiconMark = (size: number, color = '#5B3FD1') =>
  svgEl('svg', { xmlns: SVG_NS, viewBox: '0 0 128 128', width: String(size), height: String(size) },
    svgEl('path', { d: 'M23 30 V86 A19 19 0 0 0 42 105 H86 A19 19 0 0 0 105 86 V52', fill: 'none', stroke: color, 'stroke-width': '14', 'stroke-linecap': 'round' }),
    svgEl('rect', { x: '98', y: '23', width: '14', height: '14', rx: '4', fill: color }),
    svgEl('rect', { x: '44', y: '44', width: '40', height: '40', rx: '10', fill: color }));

const MODAL_BTN_CSS = `
  :host { all: initial; }
  svg { display:block; }
`;

export function ensureModalButton(root: ParentNode): void {
  for (const dialog of root.querySelectorAll(getSelectors().modalDialog)) {
    if (!dialog.querySelector(getSelectors().iconImage)) continue;
    const header = dialog.querySelector(getSelectors().modalHeader);
    const title = header?.querySelector(getSelectors().modalTitle);
    if (!title || title.querySelector(`#${MODAL_BTN_HOST_ID}`)) continue;
    const host = document.createElement('span');
    host.id = MODAL_BTN_HOST_ID;
    host.title = 'Ubicon: community device icons';
    host.style.cssText = 'display:inline-flex;align-items:center;align-self:flex-start;height:20px;margin-left:12px;cursor:pointer;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = MODAL_BTN_CSS;
    shadow.append(style, ubiconMark(18));
    host.addEventListener('click', () => {
      const mac = currentPanelMac(document);
      if (mac) openAssignPanel(mac);
    });
    title.append(host);
  }
}

const HEADER_BADGE_ID = 'ubicon-header-badge';

const HEADER_BADGE_CSS = `
  :host { all: initial; }
  svg { display:block; }
`;

// The badge doubles as the layout-change notice: amber with a different
// title when content/layout-check.ts has declared a break.
export type BadgeState = 'ok' | 'warn';
const BADGE_TEXT: Record<BadgeState, string> = {
  ok: 'Ubicon is active',
  warn: "UniFi's layout changed. Ubicon may not work until an update.",
};
const BADGE_COLOR: Record<BadgeState, string> = { ok: '#5B3FD1', warn: '#C77A00' };
let badgeState: BadgeState = 'ok';
let badgeShadow: ShadowRoot | undefined;
let badgeHost: HTMLElement | undefined;

export function setHeaderBadgeState(state: BadgeState): void {
  badgeState = state;
  const host = document.getElementById(HEADER_BADGE_ID);
  if (!host || !badgeShadow) return;
  host.title = BADGE_TEXT[state];
  host.dataset.state = state;
  host.style.cursor = state === 'warn' ? 'pointer' : '';
  badgeShadow.querySelector('svg')?.replaceWith(ubiconMark(16, BADGE_COLOR[state]));
}

export function ensureHeaderBadge(root: ParentNode): void {
  const existing = document.getElementById(HEADER_BADGE_ID);
  if (existing) {
    // Ours: nothing to do. Not ours (left by an earlier script instance,
    // e.g. after the extension was reloaded without the page): replace it,
    // since its shadow root is out of reach and it would stay purple.
    if (badgeHost === existing) return;
    existing.remove();
  }
  const svg = [...root.querySelectorAll(getSelectors().headerLogo)].find(s => !s.closest('a'));
  if (!svg) return;
  const host = document.createElement('span');
  host.id = HEADER_BADGE_ID;
  host.title = BADGE_TEXT[badgeState];
  host.dataset.state = badgeState;
  host.addEventListener('click', () => { if (badgeState === 'warn') openLayoutNotice(); });
  host.style.cssText = 'display:inline-flex;align-items:center;height:50px;vertical-align:top;margin-left:-8px;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = HEADER_BADGE_CSS;
  shadow.append(style, ubiconMark(16, BADGE_COLOR[badgeState]));
  badgeShadow = shadow;
  badgeHost = host;
  svg.insertAdjacentElement('afterend', host);
}

// The break the amber badge reports on; set by the content script when
// content/layout-check.ts declares one, cleared on recovery.
const LAYOUT_DLG_ID = 'ubicon-layout-dialog';
let layoutBreak: LayoutBreak | null = null;
export function setLayoutBreak(brk: LayoutBreak | null): void { layoutBreak = brk; }

const LAYOUT_CSS = `
  .note { padding: 12px 16px 4px; font-size: 13px; line-height: 1.5; color: var(--fg); }
  .note p { margin: 0 0 8px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 16px 16px; }
  .actions a, .actions button { font: inherit; font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 8px;
    border: 1px solid #C77A00; color: #C77A00; background: none; text-decoration: none; cursor: pointer; }
  .actions .solid { background: #C77A00; border-color: #C77A00; color: #fff; }
  .dlg.dark .actions a, .dlg.dark .actions button { border-color: #F0C15C; color: #F0C15C; }
  .dlg.dark .actions .solid { background: #F0C15C; border-color: #F0C15C; color: #1e222b; }
`;

// Opened by a click on the amber badge: the same three actions the popup
// notice offers. Dismiss only closes the dialog; the badge stays amber.
export function openLayoutNotice(): void {
  const brk = layoutBreak;
  if (!brk) return;
  document.getElementById(LAYOUT_DLG_ID)?.remove();
  let version = 'unknown';
  try { version = browser.runtime.getManifest().version; } catch {}
  const report = buildReport({
    hooks: brk.hooks, unifiVersion: brk.unifiVersion, shell: brk.shell, profile: brk.profile, console: brk.console, path: brk.path,
    browser: detectBrowser(navigator.userAgent), ubiconVersion: version,
  });

  const host = document.createElement('div');
  host.id = LAYOUT_DLG_ID;
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS + LAYOUT_CSS;
  const overlay = el('div', { class: 'overlay' });
  const dlg = el('div', { class: 'dlg' + (isDark() ? ' dark' : ''), role: 'dialog', 'aria-label': "UniFi's layout changed" });
  const closeBtn = el('button', { 'data-x': '', 'aria-label': 'Close' }, '✕');
  const dismiss = el('button', { 'data-action': 'dismiss' }, 'Dismiss');
  dlg.append(
    el('header', {}, el('span', {}, "Ubicon: UniFi's layout changed"), closeBtn),
    el('div', { class: 'note' },
      el('p', {}, "UniFi's page no longer matches what Ubicon looks for, so icons may be missing until an update."),
      el('p', {}, 'Reporting it takes one click. The report names the page parts that changed and your browser, nothing about your devices or network.')),
    el('div', { class: 'actions' },
      el('a', { class: 'solid', 'data-action': 'github', href: report.issueUrl, target: '_blank', rel: 'noopener' }, 'Report on GitHub'),
      el('a', { 'data-action': 'email', href: report.mailtoUrl }, 'Email us this'),
      dismiss));
  const close = () => host.remove();
  overlay.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  dismiss.addEventListener('click', close);
  dlg.addEventListener('keydown', e => { e.stopPropagation(); if ((e as KeyboardEvent).key === 'Escape') close(); });
  shadow.append(style, overlay, dlg);
  document.body.append(host);
}

export function openAssignPanel(mac: string): void {
  document.getElementById(DLG_HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = DLG_HOST_ID;
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const dlg = document.createElement('div');
  dlg.className = 'dlg' + (isDark() ? ' dark' : '');
  const closeBtn = el('button', { 'data-x': '', 'aria-label': 'Close' }, '✕');
  const body = el('div', { class: 'body' });
  dlg.append(
    el('header', {}, el('span', {}, 'Ubicon: assign icon'), closeBtn),
    el('div', { class: 'tabs' },
      el('button', { 'data-tab': 'db', class: 'on' }, 'Community database'),
      el('button', { 'data-tab': 'custom' }, 'Custom icon')),
    body);
  const close = () => host.remove();
  overlay.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  dlg.addEventListener('keydown', e => { e.stopPropagation(); if ((e as KeyboardEvent).key === 'Escape') close(); });

  const toast = (text: string) => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    shadow.append(t);
    setTimeout(() => t.remove(), 5000);
  };

  const finish = async (reply: UbiconReply, verb: string) => {
    if (!reply.ok) { toast(`Ubicon: ${reply.error}`); return; }
    // Removal is undoing an assignment, not learning to make one, so the
    // "set the device's name" tip doesn't apply and shouldn't fire (or
    // consume the one-time tipShown flag) on that path.
    if (verb !== 'removed') {
      const flags = await browser.storage.local.get('tipShown');
      if (!flags.tipShown) {
        showTip(`Icon ${verb}. Tip: set the device's name in UniFi's own Settings tab; Ubicon never changes UniFi settings.`);
      }
    }
    close();
    const modal = [...document.querySelectorAll(getSelectors().modalDialog)]
      .find(d => d.querySelector(getSelectors().iconImage));
    modal?.querySelector(getSelectors().modalClose)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  };

  const renderDbTab = async () => {
    const msg = (text: string) => el('div', { class: 'msg' }, text);
    const groupHdr = (text: string) => el('div', { class: 'grouphdr' }, text);
    const input = el('input', { type: 'search', placeholder: 'Search devices…' });
    const removeRow = el('div', { class: 'remove', hidden: '' }, 'Remove Ubicon icon from this device');
    const list = el('div', { class: 'list' }, msg('Loading database…'));
    body.replaceChildren(input, removeRow, list);
    const { getAssignment } = await import('../shared/storage');
    if (await getAssignment(mac)) {
      removeRow.hidden = false;
      removeRow.addEventListener('click', async () => finish(await send({ type: 'unassign', mac }), 'removed'));
    }
    const catLabel = (c: string) => {
      const fixed: Record<string, string> = { '3d_printer': '3D Printer', iot_hub: 'IoT Hub', tv: 'TV' };
      return fixed[c] ?? c.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
    };
    const addItem = (d: DeviceRecord) => {
      const meta = d.type === 'generic' ? `Generic ${catLabel(d.category)}` : [d.vendor, d.model].filter(Boolean).join(' · ');
      const item = el('div', { class: 'item' },
        el('img', { loading: 'lazy', alt: '', src: `https://cdn.jsdelivr.net/gh/tvirelli/Ubicon-DB@main/${d.icon}` }),
        el('div', {}, el('div', { class: 'n' }, d.name), el('div', { class: 'm' }, meta)));
      item.addEventListener('click', async () => finish(await send({ type: 'assign-db', mac, deviceId: d.id }), 'assigned'));
      list.append(item);
    };
    const render = async (query: string) => {
      const reply = await send({ type: 'search', query });
      if (!reply.ok) { list.replaceChildren(msg('Database unavailable, check your connection and try Refresh in the Ubicon popup.')); return; }
      const results = (reply as { results?: DeviceRecord[] }).results ?? [];
      const real = results.filter(d => d.type !== 'generic');
      const generic = results.filter(d => d.type === 'generic');
      list.replaceChildren(...(results.length ? [] : [msg('No matches. Add it to the community database, see the Ubicon popup for a link.')]));
      // Branded devices are the primary results; generic device types follow
      // under their own heading as a fallback when there is no exact match.
      if (real.length) {
        if (generic.length) list.append(groupHdr('Devices'));
        real.forEach(addItem);
      }
      if (generic.length) {
        list.append(groupHdr('Generic device types'));
        generic.forEach(addItem);
      }
    };
    let deb: number | undefined;
    input.addEventListener('input', () => { clearTimeout(deb); deb = window.setTimeout(() => render(input.value), 150); });
    render('');
  };

  const renderCustomTab = () => {
    const file = el('input', { type: 'file', accept: 'image/*' });
    const preview = el('img', { class: 'preview', hidden: '', alt: 'Preview' });
    const label = el('input', { type: 'text', placeholder: 'Label (e.g. Garage sensor)', maxlength: '40' });
    const save = el('button', { class: 'save', disabled: '' }, 'Save custom icon');
    body.replaceChildren(el('div', { class: 'custom' }, file, preview, label, save,
      el('div', { class: 'msg' }, 'Stays on this computer only, never uploaded anywhere. Use Export in the Ubicon popup to move it to another machine.')));
    let dataUri = '';
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const scale = Math.min(128 / img.width, 128 / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
        dataUri = canvas.toDataURL('image/png');
        preview.src = dataUri;
        preview.hidden = false;
        save.disabled = false;
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => {
        toast('Could not read that image file.');
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(f);
    });
    save.addEventListener('click', async () =>
      finish(await send({ type: 'assign-custom', mac, dataUri, label: label.value.trim() || 'Custom icon' }), 'saved'));
  };

  dlg.querySelectorAll<HTMLButtonElement>('.tabs button').forEach(b =>
    b.addEventListener('click', () => {
      dlg.querySelectorAll('.tabs button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      b.dataset.tab === 'db' ? renderDbTab() : renderCustomTab();
    }));

  shadow.append(style, overlay, dlg);
  document.body.append(host);
  renderDbTab();
}
