import { installConsoleRules, markConsoleActive } from '../shared/console-icon';
import { browser } from 'wxt/browser';
import type { UbiconMsg, UbiconReply } from '../shared/messages';
import { fetchIndex, iconUrlFor, searchDevices } from '../shared/db';
import {
  cacheIcon, getAllAssignments, getCachedIcon, iconKey, importAll,
  removeAssignment, setAssignment,
} from '../shared/storage';
import { registrationsForOrigin } from '../shared/registrations';
import { addConsoleOrigin } from '../shared/consoles';
import { serialized } from '../shared/write-queue';
import {
  SetupError, connect, disconnect, getCredentials, getStatus, isViewOnly, markDirty, replaceToken, syncOnce,
} from '../shared/sync/engine';
import { dismissHint, readHint, shouldShowHint } from '../shared/sync/hint';
import { encodeSetupCode } from '../shared/sync/setup-code';
import { getSyncMode } from '../shared/storage';

async function blobToDataUri(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}

async function downloadDbIcon(deviceId: string): Promise<string> {
  const index = await fetchIndex();
  const rec = index.devices.find(d => d.id === deviceId);
  if (!rec) throw new Error(`Unknown device id: ${deviceId}`);
  const res = await fetch(iconUrlFor(rec));
  if (!res.ok) throw new Error(`Icon download failed: HTTP ${res.status}`);
  const dataUri = await blobToDataUri(await res.blob());
  await cacheIcon(`db:${deviceId}`, dataUri);
  return dataUri;
}

const CHANGES_ASSIGNMENTS = new Set<UbiconMsg['type']>(['assign-db', 'assign-custom', 'unassign', 'import']);

export async function handleMessage(msg: UbiconMsg): Promise<UbiconReply> {
  if (msg.type === 'console-active') return { ok: true };
  try {
    // One check here covers every page that can send a change (the UniFi
    // page's picker, the popup, Options); the pages also disable their
    // controls, but this is the one that cannot be bypassed.
    if (CHANGES_ASSIGNMENTS.has(msg.type) && (await isViewOnly())) {
      return { ok: false, error: 'This browser is connected with a view-only token.', reason: 'view-only' };
    }
    switch (msg.type) {
      case 'assign-db': {
        // The download stays outside the queue: it can take seconds, and it
        // touches only the icon cache, never the assignment set.
        const dataUri = (await getCachedIcon(`db:${msg.deviceId}`)) ?? (await downloadDbIcon(msg.deviceId));
        await serialized(() => setAssignment(msg.mac, { kind: 'db', deviceId: msg.deviceId }));
        return { ok: true, dataUri };
      }
      case 'assign-custom': {
        const customId = crypto.randomUUID();
        await cacheIcon(`custom:${customId}`, msg.dataUri);
        await serialized(() => setAssignment(msg.mac, { kind: 'custom', customId, label: msg.label }));
        return { ok: true, dataUri: msg.dataUri };
      }
      case 'unassign':
        await serialized(() => removeAssignment(msg.mac));
        return { ok: true };
      case 'import': {
        const counts = await serialized(() => importAll(msg.file as Parameters<typeof importAll>[0]));
        return { ok: true, counts };
      }
      case 'search': {
        const index = await fetchIndex();
        return { ok: true, results: searchDevices(index.devices, msg.query) };
      }
      case 'refresh-index': {
        const index = await fetchIndex(true);
        return { ok: true, count: index.count };
      }
      case 'sync-connect': {
        const connected = await connect({ token: msg.token, repo: msg.repo, readOnly: msg.readOnly });
        await scheduleSync(true);
        return { ok: true, connected };
      }
      case 'sync-replace-token':
        await replaceToken(msg.token);
        return { ok: true, status: await getStatus() };
      case 'sync-disconnect': {
        const mode = await disconnect({ removeHint: msg.removeHint });
        await scheduleSync(false);
        return { ok: true, mode };
      }
      case 'sync-now':
        await markDirty(); // a full read, not a conditional one: "now" should mean now
        await syncOnce();
        return { ok: true, status: await getStatus() };
      case 'sync-status':
        return { ok: true, status: await getStatus(), hint: (await shouldShowHint()) ? await readHint() : null };
      case 'sync-setup-code': {
        const c = await getCredentials();
        if (!c) return { ok: false, error: 'Not connected' };
        return { ok: true, setupCode: encodeSetupCode(c) };
      }
      case 'sync-dismiss-hint':
        await dismissHint();
        return { ok: true };
    }
  } catch (e) {
    if (e instanceof SetupError) return { ok: false, error: e.reason, reason: e.reason, others: e.others };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const SYNC_ALARM = 'ubicon-sync';
const SYNC_EVERY_MINUTES = 5;
const PUSH_DEBOUNCE_MS = 10_000;

// The alarm exists only while this browser is connected, so an unconnected
// browser makes no GitHub traffic at all.
export async function scheduleSync(on: boolean): Promise<void> {
  if (on) browser.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_EVERY_MINUTES });
  else await browser.alarms.clear(SYNC_ALARM);
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
// A local change is marked first and pushed a few seconds later, so a burst
// of assignments becomes one commit. The mark is what counts: an MV3 worker
// can be shut down before the timer fires, and the alarm then finishes the
// job. The engine's own writes land here too; they merge to nothing new and
// produce no commit.
export async function onAssignmentsChanged(): Promise<void> {
  if ((await getSyncMode()) !== 'github') return;
  await markDirty();
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { syncOnce().catch(() => {}); }, PUSH_DEBOUNCE_MS);
}

