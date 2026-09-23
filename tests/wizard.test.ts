// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { UbiconMsg, UbiconReply } from '../shared/messages';
import type { SetupFailure, SyncStatus } from '../shared/sync/engine';
import { requestGitHubAccess } from '../shared/sync/permission';
import { encodeSetupCode } from '../shared/sync/setup-code';
import { NEW_REPO_URL, NEW_TOKEN_URL, PERMISSION_DENIED_TEXT } from '../shared/sync/ui-text';
import { initSyncUi } from '../entrypoints/options/sync';

// The real permission prompt cannot run here; what matters is when it is
// asked for, which the mock records.
vi.mock('../shared/sync/permission', () => ({ requestGitHubAccess: vi.fn() }));

const TOKEN = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz';
const BODY = /<body>([\s\S]*)<\/body>/.exec(readFileSync(resolve(__dirname, '../entrypoints/options/index.html'), 'utf8'))![1]!
  .replace(/<script[\s\S]*?<\/script>/g, '');

const disconnected: SyncStatus = { mode: 'browser', connected: false, readOnly: false, pending: false };

type Handler = (msg: UbiconMsg) => UbiconReply | Promise<UbiconReply>;
let calls: string[];
let sent: UbiconMsg[];
let onConnect: Handler;

// The page markup, parsed from the real index.html and moved into the test
// document node by node.
function mountBody() {
  const parsed = new DOMParser().parseFromString(`<!doctype html><html><body>${BODY}</body></html>`, 'text/html');
  document.body.replaceChildren(...[...parsed.body.childNodes].map(n => document.importNode(n, true)));
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const screen = () => document.querySelector<HTMLElement>('.screen:not([hidden])')?.dataset.screen ?? null;
const within = (sel: string) => document.querySelector<HTMLElement>(`.screen:not([hidden]) ${sel}`)!;
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };
const lineStates = (id: string) => [...$(id).children].map(li => (li as HTMLElement).dataset.state);

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function openStep3() {
  $('setup-start').click();
  within('[data-goto="repo"]').click();
  within('[data-skip="repo"]').click();
  within('[data-skip="token"]').click();
  await flush();
  expect(screen()).toBe('connect');
}

beforeEach(async () => {
  fakeBrowser.reset();
  calls = [];
  sent = [];
  onConnect = () => ({ ok: true, connected: { repo: 'tony/ubicon-sync', assignments: 12, readOnly: false } });
  vi.mocked(requestGitHubAccess).mockReset().mockImplementation(() => {
    calls.push('permission');
    return Promise.resolve(true);
  });
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async (msg: UbiconMsg): Promise<UbiconReply> => {
    calls.push(`send:${msg.type}`);
    sent.push(msg);
    if (msg.type === 'sync-status') return { ok: true, status: disconnected, hint: null };
    if (msg.type === 'sync-setup-code') return { ok: true, setupCode: 'ubicon1.SECRETCODE' };
    if (msg.type === 'sync-connect') return onConnect(msg);
    return { ok: true };
  }) as never);
  // Links open GitHub in a new tab; the test has nowhere to open it.
  document.addEventListener('click', e => { if ((e.target as Element).closest?.('a')) e.preventDefault(); });
  mountBody();
  await initSyncUi();
});

afterEach(() => vi.restoreAllMocks());

test('Open GitHub carries the two spec links exactly, in a new tab', () => {
  const repo = document.querySelector<HTMLAnchorElement>('[data-open="repo"]')!;
  const token = document.querySelector<HTMLAnchorElement>('[data-open="token"]')!;
  expect(repo.getAttribute('href')).toBe(NEW_REPO_URL);
  expect(token.getAttribute('href')).toBe(NEW_TOKEN_URL);
  expect(repo.getAttribute('href')).toBe('https://github.com/new?name=ubicon-sync&description=Private+sync+data+for+the+Ubicon+browser+extension&visibility=private&owner=%40me&template_owner=tvirelli&template_name=ubicon-sync-template');
  expect(token.getAttribute('href')).toBe('https://github.com/settings/personal-access-tokens/new?name=Ubicon+sync&description=Lets+the+Ubicon+browser+extension+sync+icon+assignments+to+the+ubicon-sync+repo&expires_in=none&contents=write');
  for (const a of [repo, token]) {
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
  }
  expect(document.querySelector<HTMLAnchorElement>('[data-screen="intro"] [data-href="signup"]')!.getAttribute('href')).toBe('https://github.com/signup');
});

