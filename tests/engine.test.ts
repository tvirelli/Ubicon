import { beforeEach, expect, test } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  SetupError, connect, disconnect, getCredentials, getStatus, markDirty, replaceToken, syncOnce, type SyncDeps,
} from '../shared/sync/engine';
import { GitHubError, type GitHubClient, type ManifestRead, type ReachEntry } from '../shared/sync/github';
import { parseManifest, serializeManifest } from '../shared/sync/manifest';
import { readHint } from '../shared/sync/hint';
import {
  cacheIcon, getAllAssignments, getCachedIcon, getSyncMode, readManifest, removeAssignment, setAssignment,
} from '../shared/storage';
import type { Manifest } from '../shared/types';

const TOKEN = 'github_pat_TESTTOKEN';
const REPO = 'tony/ubicon-sync';
const MAC1 = 'd4:3d:39:80:fc:80';
const MAC2 = 'aa:bb:cc:dd:ee:ff';
const ICON = 'data:image/png;base64,Q1VTVE9N';
const db = (deviceId: string) => ({ kind: 'db', deviceId }) as const;
// What a token sees for a private repo it was selected on.
const mine = (fullName: string): ReachEntry => ({ fullName, isPrivate: true });

// An in-memory stand-in for the user's GitHub repo, with the one property
// that matters: a write based on a stale version is refused.
class FakeRepo {
  body: string | null = null;
  version = 0;
  icons = new Map<string, string>();
  log: string[] = [];
  writable = true;
  exists = true;
  reach: ReachEntry[] = [mine(REPO)];
  // Whether the token was granted on the account's public repos ("All repositories").
  broad = false;
  // Runs once, between a client's read and its write: another browser getting in first.
  beforeNextWrite: (() => void) | null = null;
  failNext: GitHubError | null = null;

  put(m: Manifest) { this.body = serializeManifest(m); this.version++; }
  manifest(): Manifest { return parseManifest(JSON.parse(this.body ?? 'null')); }

  client(): GitHubClient {
    const repo = this;
    const guard = () => { if (repo.failNext) { const e = repo.failNext; repo.failNext = null; throw e; } };
    return {
      meta: {},
      async checkRepo() { guard(); if (!repo.exists) throw new GitHubError('not-found', 'x', 404); },
      async readManifest(etag?: string | null): Promise<ManifestRead> {
        guard();
        repo.log.push(etag ? 'read-conditional' : 'read');
        if (repo.body === null) return { status: 'missing' };
        if (etag === `"v${repo.version}"`) return { status: 'unchanged' };
        return { status: 'ok', body: repo.body, sha: `sha${repo.version}`, etag: `"v${repo.version}"` };
      },
      async writeManifest(body: string, sha: string | undefined) {
        guard();
        if (!repo.writable) throw new GitHubError('forbidden', 'x', 403);
        repo.beforeNextWrite?.();
        repo.beforeNextWrite = null;
        const current = repo.body === null ? undefined : `sha${repo.version}`;
        if (sha !== current) throw new GitHubError('conflict', 'x', 409);
        repo.body = body;
        repo.version++;
        repo.log.push('write-manifest');
        return `sha${repo.version}`;
      },
      async listIcons() { return new Set(repo.icons.keys()); },
      async getIcon(id: string) { return repo.icons.get(id) ?? null; },
      async putIcon(id: string, dataUri: string) {
        if (!repo.writable) throw new GitHubError('forbidden', 'x', 403);
        repo.icons.set(id, dataUri);
        repo.log.push(`put-icon:${id}`);
      },
    };
  }
}

let repo: FakeRepo;
let deps: SyncDeps;

beforeEach(() => {
  fakeBrowser.reset();
  repo = new FakeRepo();
  deps = {
    makeClient: () => repo.client(),
    whoami: async () => 'tony',
    listReach: async () => repo.reach,
    probeReach: async () => repo.broad,
    sleep: async () => {},
    label: () => 'Chrome on Windows',
  };
});

// Same repo, a different browser: fresh storage, as on another machine.
const switchBrowser = () => fakeBrowser.reset();

test('connect finds the repo by its default name, uploads what this browser has, and leaves the marker', async () => {
  await setAssignment(MAC1, db('a'));
  const r = await connect({ token: `  ${TOKEN}\n` }, deps);
  expect(r).toEqual({ repo: REPO, assignments: 1, readOnly: false });
  expect(await getSyncMode()).toBe('github');
  expect(repo.manifest().assignments[MAC1]?.ref).toEqual(db('a'));
  expect((await getCredentials())?.token).toBe(TOKEN); // trimmed
  expect((await readHint())?.repo).toBe(REPO);
  expect(JSON.stringify(await fakeBrowser.storage.sync.get(null))).not.toContain(TOKEN);
});

