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
    permissions: ['storage', 'unlimitedStorage', 'alarms', 'scripting', 'contextMenus', 'activeTab'],
    host_permissions: [
      'https://unifi.ui.com/*',
      'https://cdn.jsdelivr.net/*',
    ],
    // User grants local-controller origins at runtime, on every target; WXT
    // converts this to each browser's MV3 equivalent as needed.
    optional_host_permissions: ['*://*/*'],
    icons: { 16: '/icon/16.png', 32: '/icon/32.png', 48: '/icon/48.png', 96: '/icon/96.png', 128: '/icon/128.png' },
    browser_specific_settings:
      // 128.0: minimum Firefox version supporting content-script world: 'MAIN'
      // (used by the React props bridge, entrypoints/bridge.content.ts).
      browser === 'firefox' ? { gecko: { id: 'ubicon@tvirelli.github.io', strict_min_version: '128.0' } } : undefined,
  }),
});
