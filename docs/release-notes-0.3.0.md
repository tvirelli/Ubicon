# Ubicon 0.3.0

Adds optional GitHub sync. Everything else works as before, and nothing
changes for you unless you turn the new feature on. There was no 0.2.0
release.

## New: GitHub sync (optional)

Keep your icon assignments and your custom icons in a private GitHub
repository that you own, and every browser you connect stays in step through
it.

- No item limit. Browser sync storage stops at about 500 assignments; a
  connected browser does not.
- Custom icons sync too. Until now they stayed on the machine where you
  uploaded them.
- Works across Chrome, Edge and Firefox, and works whether or not you sign in
  to your browser.
- A free GitHub account is enough. Ubicon has no server of its own and its
  author never sees your data.

Setup takes about three minutes. Open the options page and click **Set up
GitHub sync**. The wizard opens each GitHub page already filled in, shows you
what to click, and checks your access token before anything is saved. Other
browsers join by pasting a setup code.

Ubicon only accepts an access token that is limited to the one sync
repository. A token that can reach any of your other repositories is refused,
and the wizard shows how to fix it on GitHub without starting over.

Each browser is connected on its own. A browser you have not connected keeps
working exactly as it did. If you use your browser vendor's sync, your other
browsers show a notice offering to connect; it can be dismissed.

A token created with read-only access gives a view-only browser: it shows
your icons and receives your changes, and cannot change anything.

See the README for the full instructions and the privacy policy for exactly
what is sent where.

## Changed

- The options page now opens in its own tab.
- Backup files written by Export are version 2 and record when each
  assignment last changed. Backups from earlier versions still import.
- Removing an assignment or importing a backup from the popup now goes
  through the same path as every other change, which prevents a lost change
  when several happen at once.
- Firefox: the minimum version is now 140 (142 on Android). The extension
  declares its data collection permissions: none are required, and one
  optional category is requested only when you turn on GitHub sync.

## Fixed

- Firefox review warnings: the icon picker and the extension pages no longer
  build any markup from strings.
- The popup could briefly show a row twice when its list was redrawn while an
  earlier redraw was still loading icons.

## Permissions

No new required permissions. Access to `api.github.com` is optional and is
requested only at the moment you set up GitHub sync, so updating from 0.1.x
does not prompt you for anything.
