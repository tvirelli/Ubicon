// Wires the layout-change notice (popup and options page) and the
// permanent "Report a problem" links (options page) to prefilled reports.
import { browser } from 'wxt/browser';
import { buildReport, detectBrowser } from './report';
import { dismissBreak, visibleBreak } from './layout-state';

export interface NoticeIds { aside: string; issue: string; mail: string; dismiss: string }
export interface ReportIds { issue: string; mail: string }
export interface Env { browser?: string; ubiconVersion?: string }

const $ = (id: string) => document.getElementById(id)!;

function env(over: Env): { browser: string; ubiconVersion: string } {
  let version = over.ubiconVersion;
  if (!version) {
    try { version = browser.runtime.getManifest().version; } catch { version = 'unknown'; }
  }
  return { browser: over.browser ?? detectBrowser(navigator.userAgent), ubiconVersion: version ?? 'unknown' };
}

export async function initLayoutNotice(ids: NoticeIds, over: Env = {}): Promise<void> {
  const aside = $(ids.aside);
  const brk = await visibleBreak();
  if (!brk) { aside.hidden = true; return; }
  const report = buildReport({ ...env(over), hooks: brk.hooks, unifiVersion: brk.unifiVersion, console: brk.console, path: brk.path });
  const issue = $(ids.issue) as HTMLAnchorElement;
  issue.href = report.issueUrl;
  issue.target = '_blank';
  issue.rel = 'noopener';
  ($(ids.mail) as HTMLAnchorElement).href = report.mailtoUrl;
  $(ids.dismiss).addEventListener('click', async () => {
    aside.hidden = true;
    await dismissBreak(brk.signature);
  });
  aside.hidden = false;
}

export function initProblemReport(ids: ReportIds, over: Env = {}): void {
  const report = buildReport(env(over));
  const issue = $(ids.issue) as HTMLAnchorElement;
  issue.href = report.issueUrl;
  issue.target = '_blank';
  issue.rel = 'noopener';
  ($(ids.mail) as HTMLAnchorElement).href = report.mailtoUrl;
}
