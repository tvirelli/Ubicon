// Rules for the browser's page-state engine (declarativeContent on Chrome
// and Edge): when a tab looks like a UniFi console on a private address,
// the toolbar icon switches to its "available here" state. The engine
// evaluates these itself; the extension is never told the address, which
// is why the permission carries no warning. Firefox has no such engine and
// keeps the click-driven offer only.
//
// The syntax is RE2: no lookaround, no backreferences.

const PRIVATE_HOST =
  '(10\\.\\d+\\.\\d+\\.\\d+|192\\.168\\.\\d+\\.\\d+|172\\.(1[6-9]|2\\d|3[01])\\.\\d+\\.\\d+|127\\.\\d+\\.\\d+\\.\\d+|169\\.254\\.\\d+\\.\\d+' +
  '|[a-z0-9-]+|[a-z0-9.-]+\\.(local|lan|home|internal|localdomain|arpa))(:\\d+)?';

// The Network app or a self-hosted controller, on a private address.
export const CONSOLE_PAGE_URL_RE = `^https?://${PRIVATE_HOST}/(network|manage)(/|$)`;

// Any page on a private address; paired with the logo below.
export const PRIVATE_PAGE_URL_RE = `^https?://${PRIVATE_HOST}/`;

// The UniFi header logo, the same hook the badge uses (content/selectors.ts),
// as a single compound selector, which is all the engine accepts.
export const CONSOLE_LOGO_SELECTOR = 'svg[class*="Logo-module_logo__"]';

export interface RuleCondition {
  pageUrl: { urlMatches: string };
  css?: string[];
}

export function consoleRuleConditions(): RuleCondition[] {
  return [
    { pageUrl: { urlMatches: CONSOLE_PAGE_URL_RE } },
    { pageUrl: { urlMatches: PRIVATE_PAGE_URL_RE }, css: [CONSOLE_LOGO_SELECTOR] },
  ];
}
