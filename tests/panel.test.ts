// @vitest-environment happy-dom
import { beforeEach, expect, test } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ensureModalButton, ensureHeaderBadge } from '../content/panel';

beforeEach(() => fakeBrowser.reset());

function changeIconModalDom() {
  document.body.innerHTML = `
    <div role="dialog" class="modal__x">
      <header class="header__x"><div class="title__x">Change Icon</div></header>
      <img src="https://static.ui.com/fingerprint/0/1_129x129.png">
    </div>`;
}

function headerDom() {
  document.body.innerHTML = `
    <header>
      <a data-testid="applink-site-network"><svg class="Logo-module_logo__x" width="28px"></svg></a>
      <div><svg class="Logo-module_logo__x" width="50px"></svg></div>
    </header>`;
}

test('ensureModalButton injects the trigger into the title div without throwing', () => {
  changeIconModalDom();
  expect(() => ensureModalButton(document)).not.toThrow();
  const title = document.querySelector('.title__x')!;
  const btn = title.querySelector('#ubicon-modal-btn');
  expect(btn).not.toBeNull();
  expect(document.querySelector('#ubicon-modal-btn')).toBe(btn);
});

test('ensureModalButton is idempotent: calling twice does not duplicate', () => {
  changeIconModalDom();
  ensureModalButton(document);
  ensureModalButton(document);
  const title = document.querySelector('.title__x')!;
  expect(title.querySelectorAll('#ubicon-modal-btn').length).toBe(1);
});

test('ensureHeaderBadge injects the badge right after the 50px center logo, not the 28px nav one', () => {
  headerDom();
  expect(() => ensureHeaderBadge(document)).not.toThrow();
  const badge = document.getElementById('ubicon-header-badge');
  expect(badge).not.toBeNull();
  const bigLogo = document.querySelector('svg[width="50px"]')!;
  const smallLogo = document.querySelector('svg[width="28px"]')!;
  expect(bigLogo.nextElementSibling).toBe(badge);
  expect(smallLogo.nextElementSibling).not.toBe(badge);
});

test('ensureHeaderBadge is idempotent: calling twice does not duplicate', () => {
  headerDom();
  ensureHeaderBadge(document);
  ensureHeaderBadge(document);
  expect(document.querySelectorAll('#ubicon-header-badge').length).toBe(1);
});

test('the header badge can be switched to the warning state and back', async () => {
  const { setHeaderBadgeState } = await import('../content/panel');
  headerDom();
  ensureHeaderBadge(document);
  const host = document.getElementById('ubicon-header-badge')!;
  expect(host.title).toBe('Ubicon is active');
  setHeaderBadgeState('warn');
  expect(host.title).toBe("UniFi's layout changed. Ubicon may not work until an update.");
  expect(host.dataset.state).toBe('warn');
  setHeaderBadgeState('ok');
  expect(host.title).toBe('Ubicon is active');
  expect(host.dataset.state).toBe('ok');
});

test('a badge created while the state is already warn starts amber', async () => {
  const { setHeaderBadgeState } = await import('../content/panel');
  setHeaderBadgeState('warn');
  headerDom();
  ensureHeaderBadge(document);
  expect(document.getElementById('ubicon-header-badge')!.dataset.state).toBe('warn');
  setHeaderBadgeState('ok');
});

// The amber badge opens an on-page dialog with the report actions. Its
// shadow root is closed, so it is caught as it is attached.
async function badgeDialog() {
  const { setHeaderBadgeState, setLayoutBreak } = await import('../content/panel');
  const roots: ShadowRoot[] = [];
  const { vi } = await import('vitest');
  const attach = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    const root = attach.call(this, init);
    roots.push(root);
    return root;
  });
  (fakeBrowser.runtime as unknown as { getManifest: () => { version: string } }).getManifest = () => ({ version: '0.4.0' });
  setLayoutBreak({ signature: 'clients-table', hooks: ['clients-table'], unifiVersion: '9.3.45', console: 'cloud', path: '/network/default/clients', firstSeen: 1, lastSeen: 2 });
  setHeaderBadgeState('warn');
  headerDom();
  ensureHeaderBadge(document);
  const host = document.getElementById('ubicon-header-badge')!;
  return { host, roots, setHeaderBadgeState, setLayoutBreak, vi };
}

test('clicking the amber badge opens a dialog with the GitHub, email and dismiss actions', async () => {
  const { host, roots, setHeaderBadgeState, setLayoutBreak, vi } = await badgeDialog();
  host.click();
  const dlgHost = document.getElementById('ubicon-layout-dialog');
  expect(dlgHost).not.toBeNull();
  const root = roots.find(r => r.host === dlgHost)!;
  expect(root.querySelector('header')!.textContent).toContain("UniFi's layout changed");
  const gh = root.querySelector<HTMLAnchorElement>('a[data-action="github"]')!;
  expect(gh.href.startsWith('https://github.com/tvirelli/Ubicon/issues/new?')).toBe(true);
  expect(new URL(gh.href).searchParams.get('title')).toBe('Layout change detected: UniFi 9.3.45, clients-table');
  expect(gh.target).toBe('_blank');
  const mail = root.querySelector<HTMLAnchorElement>('a[data-action="email"]')!;
  expect(mail.href.startsWith('mailto:info@ubiconapp.com?')).toBe(true);
  expect(root.querySelector('button[data-action="dismiss"]')).not.toBeNull();
  setHeaderBadgeState('ok'); setLayoutBreak(null); vi.restoreAllMocks();
});

test('dismiss closes the dialog and leaves the badge amber', async () => {
  const { host, roots, setHeaderBadgeState, setLayoutBreak, vi } = await badgeDialog();
  host.click();
  const dlgHost = document.getElementById('ubicon-layout-dialog')!;
  const root = roots.find(r => r.host === dlgHost)!;
  root.querySelector<HTMLButtonElement>('button[data-action="dismiss"]')!.click();
  expect(document.getElementById('ubicon-layout-dialog')).toBeNull();
  expect(host.dataset.state).toBe('warn');
  setHeaderBadgeState('ok'); setLayoutBreak(null); vi.restoreAllMocks();
});

test('clicking the badge while it is purple opens nothing', async () => {
  const { setHeaderBadgeState, setLayoutBreak, vi } = await badgeDialog();
  setHeaderBadgeState('ok');
  document.getElementById('ubicon-header-badge')!.click();
  expect(document.getElementById('ubicon-layout-dialog')).toBeNull();
  setLayoutBreak(null); vi.restoreAllMocks();
});

test('a badge left behind by an earlier script instance is replaced, not adopted', async () => {
  const { setHeaderBadgeState } = await import('../content/panel');
  headerDom();
  const orphan = document.createElement('span');
  orphan.id = 'ubicon-header-badge';
  orphan.title = 'Ubicon is active';
  document.querySelector('header div')!.append(orphan);
  setHeaderBadgeState('warn');
  ensureHeaderBadge(document);
  const host = document.getElementById('ubicon-header-badge')!;
  expect(host).not.toBe(orphan);
  expect(document.querySelectorAll('#ubicon-header-badge').length).toBe(1);
  expect(host.dataset.state).toBe('warn');
  setHeaderBadgeState('ok');
});
