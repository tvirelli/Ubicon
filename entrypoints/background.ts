import { browser } from 'wxt/browser';
import type { UbiconMsg, UbiconReply } from '../shared/messages';
import { fetchIndex, iconUrlFor, searchDevices } from '../shared/db';
import {
  cacheIcon, getAllAssignments, getCachedIcon, iconKey,
  removeAssignment, setAssignment,
} from '../shared/storage';

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
export async function ensureRegisteredOrigins(): Promise<number> {
  const { origins = [] } = (await browser.storage.local.get('origins')) as { origins?: string[] };
  const existing = await browser.scripting.getRegisteredContentScripts();
  const ids = new Set(existing.map(s => s.id));
  let registered = 0;
  for (const origin of origins) {
    const id = 'ubicon-' + new URL(origin).hostname;
    if (ids.has(id)) continue;
    try {
      await browser.scripting.registerContentScripts([{
        id,
        matches: [origin + '/*'],
        js: ['content-scripts/content.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      }]);
      registered++;
    } catch { /* e.g. host permission was revoked — skip this origin, keep going */ }
  }
  return registered;
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
  browser.runtime.onInstalled.addListener(() => { ensureRegisteredOrigins().catch(() => {}); });
  hydrateMissingIcons().catch(() => {});
  ensureRegisteredOrigins().catch(() => {});
});
