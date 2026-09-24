// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { UbiconMsg, UbiconReply } from '../shared/messages';
import { saveBreak } from '../shared/layout-state';

const BODY = /<body>([\s\S]*)<\/body>/.exec(readFileSync(resolve(__dirname, '../entrypoints/popup/index.html'), 'utf8'))![1]!
  .replace(/<script[\s\S]*?<\/script>/g, '');

function mountBody() {
  const parsed = new DOMParser().parseFromString(`<!doctype html><html><body>${BODY}</body></html>`, 'text/html');
  document.body.replaceChildren(...[...parsed.body.childNodes].map(n => document.importNode(n, true)));
}
const titleOf = (href: string) => new URL(href).searchParams.get('title') ?? '';
const bodyOf = (href: string) => new URL(href).searchParams.get('body') ?? '';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };

async function openPopup() {
  mountBody();
  vi.resetModules();
  await import('../entrypoints/popup/main');
  await flush();
}

beforeEach(() => {
  fakeBrowser.reset();
  (fakeBrowser.runtime as unknown as { getManifest: () => { version: string } }).getManifest = () => ({ version: '0.4.0' });
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async (msg: UbiconMsg): Promise<UbiconReply> => {
    if (msg.type === 'sync-status') return { ok: true, status: { mode: 'browser', connected: false, readOnly: false, pending: false }, hint: null };
    return { ok: true };
  }) as never);
});
afterEach(() => vi.restoreAllMocks());

test('the popup hides the layout notice when nothing is wrong', async () => {
  await openPopup();
  expect($('layout-warning').hidden).toBe(true);
});

test('the popup shows the layout notice with report links when a break is stored', async () => {
  await saveBreak({ signature: 'header', hooks: ['header'], unifiVersion: 'unknown', console: 'local', path: '/network', firstSeen: 1, lastSeen: 2 });
  await openPopup();
  expect($('layout-warning').hidden).toBe(false);
  expect($('layout-warning').textContent).toContain("UniFi's layout changed");
  expect(titleOf($<HTMLAnchorElement>('layout-issue').href)).toBe('Layout change detected: UniFi unknown, header');
  expect($<HTMLAnchorElement>('layout-issue').target).toBe('_blank');
  expect($<HTMLAnchorElement>('layout-mail').href).toContain('mailto:info@ubiconapp.com');
});
