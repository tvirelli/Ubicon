import { beforeEach, expect, test } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { setAssignment, cacheIcon, exportAll, importAll, getAssignment, getCachedIcon } from '../shared/storage';

beforeEach(() => fakeBrowser.reset());

// MAC-shaped: importAll now validates assignment keys against the MAC shape
// (see the invalid-entries test below), so placeholder ids like the old
// 'm1'/'m2' would be silently skipped rather than round-tripped.
const MAC1 = 'd4:3d:39:80:fc:80';
const MAC2 = 'aa:bb:cc:dd:ee:ff';

test('export/import round-trip includes custom icon images', async () => {
  await setAssignment(MAC1, { kind: 'db', deviceId: 'dev1' });
  await setAssignment(MAC2, { kind: 'custom', customId: 'c1', label: 'Silly' });
  await cacheIcon('custom:c1', 'data:image/png;base64,CUSTOM');
  await cacheIcon('db:dev1', 'data:image/png;base64,DB'); // must NOT be exported (re-derivable)
  const file = await exportAll();
  expect(file.format).toBe('ubicon-backup');
  expect(file.customIcons['c1']).toBe('data:image/png;base64,CUSTOM');
  expect(file.customIcons['dev1']).toBeUndefined();

  fakeBrowser.reset();
  const counts = await importAll(file);
  expect(counts).toEqual({ assignments: 2, customIcons: 1 });
  expect(await getAssignment(MAC2)).toEqual({ kind: 'custom', customId: 'c1', label: 'Silly' });
  expect(await getCachedIcon('custom:c1')).toBe('data:image/png;base64,CUSTOM');
});

test('importAll skips invalid entries and counts only the valid ones', async () => {
  const file = {
    format: 'ubicon-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    assignments: {
      // valid
      'd4:3d:39:80:fc:80': { kind: 'db', deviceId: 'dev1' },
      // key isn't MAC-shaped
      'not-a-mac': { kind: 'db', deviceId: 'dev2' },
      // value isn't a valid AssignmentRef shape
      'aa:bb:cc:dd:ee:ff': { kind: 'db' },
      // unknown kind
      'bb:bb:bb:bb:bb:bb': { kind: 'bogus', foo: 'bar' },
    },
    customIcons: {
      // valid
      c1: 'data:image/png;base64,CUSTOM',
      // not a data: URI at all
      c2: 'not-a-data-uri',
      // not even a string
      c3: 12345,
    },
  } as unknown as Parameters<typeof importAll>[0];

  const counts = await importAll(file);

  expect(counts).toEqual({ assignments: 1, customIcons: 1 });
  expect(await getAssignment('d4:3d:39:80:fc:80')).toEqual({ kind: 'db', deviceId: 'dev1' });
  expect(await getAssignment('not-a-mac')).toBeNull();
  expect(await getAssignment('aa:bb:cc:dd:ee:ff')).toBeNull();
  expect(await getAssignment('bb:bb:bb:bb:bb:bb')).toBeNull();
  expect(await getCachedIcon('custom:c1')).toBe('data:image/png;base64,CUSTOM');
  expect(await getCachedIcon('custom:c2')).toBeNull();
  expect(await getCachedIcon('custom:c3')).toBeNull();
});
