# Ubicon - Device Icons for UniFi

Browser extension (Chrome, Edge, Firefox, Brave) that lets you assign icons to
network clients that UniFi's fingerprint database doesn't recognize, using a
community database or your own images.

- Open a client in the UniFi web admin and use its own "Change Icon" dialog:
  Ubicon adds a small icon next to the dialog title. Click it to search the
  community database or upload a custom icon.
- Icons show up everywhere UniFi shows them: the clients table, the client
  detail panel, the view switcher, dashboard widgets, insights/flows, and side
  panes. A layered keying system matches each client by MAC first, falling
  back to name matching on pages that don't expose one.
- A small badge next to UniFi's own logo in the header confirms Ubicon is
  active on the page.
- Overlay only: Ubicon never calls the UniFi API or changes UniFi settings.
- Assignments sync between your computers via your browser account; custom
  icons stay local (move them with Export/Import backup).
- Optional GitHub sync: keep assignments and custom icons in a private
  GitHub repo you own, with no item limit, across any mix of browsers. Works
  whether or not you sign in to your browser. See [GitHub sync](#github-sync).
- Works on unifi.ui.com out of the box; add local consoles in Settings.

Device database: [Ubicon-DB](https://github.com/tvirelli/Ubicon-DB); PRs
welcome, with optional credit for contributors who add a device.

## Install

- Chrome / Brave: [Chrome Web Store](https://chromewebstore.google.com/detail/ubicon-device-icons-for-u/gceohejefeclhbbbkbifhpeonkfdgnkm)
- Edge: [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/jddpmahejanjljlgobeellacbgppbdff)
- Firefox: [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/ubicon-device-icons-for-unifi/)
- Manual: zips for each browser are attached to every [GitHub release](https://github.com/tvirelli/Ubicon/releases).

## GitHub sync

Optional, and off unless you set it up. Your icon assignments and custom
icons are saved to a private repository in your own GitHub account, and every
browser you connect stays in step through it. There is no item limit, custom
icons sync too, and it works across Chrome, Edge and Firefox, signed in to the
browser or not. A free GitHub account is enough. The author of Ubicon never
sees your data; see the [privacy policy](PRIVACY.md). The full reference,
with every question we could think of, is the
[GitHub sync guide](https://www.tonyvirelli.com/ubicon/github-sync.html).

### First browser (about 3 minutes)

Open the Ubicon options page and click **Set up GitHub sync**. The wizard
walks you through these three steps, with pictures and buttons that open the
right GitHub page already filled in:

1. **Create your private repo.** Click Open GitHub, then click **Create
   repository** on the page that opens. Everything is filled in: the name
   `ubicon-sync`, and Private.
2. **Create your access token.** Click Open GitHub. On the GitHub page, change
   **Repository access** to **Only select repositories** and pick
   `ubicon-sync`. This is the one thing GitHub cannot fill in for you. Then
   click **Generate token** and copy the token. GitHub shows it only once.
3. **Paste your token** into Ubicon and click **Connect**. Allow the browser
   prompt for `api.github.com`. Ubicon checks the token, uploads your icons,
   and shows a setup code for your other browsers.

Ubicon refuses a token that can reach any repository other than
`ubicon-sync`. If that happens, open the token on GitHub, click Edit, set
Repository access to Only select repositories, pick `ubicon-sync`, save, and
click Connect again. The same token keeps working.

### Every other browser

Install Ubicon, open its options page, click **I have a setup code**, paste
the code from the first browser (Options, Show setup code) and click Connect.
The setup code contains your token, so treat it like a password. Anything
already assigned in that browser is merged in; for a device assigned in both
places the newest change wins.

Changes reach your other browsers within about five minutes, or right away
with **Sync now**. Each browser is connected on its own: a browser you have
not connected keeps working exactly as before.

### Sharing with other people

Create one token per person on GitHub (same settings as above) and give them a
setup code made from it. To remove someone, delete their token at
<https://github.com/settings/personal-access-tokens>; nobody else is affected.
A token created with Contents set to **Read-only** gives a view-only browser:
it shows your icons and receives your changes, and cannot change anything.

### Turning it off

Options, **Disconnect**. That browser forgets the token, stops contacting
GitHub and keeps its icons. Your repository is never deleted by Ubicon; delete
it, and the token, on GitHub if you no longer want them.

### What is in the repository

`ubicon.json` lists each assigned device by MAC address with its icon, and
`icons/` holds your custom icons as PNG files. It is a plain, readable file, so
keep the repository private. Every sync is one commit, so the history shows
what changed and when. Please do not edit `ubicon.json` by hand; the extension
merges by timestamp and may undo your edit.

## License

MIT, see [LICENSE](LICENSE). The device database is separately MIT-licensed
at [tvirelli/Ubicon-DB](https://github.com/tvirelli/Ubicon-DB).
