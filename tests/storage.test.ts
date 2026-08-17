import { beforeEach, expect, test } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  getAssignment, getAllAssignments, setAssignment, removeAssignment,
  iconKey, cacheIcon, getCachedIcon,
} from '../shared/storage';

const MAC = 'd4:3d:39:80:fc:80';

beforeEach(() => fakeBrowser.reset());

test('assignment round-trip (db ref)', async () => {
  await setAssignment(MAC, { kind: 'db', deviceId: 'lockly-smart-lock' });
  expect(await getAssignment(MAC)).toEqual({ kind: 'db', deviceId: 'lockly-smart-lock' });
});

test('assignment round-trip (custom ref) and removal', async () => {
  await setAssignment(MAC, { kind: 'custom', customId: 'u1', label: 'Goofy Lock' });
  expect(await getAssignment(MAC)).toEqual({ kind: 'custom', customId: 'u1', label: 'Goofy Lock' });
  await removeAssignment(MAC);
  expect(await getAssignment(MAC)).toBeNull();
});

test('sync storage stays compact (quota)', async () => {
  await setAssignment(MAC, { kind: 'db', deviceId: 'lockly-smart-lock' });
  const raw = await fakeBrowser.storage.sync.get(`a:${MAC}`);
  expect(JSON.stringify(raw[`a:${MAC}`]).length).toBeLessThan(60);
});

test('getAllAssignments returns map keyed by mac', async () => {
  await setAssignment(MAC, { kind: 'db', deviceId: 'x' });
  await setAssignment('aa:bb:cc:dd:ee:ff', { kind: 'db', deviceId: 'y' });
  expect(Object.keys(await getAllAssignments()).sort()).toEqual(['aa:bb:cc:dd:ee:ff', MAC].sort());
});

test('icon cache round-trip and key shape', async () => {
  const ref = { kind: 'db', deviceId: 'z' } as const;
  expect(iconKey(ref)).toBe('db:z');
  await cacheIcon('db:z', 'data:image/png;base64,AAAA');
  expect(await getCachedIcon('db:z')).toBe('data:image/png;base64,AAAA');
  expect(await getCachedIcon('db:missing')).toBeNull();
});
