import { browser } from 'wxt/browser';
import { getSyncMode } from '../storage';

// A heads-up for users who have browser sync turned on. Connecting a browser
// to GitHub leaves a small marker in storage.sync; the browser vendor's sync
// carries it to the user's other installs, which then show a dismissible
// notice offering to connect too. Information only: nothing is ever blocked,
// and nothing depends on the marker arriving. With browser sync off (the
// case the design assumes) it never leaves the machine and does nothing.
// It never holds the token.
const HINT_KEY = 'sync:hint';
const DISMISSED_KEY = 'sync:hintDismissed';

export interface SyncHint { v: 1; repo: string; at: number; by: string; }

export async function readHint(): Promise<SyncHint | null> {
  const h = (await browser.storage.sync.get(HINT_KEY))[HINT_KEY] as Partial<SyncHint> | undefined;
  if (!h || h.v !== 1 || typeof h.repo !== 'string' || typeof h.at !== 'number' || typeof h.by !== 'string') return null;
  return { v: 1, repo: h.repo, at: h.at, by: h.by };
}

// Written once: a second browser connecting must not overwrite the first
// one's marker, or every dismissal elsewhere would be undone.
export async function writeHint(repo: string, by: string): Promise<void> {
  if (await readHint()) return;
  await browser.storage.sync.set({ [HINT_KEY]: { v: 1, repo, at: Date.now(), by } satisfies SyncHint });
}

export const removeHint = () => browser.storage.sync.remove(HINT_KEY);

// Remembered against the marker's own timestamp, so only a later, fresh
// setup prompts again.
export async function dismissHint(): Promise<void> {
  const h = await readHint();
  if (h) await browser.storage.local.set({ [DISMISSED_KEY]: h.at });
}

export async function shouldShowHint(): Promise<boolean> {
  const h = await readHint();
  if (!h || (await getSyncMode()) === 'github') return false;
  return (await browser.storage.local.get(DISMISSED_KEY))[DISMISSED_KEY] !== h.at;
}
