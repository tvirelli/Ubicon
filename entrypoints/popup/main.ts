import { browser } from 'wxt/browser';
import { exportAll, getAllAssignments, getCachedIcon, getIndexCache, iconKey } from '../../shared/storage';
import { addConsoleOrigin, listConsoleOrigins, removeConsoleOrigin } from '../../shared/consoles';
import type { UbiconMsg, UbiconReply } from '../../shared/messages';
import { VIEW_ONLY_TEXT } from '../../shared/sync/ui-text';
import { initPopupSync } from './sync';

const send = (msg: UbiconMsg) => browser.runtime.sendMessage(msg) as Promise<UbiconReply>;
const $ = (id: string) => document.getElementById(id)!;

// Set once sync-status answers. A view-only connection cannot save changes
// (GitHub refuses its writes), so the controls that make changes are locked
// here and the notice at the top of the popup says why.
let readOnly = false;

const EMPTY_TEXT = "No devices assigned yet. Open a client's Change Icon dialog (click its photo) and press the Ubicon mark next to the dialog title.";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Filename-safe slug for the icon download: lowercase, runs of
// non-alphanumeric characters collapsed to a single '-', trimmed.
const slugify = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'icon';

async function renderStatus() {
  const cache = await getIndexCache();
  $('db-status').textContent = cache
    ? `${cache.index.count} devices · updated ${new Date(cache.fetchedAt).toLocaleDateString()}`
    : 'database not loaded yet';
}

// Rendering awaits storage for every row, so two calls can overlap (the one
// at startup and the one that follows the sync status, for instance). Rows
// are collected first and put on the page in one go, and only the newest
// call gets to do that; otherwise both would append and every row would
// show twice.
let renderRun = 0;

async function renderList() {
  const run = ++renderRun;
  const list = $('list');
  const assignments = await getAllAssignments();
  const macs = Object.keys(assignments).sort();
  if (!macs.length) {
    if (run === renderRun) list.replaceChildren(el('p', 'empty', EMPTY_TEXT));
    return;
  }
  const rows: HTMLElement[] = [];
  for (const mac of macs) {
    const ref = assignments[mac];
    if (!ref) continue; // keys come straight from Object.keys(assignments) above, narrows for TS only
    const dataUri = await getCachedIcon(iconKey(ref));
    if (run !== renderRun) return;
    const row = el('div', 'row');
    const img = el('img');
    img.alt = '';
    img.src = dataUri ?? '/icon/32.png';
    const text = el('div');
    text.append(el('div', 'name', ref.kind === 'db' ? ref.deviceId : ref.label), el('div', 'mac', mac));
    const badge = el('span', 'badge', ref.kind === 'db' ? 'community' : dataUri ? 'custom' : 'custom · icon missing here');
    const removeBtn = el('button', undefined, '✕');
    removeBtn.title = readOnly ? VIEW_ONLY_TEXT : 'Remove';
    removeBtn.disabled = readOnly;
    row.append(img, text, badge, removeBtn);
    let confirmTimer: ReturnType<typeof setTimeout> | undefined;
    removeBtn.addEventListener('click', async () => {
      if (!removeBtn.classList.contains('confirm')) {
        // First click: arm a confirm state rather than removing right away;
        // custom icons in particular can't be re-downloaded once gone.
        removeBtn.textContent = 'Remove?';
        removeBtn.classList.add('confirm');
        removeBtn.title = 'Click again to remove';
        confirmTimer = setTimeout(() => {
          removeBtn.textContent = '✕';
          removeBtn.classList.remove('confirm');
          removeBtn.title = 'Remove';
        }, 4000);
        return;
      }
      clearTimeout(confirmTimer);
      // Through the background worker, not shared/storage.ts directly: every
      // change to assignments goes through its single write queue.
      await send({ type: 'unassign', mac });
      renderList();
    });
    if (ref.kind === 'custom') {
      // Community bridge (spec §5): opens Ubicon-DB's structured
      // device-suggestion issue form, prefilled with everything the
      // extension actually knows about this device: just its display
      // name. Vendor/model/category stay blank; a custom (non-database)
      // device has no such data to prefill from.
      const suggest = document.createElement('a');
      suggest.textContent = '↗';
      suggest.title = 'Suggest this device to the community database';
      suggest.target = '_blank';
      suggest.href = 'https://github.com/tvirelli/Ubicon-DB/issues/new?template=device-suggestion.yml&title=' +
        encodeURIComponent(`Device suggestion: ${ref.label}`) +
        '&device_name=' + encodeURIComponent(ref.label);
      row.append(suggest);

      if (dataUri) {
        // The issue form can't accept a file via URL prefill; the user
        // drags it into the form's attachment box themselves, so this just
        // gets the icon out of the extension and into a file for them.
        const download = document.createElement('a');
        download.textContent = '⬇';
        download.title = 'Download icon file for the suggestion';
        download.href = '#';
        download.addEventListener('click', e => {
          e.preventDefault();
          const a = document.createElement('a');
          a.href = dataUri;
          a.download = `${slugify(ref.label)}.png`;
          a.click();
        });
        row.append(download);
      }
    }
    rows.push(row);
  }
  list.replaceChildren(...rows);
}

