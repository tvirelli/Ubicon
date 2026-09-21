// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { UbiconMsg, UbiconReply } from '../shared/messages';
import type { SyncStatus } from '../shared/sync/engine';
import type { SyncHint } from '../shared/sync/hint';
import { requestGitHubAccess } from '../shared/sync/permission';
import { formatDate } from '../shared/sync/ui-text';
import { initSyncUi } from '../entrypoints/options/sync';

vi.mock('../shared/sync/permission', () => ({ requestGitHubAccess: vi.fn() }));

const TOKEN = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz';
const HTML = readFileSync(resolve(__dirname, '../entrypoints/options/index.html'), 'utf8');
const BODY = /<body>([\s\S]*)<\/body>/.exec(HTML)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');
const DAY = 24 * 60 * 60 * 1000;

const connected = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  mode: 'github', connected: true, repo: 'tony/ubicon-sync', readOnly: false, pending: false, lastSyncAt: Date.now() - 1000, ...over,
});
const disconnected: SyncStatus = { mode: 'browser', connected: false, readOnly: false, pending: false };

let status: SyncStatus;
let hint: SyncHint | null;
let calls: string[];
let sent: UbiconMsg[];
let replies: Partial<Record<UbiconMsg['type'], (msg: UbiconMsg) => UbiconReply>>;

// The page markup, parsed from the real index.html and moved into the test
// document node by node.
function mountBody() {
  const parsed = new DOMParser().parseFromString(`<!doctype html><html><body>${BODY}</body></html>`, 'text/html');
  document.body.replaceChildren(...[...parsed.body.childNodes].map(n => document.importNode(n, true)));
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };

async function load() {
  mountBody();
  await initSyncUi();
}

beforeEach(() => {
  fakeBrowser.reset();
  status = connected();
  hint = null;
  calls = [];
  sent = [];
  replies = {};
  vi.mocked(requestGitHubAccess).mockReset().mockImplementation(() => {
    calls.push('permission');
    return Promise.resolve(true);
  });
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async (msg: UbiconMsg): Promise<UbiconReply> => {
    calls.push(`send:${msg.type}`);
    sent.push(msg);
    const custom = replies[msg.type];
    if (custom) return custom(msg);
    if (msg.type === 'sync-status') return { ok: true, status, hint };
    if (msg.type === 'sync-setup-code') return { ok: true, setupCode: 'ubicon1.SECRETCODE' };
    if (msg.type === 'sync-disconnect') { status = disconnected; return { ok: true, mode: 'browser' }; }
    return { ok: true, status };
  }) as never);
  document.addEventListener('click', e => { if ((e.target as Element).closest?.('a')) e.preventDefault(); });
});

afterEach(() => vi.restoreAllMocks());

