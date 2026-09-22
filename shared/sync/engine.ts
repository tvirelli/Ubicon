import { browser } from 'wxt/browser';
import type { Manifest } from '../types';
import {
  cacheIcon, getCachedIcon, getSyncMode, migrateToBrowser, migrateToLocal,
  readManifest, writeManifest, type SyncMode,
} from '../storage';
import { serialized } from '../write-queue';
import { GitHubError, createGitHub, listReach, whoami, type GitHubClient, type ReachEntry } from './github';
import { removeHint, writeHint } from './hint';
import { emptyManifest, parseManifest, serializeManifest } from './manifest';
import { merge } from './merge';

const TOKEN_KEY = 'sync:token';
const REPO_KEY = 'sync:repo';
const STATE_KEY = 'sync:state';
// A timestamp, not a flag: a change that lands while a push is in flight
// moves it forward, so finishing that push does not wipe out the newer mark.
const DIRTY_KEY = 'sync:dirty';
const PROGRESS_KEY = 'sync:progress';
export const CLOCK_OFFSET_KEY = 'sync:clockOffset';

const REACH_CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60_000;
export const DEFAULT_REPO_NAME = 'ubicon-sync';

export type SyncErrorKind = 'auth' | 'not-found' | 'rate-limit' | 'network' | 'conflict' | 'bad-remote' | 'other';

interface SyncState {
  sha?: string;
  etag?: string | null;
  lastSyncAt?: number;
  lastError?: { kind: SyncErrorKind; at: number } | null;
  // Connected with a token GitHub will not accept writes from.
  readOnly?: boolean;
  // Custom icon ids known to be in the repo already, so each is uploaded once.
  remoteIcons?: string[];
  reachCheckedAt?: number;
  // The token was found to reach repos besides the sync repo: syncing stops,
  // local data and the connection stay, until a check passes again.
  paused?: 'reach';
  othersInReach?: number;
  retryAt?: number;
  tokenExpiresAt?: number;
}

// Everything the engine needs from outside, so tests can stand in a fake repo.
export interface SyncDeps {
  makeClient: (token: string, repo: string) => GitHubClient;
  whoami: (token: string) => Promise<string>;
  listReach: (token: string) => Promise<ReachEntry[]>;
  sleep: (ms: number) => Promise<void>;
  label: () => string;
}

