// Recognises a UniFi console from a tab's address, so the popup can offer to
// turn Ubicon on there with one click instead of a typed address.
//
// An extension cannot scan the network, and local consoles answer with
// self-signed certificates that block probing, so "discovery" means noticing
// the console the user is already looking at.

export type ConsoleKind = 'unifi-os' | 'classic' | 'maybe' | 'no';

export interface ConsoleGuess {
  kind: ConsoleKind;
  origin: string;
  host: string;
}

const NONE: ConsoleGuess = { kind: 'no', origin: '', host: '' };

// Private IPv4 ranges, loopback, and names that only resolve on a LAN.
function isLocalHost(hostname: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(hostname);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  if (!hostname.includes('.')) return true;
  return /\.(local|lan|home|internal|localdomain|arpa)$/i.test(hostname);
}

export function classifyConsoleUrl(url: string | undefined): ConsoleGuess {
  let u: URL;
  try { u = new URL(url ?? ''); } catch { return NONE; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return NONE;
  // The cloud portal is manifest-declared; nothing to offer there.
  if (u.hostname === 'unifi.ui.com') return NONE;
  const guess = { origin: u.origin, host: u.host };
  const local = isLocalHost(u.hostname);
  // The Network app's own paths are proof enough on a local address; a
  // public site is never offered, whatever its path looks like.
  if (!local) return NONE;
  if (/^\/network(\/|$)/.test(u.pathname)) return { kind: 'unifi-os', ...guess };
  if (/^\/manage(\/|$)/.test(u.pathname)) return { kind: 'classic', ...guess };
  return { kind: 'maybe', ...guess };
}

export function offerText(g: ConsoleGuess): string {
  if (g.kind === 'unifi-os') return `This is a UniFi console at ${g.host}. Turn on Ubicon here?`;
  if (g.kind === 'classic') return `This is a UniFi Network controller at ${g.host}. Turn on Ubicon here?`;
  return `Is ${g.host} a UniFi console? Turn on Ubicon here and it will paint icons once you are signed in.`;
}
