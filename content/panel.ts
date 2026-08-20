import { browser } from 'wxt/browser';
import type { UbiconMsg, UbiconReply } from '../shared/messages';
import type { DeviceRecord } from '../shared/types';
import { currentPanelMac } from './state';

const send = (msg: UbiconMsg) => browser.runtime.sendMessage(msg) as Promise<UbiconReply>;
const isDark = () => !!document.querySelector('[class*="-dark__"]');

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

const MODAL_BTN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="18" height="18"><path d="M23 30 V86 A19 19 0 0 0 42 105 H86 A19 19 0 0 0 105 86 V52" fill="none" stroke="#5B3FD1" stroke-width="14" stroke-linecap="round"></path><rect x="98" y="23" width="14" height="14" rx="4" fill="#5B3FD1"></rect><rect x="44" y="44" width="40" height="40" rx="10" fill="#5B3FD1"></rect></svg>`;

const MODAL_BTN_CSS = `
  :host { all: initial; }
  svg { display:block; }
`;

export function ensureModalButton(root: ParentNode): void {
  for (const dialog of root.querySelectorAll('[role="dialog"][class*="modal__"]')) {
    if (!dialog.querySelector('img[src*="fingerprint"]')) continue;
    const header = dialog.querySelector(':scope > [class*="header__"]');
    const title = header?.querySelector('[class*="title__"]');
    if (!title || title.querySelector(`#${MODAL_BTN_HOST_ID}`)) continue;
    const host = document.createElement('span');
    host.id = MODAL_BTN_HOST_ID;
    host.title = 'Ubicon: community device icons';
    host.style.cssText = 'display:inline-flex;align-items:center;align-self:flex-start;height:20px;margin-left:12px;cursor:pointer;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = MODAL_BTN_CSS;
    const holder = document.createElement('span');
    holder.innerHTML = MODAL_BTN_SVG;
    shadow.append(style, holder.firstElementChild!);
    host.addEventListener('click', () => {
      const mac = currentPanelMac(document);
      if (mac) openAssignPanel(mac);
    });
    title.append(host);
  }
}

const HEADER_BADGE_ID = 'ubicon-header-badge';
const HEADER_BADGE_SVG = MODAL_BTN_SVG.replace('width="18" height="18"', 'width="16" height="16"');

const HEADER_BADGE_CSS = `
  :host { all: initial; }
  svg { display:block; }
`;

export function ensureHeaderBadge(root: ParentNode): void {
  if (document.getElementById(HEADER_BADGE_ID)) return;
  const svg = [...root.querySelectorAll('header svg[class*="Logo-module_logo__"]')].find(s => !s.closest('a'));
  if (!svg) return;
  const host = document.createElement('span');
  host.id = HEADER_BADGE_ID;
  host.title = 'Ubicon is active';
  host.style.cssText = 'display:inline-flex;align-items:center;height:50px;vertical-align:top;margin-left:-8px;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = HEADER_BADGE_CSS;
  const holder = document.createElement('span');
  holder.innerHTML = HEADER_BADGE_SVG;
  shadow.append(style, holder.firstElementChild!);
  svg.insertAdjacentElement('afterend', host);
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
  dlg.innerHTML = `
    <header><span>Ubicon: assign icon</span><button data-x aria-label="Close">✕</button></header>
    <div class="tabs">
      <button data-tab="db" class="on">Community database</button>
      <button data-tab="custom">Custom icon</button>
    </div>
    <div class="body"></div>`;
  const body = dlg.querySelector('.body') as HTMLElement;
  const close = () => host.remove();
  overlay.addEventListener('click', close);
  dlg.querySelector('[data-x]')!.addEventListener('click', close);
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
    const modal = [...document.querySelectorAll('[role="dialog"][class*="modal__"]')]
      .find(d => d.querySelector('img[src*="fingerprint"]'));
    modal?.querySelector('[class*="closeButton__"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  };

  const renderDbTab = async () => {
    body.innerHTML = `<input type="search" placeholder="Search devices…">
      <div class="remove" hidden>Remove Ubicon icon from this device</div>
      <div class="list"><div class="msg">Loading database…</div></div>`;
    const input = body.querySelector('input')!;
    const removeRow = body.querySelector('.remove') as HTMLElement;
    const list = body.querySelector('.list') as HTMLElement;
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
      const item = document.createElement('div');
      item.className = 'item';
      item.innerHTML = `<img loading="lazy" alt=""><div><div class="n"></div><div class="m"></div></div>`;
      (item.querySelector('img') as HTMLImageElement).src =
        `https://cdn.jsdelivr.net/gh/tvirelli/Ubicon-DB@main/${d.icon}`;
      item.querySelector('.n')!.textContent = d.name;
      item.querySelector('.m')!.textContent =
        d.type === 'generic' ? `Generic ${catLabel(d.category)}` : [d.vendor, d.model].filter(Boolean).join(' · ');
      item.addEventListener('click', async () => finish(await send({ type: 'assign-db', mac, deviceId: d.id }), 'assigned'));
      list.append(item);
    };
    const render = async (query: string) => {
      const reply = await send({ type: 'search', query });
      if (!reply.ok) { list.innerHTML = `<div class="msg">Database unavailable, check your connection and try Refresh in the Ubicon popup.</div>`; return; }
      const results = (reply as { results?: DeviceRecord[] }).results ?? [];
      const real = results.filter(d => d.type !== 'generic');
      const generic = results.filter(d => d.type === 'generic');
      list.innerHTML = results.length ? '' : '<div class="msg">No matches. Add it to the community database, see the Ubicon popup for a link.</div>';
      // Branded devices are the primary results; generic device types follow
      // under their own heading as a fallback when there is no exact match.
      if (real.length) {
        if (generic.length) list.insertAdjacentHTML('beforeend', '<div class="grouphdr">Devices</div>');
        real.forEach(addItem);
      }
      if (generic.length) {
        list.insertAdjacentHTML('beforeend', '<div class="grouphdr">Generic device types</div>');
        generic.forEach(addItem);
      }
    };
    let deb: number | undefined;
    input.addEventListener('input', () => { clearTimeout(deb); deb = window.setTimeout(() => render(input.value), 150); });
    render('');
  };

  const renderCustomTab = () => {
    body.innerHTML = `<div class="custom">
      <input type="file" accept="image/*">
      <img class="preview" hidden alt="Preview">
      <input type="text" placeholder="Label (e.g. Garage sensor)" maxlength="40">
      <button class="save" disabled>Save custom icon</button>
      <div class="msg">Stays on this computer only, never uploaded anywhere. Use Export in the Ubicon popup to move it to another machine.</div>
    </div>`;
    const file = body.querySelector('input[type=file]') as HTMLInputElement;
    const preview = body.querySelector('.preview') as HTMLImageElement;
    const label = body.querySelector('input[type=text]') as HTMLInputElement;
    const save = body.querySelector('.save') as HTMLButtonElement;
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
