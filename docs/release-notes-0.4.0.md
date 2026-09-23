# Ubicon 0.4.0

Ubicon now tells you when a UniFi update changes the page in a way that
breaks it, and makes turning it on for a local console a single click.
Nothing changes in how icons are assigned or synced.

## New: a notice when UniFi's layout changes

Ubicon finds things on the UniFi page by their shape, and Ubiquiti can
change that shape in any update. Until now that meant icons silently
disappeared. From this version:

- The Ubicon mark next to UniFi's logo turns amber when the page no longer
  matches what Ubicon looks for. Click it for the details.
- The popup and the settings page show the same notice with two one-click
  reports: open a prefilled GitHub issue, or send a prefilled email. The
  report names the parts of the page that changed, your UniFi Network
  version, your browser and the Ubicon version. It never includes device
  names, MAC addresses, site names or your console's address.
- A false alarm is unlikely: the check waits for the page to settle and
  needs the same failure three times before it speaks, and it only looks at
  the Network application.
- The settings page also gets a permanent "Report a problem" section with
  the same two buttons, prefilled with your browser and version.

## New: one click to turn Ubicon on for a local console

- Open your console at its local address, click the Ubicon toolbar icon,
  and the popup offers to turn Ubicon on there. One click grants access to
  that one address and reloads the page. No typing.
- On Chrome and Edge the toolbar icon shows an amber dot while you are on a
  console that Ubicon is not yet enabled on, so you know before you click.
  The browser itself decides when to show the dot; Ubicon is not told which
  page you are on. Firefox does not offer this, so there the offer appears
  when you click the icon.
- The old "Add this console" button, which appeared in the popup on any
  website, is gone. The settings page still takes an address by hand.

## Changed

- Ubicon now reads the UniFi Network version from the dashboard and
  settings pages and keeps one set of page selectors per version, so a
  future UniFi change can be handled without breaking older consoles.
  Tested on Network 10.6.106.
- When a GitHub sync setup step fails, the message names the repository it
  was about.
- The popup list updates while it is open when a sync changes your
  assignments in the background.
- The "GitHub sync is on in another browser" notice appears as soon as it
  arrives, without reopening the popup or the settings page.

## Permissions

- Chrome and Edge: one new permission, `declarativeContent`, for the amber
  dot on the toolbar icon. It carries no warning because it gives Ubicon no
  access: the browser evaluates the rule and swaps the icon on its own.
- Firefox: no change.
- No new host permissions. Access to a local console is still granted only
  when you ask for it, one address at a time.
