// Where a detected layout break is kept between the content script that
// finds it and the popup and options page that show it.
import { browser } from 'wxt/browser';

export interface LayoutBreak {
  signature: string;
  hooks: string[];
  unifiVersion: string;
  // Site Manager (cloud) or UniFi OS (local), the shell the header sits in.
  shell?: string;
  // The selector profile (content/selectors.ts) in use when the break was found.
  profile?: string;
  console: 'cloud' | 'local';
  path: string;
  firstSeen: number;
  lastSeen: number;
}

const BREAK_KEY = 'layoutBreak';
const DISMISSED_KEY = 'layoutBreakDismissed';
const VERSIONS_KEY = 'unifiVersions';
const SHELLS_KEY = 'shellVersions';

// Versions only appear on some pages (the Network version on the dashboard
// and settings overview, the shell version in the account menu or on the
// dashboard), so each is remembered per console origin for the pages that
// do not show it.
async function remember(key: string, origin: string, value: string): Promise<void> {
  const got = await browser.storage.local.get(key);
  const map = (got[key] as Record<string, string> | undefined) ?? {};
  if (map[origin] === value) return;
  await browser.storage.local.set({ [key]: { ...map, [origin]: value } });
}

async function recall(key: string, origin: string): Promise<string> {
  const got = await browser.storage.local.get(key);
  return (got[key] as Record<string, string> | undefined)?.[origin] ?? 'unknown';
}

export const rememberUnifiVersion = (origin: string, version: string) => remember(VERSIONS_KEY, origin, version);
export const recallUnifiVersion = (origin: string) => recall(VERSIONS_KEY, origin);
export const rememberShellVersion = (origin: string, version: string) => remember(SHELLS_KEY, origin, version);
export const recallShellVersion = (origin: string) => recall(SHELLS_KEY, origin);

export async function loadBreak(): Promise<LayoutBreak | null> {
  const got = await browser.storage.local.get(BREAK_KEY);
  return (got[BREAK_KEY] as LayoutBreak | undefined) ?? null;
}

// The same signature seen again keeps its firstSeen; a new signature
// replaces the record.
export async function saveBreak(brk: LayoutBreak): Promise<void> {
  const prev = await loadBreak();
  const firstSeen = prev && prev.signature === brk.signature ? prev.firstSeen : brk.firstSeen;
  await browser.storage.local.set({ [BREAK_KEY]: { ...brk, firstSeen } });
}

export async function clearBreak(): Promise<void> {
  await browser.storage.local.remove([BREAK_KEY, DISMISSED_KEY]);
}

export async function dismissBreak(signature: string): Promise<void> {
  await browser.storage.local.set({ [DISMISSED_KEY]: signature });
}

// The break the UI should show: none if there is none, or if this exact
// break was dismissed.
export async function visibleBreak(): Promise<LayoutBreak | null> {
  const got = await browser.storage.local.get([BREAK_KEY, DISMISSED_KEY]);
  const brk = got[BREAK_KEY] as LayoutBreak | undefined;
  if (!brk) return null;
  if (got[DISMISSED_KEY] === brk.signature) return null;
  return brk;
}
