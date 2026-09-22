import { beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  getAssignment, getAllAssignments, setAssignment, removeAssignment,
  cacheIcon, getCachedIcon, getSyncMode, readManifest, writeManifest,
  migrateToLocal, migrateToBrowser, exportAll, importAll,
} from '../shared/storage';

const MAC1 = 'd4:3d:39:80:fc:80';
const MAC2 = 'aa:bb:cc:dd:ee:ff';
const db = (deviceId: string) => ({ kind: 'db', deviceId }) as const;

beforeEach(() => {
  fakeBrowser.reset();
  vi.useRealTimers();
});

test('default mode is browser, and v0.1.1 behavior is unchanged there', async () => {
  expect(await getSyncMode()).toBe('browser');
  await setAssignment(MAC1, db('a'));
  expect(Object.keys(await fakeBrowser.storage.sync.get(null))).toEqual([`a:${MAC1}`]);
  expect((await fakeBrowser.storage.local.get('assignments'))['assignments']).toBeUndefined();
  await removeAssignment(MAC1);
  expect(await fakeBrowser.storage.sync.get(null)).toEqual({});
});

test('browser mode stamps each write with a change time', async () => {
  vi.useFakeTimers({ now: 1_790_000_000_000 });
  await setAssignment(MAC1, db('a'));
  expect((await readManifest()).assignments[MAC1]).toEqual({ ref: db('a'), t: 1_790_000_000_000 });
});

test('entries written by v0.1.1 (no change time) read back as t = 0', async () => {
  await fakeBrowser.storage.sync.set({ [`a:${MAC1}`]: { d: 'legacy' } });
  expect(await getAssignment(MAC1)).toEqual(db('legacy'));
  expect((await readManifest()).assignments[MAC1]).toEqual({ ref: db('legacy'), t: 0 });
});

test('migrateToLocal copies assignments, switches mode, and leaves storage.sync intact', async () => {
  await setAssignment(MAC1, db('a'));
  await setAssignment(MAC2, { kind: 'custom', customId: 'c1', label: 'Cam' });
  const before = await fakeBrowser.storage.sync.get(null);

  await migrateToLocal('github');

  expect(await getSyncMode()).toBe('github');
  // Deleting these would propagate through the browser vendor's sync and
  // wipe the user's other, unconnected browsers.
  expect(await fakeBrowser.storage.sync.get(null)).toEqual(before);
  expect(await getAllAssignments()).toEqual({ [MAC1]: db('a'), [MAC2]: { kind: 'custom', customId: 'c1', label: 'Cam' } });
});

test('github mode reads and writes storage.local only', async () => {
  await migrateToLocal('github');
  await setAssignment(MAC1, db('a'));
  expect(await fakeBrowser.storage.sync.get(null)).toEqual({});
  expect(await getAssignment(MAC1)).toEqual(db('a'));
});

test('github mode: removing writes a tombstone and still prunes the custom icon blob', async () => {
  vi.useFakeTimers({ now: 1_790_000_000_000 });
  await migrateToLocal('github');
  await setAssignment(MAC1, { kind: 'custom', customId: 'c1', label: 'Cam' });
  await cacheIcon('custom:c1', 'data:image/png;base64,CUSTOM');
  vi.setSystemTime(1_790_000_005_000);

  await removeAssignment(MAC1);

  expect(await getAssignment(MAC1)).toBeNull();
  expect(await getCachedIcon('custom:c1')).toBeNull();
  expect(await readManifest()).toEqual({ assignments: {}, tombstones: { [MAC1]: 1_790_000_005_000 } });
});

test('github mode: assigning again clears the tombstone', async () => {
  await migrateToLocal('github');
  await setAssignment(MAC1, db('a'));
  await removeAssignment(MAC1);
  await setAssignment(MAC1, db('b'));
  const m = await readManifest();
  expect(m.tombstones[MAC1]).toBeUndefined();
  expect(m.assignments[MAC1]?.ref).toEqual(db('b'));
});

