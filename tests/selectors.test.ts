// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import {
  PROFILES, activateProfile, compareVersions, detectProfile, getSelectors, isNetworkPage, profileFor, resetProfile,
  type SelectorProfile,
} from '../content/selectors';

afterEach(() => resetProfile());

const set = (html: string) => { document.body.innerHTML = html; return document; };

// Two made-up profiles for the choosing logic; the real table has one.
const OLD: SelectorProfile = { ...PROFILES[0]!, name: 'old', minVersion: '9.0.0', confirmedOn: ['9.3.45'], hooks: { ...PROFILES[0]!.hooks, clientNameCell: 'td[data-column-id="name"]' } };
const NEW: SelectorProfile = { ...PROFILES[0]!, name: 'new', minVersion: '10.6.0', confirmedOn: ['10.6.106'] };
const FAKE = [NEW, OLD];

test('compareVersions orders dotted numbers numerically, not as text', () => {
  expect(compareVersions('10.6.106', '10.6.9')).toBeGreaterThan(0);
  expect(compareVersions('10.6.106', '10.6.106')).toBe(0);
  expect(compareVersions('10.7', '10.6.106')).toBeGreaterThan(0);
  expect(compareVersions('9.3.45', '10.0.0')).toBeLessThan(0);
});

test('the shipped table has one profile, 10.6, confirmed on 10.6.106, newest first', () => {
  expect(PROFILES.map(p => p.name)).toEqual(['10.6']);
  expect(PROFILES[0]!.confirmedOn).toContain('10.6.106');
  expect(PROFILES[0]!.hooks.clientRow).toBe('tr[data-row-id]');
  expect(PROFILES[0]!.hooks.clientNameCell).toBe('td[data-column-id="clientName"]');
  expect(PROFILES[0]!.hooks.propertyPanel).toBe('.PROPERTY_PANEL_CLASSNAME');
  expect(PROFILES[0]!.hooks.headerLogo).toBe('header svg[class*="Logo-module_logo__"]');
});

test('profileFor picks the newest profile whose floor the version reaches', () => {
  expect(profileFor('10.6.106', FAKE).name).toBe('new');
  expect(profileFor('10.9.1', FAKE).name).toBe('new');
  expect(profileFor('9.3.45', FAKE).name).toBe('old');
  expect(profileFor('8.0.0', FAKE).name).toBe('old');
  expect(profileFor('unknown', FAKE).name).toBe('new');
});

test('detectProfile tries profiles newest first and keeps the one whose hooks match the page', () => {
  set('<table><tr data-row-id="aa:bb:cc:dd:ee:ff"><td data-column-id="name"><img src="x/fingerprint/1.png"></td></tr></table>');
  expect(detectProfile(document, FAKE).name).toBe('old');
  set('<table><tr data-row-id="aa:bb:cc:dd:ee:ff"><td data-column-id="clientName"><img src="x/fingerprint/1.png"></td></tr></table>');
  expect(detectProfile(document, FAKE).name).toBe('new');
  set('<main>login</main>');
  expect(detectProfile(document, FAKE).name).toBe('new');
});

test('activateProfile uses the version when known and the page when not, and getSelectors follows it', () => {
  set('<table><tr data-row-id="aa:bb:cc:dd:ee:ff"><td data-column-id="name"><img src="x/fingerprint/1.png"></td></tr></table>');
  expect(activateProfile(document, 'unknown', FAKE)).toEqual({ profile: 'old', by: 'page' });
  expect(getSelectors().clientNameCell).toBe('td[data-column-id="name"]');
  expect(activateProfile(document, '10.6.106', FAKE)).toEqual({ profile: 'new', by: 'version' });
  expect(getSelectors().clientNameCell).toBe('td[data-column-id="clientName"]');
});

test('the default selectors are the newest shipped profile', () => {
  expect(getSelectors()).toBe(PROFILES[0]!.hooks);
});

test('isNetworkPage is true only inside the Network application', () => {
  expect(isNetworkPage('/network/default/clients')).toBe(true);
  expect(isNetworkPage('/network/default/dashboard')).toBe(true);
  expect(isNetworkPage('/network')).toBe(true);
  expect(isNetworkPage('/consoles')).toBe(false);
  expect(isNetworkPage('/')).toBe(false);
  expect(isNetworkPage('/protect/default/dashboard')).toBe(false);
});
