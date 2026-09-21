import type { DeviceRecord } from './types';
export type UbiconMsg =
  | { type: 'assign-db'; mac: string; deviceId: string }
  | { type: 'assign-custom'; mac: string; dataUri: string; label: string }
  | { type: 'unassign'; mac: string }
  // `file` is a user-supplied backup, parsed but not yet validated: importAll
  // does the validating, so it stays `unknown` here.
  | { type: 'import'; file: unknown }
  | { type: 'search'; query: string }
  | { type: 'refresh-index' };
export type UbiconReply =
  | { ok: true; dataUri?: string; results?: DeviceRecord[]; count?: number; counts?: { assignments: number; customIcons: number } }
  | { ok: false; error: string };
