// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { UbiconMsg, UbiconReply } from '../shared/messages';

const BODY = /<body>([\s\S]*)<\/body>/.exec(readFileSync(resolve(__dirname, '../entrypoints/popup/index.html'), 'utf8'))![1]!
  .replace(/<script[\s\S]*?<\/script>/g, '');

function mountBody() {
  const parsed = new DOMParser().parseFromString(`<!doctype html><html><body>${BODY}</body></html>`, 'text/html');
  document.body.replaceChildren(...[...parsed.body.childNodes].map(n => document.importNode(n, true)));
}
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };

let activeUrl: string | undefined;
let reload: ReturnType<typeof vi.fn>;
let request: ReturnType<typeof vi.fn>;
let register: ReturnType<typeof vi.fn>;

async function openPopup() {
  mountBody();
  vi.resetModules();
  await import('../entrypoints/popup/main');
  await flush();
}

beforeEach(() => {
  fakeBrowser.reset();
  activeUrl = undefined;
  reload = vi.fn().mockResolvedValue(undefined);
  request = vi.fn().mockResolvedValue(true);
  register = vi.fn().mockResolvedValue(undefined);
  (fakeBrowser as any).permissions = { request };
  (fakeBrowser as any).scripting = { registerContentScripts: register, unregisterContentScripts: vi.fn().mockResolvedValue(undefined), getRegisteredContentScripts: vi.fn().mockResolvedValue([]) };
  (fakeBrowser.tabs as any).reload = reload;
  vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation((async () => (activeUrl ? [{ id: 7, url: activeUrl, active: true, windowId: 0, index: 0, highlighted: true, incognito: false, pinned: false }] : [])) as never);
  (fakeBrowser.runtime as unknown as { getManifest: () => { version: string } }).getManifest = () => ({ version: '0.4.0' });
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async (msg: UbiconMsg): Promise<UbiconReply> => {
    if (msg.type === 'sync-status') return { ok: true, status: { mode: 'browser', connected: false, readOnly: false, pending: false }, hint: null };
    return { ok: true };
  }) as never);
});
afterEach(() => vi.restoreAllMocks());

test('on a UniFi console that is not yet enabled, the popup opens with the offer', async () => {
  activeUrl = 'https://10.2.0.1/network/default/clients';
  await openPopup();
  expect($('console-offer').hidden).toBe(false);
  expect($('console-offer-text').textContent).toBe('This is a UniFi console at 10.2.0.1. Turn on Ubicon here?');
});

test('Turn on grants the origin, registers the scripts, reloads the tab and confirms', async () => {
  activeUrl = 'https://10.2.0.1/network/default/clients';
  await openPopup();
  $('console-offer-on').click();
  await flush();
  expect(request).toHaveBeenCalledWith({ origins: ['https://10.2.0.1/*'] });
  expect(register).toHaveBeenCalledTimes(1);
  expect(reload).toHaveBeenCalledWith(7);
  expect((await fakeBrowser.storage.local.get('origins')).origins).toEqual(['https://10.2.0.1']);
  expect($('console-offer-text').textContent).toBe('Ubicon is on for 10.2.0.1. The page is reloading.');
  expect($('console-offer-on').hidden).toBe(true);
});

test('a declined permission is reported in place, nothing stored', async () => {
  activeUrl = 'https://10.2.0.1/network/default/clients';
  request.mockResolvedValue(false);
  await openPopup();
  $('console-offer-on').click();
  await flush();
  expect($('console-offer-text').textContent).toContain('declined');
  expect((await fakeBrowser.storage.local.get('origins')).origins).toBeUndefined();
});

test('an ordinary website gets no offer', async () => {
  activeUrl = 'https://www.google.com/';
  await openPopup();
  expect($('console-offer').hidden).toBe(true);
});

test('a console that is already enabled gets no offer', async () => {
  activeUrl = 'https://10.2.0.1/network/default/clients';
  await fakeBrowser.storage.local.set({ origins: ['https://10.2.0.1'] });
  await openPopup();
  expect($('console-offer').hidden).toBe(true);
});

test('a possible console, such as a login page on a private address, gets the softer offer', async () => {
  activeUrl = 'https://10.2.0.1/';
  await openPopup();
  expect($('console-offer').hidden).toBe(false);
  expect($('console-offer-text').textContent).toContain('Is 10.2.0.1 a UniFi console?');
});

test('Not now hides the offer for that origin until it is enabled some other way', async () => {
  activeUrl = 'https://10.2.0.1/network/default/clients';
  await openPopup();
  $('console-offer-later').click();
  await flush();
  expect($('console-offer').hidden).toBe(true);
  await openPopup();
  expect($('console-offer').hidden).toBe(true);
});
