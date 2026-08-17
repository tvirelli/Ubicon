import { beforeEach, expect, test } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { setAssignment, cacheIcon, exportAll, importAll, getAssignment, getCachedIcon } from '../shared/storage';

beforeEach(() => fakeBrowser.reset());

test('export/import round-trip includes custom icon images', async () => {
  await setAssignment('m1', { kind: 'db', deviceId: 'dev1' });
  await setAssignment('m2', { kind: 'custom', customId: 'c1', label: 'Silly' });
  await cacheIcon('custom:c1', 'data:image/png;base64,CUSTOM');
  await cacheIcon('db:dev1', 'data:image/png;base64,DB'); // must NOT be exported (re-derivable)
  const file = await exportAll();
  expect(file.format).toBe('ubicon-backup');
  expect(file.customIcons['c1']).toBe('data:image/png;base64,CUSTOM');
  expect(file.customIcons['dev1']).toBeUndefined();

  fakeBrowser.reset();
  const counts = await importAll(file);
  expect(counts).toEqual({ assignments: 2, customIcons: 1 });
  expect(await getAssignment('m2')).toEqual({ kind: 'custom', customId: 'c1', label: 'Silly' });
  expect(await getCachedIcon('custom:c1')).toBe('data:image/png;base64,CUSTOM');
});
