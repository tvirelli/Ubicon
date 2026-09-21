// Local-controller "console" origins the user has granted Ubicon access to
// beyond the manifest-declared https://unifi.ui.com. Three entry points all
// need the exact same add/remove/list behavior: Options' form, the toolbar
// icon's right-click "Add Current Console", and the popup's own Consoles
// section, so it lives here once rather than being reimplemented per entry
// point.
import { browser } from 'wxt/browser';
import { bridgeIdFor, paintIdFor, registrationsForOrigin } from './registrations';

export type AddConsoleResult = 'added' | 'already' | 'invalid' | 'denied';

export async function listConsoleOrigins(): Promise<string[]> {
  return ((await browser.storage.local.get('origins')).origins as string[] | undefined) ?? [];
}

export async function addConsoleOrigin(url: string | undefined): Promise<AddConsoleResult> {
  let parsed: URL;
  try {
    parsed = new URL(url ?? '');
  } catch {
    return 'invalid';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'invalid';
  const origin = parsed.origin;

  // unifi.ui.com is manifest-declared already; nothing to add for it.
  if (origin === 'https://unifi.ui.com') return 'already';

  // Must be the FIRST await on the path from the user gesture (menu click,
  // popup button click) to here. Firefox drops a handler's user-input status
  // the moment it awaits any promise, and permissions.request then rejects
  // with "may only be called from a user input handler"; Chrome keeps the
  // gesture alive for a few seconds, which is why an earlier storage read
  // here went unnoticed there. Callers must likewise not await anything
  // before calling addConsoleOrigin. An origin already granted resolves true
  // silently, so the already-stored check below costs the user no extra prompt.
  const granted = await browser.permissions.request({ origins: [origin + '/*'] });
  if (!granted) return 'denied';

  const origins = await listConsoleOrigins();
  if (origins.includes(origin)) return 'already';

  // Reuses the same shared registration shape ensureRegisteredOrigins uses,
  // so all callers stay in lockstep.
  await browser.scripting.registerContentScripts(registrationsForOrigin(origin)).catch(async err => {
    if (String(err).includes('Duplicate')) return; // already registered, fine
    throw err;
  });

  await browser.storage.local.set({ origins: [...origins, origin] });
  return 'added';
}

export async function removeConsoleOrigin(origin: string): Promise<void> {
  await browser.scripting.unregisterContentScripts({ ids: [paintIdFor(origin), bridgeIdFor(origin)] }).catch(() => {});
  const origins = await listConsoleOrigins();
  await browser.storage.local.set({ origins: origins.filter(o => o !== origin) });
}
