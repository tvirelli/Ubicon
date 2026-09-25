import { browser } from 'wxt/browser';
import { exportAll, getAllAssignments, getIndexCache } from '../../shared/storage';
import { addConsoleOrigin, listConsoleOrigins, removeConsoleOrigin } from '../../shared/consoles';
import { classifyConsoleUrl, offerText } from '../../shared/console-detect';
import type { UbiconMsg, UbiconReply } from '../../shared/messages';
import { VIEW_ONLY_TEXT } from '../../shared/sync/ui-text';
import { initPopupSync } from './sync';
import { initLayoutNotice } from '../../shared/layout-notice';

const send = (msg: UbiconMsg) => browser.runtime.sendMessage(msg) as Promise<UbiconReply>;
const $ = (id: string) => document.getElementById(id)!;

const EMPTY_TEXT = "No devices assigned yet. Open a client's Change Icon dialog (click its photo) and press the Ubicon mark next to the dialog title.";

async function renderStatus() {
  const cache = await getIndexCache();
  $('db-status').textContent = cache
    ? `${cache.index.count} devices · updated ${new Date(cache.fetchedAt).toLocaleDateString()}`
    : 'database not loaded yet';
}

// The popup used to list every assigned device here. The list now lives on
// the settings page (Assignments tab), where it has room for search; the
// popup only says how many there are.
async function renderCount() {
  const n = Object.keys(await getAllAssignments()).length;
  const count = $('count');
  count.textContent = n === 0 ? EMPTY_TEXT : n === 1 ? '1 device assigned' : `${n} devices assigned`;
  count.classList.toggle('none', n === 0);
}

$('manage').addEventListener('click', () => {
  // Not openOptionsPage: that cannot carry the #assignments hash that
  // selects the tab. The settings page opens in a full tab anyway.
  void browser.tabs.create({ url: browser.runtime.getURL('/options.html#assignments') });
});

$('version').textContent = `v${browser.runtime.getManifest().version}`;

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

// The console offer: when the popup opens on a UniFi console Ubicon is not
// yet enabled on, one click grants that origin. shared/console-detect.ts
// decides what counts as a console, so ordinary websites never see this.
// This tab's address is readable here because the click on the toolbar icon
// grants activeTab for it.
const OFFER_DISMISSED_KEY = 'consoleOfferDismissed';

async function setupConsoleOffer() {
  const aside = $('console-offer');
  const text = $('console-offer-text');
  const onBtn = $('console-offer-on') as HTMLButtonElement;
  const laterBtn = $('console-offer-later') as HTMLButtonElement;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const guess = classifyConsoleUrl(tab?.url);
  if (guess.kind === 'no') return;
  if ((await listConsoleOrigins()).includes(guess.origin)) return;
  const dismissed = ((await browser.storage.local.get(OFFER_DISMISSED_KEY))[OFFER_DISMISSED_KEY] as string[] | undefined) ?? [];
  if (dismissed.includes(guess.origin)) return;

  text.textContent = offerText(guess);
  aside.hidden = false;

  onBtn.addEventListener('click', async () => {
    // addConsoleOrigin must be the first await on this click: its
    // permissions.request has to run inside the user gesture (Firefox).
    let result: Awaited<ReturnType<typeof addConsoleOrigin>>;
    try {
      result = await addConsoleOrigin(tab?.url);
    } catch (err) {
      text.textContent = err instanceof Error ? err.message : 'Could not turn on Ubicon here.';
      return;
    }
    if (result === 'added' || result === 'already') {
      onBtn.hidden = true;
      laterBtn.hidden = true;
      text.textContent = `Ubicon is on for ${guess.host}. The page is reloading.`;
      renderConsoles();
      if (tab?.id != null) browser.tabs.reload(tab.id).catch(() => {});
    } else if (result === 'denied') {
      text.textContent = `Permission declined. Ubicon stays off for ${guess.host}; open this popup again to try once more.`;
    } else {
      text.textContent = 'That address cannot be used as a console.';
    }
  });

  laterBtn.addEventListener('click', async () => {
    aside.hidden = true;
    await browser.storage.local.set({ [OFFER_DISMISSED_KEY]: [...dismissed, guess.origin] });
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
    renderCount();
  } catch (err) {
    $('db-status').textContent = err instanceof Error ? err.message : 'import failed';
  }
});

renderStatus();
renderCount();
renderConsoles();
setupConsoleOffer();
initPopupSync(status => {
  // A view-only connection cannot save changes (GitHub refuses its writes),
  // so Import is locked and the notice at the top of the popup says why.
  const locked = status.connected && status.readOnly;
  const importBtn = $('import') as HTMLButtonElement;
  importBtn.disabled = locked;
  importBtn.title = locked ? VIEW_ONLY_TEXT : '';
});

// A background sync (or another window) can change assignments while the
// popup is open; redraw the count once the burst settles.
// Assignments live in storage.sync in browser mode and under 'assignments'
// in storage.local otherwise (shared/storage.ts); icons cache as 'icon:*'.
let redrawTimer: ReturnType<typeof setTimeout> | undefined;
browser.storage.onChanged.addListener((changes, area) => {
  const relevant = area === 'sync'
    ? Object.keys(changes).some(k => k !== 'sync:hint')
    : Object.keys(changes).some(k => k === 'assignments' || k === 'tombstones' || k.startsWith('icon:'));
  if (!relevant) return;
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => { renderCount(); renderStatus(); }, 200);
});

// The layout-change notice, if the content script has stored one.
void initLayoutNotice({ aside: 'layout-warning', issue: 'layout-issue', mail: 'layout-mail', dismiss: 'layout-dismiss' });
