import { beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addConsoleOrigin, listConsoleOrigins, removeConsoleOrigin } from '../shared/consoles';

beforeEach(() => { fakeBrowser.reset(); });

// wxt/testing/fake-browser exposes `browser.scripting.*`/`browser.permissions.*`
// methods, but they throw MockNotImplementedError when called (no in-memory
// fake exists for these namespaces) — so per-test the API is stubbed with
// vi.fn() rather than relying on fakeBrowser's own implementation.
function stubScripting(registered: Array<{ id: string }>) {
  const registerContentScripts = vi.fn().mockResolvedValue(undefined);
  const unregisterContentScripts = vi.fn().mockResolvedValue(undefined);
  (fakeBrowser as any).scripting = {
    getRegisteredContentScripts: vi.fn().mockResolvedValue(registered),
    registerContentScripts,
    unregisterContentScripts,
  };
  return { registerContentScripts, unregisterContentScripts };
}

function stubPermissions(granted: boolean) {
  const request = vi.fn().mockResolvedValue(granted);
  (fakeBrowser as any).permissions = { request };
  return request;
}

test('addConsoleOrigin returns invalid for an undefined url', async () => {
  expect(await addConsoleOrigin(undefined)).toBe('invalid');
});

test('addConsoleOrigin returns invalid for a non-http(s) url', async () => {
  expect(await addConsoleOrigin('chrome://extensions')).toBe('invalid');
});

test('addConsoleOrigin returns already for unifi.ui.com', async () => {
  expect(await addConsoleOrigin('https://unifi.ui.com/network/default/clients')).toBe('already');
});

test('addConsoleOrigin returns already for an origin already stored', async () => {
  await fakeBrowser.storage.local.set({ origins: ['https://10.71.0.1'] });
  expect(await addConsoleOrigin('https://10.71.0.1/network/default')).toBe('already');
});

test('addConsoleOrigin returns denied and registers nothing when permission is refused', async () => {
  const request = stubPermissions(false);
  const { registerContentScripts } = stubScripting([]);

  const result = await addConsoleOrigin('https://10.71.0.5/network/default');

  expect(result).toBe('denied');
  expect(request).toHaveBeenCalledWith({ origins: ['https://10.71.0.5/*'] });
  expect(registerContentScripts).not.toHaveBeenCalled();
  const { origins = [] } = (await fakeBrowser.storage.local.get('origins')) as { origins?: string[] };
  expect(origins).toEqual([]);
});

test('addConsoleOrigin registers both content scripts and appends the origin when granted', async () => {
  stubPermissions(true);
  const { registerContentScripts } = stubScripting([]);

  const result = await addConsoleOrigin('https://10.71.0.9/network/default');

  expect(result).toBe('added');
  expect(registerContentScripts).toHaveBeenCalledWith([
    expect.objectContaining({ id: 'ubicon-10.71.0.9', matches: ['https://10.71.0.9/*'] }),
    expect.objectContaining({ id: 'ubicon-bridge-10.71.0.9', world: 'MAIN' }),
  ]);
  const { origins = [] } = (await fakeBrowser.storage.local.get('origins')) as { origins?: string[] };
  expect(origins).toEqual(['https://10.71.0.9']);
});

test('listConsoleOrigins returns an empty array when nothing is stored', async () => {
  expect(await listConsoleOrigins()).toEqual([]);
});

test('listConsoleOrigins returns the stored origins', async () => {
  await fakeBrowser.storage.local.set({ origins: ['https://10.71.0.1', 'https://10.71.0.2'] });
  expect(await listConsoleOrigins()).toEqual(['https://10.71.0.1', 'https://10.71.0.2']);
});

test('addConsoleOrigin derives script ids from host (hostname+port), sanitizing the colon', async () => {
  // Two controllers on the same hostname but different ports are distinct
  // origins and must get distinct, non-colliding script ids.
  stubPermissions(true);
  const { registerContentScripts } = stubScripting([]);

  const result = await addConsoleOrigin('https://10.71.0.9:8443/network/default');

  expect(result).toBe('added');
  expect(registerContentScripts).toHaveBeenCalledWith([
    expect.objectContaining({ id: 'ubicon-10.71.0.9-8443', matches: ['https://10.71.0.9:8443/*'] }),
    expect.objectContaining({ id: 'ubicon-bridge-10.71.0.9-8443', world: 'MAIN' }),
  ]);
});

test('removeConsoleOrigin unregisters both content script ids and drops the origin from storage', async () => {
  const { unregisterContentScripts } = stubScripting([]);
  await fakeBrowser.storage.local.set({ origins: ['https://10.71.0.1', 'https://10.71.0.2'] });

  await removeConsoleOrigin('https://10.71.0.1');

  expect(unregisterContentScripts).toHaveBeenCalledWith({ ids: ['ubicon-10.71.0.1', 'ubicon-bridge-10.71.0.1'] });
  expect(await listConsoleOrigins()).toEqual(['https://10.71.0.2']);
});

test('removeConsoleOrigin derives ids from the origin (including port) when unregistering', async () => {
  const { unregisterContentScripts } = stubScripting([]);
  await fakeBrowser.storage.local.set({ origins: ['https://10.71.0.1:8443'] });

  await removeConsoleOrigin('https://10.71.0.1:8443');

  expect(unregisterContentScripts).toHaveBeenCalledWith({ ids: ['ubicon-10.71.0.1-8443', 'ubicon-bridge-10.71.0.1-8443'] });
  expect(await listConsoleOrigins()).toEqual([]);
});

test('removeConsoleOrigin tolerates an unregister failure and still drops the origin from storage', async () => {
  const unregisterContentScripts = vi.fn().mockRejectedValue(new Error('not registered'));
  (fakeBrowser as any).scripting = { unregisterContentScripts };
  await fakeBrowser.storage.local.set({ origins: ['https://10.71.0.1'] });

  await expect(removeConsoleOrigin('https://10.71.0.1')).resolves.toBeUndefined();

  expect(await listConsoleOrigins()).toEqual([]);
});
