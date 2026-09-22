import type { AssignmentRef, Manifest } from '../types';
import { emptyManifest, serializeManifest } from './manifest';

export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface MergeResult {
  merged: Manifest;
  // Whether `merged` differs from each input: drives whether to write local
  // storage and whether to push to the repo. An echo (our own write coming
  // back through storage.onChanged) merges to something identical on both
  // sides, so it produces no write and no commit without any suppression flag.
  localChanged: boolean;
  remoteChanged: boolean;
}

// What one side knows about one MAC: an assignment, a removal, or nothing.
export type Entry =
  | { kind: 'set'; ref: AssignmentRef; t: number }
  | { kind: 'del'; t: number }
  | undefined;

function entryOf(m: Manifest, mac: string): Entry {
  const set = m.assignments[mac];
  const del = m.tombstones[mac];
  if (set && (del === undefined || set.t > del)) return { kind: 'set', ref: set.ref, t: set.t };
  if (del !== undefined) return { kind: 'del', t: del };
  return undefined;
}

// Decides which side's knowledge of one MAC survives the merge.
//
// Rule (Tony, 2026-09-21): the newest change wins, and on a tie whatever is
// already in the repo wins. Ties are rare between timestamped changes but
// common for data carried over from v0.1.1, which merges as t = 0: two
// browsers that never synced can hold different icons for the same device.
// Every browser compares against the same repo, so "repo wins" makes them all
// end up identical, and GitHub's compare-and-swap settles who got there first.
export function resolveEntry(local: Entry, remote: Entry): Entry {
  // Either side may be undefined: that side has never heard of this MAC.
  if (!local) return remote;
  if (!remote) return local;
  // Strictly newer, so that a tie falls to the repo.
  return local.t > remote.t ? local : remote;
}

const same = (a: Manifest, b: Manifest) => serializeManifest(a) === serializeManifest(b);

export function merge(local: Manifest, remote: Manifest, now: number): MergeResult {
  const merged = emptyManifest();
  const macs = new Set([
    ...Object.keys(local.assignments), ...Object.keys(local.tombstones),
    ...Object.keys(remote.assignments), ...Object.keys(remote.tombstones),
  ]);
  for (const mac of macs) {
    const winner = resolveEntry(entryOf(local, mac), entryOf(remote, mac));
    if (!winner) continue;
    if (winner.kind === 'set') {
      merged.assignments[mac] = { ref: winner.ref, t: winner.t };
    } else if (now - winner.t <= TOMBSTONE_TTL_MS) {
      // Resolve first, prune second: an expired tombstone must still beat the
      // older assignment it was written to remove before it is dropped, or
      // pruning would resurrect that assignment.
      merged.tombstones[mac] = winner.t;
    }
  }
  return { merged, localChanged: !same(merged, local), remoteChanged: !same(merged, remote) };
}