test('writeManifest replaces the local manifest wholesale (used after a merge)', async () => {
  await migrateToLocal('github');
  await setAssignment(MAC1, db('a'));
  await writeManifest({ assignments: { [MAC2]: { ref: db('b'), t: 9 } }, tombstones: { [MAC1]: 8 } });
  expect(await getAllAssignments()).toEqual({ [MAC2]: db('b') });
  expect((await readManifest()).tombstones).toEqual({ [MAC1]: 8 });
});

test('migrateToBrowser merges back by timestamp, applies tombstones, and returns to browser mode', async () => {
  // storage.sync still holds the copy left behind at connect time, which an
  // unconnected browser on the same account may have kept editing.
  await fakeBrowser.storage.sync.set({
    [`a:${MAC1}`]: { d: 'stale', t: 100 },
    [`a:${MAC2}`]: { d: 'edited-elsewhere', t: 900 },
    'a:aa:bb:cc:dd:ee:01': { d: 'removed-here', t: 100 },
  });
  await migrateToLocal('github');
  await writeManifest({
    assignments: { [MAC1]: { ref: db('fresh'), t: 500 }, [MAC2]: { ref: db('older-here'), t: 300 } },
    tombstones: { 'aa:bb:cc:dd:ee:01': 400 },
  });

  expect(await migrateToBrowser()).toBe('browser');

  expect(await getSyncMode()).toBe('browser');
  expect(await getAllAssignments()).toEqual({ [MAC1]: db('fresh'), [MAC2]: db('edited-elsewhere') });
  const local = await fakeBrowser.storage.local.get(['assignments', 'tombstones']);
  expect(local['assignments']).toBeUndefined();
  expect(local['tombstones']).toBeUndefined();
});

test('migrateToBrowser stays local when the data does not fit browser sync', async () => {
  await migrateToLocal('github');
  const assignments: Record<string, { ref: ReturnType<typeof db>; t: number }> = {};
  for (let i = 0; i < 501; i++) {
    const mac = `aa:bb:cc:dd:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`;
    assignments[mac] = { ref: db(`dev-${i}`), t: 1 };
  }
  await writeManifest({ assignments, tombstones: {} });

  expect(await migrateToBrowser()).toBe('local');

  expect(await getSyncMode()).toBe('local');
  expect(Object.keys(await getAllAssignments())).toHaveLength(501);
  expect(await fakeBrowser.storage.sync.get(null)).toEqual({});
});

test('export is version 2 with change times and tombstones, and round-trips', async () => {
  await migrateToLocal('github');
  await setAssignment(MAC1, { kind: 'custom', customId: 'c1', label: 'Cam' });
  await cacheIcon('custom:c1', 'data:image/png;base64,CUSTOM');
  await setAssignment(MAC2, db('gone'));
  await removeAssignment(MAC2);

  const file = await exportAll();
  expect(file.version).toBe(2);
  expect(file.assignments[MAC1]?.ref).toEqual({ kind: 'custom', customId: 'c1', label: 'Cam' });
  expect(typeof file.assignments[MAC1]?.t).toBe('number');
  expect(Object.keys(file.tombstones)).toEqual([MAC2]);

  fakeBrowser.reset();
  expect(await importAll(file)).toEqual({ assignments: 1, customIcons: 1 });
  expect(await getAssignment(MAC1)).toEqual({ kind: 'custom', customId: 'c1', label: 'Cam' });
  expect(await getCachedIcon('custom:c1')).toBe('data:image/png;base64,CUSTOM');
});

test('imported entries are stamped now: an import is a deliberate act and should win the next merge', async () => {
  vi.useFakeTimers({ now: 1_790_000_000_000 });
  await importAll({
    format: 'ubicon-backup', version: 2, exportedAt: '2026-01-01T00:00:00.000Z',
    assignments: { [MAC1]: { ref: db('a'), t: 5 } }, tombstones: {}, customIcons: {},
  });
  expect((await readManifest()).assignments[MAC1]?.t).toBe(1_790_000_000_000);
});

test('importAll rejects files that are not Ubicon backups', async () => {
  await expect(importAll({ format: 'nope', version: 2 } as never)).rejects.toThrow('Not an Ubicon backup file');
  await expect(importAll({ format: 'ubicon-backup', version: 3 } as never)).rejects.toThrow('Not an Ubicon backup file');
});
