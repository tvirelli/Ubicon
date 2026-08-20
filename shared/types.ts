export interface DeviceRecord { id: string; name: string; vendor?: string; model?: string; category: string; keywords: string[]; icon: string; type?: 'real' | 'generic'; }
export interface DbIndex { schema: 1; generatedAt: string; count: number; devices: DeviceRecord[]; }
export type AssignmentRef =
  | { kind: 'db'; deviceId: string }
  | { kind: 'custom'; customId: string; label: string };
export interface ExportFile { format: 'ubicon-backup'; version: 1; exportedAt: string; assignments: Record<string, AssignmentRef>; customIcons: Record<string, string>; }
