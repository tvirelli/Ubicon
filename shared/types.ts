export interface DeviceRecord { id: string; name: string; vendor?: string; model?: string; category: string; keywords: string[]; icon: string; type?: 'real' | 'generic'; }
export interface DbIndex { schema: 1; generatedAt: string; count: number; devices: DeviceRecord[]; }
export type AssignmentRef =
  | { kind: 'db'; deviceId: string }
  | { kind: 'custom'; customId: string; label: string };
// Backup file written by Export. Version 1 (up to v0.1.1) had no change times; it still imports.
export interface ExportFileV1 { format: 'ubicon-backup'; version: 1; exportedAt: string; assignments: Record<string, AssignmentRef>; customIcons: Record<string, string>; }
export interface ExportFile { format: 'ubicon-backup'; version: 2; exportedAt: string; assignments: Record<string, StampedRef>; tombstones: Record<string, number>; customIcons: Record<string, string>; }
// An assignment plus the time it last changed (ms since epoch). t = 0 marks
// data carried over from versions that did not record a time, so any
// timestamped change beats it.
export interface StampedRef { ref: AssignmentRef; t: number; }
// Everything that syncs: live assignments, and tombstones (mac -> deletedAt)
// so a removal can win a merge against an older assignment elsewhere.
export interface Manifest { assignments: Record<string, StampedRef>; tombstones: Record<string, number>; }
