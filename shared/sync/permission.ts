import { browser } from 'wxt/browser';

export const GITHUB_API_ORIGIN = 'https://api.github.com/*';

// Firefox (140+) wants every kind of data an extension sends off the machine
// declared, and counts a repository the user owns as "off the machine". This
// is the optional category from wxt.config.ts (keep the two in step), asked
// for only when the user turns sync on: the MAC addresses and labels in the
// synced file.
export const FIREFOX_DATA_COLLECTION = ['personallyIdentifyingInfo'] as const;

// Asks for everything GitHub sync needs, in one browser prompt.
//
// Call this FIRST in a click handler, before any await: Firefox drops a
// handler's user-input status the moment it awaits anything, and
// permissions.request then rejects. Same rule, same reason, as
// addConsoleOrigin in shared/consoles.ts. That is also why this is not an
// async function: nothing may run between the click and the request.
// Already-granted permissions resolve true without prompting again.
export function requestGitHubAccess(): Promise<boolean> {
  const wanted: Record<string, unknown> = { origins: [GITHUB_API_ORIGIN] };
  if (import.meta.env.FIREFOX) wanted['data_collection'] = [...FIREFOX_DATA_COLLECTION];
  return browser.permissions.request(wanted as Parameters<typeof browser.permissions.request>[0]);
}