test('a second browser pulls everything and keeps what only it had', async () => {
  await setAssignment(MAC1, db('from-work'));
  await connect({ token: TOKEN }, deps);

  switchBrowser();
  await setAssignment(MAC2, db('from-home'));
  await connect({ token: TOKEN, repo: REPO }, deps);

  expect(await getAllAssignments()).toEqual({ [MAC1]: db('from-work'), [MAC2]: db('from-home') });
  expect(Object.keys(repo.manifest().assignments).sort()).toEqual([MAC2, MAC1].sort());
});

test('a token that can reach any other repo is refused and nothing is stored', async () => {
  repo.reach = [mine(REPO), mine('tony/secret-project'), mine('tony/dotfiles')];
  await setAssignment(MAC1, db('a'));
  const err = await connect({ token: TOKEN }, deps).catch(e => e as SetupError);
  expect(err).toBeInstanceOf(SetupError);
  expect(err).toMatchObject({ reason: 'token-too-broad', others: 2 });
  expect(await getCredentials()).toBeNull();
  expect(await getSyncMode()).toBe('browser');
  expect(repo.body).toBeNull();
  expect(await readHint()).toBeNull();
});

test('public repos the token was not granted on do not count: GitHub shows them to every token', async () => {
  repo.reach = [
    mine(REPO),
    { fullName: 'tony/Ubicon', isPrivate: false },
    { fullName: 'tony/ubicon-sync-template', isPrivate: false },
  ];
  await expect(connect({ token: TOKEN }, deps)).resolves.toMatchObject({ repo: REPO });
});

test('an account with only public repos and a token left on All repositories is refused', async () => {
  repo.reach = [
    mine(REPO),
    { fullName: 'tony/Ubicon', isPrivate: false },
    { fullName: 'tony/ubicon-sync-template', isPrivate: false },
  ];
  repo.broad = true;
  await expect(connect({ token: TOKEN }, deps)).rejects.toMatchObject({ reason: 'token-too-broad', others: 2 });
});

test('the probe is skipped when there is no public repo to probe', async () => {
  let probed = 0;
  deps.probeReach = async () => { probed++; return true; };
  await expect(connect({ token: TOKEN }, deps)).resolves.toMatchObject({ repo: REPO });
  expect(probed).toBe(0);
});

test('any other private repo counts', async () => {
  repo.reach = [mine(REPO), { fullName: 'tony/secrets', isPrivate: true }];
  await expect(connect({ token: TOKEN }, deps)).rejects.toMatchObject({ reason: 'token-too-broad', others: 1 });
});

test('reach comparison ignores case, since GitHub names are case-insensitive', async () => {
  repo.reach = [mine('Tony/Ubicon-Sync')];
  await expect(connect({ token: TOKEN }, deps)).resolves.toMatchObject({ repo: REPO });
});

test('a repo still being built from the template gets one retry', async () => {
  repo.exists = false;
  deps.sleep = async () => { repo.exists = true; };
  await expect(connect({ token: TOKEN }, deps)).resolves.toMatchObject({ repo: REPO });
});

test('a repo the token cannot see is reported as such', async () => {
  repo.exists = false;
  await expect(connect({ token: TOKEN }, deps)).rejects.toMatchObject({ reason: 'repo-not-found' });
  expect(await getCredentials()).toBeNull();
});

test('a rejected token is reported as such', async () => {
  deps.whoami = async () => { throw new GitHubError('auth', 'x', 401); };
  await expect(connect({ token: TOKEN }, deps)).rejects.toMatchObject({ reason: 'token-rejected' });
});

test('a view-only token cannot start an empty repo, and the browser is put back as it was', async () => {
  repo.writable = false;
  await setAssignment(MAC1, db('a'));
  await expect(connect({ token: TOKEN }, deps)).rejects.toMatchObject({ reason: 'view-only-empty-repo' });
  expect(await getSyncMode()).toBe('browser');
  expect(await getAllAssignments()).toEqual({ [MAC1]: db('a') });
});

test('nothing changed anywhere: a conditional read, no write', async () => {
  await connect({ token: TOKEN }, deps);
  await syncOnce(deps); // settles the etag after the first write
  repo.log = [];
  expect(await syncOnce(deps)).toBe('unchanged');
  expect(repo.log).toEqual(['read-conditional']);
});

