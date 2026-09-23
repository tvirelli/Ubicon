import { expect, test } from 'vitest';
import { buildReport, detectBrowser, SUPPORT_EMAIL, type ReportInput } from '../shared/report';

const input: ReportInput = {
  hooks: ['clients-table', 'header'],
  unifiVersion: '9.3.45',
  console: 'cloud',
  path: '/network/default/clients',
  browser: 'Chrome 129',
  ubiconVersion: '0.4.0',
};

test('detectBrowser names the browser and its major version from the user agent', () => {
  expect(detectBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36')).toBe('Chrome 129');
  expect(detectBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.52')).toBe('Edge 129');
  expect(detectBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0')).toBe('Firefox 141');
  expect(detectBrowser('something else')).toBe('unknown browser');
});

test('a layout report has a fixed title naming the UniFi version and the hooks', () => {
  const r = buildReport(input);
  expect(r.title).toBe('Layout change detected: UniFi 9.3.45, clients-table, header');
});

test('the body carries only the allowed fields', () => {
  const r = buildReport(input);
  expect(r.body).toContain('Hooks that no longer match: clients-table, header');
  expect(r.body).toContain('UniFi Network version: 9.3.45');
  expect(r.body).toContain('Console: cloud (unifi.ui.com)');
  expect(r.body).toContain('Page: /network/default/clients');
  expect(r.body).toContain('Browser: Chrome 129');
  expect(r.body).toContain('Ubicon version: 0.4.0');
});

test('extra fields never reach the body, so nothing identifying can be added by mistake', () => {
  const r = buildReport({ ...input, mac: 'aa:bb:cc:dd:ee:ff', siteName: 'Home' } as ReportInput);
  expect(r.body).not.toMatch(/aa:bb:cc/);
  expect(r.body).not.toMatch(/Home/);
});

test('the issue link opens a prefilled new issue on the Ubicon repo with a label', () => {
  const r = buildReport(input);
  const u = new URL(r.issueUrl);
  expect(u.origin + u.pathname).toBe('https://github.com/tvirelli/Ubicon/issues/new');
  expect(u.searchParams.get('title')).toBe(r.title);
  expect(u.searchParams.get('labels')).toBe('layout-change');
  expect(u.searchParams.get('body')).toBe(r.body);
  expect(r.issueUrl.length).toBeLessThan(2000);
});

test('the email link goes to the support address with the same subject and body', () => {
  const r = buildReport(input);
  expect(r.mailtoUrl.startsWith(`mailto:${SUPPORT_EMAIL}?`)).toBe(true);
  const q = new URLSearchParams(r.mailtoUrl.slice(r.mailtoUrl.indexOf('?') + 1));
  expect(q.get('subject')).toBe(r.title);
  expect(q.get('body')).toBe(r.body);
  expect(r.mailtoUrl.length).toBeLessThan(1000);
  expect(SUPPORT_EMAIL).toBe('ubicon@tonyvirelli.com');
});

test('a general problem report has no hooks and leaves room for the user to describe it', () => {
  const r = buildReport({ browser: 'Firefox 141', ubiconVersion: '0.4.0' });
  expect(r.title).toBe('Problem report: Ubicon 0.4.0 on Firefox 141');
  expect(r.body).toContain('What happened:');
  expect(r.body).not.toContain('Hooks');
});

test('the email link uses percent encoding, never plus signs, so mail clients show real spaces', () => {
  const r = buildReport(input);
  const query = r.mailtoUrl.slice(r.mailtoUrl.indexOf('?') + 1);
  expect(query).not.toContain('+');
  const subject = /(?:^|&)subject=([^&]*)/.exec(query)![1]!;
  const body = /(?:^|&)body=([^&]*)/.exec(query)![1]!;
  expect(decodeURIComponent(subject)).toBe(r.title);
  expect(decodeURIComponent(body)).toBe(r.body);
  expect(body).toContain('%0A');
});

test('the body names the shell the header lives in when it is known', () => {
  const r = buildReport({ ...input, shell: 'Site Manager 5.2.23' });
  expect(r.body).toContain('Shell: Site Manager 5.2.23');
  expect(buildReport(input).body).toContain('Shell: unknown');
});
