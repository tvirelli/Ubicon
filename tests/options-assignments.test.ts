// @vitest-environment happy-dom
// The Assignments tab on the settings page: every assigned device, sorted
// by name, searchable, with the same two-click remove the popup used to
// have. Icons stream in after the rows are on the page.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { UbiconMsg, UbiconReply } from '../shared/messages';
import type { SyncStatus } from '../shared/sync/engine';
import { cacheIcon, setAssignment, setIndexCache } from '../shared/storage';

const HTML = readFileSync(resolve(__dirname, '../entrypoints/options/index.html'), 'utf8');
const BODY = /<body>([\s\S]*)<\/body>/.exec(HTML)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');

function mountBody() {
  const parsed = new DOMParser().parseFromString(`<!doctype html><html><body>${BODY}</body></html>`, 'text/html');
  document.body.replaceChildren(...[...parsed.body.childNodes].map(n => document.importNode(n, true)));
}
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0)); };
const rows = () => [...document.querySelectorAll<HTMLElement>('#assign-list .row')];
const names = () => rows().filter(r => !r.hidden).map(r => r.querySelector('.name')!.textContent);

let status: SyncStatus;
let sent: UbiconMsg[];

async function openAssignments() {
  mountBody();
  vi.resetModules();
  const { initAssignmentsUi } = await import('../entrypoints/options/assignments');
  await initAssignmentsUi();
  await flush();
}

beforeEach(() => {
  fakeBrowser.reset();
  sent = [];
  status = { mode: 'browser', connected: false, readOnly: false, pending: false };
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async (msg: UbiconMsg): Promise<UbiconReply> => {
    sent.push(msg);
    if (msg.type === 'sync-status') return { ok: true, status, hint: null };
    return { ok: true };
  }) as never);
});
afterEach(() => vi.restoreAllMocks());

test('with nothing assigned the tab says so', async () => {
  await openAssignments();
  expect(rows().length).toBe(0);
  expect($('assign-empty').hidden).toBe(false);
  expect($('assign-empty').textContent).toMatch(/^No devices assigned yet\./);
});

test('assignments are listed by name, not by MAC, with the database name when the index is cached', async () => {
  await setIndexCache({ schema: 1, generatedAt: '2026-09-25', count: 1, devices: [
    { id: 'sonos-one', name: 'Sonos One', category: 'speaker', keywords: [], icon: 'sonos-one.png' },
  ] });
  await setAssignment('00:00:00:00:00:01', { kind: 'db', deviceId: 'sonos-one' });
  await setAssignment('00:00:00:00:00:02', { kind: 'custom', customId: 'c1', label: 'Garage door' });
  await setAssignment('00:00:00:00:00:03', { kind: 'db', deviceId: 'bambu-lab-h2d' });
  await openAssignments();
  expect($('assign-empty').hidden).toBe(true);
  expect(names()).toEqual(['bambu-lab-h2d', 'Garage door', 'Sonos One']);
  expect(rows()[2]!.querySelector('.mac')!.textContent).toBe('00:00:00:00:00:01');
});

test('the count line says how many devices are assigned', async () => {
  await setAssignment('00:00:00:00:00:01', { kind: 'db', deviceId: 'sonos-one' });
  await setAssignment('00:00:00:00:00:02', { kind: 'db', deviceId: 'bambu-lab-h2d' });
  await openAssignments();
  expect($('assign-count').textContent).toBe('2 devices assigned');
});

test('typing in the search box filters by name, MAC or label, ignoring case', async () => {
  await setAssignment('aa:bb:cc:dd:ee:01', { kind: 'db', deviceId: 'sonos-one' });
  await setAssignment('aa:bb:cc:dd:ee:02', { kind: 'custom', customId: 'c1', label: 'Garage door' });
  await setAssignment('11:22:33:44:55:66', { kind: 'db', deviceId: 'bambu-lab-h2d' });
  await openAssignments();
  const search = $<HTMLInputElement>('assign-search');
  const type = (v: string) => { search.value = v; search.dispatchEvent(new Event('input', { bubbles: true })); };
  type('GARAGE');
  expect(names()).toEqual(['Garage door']);
  type('aa:bb');
  expect(names()).toEqual(['Garage door', 'sonos-one']);
  type('bambu');
  expect(names()).toEqual(['bambu-lab-h2d']);
  type('zzz');
  expect(names()).toEqual([]);
  expect($('assign-none').hidden).toBe(false);
  type('');
  expect(names().length).toBe(3);
  expect($('assign-none').hidden).toBe(true);
});

test('a cached icon shows on its row and a missing one falls back to the Ubicon mark', async () => {
  await setAssignment('00:00:00:00:00:01', { kind: 'db', deviceId: 'sonos-one' });
  await setAssignment('00:00:00:00:00:02', { kind: 'custom', customId: 'c1', label: 'Garage door' });
  await cacheIcon('db:sonos-one', 'data:image/png;base64,AAAA');
  await openAssignments();
  const imgs = rows().map(r => r.querySelector('img')!.getAttribute('src'));
  expect(imgs).toEqual(['/icon/32.png', 'data:image/png;base64,AAAA']);
  expect(rows()[0]!.querySelector('.badge')!.textContent).toBe('custom · icon missing here');
  expect(rows()[1]!.querySelector('.badge')!.textContent).toBe('community');
});

test('remove takes two clicks and goes through the background worker', async () => {
  await setAssignment('aa:bb:cc:dd:ee:ff', { kind: 'db', deviceId: 'sonos-one' });
  await openAssignments();
  const remove = rows()[0]!.querySelector('button')!;
  remove.click();
  expect(remove.textContent).toBe('Remove?');
  expect(sent.filter(m => m.type === 'unassign')).toEqual([]);
  remove.click();
  await flush();
  expect(sent).toContainEqual({ type: 'unassign', mac: 'aa:bb:cc:dd:ee:ff' });
});

test('a view-only connection disables remove', async () => {
  await fakeBrowser.storage.local.set({ 'sync:mode': 'github', assignments: { 'aa:bb:cc:dd:ee:ff': { ref: { kind: 'db', deviceId: 'sonos-one' }, t: 1 } } });
  status = { mode: 'github', connected: true, readOnly: true, pending: false, repo: 'tony/ubicon-sync' } as SyncStatus;
  await openAssignments();
  const remove = rows()[0]!.querySelector('button')!;
  expect(remove.disabled).toBe(true);
});

test('an assignment that arrives while the tab is open appears in the list', async () => {
  await openAssignments();
  expect(rows().length).toBe(0);
  await setAssignment('aa:bb:cc:dd:ee:01', { kind: 'db', deviceId: 'bambu-lab-h2d' });
  await new Promise(r => setTimeout(r, 350));
  await flush();
  expect(rows().length).toBe(1);
  expect($('assign-count').textContent).toBe('1 device assigned');
});
