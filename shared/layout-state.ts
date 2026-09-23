// Where a detected layout break is kept between the content script that
// finds it and the popup and options page that show it.
import { browser } from 'wxt/browser';

export interface LayoutBreak {
  signature: string;
  hooks: string[];
  unifiVersion: string;
  console: 'cloud' | 'local';
  path: string;
  firstSeen: number;
  lastSeen: number;
}

const BREAK_KEY = 'layoutBreak';
const DISMISSED_KEY = 'layoutBreakDismissed';

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