test('the page starts on the pitch, and Set up GitHub sync opens the intro with its three steps', () => {
  expect($('wizard').hidden).toBe(true);
  expect($('sync-off').hidden).toBe(false);
  $('setup-start').click();
  expect($('page').hidden).toBe(true);
  expect(screen()).toBe('intro');
  expect($('eta').hidden).toBe(false);
  expect($('eta').textContent).toBe('About 3 minutes');
  expect([...document.querySelectorAll('#steps .step-label')].map(n => n.textContent)).toEqual(['Create repo', 'Create token', 'Connect']);
});

test('after Open GitHub the button becomes "I did this, next", with Open GitHub again as a link', async () => {
  $('setup-start').click();
  within('[data-goto="repo"]').click();
  const open = within('[data-open="repo"]');
  const done = within('[data-done="repo"]');
  expect(done.hidden).toBe(true);
  open.click();
  await flush();
  expect(open.hidden).toBe(true);
  expect(done.hidden).toBe(false);
  expect(done.textContent).toBe('I did this, next');
  expect(within('[data-again="repo"]').hidden).toBe(false);
  done.click();
  expect(screen()).toBe('token');
  expect($('eta').hidden).toBe(true);
});

test('step 2 leads with the Repository access warning, above the Open GitHub button', async () => {
  $('setup-start').click();
  within('[data-goto="repo"]').click();
  within('[data-skip="repo"]').click();
  const warning = within('.warning');
  expect(warning.textContent!.replace(/\s+/g, ' ').trim()).toContain(
    'On the GitHub page, change Repository access to Only select repositories and pick ubicon-sync. Ubicon will refuse a token that can reach your other repos.');
  const button = within('[data-open="token"]');
  expect(warning.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('every drawing of GitHub has a text alternative and says it is a drawing', () => {
  const drawings = [...document.querySelectorAll('.gh')];
  expect(drawings.length).toBeGreaterThanOrEqual(3);
  for (const d of drawings) {
    expect(d.getAttribute('role')).toBe('img');
    expect(d.getAttribute('aria-label')!.length).toBeGreaterThan(40);
    expect(d.closest('figure')!.querySelector('figcaption')!.textContent).not.toBe('');
  }
  expect(document.querySelector('[data-screen="repo"] figcaption')!.textContent).toContain('What you will see on GitHub');
});

test('the step is saved and restored; the token never reaches storage', async () => {
  await openStep3();
  type($('token') as HTMLInputElement, TOKEN);
  await flush();
  expect((await fakeBrowser.storage.local.get('sync:wizardStep'))['sync:wizardStep']).toBe('connect');
  const stored = JSON.stringify([await fakeBrowser.storage.local.get(null), await fakeBrowser.storage.sync.get(null)]);
  expect(stored).not.toContain(TOKEN);
  expect(stored).not.toContain('github_pat_');

  // A new tab: the same page, loaded again.
  mountBody();
  await initSyncUi();
  expect(screen()).toBe('connect');
  expect(($('token') as HTMLInputElement).value).toBe('');
});

test('Back never loses what was typed, and leaving the wizard forgets the step', async () => {
  await openStep3();
  type($('token') as HTMLInputElement, TOKEN);
  within('[data-back]').click();
  expect(screen()).toBe('token');
  within('[data-skip="token"]').click();
  expect(($('token') as HTMLInputElement).value).toBe(TOKEN);

  for (let i = 0; i < 4; i++) within('[data-back]').click(); // token, repo, intro, out
  await flush();
  expect($('wizard').hidden).toBe(true);
  expect($('page').hidden).toBe(false);
  expect(await fakeBrowser.storage.local.get('sync:wizardStep')).toEqual({});
});

test('a classic token gets a friendly message and a way back to step 2; spaces are trimmed silently', async () => {
  await openStep3();
  const input = $('token') as HTMLInputElement;
  type(input, '  ghp_abcdefghijklmnopqrstuvwxyz0123456789  ');
  expect(input.value).toBe('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  expect($('classic').hidden).toBe(false);
  expect($('classic-text').textContent).toMatch(/older kind of GitHub token/);

  $('connect').click();
  await flush();
  expect(requestGitHubAccess).not.toHaveBeenCalled();
  expect(sent.some(m => m.type === 'sync-connect')).toBe(false);

  within('#classic [data-goto="token"]').click();
  expect(screen()).toBe('token');

  within('[data-skip="token"]').click();
  type(input, TOKEN);
  expect($('classic').hidden).toBe(true);
});

test('an unrecognized token shape shows nothing until Connect', async () => {
  await openStep3();
  type($('token') as HTMLInputElement, 'something-else');
  expect($('classic').hidden).toBe(true);
  expect($('token-note').textContent).toBe('');
});

test('Connect asks for the GitHub permission synchronously, before anything is sent', async () => {
  await openStep3();
  type($('token') as HTMLInputElement, ` ${TOKEN} `);
  calls.length = 0;
  const get = vi.spyOn(fakeBrowser.storage.local, 'get');
  const set = vi.spyOn(fakeBrowser.storage.local, 'set');

  $('connect').click();
  // Still inside the click: the permission has been asked for, and nothing
  // asynchronous has started.
  expect(requestGitHubAccess).toHaveBeenCalledTimes(1);
  expect(calls).toEqual(['permission']);
  expect(get).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();

  await flush();
  expect(calls.slice(0, 2)).toEqual(['permission', 'send:sync-connect']);
  expect(sent.find(m => m.type === 'sync-connect')).toEqual({ type: 'sync-connect', token: TOKEN });
});

test('a declined permission sends nothing and says what to do', async () => {
  vi.mocked(requestGitHubAccess).mockResolvedValue(false);
  await openStep3();
  type($('token') as HTMLInputElement, TOKEN);
  $('connect').click();
  await flush();
  expect($('token-note').textContent).toBe(PERMISSION_DENIED_TEXT);
  expect(PERMISSION_DENIED_TEXT).toBe('Ubicon needs permission to talk to api.github.com. Click Connect and choose Allow.');
  expect(sent.some(m => m.type === 'sync-connect')).toBe(false);
  expect(($('token') as HTMLInputElement).value).toBe(TOKEN);
});

test('a permission request that throws (Firefox) is treated as declined', async () => {
  vi.mocked(requestGitHubAccess).mockRejectedValue(new Error('may only be called from a user input handler'));
  await openStep3();
  type($('token') as HTMLInputElement, TOKEN);
  $('connect').click();
  await flush();
  expect($('token-note').textContent).toBe(PERMISSION_DENIED_TEXT);
});

test('the checklist follows sync:progress line by line, as a polite live region', async () => {
  let finish!: (r: UbiconReply) => void;
  onConnect = () => new Promise<UbiconReply>(r => { finish = r; });
  await openStep3();
  type($('token') as HTMLInputElement, TOKEN);
  $('connect').click();
  await flush();

  const list = $('connect-checks');
  expect(list.getAttribute('aria-live')).toBe('polite');
  expect([...list.querySelectorAll('.label')].map(n => n.textContent)).toEqual(
    ['Token accepted', 'Found your ubicon-sync folder', 'Token only reaches that folder', 'Icons uploaded']);
  expect(lineStates('connect-checks')).toEqual(['running', 'waiting', 'waiting', 'waiting']);
  expect(($('connect') as HTMLButtonElement).disabled).toBe(true);

  await fakeBrowser.storage.local.set({ 'sync:progress': 'repo' });
  await flush();
  expect(lineStates('connect-checks')).toEqual(['done', 'running', 'waiting', 'waiting']);
  await fakeBrowser.storage.local.set({ 'sync:progress': 'sync' });
  await flush();
  expect(lineStates('connect-checks')).toEqual(['done', 'done', 'done', 'running']);
  // No information by color alone: each line also carries its state in words.
  expect(list.children[3]!.querySelector('.state')!.textContent).toContain('checking');

  finish({ ok: true, connected: { repo: 'tony/ubicon-sync', assignments: 3, readOnly: false } });
  await flush();
  expect(screen()).toBe('success');
});

const REASONS: SetupFailure[] = ['token-rejected', 'repo-not-found', 'token-too-broad', 'view-only-empty-repo', 'network', 'rate-limit', 'bad-remote', 'other'];
test.each(REASONS)('%s turns into a fix card, keeps the token and lets the user connect again', async reason => {
  onConnect = () => ({ ok: false, error: reason, reason, others: reason === 'token-too-broad' ? 4 : undefined });
  await openStep3();
  type($('token') as HTMLInputElement, TOKEN);
  $('connect').click();
  await flush();

  expect(screen()).toBe('connect');
  const card = $('connect-fix').querySelector('.fix')!;
  expect(card).not.toBeNull();
  expect(card.querySelector('h3')!.textContent).not.toBe('');
  expect(lineStates('connect-checks')).toContain('failed');
  expect(($('token') as HTMLInputElement).value).toBe(TOKEN);
  expect(($('connect') as HTMLButtonElement).disabled).toBe(false);
  expect(document.body.textContent).not.toContain(TOKEN);
  const stored = JSON.stringify(await fakeBrowser.storage.local.get(null));
  expect(stored).not.toContain(TOKEN);

  // Fixed on GitHub: the same token, one more click.
  onConnect = () => ({ ok: true, connected: { repo: 'tony/ubicon-sync', assignments: 1, readOnly: false } });
  calls.length = 0;
  card.querySelector<HTMLElement>('[data-retry]')!.click();
  expect(calls).toEqual(['permission']);
  await flush();
  expect(screen()).toBe('success');
  expect($('success-h').textContent).toBe('1 icon is now synced');
});

test('token-too-broad shows the count, the tokens page and its own drawing', async () => {
  onConnect = () => ({ ok: false, error: 'token-too-broad', reason: 'token-too-broad', others: 4 });
  await openStep3();
  type($('token') as HTMLInputElement, TOKEN);
  $('connect').click();
  await flush();
  const card = $('connect-fix').querySelector('.fix')!;
  expect(card.textContent).toContain('This token can reach 4 other repositories. Ubicon only needs ubicon-sync.');
  expect(card.textContent).toContain('same token keeps working');
  expect(card.querySelector<HTMLAnchorElement>('a.btn')!.getAttribute('href')).toBe('https://github.com/settings/personal-access-tokens');
  expect(card.querySelector('.gh[role="img"]')).not.toBeNull();
  expect(lineStates('connect-checks')).toEqual(['done', 'done', 'failed', 'waiting']);
});

test('repo-not-found reveals the owner/name field, checks its shape and sends it', async () => {
  onConnect = () => ({ ok: false, error: 'repo-not-found', reason: 'repo-not-found' });
  await openStep3();
  expect($('repo-field').hidden).toBe(true);
  type($('token') as HTMLInputElement, TOKEN);
  $('connect').click();
  await flush();
  expect($('repo-field').hidden).toBe(false);

  const repo = $('repo') as HTMLInputElement;
  repo.value = 'not a repo';
  sent.length = 0;
  $('connect').click();
  await flush();
  expect(sent.some(m => m.type === 'sync-connect')).toBe(false);
  expect($('token-note').textContent).toMatch(/owner\/name/);

  repo.value = 'tony/home-icons';
  $('connect').click();
  await flush();
  expect(sent.find(m => m.type === 'sync-connect')).toEqual({ type: 'sync-connect', token: TOKEN, repo: 'tony/home-icons' });
});

test('success: the count, the repo link, and a setup code hidden until Show', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  await openStep3();
  type($('token') as HTMLInputElement, TOKEN);
  $('connect').click();
  await flush();

  expect(screen()).toBe('success');
  expect($('success-h').textContent).toBe('12 icons are now synced');
  expect(($('success-repo') as HTMLAnchorElement).getAttribute('href')).toBe('https://github.com/tony/ubicon-sync');
  expect($('success-others').textContent!.replace(/\s+/g, ' ').trim()).toBe(
    'Your other browsers keep working as before. Paste the setup code there to bring them in.');
  expect(($('token') as HTMLInputElement).value).toBe('');
  expect(await fakeBrowser.storage.local.get('sync:wizardStep')).toEqual({});

  const card = $('success-code');
  expect(card.textContent).toContain('Set up your other browsers');
  expect(card.textContent).toContain('treat it like a password');
  expect(card.textContent).not.toContain('ubicon1.SECRETCODE');
  card.querySelector<HTMLElement>('[data-role="show-code"]')!.click();
  expect(card.querySelector('[data-role="setup-code"]')!.textContent).toBe('ubicon1.SECRETCODE');
  card.querySelector<HTMLElement>('[data-role="show-code"]')!.click();
  expect(card.textContent).not.toContain('ubicon1.SECRETCODE');

  card.querySelector<HTMLElement>('[data-role="copy-code"]')!.click();
  await flush();
  expect(writeText).toHaveBeenCalledWith('ubicon1.SECRETCODE');
  expect(card.querySelector('.copied')!.textContent).toBe('Copied');

  // Download hands the user a text file holding the code and what it is for.
  const urls: string[] = [];
  const clicks: string[] = [];
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = (b: Blob | MediaSource) => { urls.push(String((b as Blob).type)); return 'blob:code'; };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { clicks.push(this.download + ' ' + this.href); };
  try {
    card.querySelector<HTMLElement>('[data-role="download-code"]')!.click();
  } finally {
    URL.createObjectURL = origCreate;
    HTMLAnchorElement.prototype.click = origClick;
  }
  expect(urls).toEqual(['text/plain']);
  expect(clicks).toEqual(['ubicon-setup-code.txt blob:code']);
  expect(card.querySelector('.copied')!.textContent).toBe('Saved as ubicon-setup-code.txt');

  $('success-done').click();
  expect($('wizard').hidden).toBe(true);
  expect($('page').hidden).toBe(false);
});

test('a view-only connection gets no setup code card', async () => {
  onConnect = () => ({ ok: true, connected: { repo: 'tony/ubicon-sync', assignments: 0, readOnly: true } });
  await openStep3();
  type($('token') as HTMLInputElement, TOKEN);
  $('connect').click();
  await flush();
  expect($('success-h').textContent).toBe('Sync is on. No icons yet');
  expect($('success-code').children.length).toBe(0);
  expect($('success-others').hidden).toBe(true);
  expect($('success-view-only').hidden).toBe(false);
  expect(sent.some(m => m.type === 'sync-setup-code')).toBe(false);
});

test('the setup-code path sends repo, token and readOnly, permission first', async () => {
  $('setup-code').click();
  expect(screen()).toBe('code');
  expect($('steps').parentElement!.hidden).toBe(true);
  type($('code') as HTMLInputElement, `  ${encodeSetupCode({ repo: 'tony/ubicon-sync', token: TOKEN, readOnly: true })} `);
  calls.length = 0;
  $('code-connect').click();
  expect(calls).toEqual(['permission']);
  await flush();
  expect(sent.find(m => m.type === 'sync-connect')).toEqual({ type: 'sync-connect', token: TOKEN, repo: 'tony/ubicon-sync', readOnly: true });
  expect([...$('code-checks').querySelectorAll('.label')].at(-1)).toBeUndefined(); // cleared on success
  expect(screen()).toBe('success');
  expect(($('code') as HTMLInputElement).value).toBe('');
});

test('something that is not a setup code gets a friendly error and asks for nothing', async () => {
  $('setup-code').click();
  type($('code') as HTMLInputElement, 'hello there');
  $('code-connect').click();
  await flush();
  expect($('code-note').textContent).toMatch(/does not look like a setup code/);
  type($('code') as HTMLInputElement, TOKEN);
  $('code-connect').click();
  await flush();
  expect($('code-note').textContent).toMatch(/looks like a GitHub token/);
  expect(requestGitHubAccess).not.toHaveBeenCalled();
  expect(sent.some(m => m.type === 'sync-connect')).toBe(false);
});

test('"Create a new token instead" enters the wizard at step 2, and Back returns to the code screen', () => {
  $('setup-code').click();
  within('[data-goto="token"]').click();
  expect(screen()).toBe('token');
  within('[data-back]').click();
  expect(screen()).toBe('code');
});

test('a failed setup code shows the same fix cards and keeps the code in the field', async () => {
  onConnect = () => ({ ok: false, error: 'token-rejected', reason: 'token-rejected' });
  $('setup-code').click();
  const code = encodeSetupCode({ repo: 'tony/ubicon-sync', token: TOKEN, readOnly: false });
  type($('code') as HTMLInputElement, code);
  $('code-connect').click();
  await flush();
  expect($('code-fix').querySelector('.fix h3')!.textContent).toBe('GitHub did not accept this token');
  expect(($('code') as HTMLInputElement).value).toBe(code);
});

test('the token field is a password field with a Show toggle, and nothing autocompletes it', () => {
  const input = $('token') as HTMLInputElement;
  expect(input.type).toBe('password');
  expect(input.getAttribute('autocomplete')).toBe('off');
  expect(input.getAttribute('spellcheck')).toBe('false');
  const toggle = document.querySelector<HTMLElement>('[data-reveal="token"]')!;
  toggle.click();
  expect(input.type).toBe('text');
  expect(toggle.textContent).toBe('Hide');
  toggle.click();
  expect(input.type).toBe('password');
});

test('the fix card names the repo the reply says was tried, not the default', async () => {
  onConnect = () => ({ ok: false, error: 'repo-not-found', reason: 'repo-not-found', repo: 'tony/home-icons' });
  await openStep3();
  type($('token') as HTMLInputElement, TOKEN);
  $('connect').click();
  await flush();
  const card = $('connect-fix').querySelector('.fix')!;
  expect(card.textContent).toContain('cannot see home-icons');
});