test('a local change is pushed, and its own echo produces no second commit', async () => {
  await connect({ token: TOKEN }, deps);
  await setAssignment(MAC1, db('new'));
  await markDirty();
  expect(await syncOnce(deps)).toBe('synced');
  expect(repo.manifest().assignments[MAC1]?.ref).toEqual(db('new'));
  expect((await getStatus()).pending).toBe(false);

  // The engine's own local write fires storage.onChanged, which marks dirty again.
  repo.log = [];
  await markDirty();
  await syncOnce(deps);
  expect(repo.log).toEqual(['read']);
});

test('a removal reaches the other browser through a tombstone, and takes the custom icon blob with it', async () => {
  await setAssignment(MAC1, { kind: 'custom', customId: 'c1', label: 'Cam' });
  await cacheIcon('custom:c1', ICON);
  await connect({ token: TOKEN }, deps);

  switchBrowser();
  await connect({ token: TOKEN, repo: REPO }, deps);
  expect(await getCachedIcon('custom:c1')).toBe(ICON); // downloaded from the repo
  const home = await fakeBrowser.storage.local.get(null);

  switchBrowser();
  await connect({ token: TOKEN, repo: REPO }, deps);
  await removeAssignment(MAC1);
  await markDirty();
  await syncOnce(deps);
  expect(repo.manifest().tombstones[MAC1]).toBeTypeOf('number');

  switchBrowser();
  await fakeBrowser.storage.local.set(home);
  await syncOnce(deps);
  expect(await getAllAssignments()).toEqual({});
  expect(await getCachedIcon('custom:c1')).toBeNull();
});

test('custom icons are uploaded before the manifest, and only once', async () => {
  await connect({ token: TOKEN }, deps);
  await setAssignment(MAC1, { kind: 'custom', customId: 'c1', label: 'Cam' });
  await cacheIcon('custom:c1', ICON);
  await markDirty();
  repo.log = [];
  await syncOnce(deps);
  expect(repo.log).toEqual(['read', 'put-icon:c1', 'write-manifest']);

  await setAssignment(MAC2, db('x'));
  await markDirty();
  repo.log = [];
  await syncOnce(deps);
  expect(repo.log).toEqual(['read', 'write-manifest']);
});

test('another browser writing first: re-read, merge, retry once, both changes survive', async () => {
  await connect({ token: TOKEN }, deps);
  await setAssignment(MAC1, db('mine'));
  await markDirty();
  repo.beforeNextWrite = () => {
    const m = repo.manifest();
    m.assignments[MAC2] = { ref: db('theirs'), t: Date.now() };
    repo.put(m);
  };
  expect(await syncOnce(deps)).toBe('synced');
  expect(Object.keys(repo.manifest().assignments).sort()).toEqual([MAC2, MAC1].sort());
  expect(await getAllAssignments()).toEqual({ [MAC1]: db('mine'), [MAC2]: db('theirs') });
});

test('a view-only token: changes that cannot be saved are dropped, and the connection is marked', async () => {
  await setAssignment(MAC1, db('shared'));
  await connect({ token: TOKEN }, deps);

  switchBrowser();
  repo.writable = false;
  await connect({ token: TOKEN, repo: REPO }, deps);
  await setAssignment(MAC2, db('only-here'));
  await markDirty();
  await syncOnce(deps);

  expect((await getStatus()).readOnly).toBe(true);
  expect(await getAllAssignments()).toEqual({ [MAC1]: db('shared') });
});

test('a setup code from a view-only browser starts the next browser view-only', async () => {
  await setAssignment(MAC1, db('shared'));
  await connect({ token: TOKEN }, deps);
  switchBrowser();
  await expect(connect({ token: TOKEN, repo: REPO, readOnly: true }, deps)).resolves.toMatchObject({ readOnly: true });
});

test('a failed push keeps the change marked for the next attempt', async () => {
  await connect({ token: TOKEN }, deps);
  await setAssignment(MAC1, db('a'));
  await markDirty();
  repo.failNext = new GitHubError('network', 'x');
  expect(await syncOnce(deps)).toBe('error');
  expect(await getStatus()).toMatchObject({ lastError: 'network', pending: true });
  expect(await syncOnce(deps)).toBe('synced');
  expect(repo.manifest().assignments[MAC1]?.ref).toEqual(db('a'));
});

