// @vitest-environment happy-dom
import { beforeEach, expect, test } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { initLayoutNotice, initProblemReport } from '../shared/layout-notice';
import { saveBreak, visibleBreak } from '../shared/layout-state';

const IDS = { aside: 'layout-warning', issue: 'layout-issue', mail: 'layout-mail', dismiss: 'layout-dismiss' };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const titleOf = (href: string) => new URL(href).searchParams.get('title') ?? '';
const bodyOf = (href: string) => new URL(href).searchParams.get('body') ?? '';
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };

function mount() {
  document.body.replaceChildren();
  const aside = document.createElement('aside'); aside.id = IDS.aside; aside.hidden = true;
  const issue = document.createElement('a'); issue.id = IDS.issue;
  const mail = document.createElement('a'); mail.id = IDS.mail;
  const dismiss = document.createElement('button'); dismiss.id = IDS.dismiss;
  aside.append(issue, mail, dismiss);
  const rIssue = document.createElement('a'); rIssue.id = 'report-issue';
  const rMail = document.createElement('a'); rMail.id = 'report-mail';
  document.body.append(aside, rIssue, rMail);
}

beforeEach(() => {
  fakeBrowser.reset();
  (fakeBrowser.runtime as unknown as { getManifest: () => { version: string } }).getManifest = () => ({ version: '0.4.0' });
  mount();
});

const brk = {
  signature: 'clients-table', hooks: ['clients-table'], unifiVersion: '9.3.45',
  console: 'cloud' as const, path: '/network/default/clients', firstSeen: 1, lastSeen: 2,
};

test('with no stored break the notice stays hidden', async () => {
  await initLayoutNotice(IDS, { browser: 'Chrome 129' });
  expect($('layout-warning').hidden).toBe(true);
});

test('a stored break shows the notice with both prefilled links', async () => {
  await saveBreak(brk);
  await initLayoutNotice(IDS, { browser: 'Chrome 129' });
  expect($('layout-warning').hidden).toBe(false);
  const issue = $<HTMLAnchorElement>('layout-issue').href;
  expect(issue.startsWith('https://github.com/tvirelli/Ubicon/issues/new?')).toBe(true);
  expect(titleOf(issue)).toBe('Layout change detected: UniFi 9.3.45, clients-table');
  expect(bodyOf(issue)).toContain('Ubicon version: 0.4.0');
  expect($<HTMLAnchorElement>('layout-mail').href.startsWith('mailto:ubicon@tonyvirelli.com?')).toBe(true);
});

test('dismiss hides the notice and remembers the signature', async () => {
  await saveBreak(brk);
  await initLayoutNotice(IDS, { browser: 'Chrome 129' });
  $('layout-dismiss').click();
  await flush();
  expect($('layout-warning').hidden).toBe(true);
  expect(await visibleBreak()).toBeNull();
  mount();
  await initLayoutNotice(IDS, { browser: 'Chrome 129' });
  expect($('layout-warning').hidden).toBe(true);
});

test('the general report links carry the browser and version and no hooks', async () => {
  await initProblemReport({ issue: 'report-issue', mail: 'report-mail' }, { browser: 'Firefox 141' });
  const issue = $<HTMLAnchorElement>('report-issue').href;
  expect(titleOf(issue)).toBe('Problem report: Ubicon 0.4.0 on Firefox 141');
  expect(bodyOf(issue)).not.toContain('Hooks');
  expect($<HTMLAnchorElement>('report-mail').href.startsWith('mailto:ubicon@tonyvirelli.com?')).toBe(true);
});
