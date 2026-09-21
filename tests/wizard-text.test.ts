import { beforeEach, expect, test } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { SetupFailure, SyncStatus } from '../shared/sync/engine';
import {
  NEW_REPO_URL, NEW_TOKEN_URL, TOKENS_URL, WIZARD_STEP_KEY,
  checklistLabels, clearWizardStep, disconnectedText, expiryWarning, fixCardFor, formatDate,
  hintText, iconsSyncedText, loadWizardStep, relativeTime, runningLine, saveWizardStep,
  shortStatusText, statusText,
} from '../shared/sync/ui-text';

beforeEach(() => fakeBrowser.reset());

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  mode: 'github', connected: true, repo: 'tony/ubicon-sync', readOnly: false, pending: false, ...over,
});

test('the two setup links match the spec character for character', () => {
  expect(NEW_REPO_URL).toBe('https://github.com/new?name=ubicon-sync&description=Private+sync+data+for+the+Ubicon+browser+extension&visibility=private&owner=%40me&template_owner=tvirelli&template_name=ubicon-sync-template');
  expect(NEW_TOKEN_URL).toBe('https://github.com/settings/personal-access-tokens/new?name=Ubicon+sync&description=Lets+the+Ubicon+browser+extension+sync+icon+assignments+to+the+ubicon-sync+repo&expires_in=none&contents=write');
});

test('the token link never prefills a resource owner, and the token name fits GitHub\'s 40 characters', () => {
  const url = new URL(NEW_TOKEN_URL);
  expect(url.searchParams.has('target_name')).toBe(false);
  expect(url.searchParams.get('name')!.length).toBeLessThanOrEqual(40);
});

test('relativeTime: just now, minutes, hours, then a date', () => {
  expect(relativeTime(NOW - 5_000, NOW)).toBe('just now');
  expect(relativeTime(NOW - MINUTE, NOW)).toBe('1 minute ago');
  expect(relativeTime(NOW - 12 * MINUTE, NOW)).toBe('12 minutes ago');
  expect(relativeTime(NOW - 60 * MINUTE, NOW)).toBe('1 hour ago');
  expect(relativeTime(NOW - 5 * 60 * MINUTE, NOW)).toBe('5 hours ago');
  expect(relativeTime(NOW - 3 * DAY, NOW)).toBe(`on ${formatDate(NOW - 3 * DAY)}`);
});

test('relativeTime treats a time in the future as just now', () => {
  expect(relativeTime(NOW + 30 * MINUTE, NOW)).toBe('just now');
});

test('statusText reports the last sync, pending changes, errors and the pause', () => {
  expect(statusText(status({ lastSyncAt: NOW - 4 * MINUTE }), NOW)).toEqual({ text: 'Synced 4 minutes ago.', tone: 'ok' });
  expect(statusText(status({ lastSyncAt: NOW, pending: true }), NOW).text).toBe('Synced just now. Changes are waiting to upload.');
  expect(statusText(status(), NOW).text).toMatch(/first sync/);
  expect(statusText(status({ lastError: 'auth', lastSyncAt: NOW }), NOW)).toEqual({ text: 'GitHub rejected the token. Click Replace token.', tone: 'error' });
  expect(statusText(status({ lastError: 'network' }), NOW).tone).toBe('warn');
  expect(statusText(status({ paused: 'reach', lastSyncAt: NOW }), NOW).text).toMatch(/^Paused/);
});

test('a view-only browser never claims changes are waiting to upload', () => {
  expect(statusText(status({ lastSyncAt: NOW, pending: true, readOnly: true }), NOW).text).toBe('Synced just now.');
});

test('shortStatusText keeps the popup row to a few words', () => {
  expect(shortStatusText(status({ lastSyncAt: NOW - 2 * MINUTE }), NOW).text).toBe('Synced 2 minutes ago');
  expect(shortStatusText(status({ lastError: 'auth' }), NOW).text).toBe('Token rejected');
  expect(shortStatusText(status({ paused: 'reach' }), NOW).text).toMatch(/^Paused/);
  for (const kind of ['auth', 'not-found', 'rate-limit', 'network', 'conflict', 'bad-remote', 'other'] as const) {
    expect(shortStatusText(status({ lastError: kind }), NOW).text.length).toBeLessThanOrEqual(30);
  }
});

test('expiryWarning speaks up only inside 14 days, and names the date', () => {
  expect(expiryWarning(undefined, NOW)).toBeNull();
  expect(expiryWarning(NOW + 30 * DAY, NOW)).toBeNull();
  expect(expiryWarning(NOW + 10 * DAY, NOW)).toBe(`Your GitHub token expires on ${formatDate(NOW + 10 * DAY)}.`);
  expect(expiryWarning(NOW - DAY, NOW)).toBe(`Your GitHub token expired on ${formatDate(NOW - DAY)}.`);
});