export async function hydrateMissingIcons(): Promise<number> {
  const assignments = await getAllAssignments();
  let downloaded = 0;
  for (const ref of Object.values(assignments)) {
    if (ref.kind !== 'db') continue; // custom icons cannot be re-derived
    if (await getCachedIcon(iconKey(ref))) continue;
    try { await downloadDbIcon(ref.deviceId); downloaded++; } catch { /* degrade quietly; retried next hydrate */ }
  }
  return downloaded;
}

// Chrome clears all scripting.registerContentScripts registrations on
// extension reload/update, but the user's storage.local 'origins' list
// (local UniFi controllers they've granted access to) persists across that.
// Without this, every reload/update silently strands those origins with no
// content script until the user manually re-adds them in Options.
// unifi.ui.com itself is unaffected, since it's manifest-declared, not dynamic.
//
// Each origin needs two script ids (the isolated-world painter and the
// MAIN-world bridge, see shared/registrations.ts), and they're checked
// independently: an origin can end up with only one of the two surviving
// (e.g. an older build only ever registered the painter), so the other must
// still get backfilled rather than the whole origin being skipped.
export async function ensureRegisteredOrigins(): Promise<number> {
  const { origins = [] } = (await browser.storage.local.get('origins')) as { origins?: string[] };
  const existing = await browser.scripting.getRegisteredContentScripts();
  const ids = new Set(existing.map(s => s.id));
  let registered = 0;
  for (const origin of origins) {
    try {
      // registrationsForOrigin parses `origin` with `new URL(...)`: a
      // malformed stored origin throws synchronously, and that must not
      // abort the backfill loop for every other (valid) origin, so the call
      // lives inside this try alongside the registration call it feeds.
      const missing = registrationsForOrigin(origin).filter(script => !ids.has(script.id));
      if (missing.length === 0) continue;
      await browser.scripting.registerContentScripts(missing);
      registered++;
    } catch { /* e.g. malformed origin, or host permission was revoked; skip, keep going */ }
  }
  return registered;
}

const ADD_CONSOLE_MENU_ID = 'ubicon-add-console';

// Best-effort UX: briefly flashes the toolbar badge to confirm what
// happened, then clears it. Never worth failing the click over: every
// browser call here is wrapped/chained so neither a synchronous throw nor
// an async rejection (e.g. the tab closed before the timeout fires) can
// produce an unhandled rejection.
function flashBadge(text: string): void {
  try {
    browser.action.setBadgeText({ text }).catch(() => {});
  } catch { /* action API unavailable, degrade silently */ }
  setTimeout(() => {
    try {
      browser.action.setBadgeText({ text: '' }).catch(() => {});
    } catch { /* tab/action may be gone by then */ }
  }, 3000);
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: UbiconMsg, sender, sendResponse) => {
    if (msg.type === 'console-active') {
      // sender.tab is set for messages from content scripts.
      if (sender.tab?.id != null) markConsoleActive(sender.tab.id).catch(() => {});
      sendResponse({ ok: true });
      return false;
    }
    handleMessage(msg).then(sendResponse);
    return true; // async response
  });
  // The rules survive restarts, but re-installing on startup keeps them in
  // step with the code after an update.
  installConsoleRules().catch(() => {});
  browser.alarms.create('ubicon-refresh', { periodInMinutes: 720 });
  browser.alarms.onAlarm.addListener(a => {
    if (a.name === 'ubicon-refresh') fetchIndex(true).catch(() => {});
    if (a.name === SYNC_ALARM) syncOnce().catch(() => {});
  });
  browser.storage.onChanged.addListener((changes, area) => {
    // Assignments live in storage.sync in browser mode and under the single
    // 'assignments' key of storage.local otherwise (see shared/storage.ts).
    // Anything else in storage.local (icon blobs, the index, names) must not
    // trigger a hydrate, or caching an icon would loop back into this.
    if (area === 'sync' || (area === 'local' && 'assignments' in changes)) hydrateMissingIcons().catch(() => {});
    if (area === 'local' && ('assignments' in changes || 'tombstones' in changes)) onAssignmentsChanged().catch(() => {});
  });
  browser.runtime.onInstalled.addListener(() => {
    ensureRegisteredOrigins().catch(() => {});
    installConsoleRules().catch(() => {});
    try {
      // 'action' is the correct context on both Chrome and Firefox MV3.
      // Note: contextMenus.create returns the new menu id synchronously on
      // Chrome (not a Promise): the try/catch alone covers a synchronous
      // throw, e.g. re-creating an id that already exists on an update.
      browser.contextMenus.create({ id: ADD_CONSOLE_MENU_ID, title: 'Add Current Console', contexts: ['action'] });
    } catch { /* e.g. re-created on an update, ignore */ }
  });
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== ADD_CONSOLE_MENU_ID) return;
    // Called synchronously (no await before it) so addConsoleOrigin's own
    // permissions.request still runs within this click's user-gesture
    // context: see the comment there for the one await that's allowed
    // to precede it.
    addConsoleOrigin(tab?.url).then(result => {
      if (result === 'added' && tab?.id != null) browser.tabs.reload(tab.id).catch(() => {});
      // Nothing worth flashing for 'invalid'/'already': only the two
      // outcomes the user couldn't have predicted from the menu alone.
      if (result === 'added') flashBadge('✓');
      else if (result === 'denied') flashBadge('!');
    }).catch(() => {});
  });
  hydrateMissingIcons().catch(() => {});
  ensureRegisteredOrigins().catch(() => {});
  // Pull on startup; re-create the alarm, which Chrome drops on an extension
  // update just as it drops dynamic content scripts.
  getSyncMode().then(mode => {
    if (mode !== 'github') return;
    scheduleSync(true).catch(() => {});
    syncOnce().catch(() => {});
  }).catch(() => {});
});
