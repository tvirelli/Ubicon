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

  // content/state.ts: the clients table is the one whose rows have a
  // client-name cell. Other tables (devices, for one) also key rows by
  // data-row-id, so rows alone prove nothing. Once the column is there, at
  // least one cell must hold the icon image Ubicon replaces.
  const nameCells = root.querySelectorAll('tr[data-row-id] td[data-column-id="clientName"]');
  if (nameCells.length) {
    let withIcon = 0;
    for (const cell of nameCells) if (cell.querySelector(ICON_IMG)) withIcon++;
    note('clients-table', withIcon > 0);
  }

  // The property panel opens for devices, networks and settings as well as
  // clients, and only a client's panel carries an icon image. A panel with
  // one is a working client panel; a panel without one is simply not a
  // client panel, so it is never reported as broken.
  const panel = root.querySelector('.PROPERTY_PANEL_CLASSNAME');
  if (panel?.querySelector(ICON_IMG)) note('client-panel', true);

  // content/panel.ts ensureModalButton: the Change Icon dialog, known by its
  // text, needs a title element in its header for the Ubicon mark to sit
  // in. Other dialogs may carry fingerprint images too (the dashboard's
  // console picture is one), so the image alone does not identify it.
  for (const dialog of root.querySelectorAll('[role="dialog"][class*="modal__"]')) {
    if (!/\bChange Icon\b/.test(dialog.textContent ?? '')) continue;
    const title = dialog.querySelector(':scope > [class*="header__"] [class*="title__"]');
    note('change-icon-dialog', !!title);
    break;
  }

  return { present, broken };
}

// Best effort. UniFi does not announce its version on every page; these are
// the places it has been seen, and "unknown" is an honest answer.
export function readUnifiVersion(root: ParentNode): string {
  // "Network 10.6.106" appears on the dashboard (the first page after
  // login) in its versions panel, and on the settings overview page. Other
  // pages do not show it, so the content script remembers what it saw.
  // Seen on 10.6.106.
  const shown = root.querySelector('[data-testid="dashboard-network-version"], [data-testid="network-version"]');
  const m = /Network\s+(\d+(?:\.\d+)+)/.exec((shown?.textContent ?? '').replace(/\u00a0/g, ' '));
  if (m?.[1]) return m[1];
  const meta = root.querySelector<HTMLMetaElement>('meta[name="unifi-network-version"], meta[name="version"]');
  if (meta?.content && /^\d+\.\d+/.test(meta.content)) return meta.content;
  for (const script of root.querySelectorAll('script:not([src])')) {
    const m = /"version"\s*:\s*"(\d+\.\d+(?:\.\d+)?)"/.exec(script.textContent ?? '');
    if (m?.[1]) return m[1];
  }
  return 'unknown';
}

// The shell around Network, which the header hook lives in: Site Manager on
// unifi.ui.com, shown in the account menu (a popover that exists only while
// open), or UniFi OS on a local console, shown on the dashboard. Seen on
// Site Manager 5.2.23 and UniFi OS 5.1.33.
export function readShellVersion(root: ParentNode): string {
  const sm = root.querySelector('a[href*="/releases/r/site-manager/"]');
  const m1 = /Site Manager\s+(\d+(?:\.\d+)+)/.exec((sm?.textContent ?? '').replace(/ /g, ' '));
  if (m1?.[1]) return `Site Manager ${m1[1]}`;
  const os = root.querySelector('[data-testid="dashboard-unifi-os-version"]');
  const m2 = /UniFi OS\s+(\d+(?:\.\d+)+)/.exec((os?.textContent ?? '').replace(/ /g, ' '));
  if (m2?.[1]) return `UniFi OS ${m2[1]}`;
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
