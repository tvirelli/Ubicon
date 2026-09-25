// @vitest-environment happy-dom
// The popup no longer lists devices. It says how many are assigned, offers
// a Manage Assignments button that opens the settings page on the
// Assignments tab, and shows the version in the footer.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { UbiconMsg, UbiconReply } from '../shared/messages';
import { setAssignment } from '../shared/storage';

const BODY = /<body>([\s\S]*)<\/body>/.exec(readFileSync(resolve(__dirname, '../entrypoints/popup/index.html'), 'utf8'))![1]!
  .replace(/<script[\s\S]*?<\/script>/g, '');

function mountBody() {
  const parsed = new DOMParser().parseFromString(`<!doctype html><html><body>${BODY}</body></html>`, 'text/html');
  document.body.replaceChildren(...[...parsed.body.childNodes].map(n => document.importNode(n, true)));
}
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0)); };

let created: string[];

async function openPopup() {
  mountBody();
  vi.resetModules();
  await import('../entrypoints/popup/main');
  await flush();
}

beforeEach(() => {
  fakeBrowser.reset();
  created = [];
  (fakeBrowser.runtime as unknown as { getManifest: () => { version: string } }).getManifest = () => ({ version: '0.5.0' });
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async (msg: UbiconMsg): Promise<UbiconReply> => {
    if (msg.type === 'sync-status') return { ok: true, status: { mode: 'browser', connected: false, readOnly: false, pending: false }, hint: null };
    return { ok: true };
  }) as never);
  vi.spyOn(fakeBrowser.tabs, 'create').mockImplementation((async (props: { url?: string }) => {
    created.push(props.url ?? '');
    return { id: 1 };
  }) as never);
});
afterEach(() => vi.restoreAllMocks());

test('with nothing assigned the popup says so and still offers Manage Assignments', async () => {
  await openPopup();
  expect($('count').textContent).toMatch(/^No devices assigned yet\./);
  expect(document.querySelector('#list')).toBeNull();
  expect($('manage').hidden).toBe(false);
});

test('the popup counts the assigned devices', async () => {
  await setAssignment('00:00:00:00:00:01', { kind: 'db', deviceId: 'sonos-one' });
  await openPopup();
  expect($('count').textContent).toBe('1 device assigned');
  for (let i = 2; i <= 37; i++) await setAssignment(`00:00:00:00:00:${String(i).padStart(2, '0')}`, { kind: 'db', deviceId: 'sonos-one' });
  await new Promise(r => setTimeout(r, 350));
  await flush();
  expect($('count').textContent).toBe('37 devices assigned');
});

test('Manage Assignments opens the settings page on the Assignments tab', async () => {
  await openPopup();
  $('manage').click();
  await flush();
  expect(created.length).toBe(1);
  expect(created[0]!.endsWith('/options.html#assignments')).toBe(true);
});

test('the footer shows the version from the manifest', async () => {
  await openPopup();
  expect($('version').textContent).toBe('v0.5.0');
});
