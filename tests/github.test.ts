import { beforeEach, expect, test, vi } from 'vitest';
import { GitHubError, createGitHub, listReach, whoami } from '../shared/sync/github';

const TOKEN = 'github_pat_SECRETSECRETSECRET';
const REPO = 'tony/ubicon-sync';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_DATA_URI = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;

type Call = { url: string; init: RequestInit };
let calls: Call[];
let queue: Array<Response | Error>;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

beforeEach(() => {
  calls = [];
  queue = [];
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch: ${String(url)}`);
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
});

const header = (call: Call | undefined, name: string) => new Headers(call?.init.headers).get(name);

test('every request is authenticated, versioned and bypasses the browser cache', async () => {
  queue.push(json(200, { login: 'tony' }));
  expect(await whoami(TOKEN)).toBe('tony');
  expect(calls[0]?.url).toBe('https://api.github.com/user');
  expect(header(calls[0], 'authorization')).toBe(`Bearer ${TOKEN}`);
  expect(header(calls[0], 'x-github-api-version')).toBe('2022-11-28');
  expect(calls[0]?.init.cache).toBe('no-store');
});

test('listReach returns each repo the token can see with its visibility and write access', async () => {
  queue.push(json(200, [
    { full_name: 'tony/ubicon-sync', private: true, permissions: { push: true, pull: true } },
    { full_name: 'tony/public-thing', private: false, permissions: { push: false, pull: true } },
    { full_name: 'tony/admin-thing', private: false, permissions: { admin: true } },
    { full_name: 'tony/no-perms' },
  ]));
  expect(await listReach(TOKEN)).toEqual([
    { fullName: 'tony/ubicon-sync', isPrivate: true, canPush: true },
    { fullName: 'tony/public-thing', isPrivate: false, canPush: false },
    { fullName: 'tony/admin-thing', isPrivate: false, canPush: true },
    { fullName: 'tony/no-perms', isPrivate: false, canPush: false },
  ]);
  expect(calls[0]?.url).toContain('/user/repos?affiliation=owner&per_page=100');
});

test('readManifest decodes UTF-8 content and returns sha and etag', async () => {
  const body = '{"label":"Caméra"}\n';
  // GitHub wraps base64 content across lines.
  const wrapped = b64(body).replace(/(.{10})/g, '$1\n');
  queue.push(json(200, { content: wrapped, encoding: 'base64', sha: 'abc123' }, { etag: '"e1"' }));
  const r = await createGitHub(TOKEN, REPO).readManifest();
  expect(r).toEqual({ status: 'ok', body, sha: 'abc123', etag: '"e1"' });
  expect(calls[0]?.url).toBe(`https://api.github.com/repos/${REPO}/contents/ubicon.json`);
});

test('readManifest sends If-None-Match and reports 304 as unchanged', async () => {
  queue.push(new Response(null, { status: 304 }));
  const r = await createGitHub(TOKEN, REPO).readManifest('"e1"');
  expect(r).toEqual({ status: 'unchanged' });
  expect(header(calls[0], 'if-none-match')).toBe('"e1"');
});

test('readManifest reports a missing file as missing, not as an error', async () => {
  queue.push(json(404, { message: 'Not Found' }));
  expect(await createGitHub(TOKEN, REPO).readManifest()).toEqual({ status: 'missing' });
});

test('readManifest refetches raw when the file is too large to come back inline', async () => {
  queue.push(json(200, { content: '', encoding: 'none', sha: 'big1' }, { etag: '"e2"' }));
  queue.push(new Response('{"big":true}\n', { status: 200 }));
  const r = await createGitHub(TOKEN, REPO).readManifest();
  expect(r).toEqual({ status: 'ok', body: '{"big":true}\n', sha: 'big1', etag: '"e2"' });
  expect(header(calls[1], 'accept')).toBe('application/vnd.github.raw+json');
});

test('writeManifest sends base64 content with the sha and returns the new sha', async () => {
  queue.push(json(200, { content: { sha: 'new1' } }));
  const sha = await createGitHub(TOKEN, REPO).writeManifest('{"a":"é"}\n', 'old1', 'Sync from Chrome');
  expect(sha).toBe('new1');
  expect(calls[0]?.init.method).toBe('PUT');
  const sent = JSON.parse(String(calls[0]?.init.body));
  expect(sent).toEqual({ message: 'Sync from Chrome', content: b64('{"a":"é"}\n'), sha: 'old1' });
});

test('writeManifest omits the sha when creating the file', async () => {
  queue.push(json(201, { content: { sha: 'first' } }));
  await createGitHub(TOKEN, REPO).writeManifest('{}', undefined, 'Sync from Chrome');
  expect('sha' in JSON.parse(String(calls[0]?.init.body))).toBe(false);
});

