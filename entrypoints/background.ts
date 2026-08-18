import { browser } from 'wxt/browser';
import type { UbiconMsg, UbiconReply } from '../shared/messages';
import { fetchIndex, iconUrlFor, searchDevices } from '../shared/db';
import {
  cacheIcon, getAllAssignments, getCachedIcon, iconKey,
  removeAssignment, setAssignment,
} from '../shared/storage';
import { registrationsForOrigin } from '../shared/registrations';

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

export async function handleMessage(msg: UbiconMsg): Promise<UbiconReply> {
  try {
    switch (msg.type) {
      case 'assign-db': {
        const dataUri = (await getCachedIcon(`db:${msg.deviceId}`)) ?? (await downloadDbIcon(msg.deviceId));
        await setAssignment(msg.mac, { kind: 'db', deviceId: msg.deviceId });
        return { ok: true, dataUri };
      }
      case 'assign-custom': {
        const customId = crypto.randomUUID();
        await cacheIcon(`custom:${customId}`, msg.dataUri);
        await setAssignment(msg.mac, { kind: 'custom', customId, label: msg.label });
        return { ok: true, dataUri: msg.dataUri };
      }
      case 'unassign':
        await removeAssignment(msg.mac);
        return { ok: true };
      case 'search': {
        const index = await fetchIndex();
        return { ok: true, results: searchDevices(index.devices, msg.query) };
      }
      case 'refresh-index': {
        const index = await fetchIndex(true);
        return { ok: true, count: index.count };
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
// unifi.ui.com itself is unaffected — it's manifest-declared, not dynamic.
//
// Each origin needs two script ids (the isolated-world painter and the
// MAIN-world bridge — see shared/registrations.ts), and they're checked
// independently: an origin can end up with only one of the two surviving
// (e.g. an older build only ever registered the painter), so the other must
// still get backfilled rather than the whole origin being skipped.
export async function ensureRegisteredOrigins(): Promise<number> {
  const { origins = [] } = (await browser.storage.local.get('origins')) as { origins?: string[] };
  const existing = await browser.scripting.getRegisteredContentScripts();
  const ids = new Set(existing.map(s => s.id));
  let registered = 0;
  for (const origin of origins) {
    const missing = registrationsForOrigin(origin).filter(script => !ids.has(script.id));
    if (missing.length === 0) continue;
    try {
      await browser.scripting.registerContentScripts(missing);
      registered++;
    } catch { /* e.g. host permission was revoked — skip this origin, keep going */ }
  }
  return registered;
}

const ADD_CONSOLE_MENU_ID = 'ubicon-add-console';

export type AddConsoleResult = 'added' | 'already' | 'invalid' | 'denied';

// Same effect as adding an origin in Options, but from the toolbar icon's
// context menu — the current tab's origin, one click. Kept as a standalone
// exported function (rather than inline in the menu-click listener) so it's
// unit-testable without needing to invoke defineBackground's main().
export async function addConsoleOrigin(url: string | undefined): Promise<AddConsoleResult> {
  let parsed: URL;
  try {
    parsed = new URL(url ?? '');
  } catch {
    return 'invalid';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'invalid';
  const origin = parsed.origin;

  // unifi.ui.com is manifest-declared already; nothing to add for it.
  if (origin === 'https://unifi.ui.com') return 'already';

  const { origins = [] } = (await browser.storage.local.get('origins')) as { origins?: string[] };
  if (origins.includes(origin)) return 'already';

  // Valid only when called synchronously from a user gesture (the menu
  // click) — see the onClicked listener below.
  const granted = await browser.permissions.request({ origins: [origin + '/*'] });
  if (!granted) return 'denied';

  // Reuses the same shared registration shape as ensureRegisteredOrigins
  // and Options' add-origin flow, so all three stay in lockstep.
  await browser.scripting.registerContentScripts(registrationsForOrigin(origin)).catch(async err => {
    if (String(err).includes('Duplicate')) return; // already registered — fine
    throw err;
  });

  await browser.storage.local.set({ origins: [...origins, origin] });
  return 'added';
}

// Best-effort UX: briefly flashes the toolbar badge to confirm what
// happened, then clears it. Never worth failing the click over.
function flashBadge(text: string): void {
  try {
    browser.action.setBadgeText({ text });
    setTimeout(() => {
      try { browser.action.setBadgeText({ text: '' }); } catch { /* tab/action may be gone by then */ }
    }, 3000);
  } catch { /* action API unavailable — degrade silently */ }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: UbiconMsg, _sender, sendResponse) => {
    handleMessage(msg).then(sendResponse);
    return true; // async response
  });
  browser.alarms.create('ubicon-refresh', { periodInMinutes: 720 });
  browser.alarms.onAlarm.addListener(a => { if (a.name === 'ubicon-refresh') fetchIndex(true).catch(() => {}); });
  browser.storage.onChanged.addListener((_changes, area) => {
    if (area === 'sync') hydrateMissingIcons().catch(() => {});
  });
  browser.runtime.onInstalled.addListener(() => {
    ensureRegisteredOrigins().catch(() => {});
    try {
      // 'action' is the correct context on both Chrome and Firefox MV3.
      browser.contextMenus.create({ id: ADD_CONSOLE_MENU_ID, title: 'Add Current Console', contexts: ['action'] });
    } catch { /* e.g. re-created on an update — ignore */ }
  });
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== ADD_CONSOLE_MENU_ID) return;
    // Called synchronously (no await before it) so permissions.request
    // below still runs within this click's user-gesture context.
    addConsoleOrigin(tab?.url).then(result => {
      if (result === 'added' && tab?.id != null) browser.tabs.reload(tab.id);
      flashBadge(result === 'added' ? '✓' : result === 'denied' ? '!' : '');
    }).catch(() => {});
  });
  hydrateMissingIcons().catch(() => {});
  ensureRegisteredOrigins().catch(() => {});
});
