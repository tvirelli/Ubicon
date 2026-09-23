import { expect, test } from 'vitest';
import { CONSOLE_PAGE_URL_RE, CONSOLE_LOGO_SELECTOR, consoleRuleConditions } from '../shared/console-rules';

// The browser's rule engine (declarativeContent, Chrome and Edge) evaluates
// these against each page; the extension never sees the address.
const re = new RegExp(CONSOLE_PAGE_URL_RE);

test('the page pattern matches the Network app and controller paths on private addresses', () => {
  for (const u of [
    'https://10.2.0.1/network/default/dashboard',
    'http://192.168.1.1/network',
    'https://172.16.0.5/network/default/clients',
    'https://10.71.0.1:8443/manage/site/default/dashboard',
    'https://udm.local/network/default/dashboard',
    'https://unifi/network',
    'https://gateway.lan:8443/manage/',
  ]) expect(re.test(u), u).toBe(true);
});

test('the page pattern never matches public sites, the cloud portal, or other paths', () => {
  for (const u of [
    'https://unifi.ui.com/network/default/clients',
    'https://example.com/network/default',
    'https://www.google.com/',
    'https://10.2.0.1/',
    'https://10.2.0.1/protect/default',
    'https://172.32.0.1/network',
    'chrome://extensions',
  ]) expect(re.test(u), u).toBe(false);
});

test('the pattern uses only syntax the rule engine accepts: no lookaround, no backreferences', () => {
  expect(CONSOLE_PAGE_URL_RE).not.toMatch(/\(\?[=!<]/);
  expect(CONSOLE_PAGE_URL_RE).not.toMatch(/\\[1-9]/);
});

test('the logo selector is a single compound selector, which is all the rule engine allows', () => {
  expect(CONSOLE_LOGO_SELECTOR).not.toMatch(/[\s>+~]/);
  expect(CONSOLE_LOGO_SELECTOR).toContain('Logo-module_logo__');
});

test('the conditions pair the private-address pattern with the app path, or with the UniFi logo on the page', () => {
  const c = consoleRuleConditions();
  expect(c).toHaveLength(2);
  expect(c[0]).toEqual({ pageUrl: { urlMatches: CONSOLE_PAGE_URL_RE } });
  expect(c[1]!.css).toEqual([CONSOLE_LOGO_SELECTOR]);
  expect(c[1]!.pageUrl.urlMatches).not.toBe(CONSOLE_PAGE_URL_RE);
  expect(new RegExp(c[1]!.pageUrl.urlMatches).test('https://10.2.0.1/')).toBe(true);
  expect(new RegExp(c[1]!.pageUrl.urlMatches).test('https://www.google.com/')).toBe(false);
});
