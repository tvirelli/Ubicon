import { expect, test } from 'vitest';
import { merge, TOMBSTONE_TTL_MS } from '../shared/sync/merge';
import { emptyManifest, parseManifest, serializeManifest } from '../shared/sync/manifest';
import type { AssignmentRef, Manifest } from '../shared/types';

const MAC1 = 'd4:3d:39:80:fc:80';
const MAC2 = 'aa:bb:cc:dd:ee:ff';
const NOW = 1_790_000_000_000;

const db = (deviceId: string): AssignmentRef => ({ kind: 'db', deviceId });
const man = (
  assignments: Record<string, [AssignmentRef, number]> = {},
  tombstones: Record<string, number> = {},
): Manifest => ({
  assignments: Object.fromEntries(Object.entries(assignments).map(([mac, [ref, t]]) => [mac, { ref, t }])),
  tombstones,
});

test('union: entries that exist on only one side survive', () => {
  const r = merge(man({ [MAC1]: [db('a'), 10] }), man({ [MAC2]: [db('b'), 20] }), NOW);
  expect(Object.keys(r.merged.assignments).sort()).toEqual([MAC2, MAC1].sort());
  expect(r.localChanged).toBe(true);
  expect(r.remoteChanged).toBe(true);
});

test('newest assignment wins, whichever side holds it', () => {
  const localNewer = merge(man({ [MAC1]: [db('new'), 200] }), man({ [MAC1]: [db('old'), 100] }), NOW);
  expect(localNewer.merged.assignments[MAC1]).toEqual({ ref: db('new'), t: 200 });
  expect(localNewer.localChanged).toBe(false);
  expect(localNewer.remoteChanged).toBe(true);

  const remoteNewer = merge(man({ [MAC1]: [db('old'), 100] }), man({ [MAC1]: [db('new'), 200] }), NOW);
  expect(remoteNewer.merged.assignments[MAC1]).toEqual({ ref: db('new'), t: 200 });
  expect(remoteNewer.localChanged).toBe(true);
  expect(remoteNewer.remoteChanged).toBe(false);
});

test('a newer tombstone removes an older assignment', () => {
  const r = merge(man({ [MAC1]: [db('a'), NOW - 5000] }), man({}, { [MAC1]: NOW - 1000 }), NOW);
  expect(r.merged.assignments[MAC1]).toBeUndefined();
  expect(r.merged.tombstones[MAC1]).toBe(NOW - 1000);
  expect(r.localChanged).toBe(true);
  expect(r.remoteChanged).toBe(false);
});

test('a newer assignment beats an older tombstone and clears it', () => {
  const r = merge(man({ [MAC1]: [db('back'), NOW - 1000] }), man({}, { [MAC1]: NOW - 5000 }), NOW);
  expect(r.merged.assignments[MAC1]).toEqual({ ref: db('back'), t: NOW - 1000 });
  expect(r.merged.tombstones[MAC1]).toBeUndefined();
});

test('tie between two different assignments: the repo wins', () => {
  const r = merge(man({ [MAC1]: [db('local-choice'), 500] }), man({ [MAC1]: [db('repo-choice'), 500] }), NOW);
  expect(r.merged.assignments[MAC1]?.ref).toEqual(db('repo-choice'));
  expect(r.localChanged).toBe(true);
  expect(r.remoteChanged).toBe(false);
});

test('tie between legacy t = 0 entries carried over from v0.1.1: the repo wins', () => {
  const r = merge(man({ [MAC1]: [db('home'), 0] }), man({ [MAC1]: [db('work'), 0] }), NOW);
  expect(r.merged.assignments[MAC1]?.ref).toEqual(db('work'));
  expect(r.remoteChanged).toBe(false);
});

test('tie between a local assignment and a repo tombstone: the repo wins', () => {
  const r = merge(man({ [MAC1]: [db('a'), NOW - 1000] }), man({}, { [MAC1]: NOW - 1000 }), NOW);
  expect(r.merged.assignments[MAC1]).toBeUndefined();
  expect(r.merged.tombstones[MAC1]).toBe(NOW - 1000);
});