// "Chrome on Windows": names this browser in commit messages and in the
// heads-up shown on the user's other browsers.
export function browserLabel(ua: string = navigator.userAgent): string {
  const name = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${name} on ${os}` : name;
}

export const realDeps: SyncDeps = {
  makeClient: createGitHub,
  whoami,
  listReach,
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  label: browserLabel,
};

const get = async <T>(key: string): Promise<T | undefined> => (await browser.storage.local.get(key))[key] as T | undefined;
const getState = async (): Promise<SyncState> => (await get<SyncState>(STATE_KEY)) ?? {};
const setState = (s: SyncState) => browser.storage.local.set({ [STATE_KEY]: s });

export const markDirty = () => browser.storage.local.set({ [DIRTY_KEY]: Date.now() });

const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
// A repo besides the sync repo counts against the token if the token could
// read something not already public, or write anything. A public repo the
// token can only read is what anyone on the internet can do, so it is ignored.
const othersIn = (reach: ReachEntry[], repo: string) =>
  reach.filter(r => r.fullName && !sameRepo(r.fullName, repo) && (r.isPrivate || r.canPush)).length;

const customIds = (m: Manifest): Set<string> => {
  const ids = new Set<string>();
  for (const s of Object.values(m.assignments)) if (s.ref.kind === 'custom') ids.add(s.ref.customId);
  return ids;
};

const errorKind = (e: unknown): SyncErrorKind => {
  if (!(e instanceof GitHubError)) return 'other';
  return e.kind === 'forbidden' ? 'other' : e.kind;
};

export type SyncOutcome = 'synced' | 'unchanged' | 'skipped' | 'paused' | 'error';

export async function syncOnce(deps: SyncDeps = realDeps): Promise<SyncOutcome> {
  const token = await get<string>(TOKEN_KEY);
  const repo = await get<string>(REPO_KEY);
  if (!token || !repo || (await getSyncMode()) !== 'github') return 'skipped';
  const state = await getState();
  if (state.retryAt && Date.now() < state.retryAt) return 'skipped';

  try {
    // An account whose only repo is the sync repo cannot be told apart from a
    // token left on "All repositories" at setup time, so the reach is checked
    // again once a day, and on every attempt while paused so that fixing the
    // token on GitHub lifts the pause by itself.
    if (state.paused || !state.reachCheckedAt || Date.now() - state.reachCheckedAt > REACH_CHECK_EVERY_MS) {
      const others = othersIn(await deps.listReach(token), repo);
      state.reachCheckedAt = Date.now();
      state.paused = others ? 'reach' : undefined;
      state.othersInReach = others || undefined;
      if (others) {
        await setState(state);
        return 'paused';
      }
    }

    const client = deps.makeClient(token, repo);
    for (let attempt = 0; ; attempt++) {
      const dirtyAt = await get<number>(DIRTY_KEY);
      // A conditional read is free against the rate limit, but a 304 carries
      // no body to merge with, so it is only used when nothing local changed.
      const read = await client.readManifest(dirtyAt ? null : state.etag);
      recordMeta(state, client);
      if (read.status === 'unchanged') {
        state.lastSyncAt = Date.now();
        state.lastError = null;
        await setState(state);
        return 'unchanged';
      }

      let remote: Manifest;
      try {
        remote = read.status === 'missing' ? emptyManifest() : parseManifest(JSON.parse(read.body));
      } catch {
        // Not ours, or hand-edited into invalid JSON. Never overwrite what we
        // cannot read: stop and say so, the user's data stays as it is.
        state.lastError = { kind: 'bad-remote', at: Date.now() };
        await setState(state);
        return 'error';
      }

      // Read-merge-write of the local set happens inside the write queue, so
      // a change the user makes during the network calls is never lost.
      const result = await serialized(async () => {
        const local = await readManifest();
        const r = merge(local, remote, Date.now());
        if (r.localChanged) await applyLocally(local, r.merged);
        return r;
      });
      await downloadMissingIcons(client, result.merged);

      // A repo with no file yet gets one even when there is nothing to put in
      // it: every later sync can then use a free conditional read, and a
      // view-only token shows itself on the very first connect.
      if (result.remoteChanged || read.status === 'missing') {
        if (state.readOnly) {
          await serialized(() => resetLocalTo(remote));
        } else {
          try {
            await uploadNewIcons(client, state, result.merged, deps);
            state.sha = await client.writeManifest(
              serializeManifest(result.merged),
              read.status === 'ok' ? read.sha : undefined,
              `Sync from ${deps.label()}`,
            );
            state.etag = null; // the write made a new version; the next read fetches it in full
          } catch (e) {
            if (e instanceof GitHubError && e.kind === 'conflict' && attempt === 0) continue; // another browser wrote first: re-read, merge, try once more
            if (e instanceof GitHubError && e.kind === 'forbidden') {
              // GitHub will not take writes from this token: a view-only
              // connection. Drop what could not be saved so this browser does
              // not show edits no other browser will ever see.
              state.readOnly = true;
              await serialized(() => resetLocalTo(remote));
            } else {
              throw e;
            }
          }
        }
      } else if (read.status === 'ok') {
        state.sha = read.sha;
        state.etag = read.etag;
      }

      if ((await get<number>(DIRTY_KEY)) === dirtyAt) await browser.storage.local.remove(DIRTY_KEY);
      state.lastSyncAt = Date.now();
      state.lastError = null;
      state.retryAt = undefined;
      await setState(state);
      return 'synced';
    }
  } catch (e) {
    state.lastError = { kind: errorKind(e), at: Date.now() };
    if (e instanceof GitHubError && e.kind === 'rate-limit') state.retryAt = e.resetAt;
    await setState(state);
    return 'error';
  }
}

function recordMeta(state: SyncState, client: GitHubClient): void {
  state.tokenExpiresAt = client.meta.tokenExpiresAt;
  if (client.meta.serverTime === undefined) return;
  // Merging is by timestamp, so a badly wrong local clock would make this
  // browser's changes always win or always lose. GitHub's Date header is a
  // free reference; small differences are left alone.
  const offset = client.meta.serverTime - Date.now();
  void browser.storage.local.set({ [CLOCK_OFFSET_KEY]: Math.abs(offset) > MAX_CLOCK_SKEW_MS ? offset : 0 });
}

// Custom icon blobs have no other owner: when an assignment loses a merge,
// its blob goes too, mirroring what removeAssignment does for a local remove.
async function applyLocally(before: Manifest, merged: Manifest): Promise<void> {
  await writeManifest(merged);
  const kept = customIds(merged);
  const orphaned = [...customIds(before)].filter(id => !kept.has(id)).map(id => `icon:custom:${id}`);
  if (orphaned.length) await browser.storage.local.remove(orphaned);
}

async function resetLocalTo(remote: Manifest): Promise<void> {
  await applyLocally(await readManifest(), remote);
}

async function downloadMissingIcons(client: GitHubClient, merged: Manifest): Promise<void> {
  for (const id of customIds(merged)) {
    if (await getCachedIcon(`custom:${id}`)) continue;
    const dataUri = await client.getIcon(id);
    if (dataUri) await cacheIcon(`custom:${id}`, dataUri);
  }
}

// Icons go up before the manifest, so the manifest never points at a file
// that is not there yet.
async function uploadNewIcons(client: GitHubClient, state: SyncState, merged: Manifest, deps: SyncDeps): Promise<void> {
  const wanted = [...customIds(merged)];
  if (!wanted.length) return;
  const known = new Set(state.remoteIcons ?? [...(await client.listIcons())]);
  for (const s of Object.values(merged.assignments)) {
    if (s.ref.kind !== 'custom' || known.has(s.ref.customId)) continue;
    const dataUri = await getCachedIcon(`custom:${s.ref.customId}`);
    if (!dataUri) continue;
    await client.putIcon(s.ref.customId, dataUri, `Add icon ${s.ref.label || 'from ' + deps.label()}`);
    known.add(s.ref.customId);
  }
  state.remoteIcons = [...known];
}

// ---- connect, replace token, disconnect ----

export type SetupFailure =
  | 'token-rejected' | 'repo-not-found' | 'token-too-broad' | 'view-only-empty-repo'
  | 'network' | 'rate-limit' | 'bad-remote' | 'other';

export class SetupError extends Error {
  constructor(public readonly reason: SetupFailure, public readonly others?: number) {
    super(reason);
    this.name = 'SetupError';
  }
}

// The wizard shows these as a live checklist. They travel through storage
// because connecting runs in the background worker, not in the page.
export type ConnectStep = 'token' | 'repo' | 'reach' | 'sync' | 'done';
const progress = (step: ConnectStep | null) =>
  step ? browser.storage.local.set({ [PROGRESS_KEY]: step }) : browser.storage.local.remove(PROGRESS_KEY);

const asSetupError = (e: unknown): SetupError => {
  if (e instanceof SetupError) return e;
  if (e instanceof GitHubError) {
    if (e.kind === 'auth') return new SetupError('token-rejected');
    if (e.kind === 'not-found') return new SetupError('repo-not-found');
    if (e.kind === 'network' || e.kind === 'rate-limit') return new SetupError(e.kind);
  }
  return new SetupError('other');
};

// Checks a token without storing anything: who it belongs to, that it can
// see the repo, and that it can see nothing else.
async function vet(token: string, repoInput: string | undefined, deps: SyncDeps): Promise<string> {
  await progress('token');
  const login = await deps.whoami(token);
  await progress('repo');
  const repo = repoInput ?? `${login}/${DEFAULT_REPO_NAME}`;
  const client = deps.makeClient(token, repo);
  try {
    await client.checkRepo();
  } catch (e) {
    if (!(e instanceof GitHubError) || e.kind !== 'not-found') throw e;
    // GitHub builds a repo made from a template in the background; a user
    // who was quick can get here first. One retry covers it.
    await deps.sleep(3000);
    await client.checkRepo();
  }
  await progress('reach');
  const others = othersIn(await deps.listReach(token), repo);
  if (others) throw new SetupError('token-too-broad', others);
  return repo;
}

export interface ConnectInput { token: string; repo?: string; readOnly?: boolean; }
export interface ConnectResult { repo: string; assignments: number; readOnly: boolean; }

export async function connect(input: ConnectInput, deps: SyncDeps = realDeps): Promise<ConnectResult> {
  const token = input.token.trim();
  try {
    const repo = await vet(token, input.repo, deps);
    await progress('sync');
    // Only now, with every check passed, does anything get stored.
    await browser.storage.local.set({
      [TOKEN_KEY]: token,
      [REPO_KEY]: repo,
      [STATE_KEY]: { readOnly: input.readOnly === true, reachCheckedAt: Date.now() } satisfies SyncState,
    });
    await serialized(() => migrateToLocal('github'));
    await markDirty();
    const outcome = await syncOnce(deps);
    const state = await getState();
    if (outcome !== 'synced') {
      const kind = state.lastError?.kind;
      throw kind === 'auth' ? new SetupError('token-rejected')
        : kind === 'not-found' ? new SetupError('repo-not-found')
        : kind === 'network' || kind === 'rate-limit' || kind === 'bad-remote' ? new SetupError(kind)
        : new SetupError('other');
    }
    // A view-only token cannot start a repo: there is nothing in it to view.
    if (state.readOnly && !state.sha) throw new SetupError('view-only-empty-repo');
    await writeHint(repo, deps.label());
    await progress('done');
    return { repo, assignments: Object.keys((await readManifest()).assignments).length, readOnly: state.readOnly === true };
  } catch (e) {
    if (await get<string>(TOKEN_KEY)) await forget();
    await progress(null);
    throw asSetupError(e);
  }
}

export async function replaceToken(newToken: string, deps: SyncDeps = realDeps): Promise<void> {
  const repo = await get<string>(REPO_KEY);
  if (!repo) throw new SetupError('other');
  const token = newToken.trim();
  try {
    await vet(token, repo, deps);
  } catch (e) {
    throw asSetupError(e);
  } finally {
    await progress(null);
  }
  const state = await getState();
  await browser.storage.local.set({
    [TOKEN_KEY]: token,
    // A new token may have different rights; it re-proves itself on first write.
    [STATE_KEY]: { ...state, readOnly: false, paused: undefined, othersInReach: undefined, lastError: null, retryAt: undefined, reachCheckedAt: Date.now() } satisfies SyncState,
  });
  await markDirty();
  await syncOnce(deps);
}

async function forget(): Promise<'browser' | 'local'> {
  await browser.storage.local.remove([TOKEN_KEY, REPO_KEY, STATE_KEY, DIRTY_KEY, CLOCK_OFFSET_KEY]);
  return serialized(() => migrateToBrowser());
}

// Per browser. Affects no other browser and never touches the repo.
export async function disconnect(opts: { removeHint: boolean }, deps: SyncDeps = realDeps): Promise<'browser' | 'local'> {
  await markDirty();
  await syncOnce(deps); // best effort: a dead token must not keep the user connected
  const mode = await forget();
  if (opts.removeHint) await removeHint();
  return mode;
}

export interface SyncStatus {
  mode: SyncMode;
  connected: boolean;
  repo?: string;
  readOnly: boolean;
  lastSyncAt?: number;
  lastError?: SyncErrorKind;
  paused?: 'reach';
  othersInReach?: number;
  tokenExpiresAt?: number;
  pending: boolean;
}

export async function getStatus(): Promise<SyncStatus> {
  const [mode, repo, token, state, dirty] = await Promise.all([
    getSyncMode(), get<string>(REPO_KEY), get<string>(TOKEN_KEY), getState(), get<number>(DIRTY_KEY),
  ]);
  return {
    mode,
    connected: mode === 'github' && !!token,
    repo,
    readOnly: state.readOnly === true,
    lastSyncAt: state.lastSyncAt,
    lastError: state.lastError?.kind,
    paused: state.paused,
    othersInReach: state.othersInReach,
    tokenExpiresAt: state.tokenExpiresAt,
    pending: !!dirty,
  };
}

// Connected with a token GitHub refuses writes from. Changes are blocked in
// such a browser: they could never reach the repo, so they would only make
// this browser disagree with every other one.
export async function isViewOnly(): Promise<boolean> {
  return (await getSyncMode()) === 'github' && (await getState()).readOnly === true;
}

// For Show setup code. The only place the stored token is handed back out.
export async function getCredentials(): Promise<{ token: string; repo: string; readOnly: boolean } | null> {
  const [token, repo, state] = await Promise.all([get<string>(TOKEN_KEY), get<string>(REPO_KEY), getState()]);
  return token && repo ? { token, repo, readOnly: state.readOnly === true } : null;
}
