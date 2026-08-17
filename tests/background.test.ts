import { beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleMessage, hydrateMissingIcons } from '../entrypoints/background';
import { setIndexCache, getAssignment, getCachedIcon, setAssignment } from '../shared/storage';
import type { DbIndex } from '../shared/types';

const IDX: DbIndex = { schema: 1, generatedAt: 't', count: 1, devices: [
  { id: 'lockly-smart-lock', name: 'Lockly Smart Lock', vendor: 'Lockly', model: 'PGD728F', category: 'smart_lock', keywords: [], icon: 'icons/lockly-smart-lock.png' },
]};
const PNG_BYTES = new Uint8Array([137, 80, 78, 71]);

beforeEach(async () => {
  fakeBrowser.reset();
  await setIndexCache(IDX);
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    blob: async () => new Blob([PNG_BYTES], { type: 'image/png' }),
    json: async () => IDX,
  });
});

test('assign-db fetches icon, caches it, writes assignment', async () => {
  const reply = await handleMessage({ type: 'assign-db', mac: 'm1', deviceId: 'lockly-smart-lock' });
  expect(reply.ok).toBe(true);
  expect((reply as any).dataUri).toMatch(/^data:image\/png;base64,/);
  expect(await getAssignment('m1')).toEqual({ kind: 'db', deviceId: 'lockly-smart-lock' });
  expect(await getCachedIcon('db:lockly-smart-lock')).toBe((reply as any).dataUri);
});

test('assign-db for unknown device errors without writing', async () => {
  const reply = await handleMessage({ type: 'assign-db', mac: 'm1', deviceId: 'nope' });
  expect(reply.ok).toBe(false);
  expect(await getAssignment('m1')).toBeNull();
});

test('assign-custom stores icon and assignment; unassign removes', async () => {
  const r = await handleMessage({ type: 'assign-custom', mac: 'm2', dataUri: 'data:image/png;base64,Q', label: 'Silly' });
  expect(r.ok).toBe(true);
  const a = await getAssignment('m2');
  expect(a?.kind).toBe('custom');
  await handleMessage({ type: 'unassign', mac: 'm2' });
  expect(await getAssignment('m2')).toBeNull();
});

test('search returns full list on empty query', async () => {
  const r = await handleMessage({ type: 'search', query: '' });
  expect((r as any).results.length).toBe(1);
});

test('hydrateMissingIcons downloads icons for synced db assignments', async () => {
  await setAssignment('m3', { kind: 'db', deviceId: 'lockly-smart-lock' });
  const n = await hydrateMissingIcons();
  expect(n).toBe(1);
  expect(await getCachedIcon('db:lockly-smart-lock')).toMatch(/^data:/);
});
