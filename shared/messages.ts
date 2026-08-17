import type { AssignmentRef, DeviceRecord } from './types';
export type UbiconMsg =
  | { type: 'assign-db'; mac: string; deviceId: string }
  | { type: 'assign-custom'; mac: string; dataUri: string; label: string }
  | { type: 'unassign'; mac: string }
  | { type: 'search'; query: string }
  | { type: 'refresh-index' };
export type UbiconReply =
  | { ok: true; dataUri?: string; results?: DeviceRecord[]; count?: number }
  | { ok: false; error: string };
