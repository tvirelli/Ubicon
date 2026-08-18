import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: ({ browser }) => ({
    name: 'Ubicon — Device Icons for UniFi',
    description:
      'Assign community and custom icons to network clients that UniFi does not recognize. Visual overlay only — never touches your UniFi settings.',
    permissions: ['storage', 'unlimitedStorage', 'alarms', 'scripting'],
    host_permissions: [
      'https://unifi.ui.com/*',
      'https://cdn.jsdelivr.net/*',
    ],
    // Chromium: user grants local-controller origins at runtime.
    ...(browser === 'firefox'
      ? { optional_permissions: ['*://*/*'] }
      : { optional_host_permissions: ['*://*/*'] }),
    icons: { 16: '/icon/16.png', 32: '/icon/32.png', 48: '/icon/48.png', 96: '/icon/96.png', 128: '/icon/128.png' },
    browser_specific_settings:
      // 128.0: minimum Firefox version supporting content-script world: 'MAIN'
      // (used by the React props bridge, entrypoints/bridge.content.ts).
      browser === 'firefox' ? { gecko: { id: 'ubicon@tvirelli.github.io', strict_min_version: '128.0' } } : undefined,
  }),
});
