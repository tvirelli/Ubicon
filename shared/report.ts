// Builds the prefilled "Report this issue" and "Email us this" links. The
// body is assembled from a fixed list of fields and nothing else, so a MAC
// address, device name, site name or console URL can never end up in it.

export const SUPPORT_EMAIL = 'ubicon@tonyvirelli.com';
const ISSUES_URL = 'https://github.com/tvirelli/Ubicon/issues/new';
const LABEL = 'layout-change';

export interface ReportInput {
  // Present for a layout break, absent for a general problem report.
  hooks?: string[];
  unifiVersion?: string;
  shell?: string;
  console?: 'cloud' | 'local';
  path?: string;
  browser: string;
  ubiconVersion: string;
}

export interface Report {
  title: string;
  body: string;
  issueUrl: string;
  mailtoUrl: string;
}

export function detectBrowser(ua: string): string {
  const pick = (name: string, re: RegExp) => { const m = re.exec(ua); return m ? `${name} ${m[1]}` : null; };
  return pick('Edge', /\bEdg\/(\d+)/) ?? pick('Firefox', /\bFirefox\/(\d+)/) ?? pick('Chrome', /\bChrome\/(\d+)/) ?? 'unknown browser';
}

export function buildReport(input: ReportInput): Report {
  const layout = !!input.hooks?.length;
  const title = layout
    ? `Layout change detected: UniFi ${input.unifiVersion ?? 'unknown'}, ${input.hooks!.join(', ')}`
    : `Problem report: Ubicon ${input.ubiconVersion} on ${input.browser}`;

  const lines: string[] = [];
  if (layout) {
    lines.push('Ubicon noticed that UniFi\'s page layout no longer matches what it looks for.');
    lines.push('');
    lines.push(`Hooks that no longer match: ${input.hooks!.join(', ')}`);
    lines.push(`UniFi Network version: ${input.unifiVersion ?? 'unknown'}`);
    lines.push(`Shell: ${input.shell ?? 'unknown'}`);
    lines.push(`Console: ${input.console === 'local' ? 'local (self-hosted)' : 'cloud (unifi.ui.com)'}`);
    lines.push(`Page: ${input.path ?? 'unknown'}`);
  } else {
    lines.push('What happened:');
    lines.push('');
    lines.push('');
  }
  lines.push(`Browser: ${input.browser}`);
  lines.push(`Ubicon version: ${input.ubiconVersion}`);
  const body = lines.join('\n');

  const issue = new URL(ISSUES_URL);
  issue.searchParams.set('title', title);
  issue.searchParams.set('labels', layout ? LABEL : 'bug');
  issue.searchParams.set('body', body);

  // mailto takes percent encoding only: a mail client shows a "+" as a
  // literal plus sign, unlike a web form.
  const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  return { title, body, issueUrl: issue.toString(), mailtoUrl };
}
