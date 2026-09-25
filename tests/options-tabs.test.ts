// @vitest-environment happy-dom
// The settings page has two tabs, Assignments and Settings. Settings is the
// default so the links that opened the page before (sync manage, the
// browser's own options entry) land where they always did; the popup's
// Manage Assignments button opens the page with #assignments.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import { initTabs } from '../entrypoints/options/tabs';

const HTML = readFileSync(resolve(__dirname, '../entrypoints/options/index.html'), 'utf8');
const BODY = /<body>([\s\S]*)<\/body>/.exec(HTML)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');

function mountBody() {
  const parsed = new DOMParser().parseFromString(`<!doctype html><html><body>${BODY}</body></html>`, 'text/html');
  document.body.replaceChildren(...[...parsed.body.childNodes].map(n => document.importNode(n, true)));
}
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const selected = (id: string) => $(id).getAttribute('aria-selected');

beforeEach(() => {
  location.hash = '';
  mountBody();
});

test('Settings is the default tab and the existing sections live under it', () => {
  initTabs();
  expect($('panel-settings').hidden).toBe(false);
  expect($('panel-assignments').hidden).toBe(true);
  expect(selected('tab-settings')).toBe('true');
  expect(selected('tab-assignments')).toBe('false');
  expect($('panel-settings').contains($('sync'))).toBe(true);
  expect($('panel-settings').contains($('consoles-block'))).toBe(true);
  expect($('panel-settings').contains($('report-block'))).toBe(true);
  expect($('panel-assignments').contains($('assignments-block'))).toBe(true);
});

test('opening the page with #assignments selects the Assignments tab', () => {
  location.hash = '#assignments';
  initTabs();
  expect($('panel-assignments').hidden).toBe(false);
  expect($('panel-settings').hidden).toBe(true);
  expect(selected('tab-assignments')).toBe('true');
});

test('clicking a tab switches panels and records the choice in the hash', () => {
  initTabs();
  $('tab-assignments').click();
  expect($('panel-assignments').hidden).toBe(false);
  expect($('panel-settings').hidden).toBe(true);
  expect(location.hash).toBe('#assignments');
  $('tab-settings').click();
  expect($('panel-settings').hidden).toBe(false);
  expect(location.hash).toBe('#settings');
});