test('iconsSyncedText handles none, one and many', () => {
  expect(iconsSyncedText(0)).toBe('Sync is on. No icons yet');
  expect(iconsSyncedText(1)).toBe('1 icon is now synced');
  expect(iconsSyncedText(37)).toBe('37 icons are now synced');
});

test('disconnectedText says where the data went', () => {
  expect(disconnectedText('browser')).toBe('Your icons are back in normal browser storage.');
  expect(disconnectedText('local')).toBe('You have more assignments than browser sync can hold. They stay in this browser.');
});

test('hintText names the browser that turned sync on', () => {
  expect(hintText('Chrome on Windows')).toBe('You have GitHub sync turned on in Chrome on Windows. Connect this browser to share the same icons.');
});

test('checklist lines use the spec\'s words, and a view-only browser downloads', () => {
  expect(checklistLabels(false)).toEqual(['Token accepted', 'Found your ubicon-sync folder', 'Token only reaches that folder', 'Icons uploaded']);
  expect(checklistLabels(true, 'tony/home-icons')).toEqual(['Token accepted', 'Found your home-icons folder', 'Token only reaches that folder', 'Icons downloaded']);
});

test('runningLine maps engine progress to the line being checked', () => {
  expect(['token', 'repo', 'reach', 'sync', 'done'].map(s => runningLine(s as Parameters<typeof runningLine>[0]))).toEqual([0, 1, 2, 3, 4]);
});

test('every setup failure has a card with a title and a sentence', () => {
  const reasons: SetupFailure[] = ['token-rejected', 'repo-not-found', 'token-too-broad', 'view-only-empty-repo', 'network', 'rate-limit', 'bad-remote', 'other'];
  for (const reason of reasons) {
    const card = fixCardFor(reason);
    expect(card.title, reason).not.toBe('');
    expect(card.body, reason).not.toBe('');
  }
});

test('token-too-broad: count, the edit steps, the tokens page, and no starting over', () => {
  const card = fixCardFor('token-too-broad', { others: 7 });
  expect(card.body).toBe('This token can reach 7 other repositories. Ubicon only needs ubicon-sync.');
  expect(fixCardFor('token-too-broad', { others: 1 }).body).toBe('This token can reach 1 other repository. Ubicon only needs ubicon-sync.');
  expect(card.line).toBe(2);
  expect(card.steps.join(' ')).toMatch(/Edit.*Only select repositories.*ubicon-sync.*Update/);
  expect(card.note).toMatch(/same token keeps working/);
  expect(card.actions).toEqual([{ label: 'Open your tokens on GitHub', href: TOKENS_URL }]);
  expect(TOKENS_URL).toBe('https://github.com/settings/personal-access-tokens');
});

test('token-rejected sends the wizard back to step 2, and a connected browser to GitHub', () => {
  expect(fixCardFor('token-rejected').actions).toEqual([{ label: 'Back to step 2', step: 'token' }]);
  expect(fixCardFor('token-rejected', { context: 'replace' }).actions).toEqual([{ label: 'Create a new token on GitHub', href: NEW_TOKEN_URL }]);
});

test('repo-not-found offers step 1, the token edit and the repo field, in the wizard only', () => {
  const card = fixCardFor('repo-not-found');
  expect(card.askRepo).toBe(true);
  expect(card.actions).toContainEqual({ label: 'Back to step 1', step: 'repo' });
  expect(card.actions).toContainEqual({ label: 'Open your tokens on GitHub', href: TOKENS_URL });
  const replace = fixCardFor('repo-not-found', { context: 'replace', repo: 'tony/home-icons' });
  expect(replace.askRepo).toBe(false);
  expect(replace.title).toMatch(/home-icons/);
});

test('view-only-empty-repo asks for a Read and write token', () => {
  expect(fixCardFor('view-only-empty-repo').body).toMatch(/Read and write/);
});

test('bad-remote links to the repo when it is known', () => {
  expect(fixCardFor('bad-remote', { repo: 'tony/ubicon-sync' }).actions[0]).toEqual({ label: 'Open the repo on GitHub', href: 'https://github.com/tony/ubicon-sync' });
  expect(fixCardFor('bad-remote').actions[0]).toHaveProperty('href');
});

test('the wizard step is saved, restored and cleared, and junk is ignored', async () => {
  expect(await loadWizardStep()).toBeNull();
  await saveWizardStep('token');
  expect(await loadWizardStep()).toBe('token');
  await fakeBrowser.storage.local.set({ [WIZARD_STEP_KEY]: 'nonsense' });
  expect(await loadWizardStep()).toBeNull();
  await saveWizardStep('code');
  await clearWizardStep();
  expect(await fakeBrowser.storage.local.get(null)).toEqual({});
});
