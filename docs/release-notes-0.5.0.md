# Ubicon 0.5.0

The list of assigned devices moves out of the toolbar popup and onto the
settings page, where it has room to grow. Nothing changes in how icons are
assigned or synced, and no new permissions are asked for.

## New: an Assignments page

- The settings page now has two tabs, Assignments and Settings. The
  Assignments tab lists every device you have assigned, sorted by name,
  with a search box that filters as you type on the device name, the MAC
  address or the icon label.
- Each row shows the icon, the database name or your custom label, the
  MAC address and a community or custom badge. Remove still takes two
  clicks, and a view-only GitHub token still locks it.
- Icons appear as they are read, so a list of a few hundred devices shows
  up at once instead of after the last one loads.

## Changed: the popup

- The popup no longer lists devices. It says how many are assigned and has
  a Manage Assignments button that opens the Assignments tab. Consoles,
  GitHub sync, the layout notice, Refresh database and the backup buttons
  are where they were.
- The popup footer shows the installed version.

## Permissions

- No change on any browser.
