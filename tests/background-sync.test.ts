import { beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleMessage, onAssignmentsChanged } from '../entrypoints/background';
import { getSyncMode, migrateToLocal, setAssignment } from '../shared/storage';
import { writeHint } from '../shared/sync/hint';
import { decodeSetupCode } from '../shared/sync/setup-code';

const TOKEN = 'github_pat_BACKGROUNDTEST';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  fakeBrowser.reset();
  vi.useRealTimers();
});

test('sync-status on a browser that was never connected: plain v0.1.1 state, no notice', async () => {
  const r = await handleMessage({ type: 'sync-status' });
  expect(r).toMatchObject({ ok: true, hint: null, status: { mode: 'browser', connected: false, readOnly: false, pending: false } });
});

test('sync-status carries the heads-up when another browser left the marker, until dismissed', async () => {
  await writeHint('tony/ubicon-sync', 'Chrome on Windows');
  expect(await handleMessage({ type: 'sync-status' })).toMatchObject({ hint: { repo: 'tony/ubicon-sync', by: 'Chrome on Windows' } });
  await handleMessage({ type: 'sync-dismiss-hint' });
  expect(await handleMessage({ type: 'sync-status' })).toMatchObject({ hint: null });
});

test('sync-setup-code is refused when not connected', async () => {
  expect(await handleMessage({ type: 'sync-setup-code' })).toEqual({ ok: false, error: 'Not connected' });
});

test('sync-setup-code hands back repo and token once connected', async () => {
  await fakeBrowser.storage.local.set({ 'sync:token': TOKEN, 'sync:repo': 'tony/ubicon-sync' });
  const r = await handleMessage({ type: 'sync-setup-code' });
  expect(r.ok && decodeSetupCode(r.setupCode ?? '')).toEqual({ repo: 'tony/ubicon-sync', token: TOKEN, readOnly: false });
});

test('a failed connect comes back as a reason the wizard can act on, and changes nothing', async () => {
  global.fetch = vi.fn(async () => json(401, { message: 'Bad credentials' })) as typeof fetch;
  await setAssignment('d4:3d:39:80:fc:80', { kind: 'db', deviceId: 'a' });
  const r = await handleMessage({ type: 'sync-connect', token: TOKEN });
  expect(r).toMatchObject({ ok: false, reason: 'token-rejected' });
  expect(JSON.stringify(r)).not.toContain(TOKEN);
  expect(await getSyncMode()).toBe('browser');
  expect(JSON.stringify(await fakeBrowser.storage.local.get(null))).not.toContain(TOKEN);
});

test('a token left on All repositories is refused with the count of other repos', async () => {
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith('/user')) return json(200, { login: 'tony' });
    if (u.includes('/user/repos')) return json(200, [{ full_name: 'tony/ubicon-sync' }, { full_name: 'tony/a' }, { full_name: 'tony/b' }]);
    return json(200, {});
  }) as typeof fetch;
  expect(await handleMessage({ type: 'sync-connect', token: TOKEN })).toMatchObject({ ok: false, reason: 'token-too-broad', others: 2 });
});

test('a local change is marked for pushing only on a connected browser', async () => {
  await onAssignmentsChanged();
  expect((await fakeBrowser.storage.local.get('sync:dirty'))['sync:dirty']).toBeUndefined();

  vi.useFakeTimers();
  await migrateToLocal('github');
  await onAssignmentsChanged();
  expect((await fakeBrowser.storage.local.get('sync:dirty'))['sync:dirty']).toBeTypeOf('number');
});
