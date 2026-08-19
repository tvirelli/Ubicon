import { browser } from 'wxt/browser';
import type { AssignmentRef, DbIndex, ExportFile } from './types';

const A = (mac: string) => `a:${mac}`;
type SyncVal = { d: string } | { c: string; l: string };

const encode = (ref: AssignmentRef): SyncVal =>
  ref.kind === 'db' ? { d: ref.deviceId } : { c: ref.customId, l: ref.label };
const decode = (v: SyncVal): AssignmentRef =>
  'd' in v ? { kind: 'db', deviceId: v.d } : { kind: 'custom', customId: v.c, label: v.l };

export async function getAssignment(mac: string): Promise<AssignmentRef | null> {
  const r = await browser.storage.sync.get(A(mac));
  return r[A(mac)] ? decode(r[A(mac)] as SyncVal) : null;
}

export async function getAllAssignments(): Promise<Record<string, AssignmentRef>> {
  const all = await browser.storage.sync.get(null);
  const out: Record<string, AssignmentRef> = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('a:')) out[k.slice(2)] = decode(v as SyncVal);
  }
  return out;
}

export const setAssignment = (mac: string, ref: AssignmentRef) =>
  browser.storage.sync.set({ [A(mac)]: encode(ref) });

export async function removeAssignment(mac: string): Promise<void> {
  // A custom icon's blob has no other owner and can't be re-derived (unlike
  // a db icon, which just gets re-downloaded next hydrate); read the
  // assignment before removing it so its blob can be pruned too, rather than
  // leaking forever in storage.local under a mac no assignment points to
  // anymore.
  const ref = await getAssignment(mac);
  await browser.storage.sync.remove(A(mac));
  if (ref?.kind === 'custom') {
    await browser.storage.local.remove(`icon:${iconKey(ref)}`);
  }
}

export const iconKey = (ref: AssignmentRef) =>
  ref.kind === 'db' ? `db:${ref.deviceId}` : `custom:${ref.customId}`;

export async function getCachedIcon(key: string): Promise<string | null> {
  const k = `icon:${key}`;
  const r = await browser.storage.local.get(k);
  return (r[k] as string) ?? null;
}
export const cacheIcon = (key: string, dataUri: string) =>
  browser.storage.local.set({ [`icon:${key}`]: dataUri });

export async function getIndexCache() {
  const r = await browser.storage.local.get('index');
  return (r['index'] as { fetchedAt: number; index: DbIndex }) ?? null;
}
export const setIndexCache = (index: DbIndex) =>
  browser.storage.local.set({ index: { fetchedAt: Date.now(), index } });

export async function exportAll(): Promise<ExportFile> {
  const assignments = await getAllAssignments();
  const local = await browser.storage.local.get(null);
  const customIcons: Record<string, string> = {};
  for (const [k, v] of Object.entries(local)) {
    if (k.startsWith('icon:custom:')) customIcons[k.slice('icon:custom:'.length)] = v as string;
  }
  return { format: 'ubicon-backup', version: 1, exportedAt: new Date().toISOString(), assignments, customIcons };
}

// Matches content/state.ts's MAC_EXACT_RE, kept as a separate constant here
// rather than imported, since shared/storage.ts must not depend on the
// content script (content/state.ts already imports from here).
const MAC_SHAPE_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

function isValidAssignmentRef(v: unknown): v is AssignmentRef {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (r['kind'] === 'db') return typeof r['deviceId'] === 'string';
  if (r['kind'] === 'custom') return typeof r['customId'] === 'string' && typeof r['label'] === 'string';
  return false;
}

export async function importAll(file: ExportFile) {
  if (file?.format !== 'ubicon-backup' || file.version !== 1) throw new Error('Not an Ubicon backup file');
  let assignments = 0, customIcons = 0;
  // Untrusted input (a user-supplied JSON file): skip anything that
  // doesn't match the expected shape rather than importing garbage or
  // throwing away the whole file over one bad entry.
  for (const [mac, ref] of Object.entries(file.assignments ?? {})) {
    if (!MAC_SHAPE_RE.test(mac) || !isValidAssignmentRef(ref)) continue;
    await setAssignment(mac, ref);
    assignments++;
  }
  for (const [id, dataUri] of Object.entries(file.customIcons ?? {})) {
    if (typeof dataUri !== 'string' || !dataUri.startsWith('data:image/')) continue;
    await cacheIcon(`custom:${id}`, dataUri);
    customIcons++;
  }
  return { assignments, customIcons };
}
