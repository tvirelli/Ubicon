// @vitest-environment happy-dom
// The popup keeps up with changes that happen while it is open: a sync in
// the background changing assignments, or the heads-up marker arriving.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { UbiconMsg, UbiconReply } from '../shared/messages';
import type { SyncHint } from '../shared/sync/hint';
import { setAssignment } from '../shared/storage';

const BODY = /<body>([\s\S]*)<\/body>/.exec(readFileSync(resolve(__dirname, '../entrypoints/popup/index.html'), 'utf8'))![1]!
  .replace(/<script[\s\S]*?<\/script>/g, '');

function mountBody() {
  const parsed = new DOMParser().parseFromString(`<!doctype html><html><body>${BODY}</body></html>`, 'text/html');
  document.body.replaceChildren(...[...parsed.body.childNodes].map(n => document.importNode(n, true)));
}
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0)); };

let hint: SyncHint | null;

async function openPopup() {
  mountBody();
  vi.resetModules();
  await import('../entrypoints/popup/main');
  await flush();
}

beforeEach(() => {
  fakeBrowser.reset();
  hint = null;
  (fakeBrowser.runtime as unknown as { getManifest: () => { version: string } }).getManifest = () => ({ version: '0.4.0' });
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async (msg: UbiconMsg): Promise<UbiconReply> => {
    if (msg.type === 'sync-status') return { ok: true, status: { mode: 'browser', connected: false, readOnly: false, pending: false }, hint };
    return { ok: true };
  }) as never);
});
afterEach(() => vi.restoreAllMocks());

test('an assignment that arrives while the popup is open appears in the list', async () => {
  await openPopup();
  expect($('list').querySelector('.row')).toBeNull();
  await setAssignment('aa:bb:cc:dd:ee:01', { kind: 'db', deviceId: 'bambu-lab-h2d' });
  // The popup collapses a burst of storage changes into one redraw.
  await new Promise(r => setTimeout(r, 350));
  await flush();
  expect($('list').querySelector('.row')).not.toBeNull();
});

test('the heads-up marker arriving while the popup is open shows the notice', async () => {
  await openPopup();
  expect($('hint').hidden).toBe(true);
  hint = { v: 1, repo: 'tony/ubicon-sync', at: 1790000000000, by: 'Firefox on Linux' };
  await fakeBrowser.storage.sync.set({ 'sync:hint': hint });
  await flush();
  expect($('hint').hidden).toBe(false);
  expect($('hint-text').textContent).toContain('Firefox on Linux');
});
