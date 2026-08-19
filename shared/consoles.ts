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

  const origins = await listConsoleOrigins();
  if (origins.includes(origin)) return 'already';

  // Valid only when called synchronously from a user gesture (a menu click,
  // a popup button click). One quick storage.local read (the already-stored
  // check just above) precedes this; that ordering is spec-required, not
  // incidental, but callers must not add any further awaits before this
  // point, or browsers may no longer consider the request gesture-triggered.
  const granted = await browser.permissions.request({ origins: [origin + '/*'] });
  if (!granted) return 'denied';

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
