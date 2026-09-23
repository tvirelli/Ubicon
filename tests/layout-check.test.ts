// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { checkHooks, LayoutMonitor, readUnifiVersion, type HookCheck, type HookName } from '../content/layout-check';

const LOGO = '<header><div><svg class="Logo-module_logo__x"></svg></div></header>';
const ROW = (withIcon = true) => `
  <table><tbody><tr data-row-id="aa:bb:cc:dd:ee:ff">
    <td data-column-id="clientName">${withIcon ? '<img src="https://static.ui.com/fingerprint/0/1_129x129.png">' : 'Printer'}</td>
  </tr></tbody></table>`;
const PANEL = '<div class="PROPERTY_PANEL_CLASSNAME"><img src="https://static.ui.com/fingerprint/0/1_129x129.png"></div>';
const DIALOG = (withTitle = true) => `
  <div role="dialog" class="modal__x">
    ${withTitle ? '<header class="header__x"><div class="title__x">Change Icon</div></header>' : '<header class="header__x"></header>'}
    <img src="https://static.ui.com/fingerprint/0/1_129x129.png">
  </div>`;

const failing1: HookCheck = { present: ['clients-table'], broken: ['clients-table'] };
const set = (html: string) => { document.body.innerHTML = html; return document; };
const broken = (html: string): HookName[] => checkHooks(set(html)).broken;

test('a healthy page reports every present hook and nothing broken', () => {
  const r = checkHooks(set(LOGO + ROW() + PANEL + DIALOG()));
  expect(r.broken).toEqual([]);
  expect(r.present).toEqual(['header', 'clients-table', 'client-panel', 'change-icon-dialog']);
});

test('an empty page (login screen, no console) has nothing present and nothing broken', () => {
  const r = checkHooks(set('<main><form></form></main>'));
  expect(r.present).toEqual([]);
  expect(r.broken).toEqual([]);
});

test('rows without a client-name cell holding an image mean the table hook broke', () => {
  expect(broken(LOGO + ROW(false))).toEqual(['clients-table']);
});

test('a header without a logo outside a link means the header hook broke', () => {
  expect(broken('<header><a><svg class="Logo-module_logo__x"></svg></a></header>' + ROW())).toEqual(['header']);
});

test('a Change Icon dialog without a title to hold the mark means the dialog hook broke', () => {
  expect(broken(LOGO + ROW() + DIALOG(false))).toEqual(['change-icon-dialog']);
});

test('rows with icons but no property panel is not a break (the panel is only open sometimes)', () => {
  expect(broken(LOGO + ROW())).toEqual([]);
});

test('readUnifiVersion reads the Network version from the dashboard panel, non-breaking space included', () => {
  const dash = '<div data-testid="dashboard-network-version"><span>Network&nbsp;10.6.106</span><span>Up to date</span></div>'
    + '<div data-testid="dashboard-unifi-os-version"><span>UniFi OS&nbsp;5.1.33</span></div>';
  expect(readUnifiVersion(set(dash))).toBe('10.6.106');
  const settings = '<li><span data-testid="network-version">Network 10.6.106</span></li>';
  expect(readUnifiVersion(set(settings))).toBe('10.6.106');
});

test('readUnifiVersion finds a version in the page and falls back to unknown', () => {
  expect(readUnifiVersion(set('<script>window.__CONFIG__={"version":"9.3.45"}</script>'))).toBe('9.3.45');
  expect(readUnifiVersion(set('<meta name="unifi-network-version" content="9.4.0">'))).toBe('9.4.0');
  expect(readUnifiVersion(set('<div>nothing</div>'))).toBe('unknown');
});

// The monitor decides when a failing check is a real break: only after the
// page has been up a while, and only when the same hooks keep failing on
// several checks spaced apart.
test('the monitor stays quiet until the page has been up for five seconds', () => {
  const m = new LayoutMonitor({ startedAt: 0 });
  expect(m.observe(failing1, 1_000)).toBeNull();
  expect(m.observe(failing1, 4_000)).toBeNull();
});

test('the monitor needs three failing checks at least two seconds apart', () => {
  const m = new LayoutMonitor({ startedAt: 0 });
  const failing: HookCheck = { present: ['clients-table'], broken: ['clients-table'] };
  expect(m.observe(failing, 6_000)).toBeNull();
  expect(m.observe(failing, 6_500)).toBeNull(); // too soon, does not count
  expect(m.observe(failing, 8_100)).toBeNull();
  const b = m.observe(failing, 10_200);
  expect(b).not.toBeNull();
  expect(b!.hooks).toEqual(['clients-table']);
  expect(b!.signature).toBe('clients-table');
});

test('a healthy check in between resets the count', () => {
  const m = new LayoutMonitor({ startedAt: 0 });
  const failing: HookCheck = { present: ['clients-table'], broken: ['clients-table'] };
  const healthy: HookCheck = { present: ['clients-table'], broken: [] };
  m.observe(failing, 6_000);
  m.observe(failing, 8_100);
  m.observe(healthy, 9_000);
  expect(m.observe(failing, 11_000)).toBeNull();
});

test('the signature lists the broken hooks in a fixed order so the same break always matches', () => {
  const m = new LayoutMonitor({ startedAt: 0 });
  const failing: HookCheck = { present: ['header', 'clients-table'], broken: ['clients-table', 'header'] };
  m.observe(failing, 6_000);
  m.observe(failing, 8_100);
  expect(m.observe(failing, 10_200)!.signature).toBe('header+clients-table');
});

test('after a break, a healthy check reports recovery once', () => {
  const m = new LayoutMonitor({ startedAt: 0 });
  const failing: HookCheck = { present: ['clients-table'], broken: ['clients-table'] };
  const healthy: HookCheck = { present: ['clients-table'], broken: [] };
  m.observe(failing, 6_000); m.observe(failing, 8_100); m.observe(failing, 10_200);
  expect(m.recovered(healthy)).toBe(true);
  expect(m.recovered(healthy)).toBe(false);
});

test('a break remembered from an earlier page load counts as declared, so a healthy page recovers from it', () => {
  const m = new LayoutMonitor({ startedAt: 0 });
  m.assumeDeclared('clients-table');
  const healthy: HookCheck = { present: ['clients-table'], broken: [] };
  expect(m.recovered(healthy)).toBe(true);
  expect(m.recovered(healthy)).toBe(false);
});
