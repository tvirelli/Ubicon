// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { initReportUi } from '../entrypoints/options/report';
import { saveBreak } from '../shared/layout-state';

const HTML = readFileSync(resolve(__dirname, '../entrypoints/options/index.html'), 'utf8');
const BODY = /<body>([\s\S]*)<\/body>/.exec(HTML)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');

function mountBody() {
  const parsed = new DOMParser().parseFromString(`<!doctype html><html><body>${BODY}</body></html>`, 'text/html');
  document.body.replaceChildren(...[...parsed.body.childNodes].map(n => document.importNode(n, true)));
}
const titleOf = (href: string) => new URL(href).searchParams.get('title') ?? '';
const bodyOf = (href: string) => new URL(href).searchParams.get('body') ?? '';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

beforeEach(() => {
  fakeBrowser.reset();
  (fakeBrowser.runtime as unknown as { getManifest: () => { version: string } }).getManifest = () => ({ version: '0.4.0' });
  mountBody();
});

test('the options page always offers the two prefilled report links', async () => {
  await initReportUi();
  const issue = $<HTMLAnchorElement>('report-issue').href;
  expect(issue.startsWith('https://github.com/tvirelli/Ubicon/issues/new?')).toBe(true);
  expect(titleOf(issue).startsWith('Problem report: Ubicon 0.4.0 on')).toBe(true);
  expect($<HTMLAnchorElement>('report-mail').href.startsWith('mailto:info@ubiconapp.com?')).toBe(true);
  expect($('layout-warning').hidden).toBe(true);
});

test('the options page shows the layout notice when a break is stored', async () => {
  await saveBreak({ signature: 'clients-table', hooks: ['clients-table'], unifiVersion: '9.3.45', console: 'cloud', path: '/network/default/clients', firstSeen: 1, lastSeen: 2 });
  await initReportUi();
  expect($('layout-warning').hidden).toBe(false);
  expect(titleOf($<HTMLAnchorElement>('layout-issue').href)).toContain('UniFi 9.3.45, clients-table');
});
