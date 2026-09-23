import { defineConfig } from 'wxt';

export default defineConfig({
  // Firefox 128+ supports MV3 (including content-script world: 'MAIN'), so
  // target MV3 on every browser rather than letting WXT fall back to its
  // MV2-by-default behavior for firefox.
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'Ubicon - Device Icons for UniFi',
    description:
      'Community and custom icons for clients that UniFi does not recognize. Visual overlay only, never touches your UniFi settings.',
    permissions: [
      'storage', 'unlimitedStorage', 'alarms', 'scripting', 'contextMenus', 'activeTab',
      // The page-state rule engine that lights up the toolbar icon on a
      // UniFi console the user has not enabled yet (shared/console-rules.ts).
      // Chrome shows no warning for it; Firefox does not have it.
      ...(browser === 'firefox' ? [] : ['declarativeContent']),
    ],
    host_permissions: [
      'https://unifi.ui.com/*',
      'https://cdn.jsdelivr.net/*',
    ],
    // User grants local-controller origins at runtime, on every target; WXT
    // converts this to each browser's MV3 equivalent as needed.
    optional_host_permissions: ['*://*/*'],
    icons: { 16: '/icon/16.png', 32: '/icon/32.png', 48: '/icon/48.png', 96: '/icon/96.png', 128: '/icon/128.png' },
    browser_specific_settings:
      // 140.0 desktop / 142.0 Android: the first Firefox versions that
      // understand gecko.data_collection_permissions, declared below, so the
      // minimum version follows that key. It also covers the older floor of
      // 128.0, the first version with content-script world: 'MAIN' (used by
      // the React props bridge, entrypoints/bridge.content.ts).
      //
      // data_collection_permissions is declared here on purpose: WXT does
      // not emit it, it only warns when it is missing. required: ['none']
      // states that using Ubicon never depends on collecting any data.
      // The optional category covers GitHub sync only, and is asked for at
      // the moment the user turns it on (shared/sync/permission.ts, which
      // must list the same name): the MAC addresses and labels in the synced
      // file. Mozilla counts a repository the user owns as data leaving the
      // browser.
      browser === 'firefox'
        ? {
            gecko: {
              id: 'ubicon@tvirelli.github.io',
              strict_min_version: '140.0',
              data_collection_permissions: {
                required: ['none'],
                optional: ['personallyIdentifyingInfo'],
              },
            },
            gecko_android: { strict_min_version: '142.0' },
          }
        : undefined,
  }),
});
