import { expect, test } from 'vitest';
import { classifyConsoleUrl, offerText } from '../shared/console-detect';

test('a UniFi OS console is recognised by the Network app path on a non-cloud origin', () => {
  expect(classifyConsoleUrl('https://10.2.0.1/network/default/dashboard')).toEqual({ kind: 'unifi-os', origin: 'https://10.2.0.1', host: '10.2.0.1' });
  expect(classifyConsoleUrl('http://192.168.1.1/network')).toEqual({ kind: 'unifi-os', origin: 'http://192.168.1.1', host: '192.168.1.1' });
});

test('a self-hosted Network controller is recognised by its manage path', () => {
  expect(classifyConsoleUrl('https://10.71.0.1:8443/manage/site/default/dashboard')).toEqual({ kind: 'classic', origin: 'https://10.71.0.1:8443', host: '10.71.0.1:8443' });
});

test('a private address or local name without the app path is a possible console, such as a login page', () => {
  expect(classifyConsoleUrl('https://10.2.0.1/').kind).toBe('maybe');
  expect(classifyConsoleUrl('https://192.168.0.5/login').kind).toBe('maybe');
  expect(classifyConsoleUrl('https://udm.local/').kind).toBe('maybe');
  expect(classifyConsoleUrl('https://unifi.home/').kind).toBe('maybe');
  expect(classifyConsoleUrl('https://unifi/').kind).toBe('maybe');
  expect(classifyConsoleUrl('https://gateway.lan:8443/').kind).toBe('maybe');
});

test('public websites, the cloud portal and browser pages are never offered', () => {
  expect(classifyConsoleUrl('https://www.google.com/').kind).toBe('no');
  expect(classifyConsoleUrl('https://unifi.ui.com/network/default/clients').kind).toBe('no');
  expect(classifyConsoleUrl('https://example.com/network/default').kind).toBe('no');
  expect(classifyConsoleUrl('chrome://extensions').kind).toBe('no');
  expect(classifyConsoleUrl(undefined).kind).toBe('no');
  expect(classifyConsoleUrl('not a url').kind).toBe('no');
});

test('the offer wording is confident for a recognised console and asks for a possible one', () => {
  expect(offerText({ kind: 'unifi-os', origin: 'https://10.2.0.1', host: '10.2.0.1' })).toBe('This is a UniFi console at 10.2.0.1. Turn on Ubicon here?');
  expect(offerText({ kind: 'classic', origin: 'https://10.71.0.1:8443', host: '10.71.0.1:8443' })).toBe('This is a UniFi Network controller at 10.71.0.1:8443. Turn on Ubicon here?');
  expect(offerText({ kind: 'maybe', origin: 'https://10.2.0.1', host: '10.2.0.1' })).toBe('Is 10.2.0.1 a UniFi console? Turn on Ubicon here and it will paint icons once you are signed in.');
});
