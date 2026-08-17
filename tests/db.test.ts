import { beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { searchDevices, fetchIndex, iconUrlFor } from '../shared/db';
import { setIndexCache } from '../shared/storage';
import type { DbIndex, DeviceRecord } from '../shared/types';

const dev = (over: Partial<DeviceRecord>): DeviceRecord => ({
  id: 'x', name: 'X', vendor: 'V', model: 'M', category: 'other', keywords: [], icon: 'icons/x.png', ...over,
});
const IDX: DbIndex = { schema: 1, generatedAt: 't', count: 2, devices: [
  dev({ id: 'b', name: 'Bambu Lab X1', vendor: 'Bambu Lab', keywords: ['printer'] }),
  dev({ id: 'a', name: 'Acme Lock', vendor: 'Acme', model: 'AL-1' }),
]};

beforeEach(() => { fakeBrowser.reset(); vi.restoreAllMocks(); });

test('empty query returns all sorted by name', () => {
  expect(searchDevices(IDX.devices, '  ').map(d => d.name)).toEqual(['Acme Lock', 'Bambu Lab X1']);
});

test('matches across name, vendor, model, keywords, case-insensitive', () => {
  expect(searchDevices(IDX.devices, 'PRINTER')[0].id).toBe('b');
  expect(searchDevices(IDX.devices, 'al-1')[0].id).toBe('a');
  expect(searchDevices(IDX.devices, 'zzz')).toEqual([]);
});

test('iconUrlFor builds the jsDelivr URL', () => {
  expect(iconUrlFor(dev({ icon: 'icons/a.png' })))
    .toBe('https://cdn.jsdelivr.net/gh/tvirelli/Ubicon-DB@main/icons/a.png');
});

test('fetchIndex uses fresh cache without network', async () => {
  await setIndexCache(IDX);
  global.fetch = vi.fn();
  expect((await fetchIndex()).count).toBe(2);
  expect(fetch).not.toHaveBeenCalled();
});

test('fetchIndex force-fetches, stores cache, falls back to stale on failure', async () => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => IDX });
  const idx = await fetchIndex(true);
  expect(idx.count).toBe(2);
  global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
  expect((await fetchIndex(true)).count).toBe(2); // stale cache served
});