test('the options page opens as a full tab and its styles live in a stylesheet', () => {
  expect(HTML).toContain('<meta name="manifest.open_in_tab" content="true" />');
  expect(HTML).not.toMatch(/\sstyle="/);
});

test('the local controllers form is still on the page', async () => {
  await load();
  for (const id of ['add', 'url', 'msg', 'origins']) expect($(id), id).not.toBeNull();
});

test('not connected: the pitch, the setup button and the setup-code link', async () => {
  status = disconnected;
  await load();
  expect($('sync-off').hidden).toBe(false);
  expect($('sync-on').hidden).toBe(true);
  expect($('setup-start').textContent).toBe('Set up GitHub sync');
  expect($('setup-code').textContent).toBe('I have a setup code');
  expect($('sync-off').textContent).toMatch(/Optional/);
  expect($('sync-off').textContent).toMatch(/Free/);
  expect($('sync-off').textContent).toMatch(/one private folder/);
});

test('connected: status line, repo link and the four controls', async () => {
  await load();
  expect($('sync-on').hidden).toBe(false);
  expect($('sync-off').hidden).toBe(true);
  expect($('sync-status').textContent).toBe('Synced just now.');
  expect(($('sync-repo') as HTMLAnchorElement).getAttribute('href')).toBe('https://github.com/tony/ubicon-sync');
  expect(['sync-now', 'show-code', 'replace-open', 'disconnect-open'].map(id => $(id).textContent)).toEqual(
    ['Sync now', 'Show setup code', 'Replace token', 'Disconnect']);
  expect($('view-only-badge').hidden).toBe(true);
  expect($('expiry').hidden).toBe(true);
});

test('a saved wizard step is dropped once the browser is connected', async () => {
  await fakeBrowser.storage.local.set({ 'sync:wizardStep': 'token' });
  await load();
  await flush();
  expect($('wizard').hidden).toBe(true);
  expect(await fakeBrowser.storage.local.get('sync:wizardStep')).toEqual({});
});

test('the last error is told in plain words, with a tone that is not color alone', async () => {
  status = connected({ lastError: 'auth' });
  await load();
  expect($('sync-status').textContent).toBe('GitHub rejected the token. Click Replace token.');
  expect($('sync-status-box').dataset.tone).toBe('error');
});

test('a view-only browser shows the badge and hides Show setup code', async () => {
  status = connected({ readOnly: true });
  await load();
  expect($('view-only-badge').hidden).toBe(false);
  expect($('view-only-badge').textContent).toBe('View-only');
  expect($('view-only-note').textContent).toContain('This browser is connected with a view-only token.');
  expect($('show-code').hidden).toBe(true);
});

test('a token that expires within 14 days gets a warning with the date', async () => {
  const at = Date.now() + 5 * DAY;
  status = connected({ tokenExpiresAt: at });
  await load();
  expect($('expiry').hidden).toBe(false);
  expect($('expiry').textContent).toContain(`Your GitHub token expires on ${formatDate(at)}.`);
});

test('paused for reach: says Paused, shows the token-too-broad card, and Check again syncs', async () => {
  status = connected({ paused: 'reach', othersInReach: 9 });
  await load();
  expect($('sync-status').textContent).toMatch(/^Paused/);
  const card = $('paused-fix').querySelector('.fix')!;
  expect(card.textContent).toContain('This token can reach 9 other repositories. Ubicon only needs ubicon-sync.');
  expect(card.querySelector<HTMLAnchorElement>('a.btn')!.getAttribute('href')).toBe('https://github.com/settings/personal-access-tokens');

  status = connected();
  card.querySelector<HTMLElement>('[data-retry]')!.click();
  await flush();
  expect(sent.some(m => m.type === 'sync-now')).toBe(true);
  expect($('paused-fix').children.length).toBe(0);
  expect($('sync-status').textContent).toBe('Synced just now.');
});

test('Sync now sends sync-now and repaints from the reply', async () => {
  status = connected({ lastSyncAt: Date.now() - 10 * 60_000 });
  await load();
  expect($('sync-status').textContent).toBe('Synced 10 minutes ago.');
  status = connected();
  $('sync-now').click();
  await flush();
  expect(sent.at(-1)).toEqual({ type: 'sync-now' });
  expect($('sync-status').textContent).toBe('Synced just now.');
});

test('Show setup code fetches the code, shows it with Copy and the secret warning, and hides it again', async () => {
  await load();
  expect(document.body.textContent).not.toContain('ubicon1.SECRETCODE');
  $('show-code').click();
  await flush();
  const panel = $('code-panel');
  expect(panel.hidden).toBe(false);
  expect(panel.querySelector('[data-role="setup-code"]')!.textContent).toBe('ubicon1.SECRETCODE');
  expect(panel.textContent).toContain('treat it like a password');
  expect(panel.querySelector('[data-role="copy-code"]')).not.toBeNull();
  $('show-code').click();
  await flush();
  expect(panel.hidden).toBe(true);
  expect(document.body.textContent).not.toContain('ubicon1.SECRETCODE');
});

test('Replace token asks for the permission first, then sends sync-replace-token', async () => {
  await load();
  $('replace-open').click();
  expect($('replace-panel').hidden).toBe(false);
  const input = $('new-token') as HTMLInputElement;
  expect(input.type).toBe('password');
  input.value = TOKEN;
  calls.length = 0;
  $('replace-go').click();
  expect(calls).toEqual(['permission']);
  await flush();
  expect(calls.slice(0, 2)).toEqual(['permission', 'send:sync-replace-token']);
  expect(sent.find(m => m.type === 'sync-replace-token')).toEqual({ type: 'sync-replace-token', token: TOKEN });
  expect($('replace-panel').hidden).toBe(true);
  expect(input.value).toBe('');
});

test('Replace token shows the same fix cards and keeps the token in the field', async () => {
  replies['sync-replace-token'] = () => ({ ok: false, error: 'token-too-broad', reason: 'token-too-broad', others: 2 });
  await load();
  $('replace-open').click();
  ($('new-token') as HTMLInputElement).value = TOKEN;
  $('replace-go').click();
  await flush();
  expect($('replace-fix').textContent).toContain('This token can reach 2 other repositories.');
  expect(($('new-token') as HTMLInputElement).value).toBe(TOKEN);
  expect($('replace-panel').hidden).toBe(false);
});

test('Disconnect explains itself in a panel and sends removeHint from the checkbox', async () => {
  const confirm = vi.fn();
  window.confirm = confirm;
  await load();
  $('disconnect-open').click();
  const panel = $('disconnect-panel');
  expect(panel.hidden).toBe(false);
  expect(panel.textContent).toMatch(/Only this browser is affected/);
  expect(panel.textContent).toMatch(/Your icons stay in this browser/);
  expect(panel.textContent).toMatch(/The GitHub repo is not touched/);
  const box = $('remove-hint') as HTMLInputElement;
  expect(box.checked).toBe(false);
  expect(box.closest('label')!.textContent!.trim()).toBe('Also stop suggesting GitHub sync on my other browsers');

  $('disconnect-go').click();
  await flush();
  expect(sent.find(m => m.type === 'sync-disconnect')).toEqual({ type: 'sync-disconnect', removeHint: false });
  expect(confirm).not.toHaveBeenCalled();
  expect($('sync-gone').hidden).toBe(false);
  expect($('gone-text').textContent).toBe('Your icons are back in normal browser storage.');
  expect(($('gone-repo') as HTMLAnchorElement).getAttribute('href')).toBe('https://github.com/tony/ubicon-sync/settings');
  expect(($('gone-tokens') as HTMLAnchorElement).getAttribute('href')).toBe('https://github.com/settings/personal-access-tokens');

  // The mode change that disconnecting causes must not wipe the message.
  await fakeBrowser.storage.local.set({ 'sync:mode': 'browser' });
  await flush();
  expect($('sync-gone').hidden).toBe(false);
  $('gone-done').click();
  await flush();
  expect($('sync-off').hidden).toBe(false);
  expect($('sync-gone').hidden).toBe(true);
});

test('a ticked checkbox sends removeHint true, and local mode is explained', async () => {
  replies['sync-disconnect'] = () => { status = disconnected; return { ok: true, mode: 'local' }; };
  await load();
  $('disconnect-open').click();
  ($('remove-hint') as HTMLInputElement).checked = true;
  $('disconnect-go').click();
  await flush();
  expect(sent.find(m => m.type === 'sync-disconnect')).toEqual({ type: 'sync-disconnect', removeHint: true });
  expect($('gone-text').textContent).toBe('You have more assignments than browser sync can hold. They stay in this browser.');
});

test('Cancel closes the disconnect panel and sends nothing', async () => {
  await load();
  $('disconnect-open').click();
  $('disconnect-cancel').click();
  expect($('disconnect-panel').hidden).toBe(true);
  expect(sent.some(m => m.type === 'sync-disconnect')).toBe(false);
});

test('the status repaints when sync:state, sync:mode or sync:dirty change', async () => {
  await load();
  for (const key of ['sync:state', 'sync:mode', 'sync:dirty']) {
    sent.length = 0;
    await fakeBrowser.storage.local.set({ [key]: Date.now() + key });
    await flush();
    expect(sent.some(m => m.type === 'sync-status'), key).toBe(true);
  }
  sent.length = 0;
  await fakeBrowser.storage.local.set({ unrelated: 1 });
  await flush();
  expect(sent.length).toBe(0);
});

test('the hint notice shows on an unconnected browser; Enter setup code opens that screen', async () => {
  status = disconnected;
  hint = { v: 1, repo: 'tony/ubicon-sync', at: 1790000000000, by: 'Chrome on Windows' };
  await load();
  expect($('hint').hidden).toBe(false);
  expect($('hint-text').textContent).toBe('You have GitHub sync turned on in Chrome on Windows. Connect this browser to share the same icons.');
  $('hint-enter').click();
  expect(document.querySelector<HTMLElement>('.screen:not([hidden])')!.dataset.screen).toBe('code');
  expect($('code-repo-line').textContent).toContain('tony/ubicon-sync');
  expect(document.querySelector('[data-screen="code"]')!.textContent).toMatch(/open Ubicon's options and\s+click Show setup code/);
});

test('Dismiss hides the notice and sends sync-dismiss-hint', async () => {
  status = disconnected;
  hint = { v: 1, repo: 'tony/ubicon-sync', at: 1790000000000, by: 'Firefox on Linux' };
  await load();
  $('hint-dismiss').click();
  await flush();
  expect($('hint').hidden).toBe(true);
  expect(sent.at(-1)).toEqual({ type: 'sync-dismiss-hint' });
});

test('no hint, no notice', async () => {
  status = disconnected;
  await load();
  expect($('hint').hidden).toBe(true);
});

test('the popup\'s "Enter setup code" reaches an Options page that is already open', async () => {
  status = disconnected;
  await load();
  await fakeBrowser.storage.local.set({ 'sync:wizardStep': 'code' });
  await flush();
  expect($('wizard').hidden).toBe(false);
  expect(document.querySelector<HTMLElement>('.screen:not([hidden])')!.dataset.screen).toBe('code');
});
