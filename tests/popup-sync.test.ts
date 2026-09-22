// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { UbiconMsg, UbiconReply } from '../shared/messages';
import type { SyncStatus } from '../shared/sync/engine';
import type { SyncHint } from '../shared/sync/hint';

const BODY = /<body>([\s\S]*)<\/body>/.exec(readFileSync(resolve(__dirname, '../entrypoints/popup/index.html'), 'utf8'))![1]!
  .replace(/<script[\s\S]*?<\/script>/g, '');

const disconnected: SyncStatus = { mode: 'browser', connected: false, readOnly: false, pending: false };
const connected = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  mode: 'github', connected: true, repo: 'tony/ubicon-sync', readOnly: false, pending: false, lastSyncAt: Date.now() - 3 * 60_000, ...over,
});

let status: SyncStatus;
let hint: SyncHint | null;
let sent: UbiconMsg[];
let openOptionsPage: ReturnType<typeof vi.fn>;

// The page markup, parsed from the real index.html and moved into the test
// document node by node.
function mountBody() {
  const parsed = new DOMParser().parseFromString(`<!doctype html><html><body>${BODY}</body></html>`, 'text/html');
  document.body.replaceChildren(...[...parsed.body.childNodes].map(n => document.importNode(n, true)));
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };

// The popup script runs on import, as it does in the browser, so each test
// loads a fresh copy against a fresh document.
async function openPopup() {
  mountBody();
  vi.resetModules();
  await import('../entrypoints/popup/main');
  await flush();
}

beforeEach(() => {
  fakeBrowser.reset();
  status = disconnected;
  hint = null;
  sent = [];
  openOptionsPage = vi.fn().mockResolvedValue(undefined);
  (fakeBrowser.runtime as unknown as { openOptionsPage: unknown }).openOptionsPage = openOptionsPage;
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async (msg: UbiconMsg): Promise<UbiconReply> => {
    sent.push(msg);
    if (msg.type === 'sync-status') return { ok: true, status, hint };
    if (msg.type === 'sync-now') return { ok: true, status };
    return { ok: true };
  }) as never);
});

afterEach(() => vi.restoreAllMocks());

test('not connected: a "Set up GitHub sync" link that opens the Options page', async () => {
  await openPopup();
  expect($('sync-setup').hidden).toBe(false);
  expect($('sync-setup').textContent).toBe('Set up GitHub sync');
  expect($('sync-now').hidden).toBe(true);
  expect($('sync-manage').hidden).toBe(true);
  expect($('hint').hidden).toBe(true);
  expect($('view-only').hidden).toBe(true);
  $('sync-setup').click();
  expect(openOptionsPage).toHaveBeenCalledTimes(1);
});

test('connected: "Synced N minutes ago", a Sync now button, and a Manage link to the Options page', async () => {
  status = connected();
  await openPopup();
  expect($('sync-setup').hidden).toBe(true);
  expect($('sync-text').textContent).toBe('Synced 3 minutes ago');
  expect($('sync-now').hidden).toBe(false);
  expect($('sync-manage').hidden).toBe(false);
  $('sync-manage').click();
  expect(openOptionsPage).toHaveBeenCalledTimes(1);

  status = connected({ lastSyncAt: Date.now() });
  $('sync-now').click();
  await flush();
  expect(sent.at(-1)).toEqual({ type: 'sync-now' });
  expect($('sync-text').textContent).toBe('Synced just now');
});

test('connected with an error: the error in a few words', async () => {
  status = connected({ lastError: 'auth' });
  await openPopup();
  expect($('sync-text').textContent).toBe('Token rejected');
  expect($('sync-text').dataset.tone).toBe('warn');
});

test('an expiring token is flagged with its date and leads to the Options page', async () => {
  const at = Date.now() + 3 * 24 * 60 * 60 * 1000;
  status = connected({ tokenExpiresAt: at });
  await openPopup();
  expect($('sync-expiry').hidden).toBe(false);
  expect($('sync-expiry').textContent).toContain(`Your GitHub token expires on ${new Date(at).toLocaleDateString()}`);
  $('sync-expiry').click();
  expect(openOptionsPage).toHaveBeenCalledTimes(1);
});

test('the hint notice appears, and Dismiss sends sync-dismiss-hint', async () => {
  hint = { v: 1, repo: 'tony/ubicon-sync', at: 1790000000000, by: 'Chrome on Windows' };
  await openPopup();
  expect($('hint').hidden).toBe(false);
  expect($('hint-text').textContent).toBe('You have GitHub sync turned on in Chrome on Windows. Connect this browser to share the same icons.');
  expect($('hint-enter').textContent).toBe('Enter setup code');
  $('hint-dismiss').click();
  await flush();
  expect($('hint').hidden).toBe(true);
  expect(sent.at(-1)).toEqual({ type: 'sync-dismiss-hint' });
});

test('Enter setup code saves the step, then opens the Options page', async () => {
  hint = { v: 1, repo: 'tony/ubicon-sync', at: 1790000000000, by: 'Chrome on Windows' };
  await openPopup();
  let stepWhenOpened: unknown;
  openOptionsPage.mockImplementation(async () => {
    stepWhenOpened = (await fakeBrowser.storage.local.get('sync:wizardStep'))['sync:wizardStep'];
  });
  $('hint-enter').click();
  await flush();
  expect(openOptionsPage).toHaveBeenCalledTimes(1);
  expect(stepWhenOpened).toBe('code');
});

test('a view-only connection disables remove buttons and Import, and says why', async () => {
  await fakeBrowser.storage.local.set({
    'sync:mode': 'github',
    assignments: { 'aa:bb:cc:dd:ee:ff': { ref: { kind: 'db', deviceId: 'sonos-one' }, t: 1 } },
  });
  status = connected({ readOnly: true });
  await openPopup();
  expect($('view-only').hidden).toBe(false);
  expect($('view-only').textContent).toBe('This browser is connected with a view-only token.');
  expect(($('import') as HTMLButtonElement).disabled).toBe(true);
  const remove = document.querySelectorAll<HTMLButtonElement>('#list .row button');
  expect(remove.length).toBe(1);
  expect(remove[0]!.disabled).toBe(true);
});

test('a normal connection leaves remove and Import alone', async () => {
  await fakeBrowser.storage.local.set({
    'sync:mode': 'github',
    assignments: { 'aa:bb:cc:dd:ee:ff': { ref: { kind: 'db', deviceId: 'sonos-one' }, t: 1 } },
  });
  status = connected();
  await openPopup();
  expect(($('import') as HTMLButtonElement).disabled).toBe(false);
  const remove = document.querySelector<HTMLButtonElement>('#list .row button')!;
  expect(remove.disabled).toBe(false);
  expect(document.querySelector('#list .row .name')!.textContent).toBe('sonos-one');
  expect(document.querySelector('#list .row .mac')!.textContent).toBe('aa:bb:cc:dd:ee:ff');

  // The two-click remove still works as before.
  remove.click();
  expect(remove.textContent).toBe('Remove?');
  remove.click();
  await flush();
  expect(sent).toContainEqual({ type: 'unassign', mac: 'aa:bb:cc:dd:ee:ff' });
});

test('with nothing assigned the empty message is shown', async () => {
  await openPopup();
  expect(document.querySelector('#list .empty')!.textContent).toMatch(/^No devices assigned yet\./);
});
