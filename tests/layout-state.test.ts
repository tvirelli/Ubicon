import { beforeEach, expect, test } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { clearBreak, dismissBreak, loadBreak, saveBreak, visibleBreak, type LayoutBreak } from '../shared/layout-state';

beforeEach(() => fakeBrowser.reset());

const brk: LayoutBreak = {
  signature: 'clients-table', hooks: ['clients-table'], unifiVersion: '9.3.45',
  console: 'cloud', path: '/network/default/clients', firstSeen: 1000, lastSeen: 2000,
};

test('a saved break can be read back', async () => {
  await saveBreak(brk);
  expect(await loadBreak()).toEqual(brk);
});

test('there is no break by default', async () => {
  expect(await loadBreak()).toBeNull();
  expect(await visibleBreak()).toBeNull();
});

test('dismissing hides the break until its signature changes', async () => {
  await saveBreak(brk);
  await dismissBreak(brk.signature);
  expect(await visibleBreak()).toBeNull();
  await saveBreak({ ...brk, signature: 'header+clients-table', hooks: ['header', 'clients-table'] });
  expect((await visibleBreak())?.signature).toBe('header+clients-table');
});

test('saving the same signature again keeps firstSeen and updates lastSeen', async () => {
  await saveBreak(brk);
  await saveBreak({ ...brk, firstSeen: 5000, lastSeen: 9000 });
  const b = await loadBreak();
  expect(b?.firstSeen).toBe(1000);
  expect(b?.lastSeen).toBe(9000);
});

test('clearing removes the break and forgets the dismissal', async () => {
  await saveBreak(brk);
  await dismissBreak(brk.signature);
  await clearBreak();
  expect(await loadBreak()).toBeNull();
  await saveBreak(brk);
  expect((await visibleBreak())?.signature).toBe('clients-table');
});

test('the UniFi version seen on the dashboard is remembered per console for pages that do not show it', async () => {
  const { recallUnifiVersion, rememberUnifiVersion } = await import('../shared/layout-state');
  expect(await recallUnifiVersion('https://unifi.ui.com')).toBe('unknown');
  await rememberUnifiVersion('https://unifi.ui.com', '10.6.106');
  await rememberUnifiVersion('https://192.168.1.1', '9.3.45');
  expect(await recallUnifiVersion('https://unifi.ui.com')).toBe('10.6.106');
  expect(await recallUnifiVersion('https://192.168.1.1')).toBe('9.3.45');
});