test.each([409, 422])('writeManifest maps HTTP %i to a conflict', async status => {
  queue.push(json(status, { message: 'ubicon.json does not match' }));
  await expect(createGitHub(TOKEN, REPO).writeManifest('{}', 'stale', 'm')).rejects.toMatchObject({ kind: 'conflict' });
});

test('error mapping: 401 auth, 404 not-found, 403 forbidden, exhausted quota rate-limit, thrown fetch network', async () => {
  const gh = createGitHub(TOKEN, REPO);
  queue.push(json(401, { message: 'Bad credentials' }));
  await expect(gh.checkRepo()).rejects.toMatchObject({ kind: 'auth', status: 401 });
  queue.push(json(404, { message: 'Not Found' }));
  await expect(gh.checkRepo()).rejects.toMatchObject({ kind: 'not-found' });
  queue.push(json(403, { message: 'Resource not accessible by personal access token' }));
  await expect(gh.writeManifest('{}', 'x', 'm')).rejects.toMatchObject({ kind: 'forbidden' });
  queue.push(json(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' }));
  await expect(gh.checkRepo()).rejects.toMatchObject({ kind: 'rate-limit', resetAt: 1_790_000_000_000 });
  queue.push(new TypeError('Failed to fetch'));
  await expect(gh.checkRepo()).rejects.toMatchObject({ kind: 'network' });
});

test('errors never carry the token', async () => {
  queue.push(json(401, { message: `Bad credentials for ${TOKEN}` }));
  const err = await createGitHub(TOKEN, REPO).checkRepo().catch(e => e as GitHubError);
  expect(err).toBeInstanceOf(GitHubError);
  expect(JSON.stringify({ ...(err as GitHubError), message: (err as GitHubError).message })).not.toContain(TOKEN);
});

test('listIcons returns custom ids, and an absent icons folder means none', async () => {
  queue.push(json(200, [{ name: 'c1.png', type: 'file' }, { name: 'notes.txt', type: 'file' }, { name: 'c2.png', type: 'file' }]));
  expect([...(await createGitHub(TOKEN, REPO).listIcons())].sort()).toEqual(['c1', 'c2']);
  queue.push(json(404, { message: 'Not Found' }));
  expect((await createGitHub(TOKEN, REPO).listIcons()).size).toBe(0);
});

test('getIcon returns a PNG data URI, and null when the file is missing', async () => {
  queue.push(new Response(PNG, { status: 200 }));
  expect(await createGitHub(TOKEN, REPO).getIcon('c1')).toBe(PNG_DATA_URI);
  expect(calls[0]?.url).toBe(`https://api.github.com/repos/${REPO}/contents/icons/c1.png`);
  queue.push(json(404, { message: 'Not Found' }));
  expect(await createGitHub(TOKEN, REPO).getIcon('gone')).toBeNull();
});

test('getIcon rejects anything that is not a reasonably sized PNG', async () => {
  queue.push(new Response(new TextEncoder().encode('<svg onload=alert(1)>'), { status: 200 }));
  expect(await createGitHub(TOKEN, REPO).getIcon('evil')).toBeNull();
  const huge = new Uint8Array(256 * 1024 + 1);
  huge.set(PNG);
  queue.push(new Response(huge, { status: 200 }));
  expect(await createGitHub(TOKEN, REPO).getIcon('huge')).toBeNull();
});

test('getIcon refuses ids that could escape the icons folder', async () => {
  expect(await createGitHub(TOKEN, REPO).getIcon('../ubicon')).toBeNull();
  expect(calls).toHaveLength(0);
});

test('putIcon uploads the PNG bytes, and an already existing file counts as success', async () => {
  queue.push(json(201, { content: { sha: 'i1' } }));
  await createGitHub(TOKEN, REPO).putIcon('c1', PNG_DATA_URI, 'Add icon Cam');
  const sent = JSON.parse(String(calls[0]?.init.body));
  expect(sent).toEqual({ message: 'Add icon Cam', content: btoa(String.fromCharCode(...PNG)) });
  queue.push(json(422, { message: 'Invalid request. "sha" wasn\'t supplied.' }));
  await expect(createGitHub(TOKEN, REPO).putIcon('c1', PNG_DATA_URI, 'Add icon Cam')).resolves.toBeUndefined();
});

test('meta records the server clock and the token expiry from response headers', async () => {
  const gh = createGitHub(TOKEN, REPO);
  queue.push(json(200, {}, {
    date: 'Mon, 21 Sep 2026 12:00:00 GMT',
    'github-authentication-token-expiration': '2027-01-15 08:30:00 UTC',
  }));
  await gh.checkRepo();
  expect(gh.meta.serverTime).toBe(Date.parse('2026-09-21T12:00:00Z'));
  expect(gh.meta.tokenExpiresAt).toBe(Date.parse('2027-01-15T08:30:00Z'));
});