test('tie between a local tombstone and a repo assignment: the repo wins', () => {
  const r = merge(man({}, { [MAC1]: NOW - 1000 }), man({ [MAC1]: [db('a'), NOW - 1000] }), NOW);
  expect(r.merged.assignments[MAC1]?.ref).toEqual(db('a'));
  expect(r.merged.tombstones[MAC1]).toBeUndefined();
});

test('tombstones older than the TTL are pruned, after they have done their job', () => {
  const expired = NOW - TOMBSTONE_TTL_MS - 1;
  // The expired tombstone is still newer than the local assignment, so it
  // must win first and only then be dropped; pruning before resolving would
  // resurrect the assignment.
  const r = merge(man({ [MAC1]: [db('a'), expired - 1000] }), man({}, { [MAC1]: expired }), NOW);
  expect(r.merged.assignments[MAC1]).toBeUndefined();
  expect(r.merged.tombstones[MAC1]).toBeUndefined();
  expect(r.remoteChanged).toBe(true);
});

test('identical manifests report no change on either side', () => {
  const a = man({ [MAC1]: [db('a'), 10] }, { [MAC2]: NOW - 1 });
  const r = merge(a, structuredClone(a), NOW);
  expect(r.localChanged).toBe(false);
  expect(r.remoteChanged).toBe(false);
});

test('merge does not mutate its inputs', () => {
  const local = man({ [MAC1]: [db('a'), 10] });
  const remote = man({ [MAC2]: [db('b'), 20] });
  const before = JSON.stringify([local, remote]);
  merge(local, remote, NOW);
  expect(JSON.stringify([local, remote])).toBe(before);
});

test('parseManifest skips invalid entries and lowercases MACs', () => {
  const parsed = parseManifest({
    format: 'ubicon-sync',
    version: 2,
    assignments: {
      'D4:3D:39:80:FC:80': { ref: db('ok'), t: 5 },
      'not-a-mac': { ref: db('x'), t: 5 },
      'aa:bb:cc:dd:ee:01': { ref: { kind: 'db' }, t: 5 },
      'aa:bb:cc:dd:ee:02': { ref: db('x'), t: -1 },
      'aa:bb:cc:dd:ee:03': { ref: db('x'), t: 'soon' },
      'aa:bb:cc:dd:ee:04': 'nope',
    },
    tombstones: { 'AA:BB:CC:DD:EE:FF': 7, 'bad': 7, 'aa:bb:cc:dd:ee:05': Number.NaN },
  });
  expect(parsed.assignments).toEqual({ [MAC1]: { ref: db('ok'), t: 5 } });
  expect(parsed.tombstones).toEqual({ [MAC2]: 7 });
});

test('parseManifest rejects a file that is not an Ubicon sync manifest', () => {
  expect(() => parseManifest({ format: 'something-else', version: 2 })).toThrow();
  expect(() => parseManifest(null)).toThrow();
  expect(() => parseManifest({ format: 'ubicon-sync', version: 99 })).toThrow();
});

test('serializeManifest is stable: sorted keys, 2-space indent, round-trips', () => {
  const a = man({ [MAC1]: [db('a'), 10], [MAC2]: [db('b'), 20] }, { 'aa:bb:cc:dd:ee:01': 3 });
  const b = man({ [MAC2]: [db('b'), 20], [MAC1]: [db('a'), 10] }, { 'aa:bb:cc:dd:ee:01': 3 });
  expect(serializeManifest(a)).toBe(serializeManifest(b));
  expect(serializeManifest(a)).toContain('\n  "assignments"');
  expect(parseManifest(JSON.parse(serializeManifest(a)))).toEqual(a);
  expect(parseManifest(JSON.parse(serializeManifest(emptyManifest())))).toEqual(emptyManifest());
});
