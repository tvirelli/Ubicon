import { browser } from 'wxt/browser';
import type { AssignmentRef, DbIndex, ExportFile, ExportFileV1, Manifest, StampedRef } from './types';
import { MAC_SHAPE_RE, isValidAssignmentRef, isValidStamp } from './validate';

// Where assignments live.
//   browser: storage.sync, one `a:<mac>` key each. The default, and exactly
//            what v0.1.1 did. Bounded by the browser's 512-item / 8 KB caps.
//   github:  storage.local, under the single keys below, synced to the user's
//            GitHub repo by shared/sync. No caps.
//   local:   same layout as github with no remote: a browser that was
//            disconnected holding more than storage.sync can take back.
export type SyncMode = 'browser' | 'github' | 'local';
const MODE_KEY = 'sync:mode';
// Single keys rather than one key per mac: storage.local also holds the icon
// blobs, so finding assignments with get(null) there would load every image.
const ASSIGNMENTS_KEY = 'assignments';
const TOMBSTONES_KEY = 'tombstones';

const A = (mac: string) => `a:${mac}`;
// `t` is the change time (ms). Entries written before v0.3.0 have none and
// read back as t = 0, so any timestamped change beats them in a merge.
type SyncVal = ({ d: string } | { c: string; l: string }) & { t?: number };

const encode = (ref: AssignmentRef, t: number): SyncVal =>
  ref.kind === 'db' ? { d: ref.deviceId, t } : { c: ref.customId, l: ref.label, t };
const decode = (v: SyncVal): AssignmentRef =>
  'd' in v ? { kind: 'db', deviceId: v.d } : { kind: 'custom', customId: v.c, label: v.l };
const stamped = (v: SyncVal): StampedRef => ({ ref: decode(v), t: isValidStamp(v.t) ? v.t : 0 });

export async function getSyncMode(): Promise<SyncMode> {
  const mode = (await browser.storage.local.get(MODE_KEY))[MODE_KEY];
  return mode === 'github' || mode === 'local' ? mode : 'browser';
}

async function readSyncArea(): Promise<Record<string, StampedRef>> {
  const all = await browser.storage.sync.get(null);
  const out: Record<string, StampedRef> = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('a:')) out[k.slice(2)] = stamped(v as SyncVal);
  }
  return out;
}

async function readLocalArea(): Promise<Manifest> {
  const r = await browser.storage.local.get([ASSIGNMENTS_KEY, TOMBSTONES_KEY]);
  // Copied, so callers can edit the result freely. Real browsers already hand
  // back a fresh copy on every get; the test double hands back its own object,
  // which would let one caller's edits leak into another's read.
  return structuredClone({
    assignments: (r[ASSIGNMENTS_KEY] as Manifest['assignments']) ?? {},
    tombstones: (r[TOMBSTONES_KEY] as Manifest['tombstones']) ?? {},
  });
}

// Everything that syncs, with change times. Browser mode has no tombstones:
// storage.sync propagates a removal by itself.
export async function readManifest(): Promise<Manifest> {
  return (await getSyncMode()) === 'browser'
    ? { assignments: await readSyncArea(), tombstones: {} }
    : readLocalArea();
}

// Replaces the local manifest wholesale: what the sync engine calls with the
// result of a merge. Only meaningful outside browser mode.
export const writeManifest = (m: Manifest) =>
  browser.storage.local.set({ [ASSIGNMENTS_KEY]: m.assignments, [TOMBSTONES_KEY]: m.tombstones });

export async function getAssignment(mac: string): Promise<AssignmentRef | null> {
  if ((await getSyncMode()) === 'browser') {
    const r = await browser.storage.sync.get(A(mac));
    return r[A(mac)] ? decode(r[A(mac)] as SyncVal) : null;
  }
  return (await readLocalArea()).assignments[mac]?.ref ?? null;
}

export async function getAllAssignments(): Promise<Record<string, AssignmentRef>> {
  const { assignments } = await readManifest();
  return Object.fromEntries(Object.entries(assignments).map(([mac, s]) => [mac, s.ref]));
}

// Change times decide merges, so outside browser mode they are corrected by
// the offset the sync engine measured against GitHub's clock (0 unless this
// machine's clock is more than a minute out).
async function stampNow(): Promise<number> {
  const offset = (await browser.storage.local.get('sync:clockOffset'))['sync:clockOffset'];
  return Date.now() + (typeof offset === 'number' ? offset : 0);
}

export async function setAssignment(mac: string, ref: AssignmentRef, t?: number): Promise<void> {
  if ((await getSyncMode()) === 'browser') {
    await browser.storage.sync.set({ [A(mac)]: encode(ref, t ?? Date.now()) });
    return;
  }
  t ??= await stampNow();
  const m = await readLocalArea();
  m.assignments[mac] = { ref, t };
  delete m.tombstones[mac];
  await writeManifest(m);
}

