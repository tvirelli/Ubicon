import type { DeviceRecord } from './types';
import type { ConnectResult, SetupFailure, SyncStatus } from './sync/engine';
import type { SyncHint } from './sync/hint';

export type UbiconMsg =
  | { type: 'assign-db'; mac: string; deviceId: string }
  | { type: 'assign-custom'; mac: string; dataUri: string; label: string }
  | { type: 'unassign'; mac: string }
  // `file` is a user-supplied backup, parsed but not yet validated: importAll
  // does the validating, so it stays `unknown` here.
  | { type: 'import'; file: unknown }
  | { type: 'search'; query: string }
  | { type: 'refresh-index' }
  // GitHub sync. The page asks for the api.github.com permission itself, in
  // its click handler, before sending sync-connect or sync-replace-token: the
  // background worker has no user gesture to ask with.
  | { type: 'sync-connect'; token: string; repo?: string; readOnly?: boolean }
  | { type: 'sync-replace-token'; token: string }
  | { type: 'sync-disconnect'; removeHint: boolean }
  | { type: 'sync-now' }
  | { type: 'sync-status' }
  | { type: 'sync-setup-code' }
  | { type: 'sync-dismiss-hint' }
  // From a content script on a local console: this tab shows the normal
  // toolbar icon, whatever the console rules decided (shared/console-icon.ts).
  | { type: 'console-active' };

export type UbiconReply =
  | {
    ok: true;
    dataUri?: string;
    results?: DeviceRecord[];
    count?: number;
    counts?: { assignments: number; customIcons: number };
    connected?: ConnectResult;
    status?: SyncStatus;
    // Set when this browser should show the "you have GitHub sync turned on
    // elsewhere" notice.
    hint?: SyncHint | null;
    setupCode?: string;
    mode?: 'browser' | 'local';
  }
  // `reason` and `others` are set for sync setup failures, so the wizard can
  // show the matching fix card; `error` stays the human-readable fallback.
  // `repo` names the repository a failed setup step was about, when known.
  | { ok: false; error: string; reason?: SetupFailure | 'view-only'; others?: number; repo?: string };
