// The setup code is how a second browser joins: one string that carries the
// repo and the token, so the user pastes once. It is a secret (it contains
// the token) and the UI says so. base64url keeps it to characters that
// survive chat apps, email and double-click selection.
const PREFIX = 'ubicon1.';

export interface SetupCode { repo: string; token: string; readOnly: boolean; }

const toBase64Url = (s: string) => {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
};

export const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

export function encodeSetupCode(c: SetupCode): string {
  return PREFIX + toBase64Url(JSON.stringify({ r: c.repo, t: c.token, ...(c.readOnly ? { ro: true } : {}) }));
}

// Null for anything that is not a well-formed setup code: this parses text a
// user pasted, so it must never throw.
export function decodeSetupCode(text: string): SetupCode | null {
  const code = text.trim();
  if (!code.startsWith(PREFIX)) return null;
  try {
    const o = JSON.parse(fromBase64Url(code.slice(PREFIX.length))) as { r?: unknown; t?: unknown; ro?: unknown };
    if (typeof o.r !== 'string' || !REPO_RE.test(o.r) || typeof o.t !== 'string' || !o.t) return null;
    return { repo: o.r, token: o.t, readOnly: o.ro === true };
  } catch {
    return null;
  }
}

// Lets the wizard react the moment something is pasted: fine-grained tokens
// are the only kind that can be limited to one repo, and people who already
// have a classic token lying around will try it.
export function looksLikeToken(text: string): 'fine-grained' | 'classic' | 'unknown' {
  const t = text.trim();
  if (t.startsWith('github_pat_')) return 'fine-grained';
  if (/^gh[opusr]_/.test(t)) return 'classic';
  return 'unknown';
}
