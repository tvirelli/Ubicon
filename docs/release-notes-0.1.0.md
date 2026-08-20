# Ubicon 0.1.0

First public release of Ubicon, a cross-browser extension that adds device
icons to the UniFi Network web admin for clients UniFi's own fingerprint
database does not recognize.

## What it does

- Adds an icon control to the UniFi "Change Icon" dialog. Click it to search
  the community device database or upload your own image.
- Once assigned, an icon follows the client everywhere UniFi shows it: the
  clients table, the client detail panel, the view switcher, dashboard
  widgets, insights and flows, and side panes.
- A small badge beside UniFi's own logo confirms Ubicon is active on the page.
- Works on unifi.ui.com out of the box. Local and self-hosted controllers can
  be added from Settings, or with the right-click "Add Current Console" item
  on the toolbar icon.
- Export and Import buttons in the popup move your custom icons between
  machines.

## How it works

Ubicon is a read-only visual overlay. It never calls the UniFi API and never
changes a UniFi setting. Icon assignments sync through your browser account;
custom icon images stay local to the machine that uploaded them. The community
icon database is fetched as static files from jsDelivr, with no user data
attached to any request.

## Community database

This release ships alongside a community device database of 64 popular devices
that UniFi does not fingerprint, spanning 3D printers, smart locks, video
doorbells, e-readers, handheld and retro game consoles, network and industrial
gear, and more. The database is open to contributions at
https://github.com/tvirelli/Ubicon-DB.

## Browsers

Packaged for Chrome, Edge, and Firefox. Brave and other Chromium browsers use
the Chrome package.
