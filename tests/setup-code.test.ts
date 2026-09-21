import { beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { decodeSetupCode, encodeSetupCode, looksLikeToken } from '../shared/sync/setup-code';
import { dismissHint, readHint, removeHint, shouldShowHint, writeHint } from '../shared/sync/hint';
import { migrateToLocal } from '../shared/storage';

const TOKEN = 'github_pat_11ABCDEFG0abcdefghijkl_MNOPQRSTUVWXYZ';

beforeEach(() => { fakeBrowser.reset(); vi.useRealTimers(); });

test('setup code round-trips repo, token and the view-only flag', () => {
  const code = encodeSetupCode({ repo: 'tony/ubicon-sync', token: TOKEN, readOnly: false });
  expect(code.startsWith('ubicon1.')).toBe(true);
  expect(code).not.toContain(TOKEN); // not readable at a glance over a shoulder
  expect(/^[A-Za-z0-9._-]+$/.test(code)).toBe(true); // survives chat apps and email
  expect(decodeSetupCode(code)).toEqual({ repo: 'tony/ubicon-sync', token: TOKEN, readOnly: false });
  expect(decodeSetupCode(encodeSetupCode({ repo: 'a/b', token: TOKEN, readOnly: true }))?.readOnly).toBe(true);
});

test('decodeSetupCode tolerates surrounding whitespace and rejects everything else', () => {
  const code = encodeSetupCode({ repo: 'tony/ubicon-sync', token: TOKEN, readOnly: false });
  expect(decodeSetupCode(`  ${code}\n`)?.repo).toBe('tony/ubicon-sync');
  expect(decodeSetupCode('')).toBeNull();
  expect(decodeSetupCode(TOKEN)).toBeNull();
  expect(decodeSetupCode('ubicon1.not-base64-json')).toBeNull();
  expect(decodeSetupCode('ubicon1.' + btoa(JSON.stringify({ r: 'no-slash', t: TOKEN })))).toBeNull();
  expect(decodeSetupCode('ubicon1.' + btoa(JSON.stringify({ r: 'a/b' })))).toBeNull();
});

test('looksLikeToken tells a fine-grained token from a classic one and from junk', () => {
  expect(looksLikeToken(TOKEN)).toBe('fine-grained');
  expect(looksLikeToken('ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toBe('classic');
  expect(looksLikeToken('hello')).toBe('unknown');
});

test('the marker holds no token and is written once', async () => {
  vi.useFakeTimers({ now: 1_790_000_000_000 });
  await writeHint('tony/ubicon-sync', 'Chrome on Windows');
  vi.setSystemTime(1_790_000_999_000);
  await writeHint('tony/ubicon-sync', 'Firefox on Linux'); // a second browser connecting must not overwrite it
  const raw = await fakeBrowser.storage.sync.get(null);
  expect(raw).toEqual({ 'sync:hint': { v: 1, repo: 'tony/ubicon-sync', at: 1_790_000_000_000, by: 'Chrome on Windows' } });
  expect(await readHint()).toEqual({ v: 1, repo: 'tony/ubicon-sync', at: 1_790_000_000_000, by: 'Chrome on Windows' });
});

test('the notice shows only on a browser that is not connected, until dismissed', async () => {
  expect(await shouldShowHint()).toBe(false); // no marker: a new user, or browser sync is off
  await writeHint('tony/ubicon-sync', 'Chrome on Windows');
  expect(await shouldShowHint()).toBe(true);
  await dismissHint();
  expect(await shouldShowHint()).toBe(false);
});

test('a newer marker prompts again after an old one was dismissed', async () => {
  vi.useFakeTimers({ now: 1000 });
  await writeHint('tony/ubicon-sync', 'Chrome on Windows');
  await dismissHint();
  await removeHint();
  vi.setSystemTime(2000);
  await writeHint('tony/ubicon-sync', 'Chrome on Windows');
  expect(await shouldShowHint()).toBe(true);
});

test('a connected browser never shows the notice', async () => {
  await writeHint('tony/ubicon-sync', 'Chrome on Windows');
  await migrateToLocal('github');
  expect(await shouldShowHint()).toBe(false);
});

test('a malformed marker is ignored', async () => {
  await fakeBrowser.storage.sync.set({ 'sync:hint': { v: 1, repo: 42 } });
  expect(await readHint()).toBeNull();
  expect(await shouldShowHint()).toBe(false);
});
