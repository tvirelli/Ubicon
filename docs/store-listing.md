# Store listing draft

## Submission metadata

- Privacy policy URL: https://github.com/tvirelli/Ubicon/blob/main/PRIVACY.md
- Homepage / support: https://github.com/tvirelli/Ubicon
- Version: 0.1.0
- Screenshots (docs/store/images/), all 1280x800: 01-clients-table.png (icon overlay across the client list), 02-popup-overlay.png (extension popup with assignments), 03-assign-community.png (Community database picker), 04-assign-custom.png (Custom icon upload)
- Small promo tile: promo-tile-440x280.png (440x280)

## Name

Ubicon - Device Icons for UniFi

## Short description (Chrome, ≤132 chars)

Assign community and custom icons to devices UniFi doesn't recognize. Overlay only, never touches your UniFi settings.

## Category

Productivity / Tools

## Full description

Ubicon lets you assign icons to network clients that UniFi's own fingerprint
database doesn't recognize, using a community icon database or your own
images.

Open a client's "Change Icon" dialog in the UniFi web admin and Ubicon adds a
small icon next to the dialog title; click it to search the community
database or upload a custom icon. Once assigned, the icon appears everywhere
UniFi shows that client: the clients table, the client detail panel, the view
switcher, dashboard widgets, insights/flows, and side panes. A small badge
next to UniFi's own logo confirms Ubicon is active on the page.

Ubicon is a visual overlay only: it never calls the UniFi API and never
changes any UniFi setting. Icon assignments sync between your computers via
your browser account's sync; custom icons you upload stay local to that
machine (use the popup's Export/Import to move them). Works on unifi.ui.com
out of the box; add local UniFi controllers from the extension's Settings
page.

The device database is community-maintained and open to contributions
(PRs welcome, with optional credit for contributors who add a device).

## Permission justifications

- **storage, unlimitedStorage**: caches the community icon database and
  stores your icon assignments and any custom icons you upload, all locally
  in browser storage. `unlimitedStorage` accommodates custom icon uploads
  without hitting the default storage quota.
- **alarms**: schedules a periodic (roughly every 12 hours) background
  refresh of the community icon database so new devices show up without
  requiring a manual refresh.
- **scripting, optional host permissions (`*://*/*` requested at runtime,
  never bundled)**: lets you add your own local/self-hosted UniFi
  controller as a supported site from Settings. Ubicon only runs on
  unifi.ui.com by default; any additional origin is granted explicitly by
  the user, one at a time, and only for that origin.
- **contextMenus**: adds the right-click "Add Current Console" item on the
  toolbar icon, so you can grant Ubicon access to the local UniFi controller
  you're currently viewing without opening Settings.
- **activeTab**: reads the active tab's URL only when you open the popup or
  use that menu, to offer adding that console.
- **Host permission: unifi.ui.com**: this is where Ubicon's UI (the icon
  picker and header badge) is injected and where it reads client
  identity so it can place the right icon on the right client. Core to the
  extension's function.
- **Host permission: cdn.jsdelivr.net**: fetches the public,
  community-maintained icon database and icon images. No request carries any
  user or client data; it's a plain GET of static JSON/PNG files.
- **MAIN-world content script (bridge.content.ts)**: UniFi's web app hides
  each client's identity (its MAC address and display name) inside React's
  internal component state rather than the page's visible DOM/attributes.
  Ubicon runs a small script in the page's own JavaScript context (the
  "MAIN world," as opposed to the extension's isolated content-script world)
  solely to read that identity data straight off the UniFi page you're
  already viewing, so it knows which client each icon belongs to. This
  script never adds network requests, never sends anything to the
  extension's isolated world beyond MAC/name pairs, and never transmits
  anything off the page; it only reads data the page itself already
  rendered, for the sole purpose of placing icons correctly.

## Privacy statement

Ubicon does not collect any data, does not run analytics or telemetry, and
does not talk to any external service other than jsDelivr, which serves the
public community icon database (a static, unauthenticated file fetch with no
user data attached). Your icon assignments (which device has which icon, for
both community and custom icons) sync via your browser account's own sync
feature, which Ubicon does not operate. The custom icon image files you
upload stay in this browser's local storage only, since they cannot be
automatically re-fetched on another device; move them between machines with
Export/Import. Nothing about your network, clients, or UniFi controller is
ever sent anywhere.
