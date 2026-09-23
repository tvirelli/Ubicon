// Every selector Ubicon uses to find things on UniFi's page, in one table.
//
// Ubiquiti does not promise any of these; they are read off real consoles
// and recorded with the Network version they were confirmed on. When a
// future version changes the page, a new profile is added at the top and
// the old one stays, so every version that ever matched keeps matching.
// The painters (content/state.ts, content/panel.ts, content/bridge-core.ts)
// and the layout check (content/layout-check.ts) all read from here.

export interface SelectorHooks {
  // The header logo the badge sits next to. Must not be inside a link.
  headerLogo: string;
  // A clients-table row; its data-row-id is the MAC.
  clientRow: string;
  // The cell in that row holding the client's name and icon.
  clientNameCell: string;
  // The side panel for a selected client (also used for devices, networks).
  propertyPanel: string;
  // The tabs of the view switcher and the close control inside a tab whose
  // aria-label names the client.
  viewSwitcherTab: string;
  switcherTab: string;
  switcherClose: string;
  // Modal dialogs, their header, the title inside it, and the close button.
  modalDialog: string;
  modalHeader: string;
  modalTitle: string;
  modalClose: string;
  // The dark theme marker.
  darkTheme: string;
  // Any icon-shaped image Ubicon may paint: UniFi's fingerprint icons,
  // client photos, and images Ubicon has already painted.
  iconImage: string;
}

export interface SelectorProfile {
  name: string;
  // Lowest Network version this profile is meant for, inclusive.
  minVersion: string;
  // Versions it was confirmed on by hand.
  confirmedOn: string[];
  hooks: SelectorHooks;
}

// Newest first.
export const PROFILES: SelectorProfile[] = [
  {
    name: '10.6',
    minVersion: '10.6.0',
    confirmedOn: ['10.6.106'],
    hooks: {
      headerLogo: 'header svg[class*="Logo-module_logo__"]',
      clientRow: 'tr[data-row-id]',
      clientNameCell: 'td[data-column-id="clientName"]',
      propertyPanel: '.PROPERTY_PANEL_CLASSNAME',
      viewSwitcherTab: '[class*="viewSwitcher__"] [class*="switcherTab__"]',
      switcherTab: '[class*="switcherTab__"]',
      switcherClose: '[class*="switcherClose__"]',
      modalDialog: '[role="dialog"][class*="modal__"]',
      modalHeader: ':scope > [class*="header__"]',
      modalTitle: '[class*="title__"]',
      modalClose: '[class*="closeButton__"]',
      darkTheme: '[class*="-dark__"]',
      iconImage: 'img[src*="fingerprint/"], img[src*="/clients/photos/"], img[data-ubicon]',
    },
  },
];

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const known = (v: string) => /^\d+(\.\d+)*$/.test(v);

// The newest profile whose floor the version reaches; an unknown version
// gets the newest profile, a version below every floor gets the oldest.
export function profileFor(version: string, profiles: SelectorProfile[] = PROFILES): SelectorProfile {
  if (!known(version)) return profiles[0]!;
  for (const p of profiles) if (compareVersions(version, p.minVersion) >= 0) return p;
  return profiles[profiles.length - 1]!;
}

// Feature detection for when the version is not known: the first profile,
// newest first, whose identifying hooks find something on the page. A page
// with nothing to identify (login, console picker) gets the newest.
export function detectProfile(root: ParentNode, profiles: SelectorProfile[] = PROFILES): SelectorProfile {
  for (const p of profiles) {
    const h = p.hooks;
    if (root.querySelector(`${h.clientRow} ${h.clientNameCell}`) || root.querySelector(h.modalDialog)) return p;
    const logo = [...root.querySelectorAll(h.headerLogo)].find(s => !s.closest('a'));
    if (logo) return p;
  }
  return profiles[0]!;
}

let active: SelectorProfile = PROFILES[0]!;

export function getSelectors(): SelectorHooks { return active.hooks; }
export function activeProfileName(): string { return active.name; }
export function resetProfile(): void { active = PROFILES[0]!; }

export function activateProfile(root: ParentNode, version: string, profiles: SelectorProfile[] = PROFILES): { profile: string; by: 'version' | 'page' } {
  const by = known(version) ? 'version' : 'page';
  active = by === 'version' ? profileFor(version, profiles) : detectProfile(root, profiles);
  return { profile: active.name, by };
}

// Ubicon only has work inside the Network application; unifi.ui.com also
// serves the console picker, account pages and other applications.
export function isNetworkPage(pathname: string): boolean {
  return /^\/network(\/|$)/.test(pathname);
}
