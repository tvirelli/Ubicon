import { beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleMessage, hydrateMissingIcons, ensureRegisteredOrigins } from '../entrypoints/background';
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

// wxt/testing/fake-browser exposes `browser.scripting.*` methods, but they
// throw MockNotImplementedError when called (no in-memory fake exists for
// this namespace) — so per-test the API is stubbed with vi.fn() rather than
// relying on fakeBrowser's own implementation.
function stubScripting(registered: Array<{ id: string }>) {
  const registerContentScripts = vi.fn().mockResolvedValue(undefined);
  (fakeBrowser as any).scripting = {
    getRegisteredContentScripts: vi.fn().mockResolvedValue(registered),
    registerContentScripts,
  };
  return registerContentScripts;
}

test('ensureRegisteredOrigins re-registers every stored origin when nothing is currently registered', async () => {
  const registerContentScripts = stubScripting([]);
  await fakeBrowser.storage.local.set({ origins: ['https://10.71.0.1', 'https://10.71.0.2'] });
  const n = await ensureRegisteredOrigins();
  expect(n).toBe(2);
  expect(registerContentScripts).toHaveBeenCalledTimes(2);
  expect(registerContentScripts).toHaveBeenCalledWith([
    expect.objectContaining({ id: 'ubicon-10.71.0.1', matches: ['https://10.71.0.1/*'] }),
    expect.objectContaining({ id: 'ubicon-bridge-10.71.0.1', matches: ['https://10.71.0.1/*'], world: 'MAIN' }),
  ]);
  expect(registerContentScripts).toHaveBeenCalledWith([
    expect.objectContaining({ id: 'ubicon-10.71.0.2', matches: ['https://10.71.0.2/*'] }),
    expect.objectContaining({ id: 'ubicon-bridge-10.71.0.2', matches: ['https://10.71.0.2/*'], world: 'MAIN' }),
  ]);
});

test('ensureRegisteredOrigins backfills only the missing bridge script when an origin is partially registered', async () => {
  // 10.71.0.1 already has its primary (painter) script registered, but not
  // the bridge — e.g. it was registered by a pre-bridge build. Each id is
  // checked independently, so only the missing bridge script should be
  // registered for it; 10.71.0.2 has neither yet, so both are registered.
  const registerContentScripts = stubScripting([{ id: 'ubicon-10.71.0.1' }]);
  await fakeBrowser.storage.local.set({ origins: ['https://10.71.0.1', 'https://10.71.0.2'] });
  const n = await ensureRegisteredOrigins();
  expect(n).toBe(2);
  expect(registerContentScripts).toHaveBeenCalledTimes(2);
  expect(registerContentScripts).toHaveBeenCalledWith([
    expect.objectContaining({ id: 'ubicon-bridge-10.71.0.1', world: 'MAIN' }),
  ]);
  expect(registerContentScripts).toHaveBeenCalledWith([
    expect.objectContaining({ id: 'ubicon-10.71.0.2' }),
    expect.objectContaining({ id: 'ubicon-bridge-10.71.0.2' }),
  ]);
});

test('ensureRegisteredOrigins skips an origin whose scripts are both already registered', async () => {
  const registerContentScripts = stubScripting([
    { id: 'ubicon-10.71.0.1' }, { id: 'ubicon-bridge-10.71.0.1' },
  ]);
  await fakeBrowser.storage.local.set({ origins: ['https://10.71.0.1'] });
  const n = await ensureRegisteredOrigins();
  expect(n).toBe(0);
  expect(registerContentScripts).not.toHaveBeenCalled();
});

test('ensureRegisteredOrigins skips a malformed stored origin without aborting the backfill for the rest', async () => {
  // registrationsForOrigin parses each origin with `new URL(...)`, which
  // throws synchronously for a malformed value — that must not abort the
  // whole loop and strand every other (valid) stored origin unregistered.
  const registerContentScripts = stubScripting([]);
  await fakeBrowser.storage.local.set({ origins: ['not a url', 'https://10.71.0.2'] });
  const n = await ensureRegisteredOrigins();
  expect(n).toBe(1);
  expect(registerContentScripts).toHaveBeenCalledTimes(1);
  expect(registerContentScripts).toHaveBeenCalledWith([
    expect.objectContaining({ id: 'ubicon-10.71.0.2' }),
    expect.objectContaining({ id: 'ubicon-bridge-10.71.0.2' }),
  ]);
});

test('ensureRegisteredOrigins derives ids from host (hostname+port) for a stored origin with a port', async () => {
  const registerContentScripts = stubScripting([]);
  await fakeBrowser.storage.local.set({ origins: ['https://10.71.0.5:8443'] });
  const n = await ensureRegisteredOrigins();
  expect(n).toBe(1);
  expect(registerContentScripts).toHaveBeenCalledWith([
    expect.objectContaining({ id: 'ubicon-10.71.0.5-8443', matches: ['https://10.71.0.5:8443/*'] }),
    expect.objectContaining({ id: 'ubicon-bridge-10.71.0.5-8443', world: 'MAIN' }),
  ]);
});