export async function removeAssignment(mac: string): Promise<void> {
  // A custom icon's blob has no other owner and can't be re-derived (unlike
  // a db icon, which just gets re-downloaded next hydrate); read the
  // assignment before removing it so its blob can be pruned too, rather than
  // leaking forever in storage.local under a mac no assignment points to
  // anymore.
  const ref = await getAssignment(mac);
  if ((await getSyncMode()) === 'browser') {
    await browser.storage.sync.remove(A(mac));
  } else {
    // A tombstone, not just a delete: the removal has to win the next merge
    // against the older assignment other browsers and the repo still hold.
    const m = await readLocalArea();
    delete m.assignments[mac];
    m.tombstones[mac] = await stampNow();
    await writeManifest(m);
  }
  if (ref?.kind === 'custom') {
    await browser.storage.local.remove(`icon:${iconKey(ref)}`);
  }
}

// Connect: copy assignments out of storage.sync into storage.local and switch
// mode. The storage.sync copy is deliberately left in place and no longer
// written to: deleting it would propagate through the browser vendor's sync
// and wipe the user's other browsers that are not connected.
export async function migrateToLocal(mode: 'github' | 'local'): Promise<void> {
  if ((await getSyncMode()) !== 'browser') {
    await browser.storage.local.set({ [MODE_KEY]: mode });
    return;
  }
  const assignments: Manifest['assignments'] = {};
  for (const [mac, s] of Object.entries(await readSyncArea())) assignments[mac.toLowerCase()] = s;
  await browser.storage.local.set({ [ASSIGNMENTS_KEY]: assignments, [TOMBSTONES_KEY]: {}, [MODE_KEY]: mode });
}

// storage.sync allows 512 items and ~100 KB in total; stay clear of both so
// a browser that goes back to browser mode can still take new assignments.
const BROWSER_SYNC_MAX_ITEMS = 500;
const BROWSER_SYNC_MAX_BYTES = 90_000;

// Disconnect: fold the local manifest back into storage.sync, newest change
// per mac winning, since an unconnected browser on the same account may have
// kept editing the copy left behind at connect time. Returns the mode the
// browser ended up in: 'local' when the data is more than storage.sync holds.
export async function migrateToBrowser(): Promise<'browser' | 'local'> {
  const local = await readLocalArea();
  const inSync = await readSyncArea();
  const result: Record<string, StampedRef> = { ...inSync };
  for (const [mac, s] of Object.entries(local.assignments)) {
    const theirs = result[mac];
    if (!theirs || s.t >= theirs.t) result[mac] = s;
  }
  for (const [mac, deletedAt] of Object.entries(local.tombstones)) {
    const theirs = result[mac];
    if (theirs && theirs.t <= deletedAt) delete result[mac];
  }

  const encoded = Object.fromEntries(Object.entries(result).map(([mac, s]) => [A(mac), encode(s.ref, s.t)]));
  const fits = Object.keys(encoded).length <= BROWSER_SYNC_MAX_ITEMS
    && JSON.stringify(encoded).length <= BROWSER_SYNC_MAX_BYTES;
  if (!fits) {
    await browser.storage.local.set({ [MODE_KEY]: 'local' });
    return 'local';
  }

  const stale = Object.keys(inSync).filter(mac => !(mac in result)).map(A);
  if (stale.length) await browser.storage.sync.remove(stale);
  await browser.storage.sync.set(encoded);
  await browser.storage.local.remove([ASSIGNMENTS_KEY, TOMBSTONES_KEY, MODE_KEY]);
  return 'browser';
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
  const { assignments, tombstones } = await readManifest();
  const local = await browser.storage.local.get(null);
  const customIcons: Record<string, string> = {};
  for (const [k, v] of Object.entries(local)) {
    if (k.startsWith('icon:custom:')) customIcons[k.slice('icon:custom:'.length)] = v as string;
  }
  return { format: 'ubicon-backup', version: 2, exportedAt: new Date().toISOString(), assignments, tombstones, customIcons };
}

export async function importAll(file: ExportFile | ExportFileV1) {
  if (file?.format !== 'ubicon-backup' || (file.version !== 1 && file.version !== 2)) {
    throw new Error('Not an Ubicon backup file');
  }
  let assignments = 0, customIcons = 0;
  // An import is a deliberate act, so every imported entry is stamped now:
  // it should win the next merge and propagate, whatever time the file says.
  const now = Date.now();
  // Untrusted input (a user-supplied JSON file): skip anything that
  // doesn't match the expected shape rather than importing garbage or
  // throwing away the whole file over one bad entry.
  for (const [mac, entry] of Object.entries(file.assignments ?? {})) {
    // v1 stored the ref directly; v2 wraps it as { ref, t }.
    const ref = file.version === 1 ? entry : (entry as StampedRef | null)?.ref;
    if (!MAC_SHAPE_RE.test(mac) || !isValidAssignmentRef(ref)) continue;
    await setAssignment(mac, ref, now);
    assignments++;
  }
  for (const [id, dataUri] of Object.entries(file.customIcons ?? {})) {
    if (typeof dataUri !== 'string' || !dataUri.startsWith('data:image/')) continue;
    await cacheIcon(`custom:${id}`, dataUri);
    customIcons++;
  }
  return { assignments, customIcons };
}
