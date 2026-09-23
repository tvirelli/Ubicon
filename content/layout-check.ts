// Notices when UniFi's page no longer matches the hooks Ubicon paints
// through, so the user can be told instead of seeing icons silently vanish.
//
// A hook counts as broken only when its parent is on the page but the piece
// Ubicon needs inside it is not. A login screen, an empty site or a closed
// panel therefore never trips it.

export type HookName = 'header' | 'clients-table' | 'client-panel' | 'change-icon-dialog';

// Fixed order, so a signature built from a set of hooks is always the same
// string for the same set.
export const HOOK_ORDER: HookName[] = ['header', 'clients-table', 'client-panel', 'change-icon-dialog'];

export interface HookCheck {
  present: HookName[];
  broken: HookName[];
}

const ICON_IMG = 'img[src*="fingerprint/"], img[src*="/clients/photos/"], img[data-ubicon]';

export function checkHooks(root: ParentNode): HookCheck {
  const present: HookName[] = [];
  const broken: HookName[] = [];
  const note = (name: HookName, ok: boolean) => { present.push(name); if (!ok) broken.push(name); };

  // content/panel.ts ensureHeaderBadge: the logo SVG that is not a link.
  const header = root.querySelector('header');
  if (header) {
    const logo = [...header.querySelectorAll('svg[class*="Logo-module_logo__"]')].find(s => !s.closest('a'));
    note('header', !!logo);
  }

  // content/state.ts: rows keyed by MAC, each with a client-name cell that
  // holds the icon image Ubicon replaces.
  const rows = root.querySelectorAll('tr[data-row-id]');
  if (rows.length) {
    let withIcon = 0;
    for (const row of rows) if (row.querySelector(`td[data-column-id="clientName"] ${ICON_IMG}`)) withIcon++;
    note('clients-table', withIcon > 0);
    // The property panel is only open some of the time, so its absence is
    // not a break; when it is open it must hold an icon image.
    const panel = root.querySelector('.PROPERTY_PANEL_CLASSNAME');
    if (panel) note('client-panel', !!panel.querySelector(ICON_IMG));
  }

  // content/panel.ts ensureModalButton: a Change Icon dialog needs a title
  // in its header for the Ubicon mark to sit in.
  for (const dialog of root.querySelectorAll('[role="dialog"][class*="modal__"]')) {
    if (!dialog.querySelector('img[src*="fingerprint"]')) continue;
    const title = dialog.querySelector(':scope > [class*="header__"] [class*="title__"]');
    note('change-icon-dialog', !!title);
    break;
  }

  return { present, broken };
}

// Best effort. UniFi does not announce its version on every page; these are
// the places it has been seen, and "unknown" is an honest answer.
export function readUnifiVersion(root: ParentNode): string {
  const meta = root.querySelector<HTMLMetaElement>('meta[name="unifi-network-version"], meta[name="version"]');
  if (meta?.content && /^\d+\.\d+/.test(meta.content)) return meta.content;
  for (const script of root.querySelectorAll('script:not([src])')) {
    const m = /"version"\s*:\s*"(\d+\.\d+(?:\.\d+)?)"/.exec(script.textContent ?? '');
    if (m?.[1]) return m[1];
  }
  return 'unknown';
}

export interface LayoutBreakSeen {
  hooks: HookName[];
  signature: string;
  at: number;
}

export const signatureOf = (hooks: HookName[]): string =>
  HOOK_ORDER.filter(h => hooks.includes(h)).join('+');

const SETTLE_MS = 5_000;
const GAP_MS = 2_000;
const STRIKES = 3;

// Turns a stream of checks into a decision. A break is declared only after
// the page has been up for a while and the same hooks have failed on three
// checks spaced at least two seconds apart. Any healthy check in between
// starts the count over.
export class LayoutMonitor {
  private readonly startedAt: number;
  private strikes = 0;
  private lastStrikeAt = -Infinity;
  private lastSignature = '';
  private declared: string | null = null;

  constructor(opts: { startedAt: number }) { this.startedAt = opts.startedAt; }

  observe(check: HookCheck, now: number): LayoutBreakSeen | null {
    if (!check.broken.length) { this.reset(); return null; }
    if (now - this.startedAt < SETTLE_MS) return null;
    const signature = signatureOf(check.broken);
    if (signature !== this.lastSignature) { this.strikes = 0; this.lastSignature = signature; this.lastStrikeAt = -Infinity; }
    if (now - this.lastStrikeAt < GAP_MS) return null;
    this.strikes++;
    this.lastStrikeAt = now;
    if (this.strikes < STRIKES) return null;
    this.declared = signature;
    return { hooks: HOOK_ORDER.filter(h => check.broken.includes(h)), signature, at: now };
  }

  // A break remembered from an earlier page load: treated as declared so
  // the first healthy check clears it instead of leaving it stale.
  assumeDeclared(signature: string): void { this.declared = signature; }

  // True once, the first time a healthy check follows a declared break.
  recovered(check: HookCheck): boolean {
    if (check.broken.length || !this.declared) return false;
    this.declared = null;
    this.reset();
    return true;
  }

  private reset(): void { this.strikes = 0; this.lastStrikeAt = -Infinity; this.lastSignature = ''; }
}