test('a rate limit is waited out, not hammered', async () => {
  await connect({ token: TOKEN }, deps);
  await markDirty();
  repo.failNext = new GitHubError('rate-limit', 'x', 403, Date.now() + 60_000);
  await syncOnce(deps);
  repo.log = [];
  expect(await syncOnce(deps)).toBe('skipped');
  expect(repo.log).toEqual([]);
});

test('a repo file that cannot be read is never overwritten', async () => {
  await connect({ token: TOKEN }, deps);
  repo.body = '{ this is not json';
  repo.version++;
  await setAssignment(MAC1, db('a'));
  await markDirty();
  expect(await syncOnce(deps)).toBe('error');
  expect((await getStatus()).lastError).toBe('bad-remote');
  expect(repo.body).toBe('{ this is not json');
});

test('a token whose reach grows later pauses syncing, keeps the data, and resumes once fixed', async () => {
  await setAssignment(MAC1, db('a'));
  await connect({ token: TOKEN }, deps);
  const state = (await fakeBrowser.storage.local.get('sync:state'))['sync:state'] as { reachCheckedAt: number };
  await fakeBrowser.storage.local.set({ 'sync:state': { ...state, reachCheckedAt: Date.now() - 25 * 60 * 60 * 1000 } });

  repo.reach = [mine(REPO), mine('tony/new-private-repo')];
  expect(await syncOnce(deps)).toBe('paused');
  expect(await getStatus()).toMatchObject({ paused: 'reach', othersInReach: 1, connected: true });
  expect(await getAllAssignments()).toEqual({ [MAC1]: db('a') });

  repo.reach = [mine(REPO)];
  expect(await syncOnce(deps)).not.toBe('paused');
  expect((await getStatus()).paused).toBeUndefined();
});

test('replaceToken vets the new token first and refuses a broad one without losing the old', async () => {
  await connect({ token: TOKEN }, deps);
  repo.reach = [mine(REPO), mine('tony/other')];
  await expect(replaceToken('github_pat_NEW', deps)).rejects.toMatchObject({ reason: 'token-too-broad' });
  expect((await getCredentials())?.token).toBe(TOKEN);
  repo.reach = [mine(REPO)];
  await replaceToken('github_pat_NEW', deps);
  expect((await getCredentials())?.token).toBe('github_pat_NEW');
});

test('disconnect pushes what is pending, forgets the token, returns to browser mode and leaves the repo alone', async () => {
  await connect({ token: TOKEN }, deps);
  await setAssignment(MAC1, db('last-minute'));
  const before = repo.version;

  expect(await disconnect({ removeHint: false }, deps)).toBe('browser');

  expect(repo.manifest().assignments[MAC1]?.ref).toEqual(db('last-minute'));
  expect(repo.version).toBe(before + 1);
  expect(await getCredentials()).toBeNull();
  expect(await getSyncMode()).toBe('browser');
  expect(await getAllAssignments()).toEqual({ [MAC1]: db('last-minute') });
  expect(JSON.stringify(await fakeBrowser.storage.local.get(null))).not.toContain(TOKEN);
  expect(await readHint()).not.toBeNull();
});

test('disconnect works with a dead token, and can take the marker with it', async () => {
  await setAssignment(MAC1, db('a'));
  await connect({ token: TOKEN }, deps);
  deps.listReach = async () => { throw new GitHubError('auth', 'x', 401); };
  repo.failNext = new GitHubError('auth', 'x', 401);
  expect(await disconnect({ removeHint: true }, deps)).toBe('browser');
  expect(await getAllAssignments()).toEqual({ [MAC1]: db('a') });
  expect(await readHint()).toBeNull();
});

test('syncOnce does nothing on a browser that is not connected', async () => {
  expect(await syncOnce(deps)).toBe('skipped');
  expect(repo.log).toEqual([]);
});

test('local manifest after a merge matches the repo exactly', async () => {
  await setAssignment(MAC1, db('a'));
  await connect({ token: TOKEN }, deps);
  expect(serializeManifest(await readManifest())).toBe(repo.body);
});

test('a repo the token cannot see is named in the failure, so the fix card can show which one was tried', async () => {
  repo.exists = false;
  await expect(connect({ token: TOKEN }, deps)).rejects.toMatchObject({ reason: 'repo-not-found', repo: expect.stringMatching(/\/ubicon-sync$/) });
  await expect(connect({ token: TOKEN, repo: 'tony/home-icons' }, deps)).rejects.toMatchObject({ reason: 'repo-not-found', repo: 'tony/home-icons' });
});
