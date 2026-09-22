import type { Manifest } from '../types';
import { MAC_SHAPE_RE, isValidAssignmentRef, isValidStamp } from '../validate';

export const MANIFEST_FORMAT = 'ubicon-sync';
export const MANIFEST_VERSION = 2;

export const emptyManifest = (): Manifest => ({ assignments: {}, tombstones: {} });

// The repo file is untrusted input (anyone holding a token can write it, and
// users can edit it by hand on github.com): a file that isn't ours at all is
// an error, but inside one, skip whatever doesn't match the expected shape
// rather than throwing away the whole file over one bad entry. Same stance
// as importAll.
export function parseManifest(raw: unknown): Manifest {
  const file = raw as { format?: unknown; version?: unknown; assignments?: unknown; tombstones?: unknown } | null;
  if (!file || typeof file !== 'object' || file.format !== MANIFEST_FORMAT || file.version !== MANIFEST_VERSION) {
    throw new Error('Not an Ubicon sync file');
  }
  const out = emptyManifest();
  for (const [mac, entry] of Object.entries((file.assignments as Record<string, unknown>) ?? {})) {
    const e = entry as { ref?: unknown; t?: unknown } | null;
    if (!MAC_SHAPE_RE.test(mac) || !e || typeof e !== 'object') continue;
    if (!isValidAssignmentRef(e.ref) || !isValidStamp(e.t)) continue;
    out.assignments[mac.toLowerCase()] = { ref: e.ref, t: e.t };
  }
  for (const [mac, t] of Object.entries((file.tombstones as Record<string, unknown>) ?? {})) {
    if (!MAC_SHAPE_RE.test(mac) || !isValidStamp(t)) continue;
    out.tombstones[mac.toLowerCase()] = t;
  }
  return out;
}

const sortKeys = <T>(rec: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(rec).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

// Sorted keys and a fixed indent, so the same data always produces the same
// bytes: git diffs in the user's repo stay readable, and two manifests can be
// compared by comparing their serialized form.
export function serializeManifest(m: Manifest): string {
  return JSON.stringify(
    {
      format: MANIFEST_FORMAT,
      version: MANIFEST_VERSION,
      assignments: sortKeys(m.assignments),
      tombstones: sortKeys(m.tombstones),
    },
    null,
    2,
  ) + '\n';
}