async function renderConsoles() {
  const ul = $('consoles');
  ul.replaceChildren();
  for (const origin of await listConsoleOrigins()) {
    const li = document.createElement('li');
    li.className = 'console-row';
    const span = document.createElement('span');
    span.className = 'origin';
    span.textContent = origin;
    const rm = document.createElement('button');
    rm.textContent = '✕';
    rm.title = 'Remove';
    rm.addEventListener('click', async () => {
      await removeConsoleOrigin(origin);
      renderConsoles();
    });
    li.append(span, rm);
    ul.append(li);
  }
}

// Offers to add the active tab's console, if it looks like one worth
// adding: an http(s) origin, not the manifest-declared unifi.ui.com, and
// not already granted.
async function setupAddConsoleButton() {
  const btn = $('add-console') as HTMLButtonElement;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  let origin: string;
  try {
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    origin = url.origin;
  } catch {
    return;
  }
  if (origin === 'https://unifi.ui.com') return;
  if ((await listConsoleOrigins()).includes(origin)) return;

  btn.textContent = `Add this console (${origin})`;
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    // Called directly here (this click IS the user gesture); see
    // shared/consoles.ts's addConsoleOrigin for why that matters.
    let result: Awaited<ReturnType<typeof addConsoleOrigin>>;
    try {
      result = await addConsoleOrigin(tab.url);
    } catch (err) {
      // A rejected permissions.request (e.g. Firefox's user-input rule)
      // used to vanish here, leaving the button apparently dead.
      $('db-status').textContent = err instanceof Error ? err.message : 'could not add console';
      return;
    }
    if (result === 'added') {
      btn.hidden = true;
      renderConsoles();
      if (tab.id != null) browser.tabs.reload(tab.id).catch(() => {});
    } else if (result === 'denied') {
      $('db-status').textContent = 'permission declined';
    }
  });
}

$('refresh').addEventListener('click', async () => {
  $('db-status').textContent = 'refreshing…';
  const reply = await send({ type: 'refresh-index' });
  if (!reply.ok) {
    $('db-status').textContent = 'refresh failed: ' + reply.error;
    return;
  }
  renderStatus();
});

$('export').addEventListener('click', async () => {
  const file = await exportAll();
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ubicon-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  // Deferred: some browsers start the download asynchronously after click(),
  // and revoking the object URL synchronously can race that and produce an
  // empty/failed download.
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
});

$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    // Through the background worker's write queue, like every other change.
    const reply = await send({ type: 'import', file: JSON.parse(await f.text()) });
    if (!reply.ok) throw new Error(reply.error);
    const counts = reply.counts ?? { assignments: 0, customIcons: 0 };
    $('db-status').textContent = `imported ${counts.assignments} assignments, ${counts.customIcons} custom icons`;
    renderList();
  } catch (err) {
    $('db-status').textContent = err instanceof Error ? err.message : 'import failed';
  }
});

renderStatus();
renderList();
renderConsoles();
setupAddConsoleButton();
initPopupSync(status => {
  const locked = status.connected && status.readOnly;
  const importBtn = $('import') as HTMLButtonElement;
  importBtn.disabled = locked;
  importBtn.title = locked ? VIEW_ONLY_TEXT : '';
  if (locked === readOnly) return;
  readOnly = locked;
  renderList();
});
