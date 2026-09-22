// Thin client for the handful of GitHub REST calls sync needs. It knows
// nothing about manifests or merging: it moves bytes and reports versions.
const API = 'https://api.github.com';
const MANIFEST_PATH = 'ubicon.json';
const ICONS_DIR = 'icons';
const MAX_ICON_BYTES = 256 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Custom ids are UUIDs we generate, but a repo file is untrusted input: only
// ids that cannot change the request path are ever put into one.
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type GitHubErrorKind = 'auth' | 'not-found' | 'forbidden' | 'rate-limit' | 'conflict' | 'network' | 'other';

export class GitHubError extends Error {
  constructor(
    public readonly kind: GitHubErrorKind,
    message: string,
    public readonly status?: number,
    // rate-limit only: when the quota resets, ms since epoch.
    public readonly resetAt?: number,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

// What the last response told us beyond its body.
export interface GitHubMeta {
  // GitHub's clock, from the Date header: lets the engine correct a badly
  // skewed local clock, since merging is by timestamp.
  serverTime?: number;
  // From GitHub-Authentication-Token-Expiration; absent for tokens that do
  // not expire.
  tokenExpiresAt?: number;
}

export type ManifestRead =
  | { status: 'unchanged' }
  | { status: 'missing' }
  | { status: 'ok'; body: string; sha: string; etag: string | null };

const toBase64 = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const fromBase64 = (b64: string): Uint8Array => {
  const bin = atob(b64.replace(/\s/g, '')); // GitHub wraps content across lines
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

async function request(
  token: string,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  meta?: GitHubMeta,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      // The browser's HTTP cache would answer conditional requests for us and
      // hide the ETag handling; versions are tracked here instead.
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    // The underlying error text is dropped on purpose: nothing from the
    // request, which carries the token, may end up in a message.
    throw new GitHubError('network', 'Could not reach GitHub');
  }
  if (meta) {
    const date = Date.parse(res.headers.get('date') ?? '');
    if (!Number.isNaN(date)) meta.serverTime = date;
    const expiry = res.headers.get('github-authentication-token-expiration');
    // Sent as "2027-01-15 08:30:00 UTC", which Date.parse does not take as is.
    const expiresAt = expiry ? Date.parse(expiry.replace(' UTC', 'Z').replace(' ', 'T')) : Number.NaN;
    meta.tokenExpiresAt = Number.isNaN(expiresAt) ? undefined : expiresAt;
  }
  return res;
}

// Turns a failed response into a typed error. Messages are fixed strings: the
// response body is never echoed, so nothing sensitive can ride along.
function fail(res: Response): GitHubError {
  const s = res.status;
  if (s === 401) return new GitHubError('auth', 'GitHub rejected the token', s);
  if ((s === 403 || s === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    return new GitHubError('rate-limit', 'GitHub rate limit reached', s, Number.isFinite(reset) ? reset * 1000 : undefined);
  }
  if (s === 403) return new GitHubError('forbidden', 'The token is not allowed to do that', s);
  if (s === 404) return new GitHubError('not-found', 'Not found on GitHub', s);
  if (s === 409 || s === 422) return new GitHubError('conflict', 'The file changed on GitHub', s);
  return new GitHubError('other', `GitHub answered HTTP ${s}`, s);
}

// Works on a fine-grained token with no extra permission.
export async function whoami(token: string): Promise<string> {
  const res = await request(token, '/user');
  if (!res.ok) throw fail(res);
  return String(((await res.json()) as { login?: unknown }).login ?? '');
}

export interface ReachEntry { fullName: string; isPrivate: boolean; }

// The repos the token can see. A fine-grained token limited to selected
// repositories is shown only the private repos it was selected on, so a
// second private repo here means the token was left on "All repositories".
// Public repos are shown to every token, and the per-repo permissions in the
// listing describe the user's own rights, not the token's, so for those the
// listing says nothing about reach: that is what probeReach is for.
export async function listReach(token: string): Promise<ReachEntry[]> {
  const res = await request(token, '/user/repos?affiliation=owner&per_page=100');
  if (!res.ok) throw fail(res);
  const rows = (await res.json()) as Array<{ full_name?: unknown; private?: unknown }>;
  return rows.map(r => ({ fullName: String(r.full_name ?? ''), isPrivate: r.private === true }));
}

// Whether the token was granted on a given public repo. Reading a public
// repo's contents works for any token, but its collaborators list needs a
// real grant on that repo: a token limited to other repos gets 403, a token
// left on "All repositories" gets 200 (verified against GitHub 2026-09-22).
export async function probeReach(token: string, fullName: string): Promise<boolean> {
  const res = await request(token, `/repos/${fullName}/collaborators?per_page=1`);
  if (res.status === 403 || res.status === 404) return false;
  if (!res.ok) throw fail(res);
  return true;
}

export function createGitHub(token: string, repo: string) {
  const meta: GitHubMeta = {};
  const contents = (path: string) => `/repos/${repo}/contents/${path}`;
  const call = (path: string, init?: RequestInit & { headers?: Record<string, string> }) =>
    request(token, path, init, meta);

  return {
    meta,

    // 404 here means the token cannot see the repo: fine-grained tokens get
    // a 404, not a 403, for repos that were not selected on them.
    async checkRepo(): Promise<void> {
      const res = await call(`/repos/${repo}`);
      if (!res.ok) throw fail(res);
    },

    async readManifest(etag?: string | null): Promise<ManifestRead> {
      const res = await call(contents(MANIFEST_PATH), etag ? { headers: { 'If-None-Match': etag } } : undefined);
      if (res.status === 304) return { status: 'unchanged' }; // free against the rate limit
      if (res.status === 404) return { status: 'missing' }; // nothing synced yet
      if (!res.ok) throw fail(res);
      const file = (await res.json()) as { content?: string; encoding?: string; sha?: string };
      const newEtag = res.headers.get('etag');
      const sha = String(file.sha ?? '');
      if (file.encoding === 'base64' && file.content) {
        return { status: 'ok', body: new TextDecoder().decode(fromBase64(file.content)), sha, etag: newEtag };
      }
      // Over 1 MB the API leaves `content` empty; the raw media type serves
      // files up to 100 MB. The sha from the first answer still applies.
      const raw = await call(contents(MANIFEST_PATH), { headers: { Accept: 'application/vnd.github.raw+json' } });
      if (!raw.ok) throw fail(raw);
      return { status: 'ok', body: await raw.text(), sha, etag: newEtag };
    },

    // `sha` is the version this write is based on; GitHub refuses the write if
    // the file has moved on since, which is the compare-and-swap that makes
    // concurrent browsers safe. Omitted only when creating the file.
    async writeManifest(body: string, sha: string | undefined, message: string): Promise<string> {
      const res = await call(contents(MANIFEST_PATH), {
        method: 'PUT',
        body: JSON.stringify({ message, content: toBase64(new TextEncoder().encode(body)), ...(sha ? { sha } : {}) }),
      });
      if (!res.ok) throw fail(res);
      return String(((await res.json()) as { content?: { sha?: string } }).content?.sha ?? '');
    },

    async listIcons(): Promise<Set<string>> {
      const res = await call(contents(ICONS_DIR));
      if (res.status === 404) return new Set(); // no custom icon uploaded yet
      if (!res.ok) throw fail(res);
      const ids = new Set<string>();
      for (const f of (await res.json()) as Array<{ name?: string; type?: string }>) {
        if (f.type === 'file' && f.name?.endsWith('.png')) ids.add(f.name.slice(0, -4));
      }
      return ids;
    },

    // Null for anything unusable, so one bad file degrades to a missing icon
    // and never stops a sync.
    async getIcon(id: string): Promise<string | null> {
      if (!SAFE_ID_RE.test(id)) return null;
      const res = await call(contents(`${ICONS_DIR}/${id}.png`), { headers: { Accept: 'application/vnd.github.raw+json' } });
      if (res.status === 404) return null;
      if (!res.ok) throw fail(res);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > MAX_ICON_BYTES || !PNG_MAGIC.every((b, i) => bytes[i] === b)) return null;
      return `data:image/png;base64,${toBase64(bytes)}`;
    },

    // Icon files are named by a unique id and never change, so a write can
    // only ever be a create: "already exists" is success, not a conflict.
    async putIcon(id: string, dataUri: string, message: string): Promise<void> {
      if (!SAFE_ID_RE.test(id)) return;
      const content = dataUri.slice(dataUri.indexOf(',') + 1);
      const res = await call(contents(`${ICONS_DIR}/${id}.png`), { method: 'PUT', body: JSON.stringify({ message, content }) });
      if (!res.ok && res.status !== 422 && res.status !== 409) throw fail(res);
    },
  };
}

export type GitHubClient = ReturnType<typeof createGitHub>;
