import type { AssignmentRef } from './types';

// Matches content/state.ts's MAC_EXACT_RE, kept as a separate constant here
// rather than imported, since shared/ must not depend on the content script
// (content/state.ts already imports from shared/storage.ts).
export const MAC_SHAPE_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export function isValidAssignmentRef(v: unknown): v is AssignmentRef {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (r['kind'] === 'db') return typeof r['deviceId'] === 'string';
  if (r['kind'] === 'custom') return typeof r['customId'] === 'string' && typeof r['label'] === 'string';
  return false;
}

// A change time: milliseconds since epoch, or 0 for data carried over from
// versions that did not record one.
export const isValidStamp = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;
