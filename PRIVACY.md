# Ubicon Privacy Policy

Last updated: 2026-09-21

Ubicon ("the extension") is a visual overlay for the UniFi Network web admin.
This policy explains, in plain terms, what the extension does and does not do
with your data.

## Summary

Ubicon does not collect, transmit, sell, or share any personal or network
data. There are no analytics, no telemetry, and no tracking of any kind. The
extension has no backend server of its own.

One feature is an exception, and it is off unless you turn it on: GitHub
sync. If you set it up, your icon assignments and custom icons are saved to a
private repository in your own GitHub account, using an access token you
create yourself. They go to GitHub and nowhere else. The author of Ubicon
receives nothing and cannot see that repository. See "GitHub sync" below.

## What Ubicon stores, and where

- **Icon assignments** (which client gets which icon) are saved in your
  browser's sync storage. This lets the same assignments follow you between
  computers where you are signed in to the same browser profile. This sync is
  operated by your browser vendor, not by Ubicon.
- **Custom icons you upload** are stored in your browser's local storage on
  that one machine only. They are not synced automatically unless you turn on
  GitHub sync. You can also move them between machines with the Export and
  Import buttons in the extension popup.
- **A cached copy of the community icon database** (a public list of device
  names and icon images) is stored locally so the extension works quickly and
  offline. It contains no user data.

All of this data stays on your own devices and in your own browser account,
unless you turn on GitHub sync.

## GitHub sync (optional, off by default)

If you never set up GitHub sync, nothing in this section applies to you and
the extension never contacts GitHub.

If you do set it up:

- **What is sent.** Your icon assignments (the MAC address of each device you
  assigned an icon to, which icon it got, and any label you typed for a custom
  icon) and your custom icon images. Nothing else: no IP addresses, no device
  names read from UniFi, no console addresses, nothing from UniFi itself.
- **Where it goes.** To one private repository in your own GitHub account,
  through GitHub's API at api.github.com. It is stored there as a readable
  file, not encrypted, so keep that repository private. GitHub keeps a history
  of every change. GitHub's own privacy policy applies to what is stored with
  them.
- **The access token.** You create it on GitHub and paste it into the
  extension. It is stored in your browser's local storage on that machine, is
  sent only to GitHub, and is never placed in browser sync storage. Ubicon
  refuses any token that can reach a repository other than the one used for
  sync, so the token it holds can never touch the rest of your GitHub account.
- **The setup code.** To connect another browser, Ubicon can show you a setup
  code. It contains your token. Treat it like a password.
- **Your other browsers.** When you connect a browser, Ubicon leaves a small
  note in browser sync storage holding the repository name, the time, and a
  label such as "Chrome on Windows". It never holds the token. If you use your
  browser vendor's sync, your other browsers use it to suggest connecting.
- **Turning it off.** Disconnect in the extension's options removes the token
  from that browser and stops all contact with GitHub from it. Your repository
  is never deleted by Ubicon; delete it, and the token, on GitHub whenever you
  like.

In browsers connected to GitHub sync, assignments are kept in local storage
and in your repository, and are no longer written to browser sync storage.

## Network requests

Apart from GitHub sync, Ubicon makes exactly one kind of outbound request: a
plain, unauthenticated GET to the jsDelivr content delivery network to
download the public community icon database and its icon images. These
requests carry no user data, no
identifiers, and nothing about your network or clients. They are identical for
every user.

Ubicon never calls the UniFi API and never sends anything about your network,
your clients, or your UniFi controller anywhere.

## Reading the UniFi page

To place the correct icon on the correct client, Ubicon reads the client's
identity (its MAC address and display name) directly from the UniFi web page
you are already viewing. This information is used only, and immediately, to
match an icon to a client on that same page. It is never stored beyond the
icon assignment you choose to make, and never transmitted off the page.

## Permissions

The extension requests only the permissions needed for the above: local and
synced storage for assignments and cached icons, access to unifi.ui.com (and
any local UniFi controller you explicitly add yourself) to draw its interface,
and access to jsDelivr to fetch the public icon database. Optional host
permissions for self-hosted controllers are requested one origin at a time and
only when you choose to add them. Access to api.github.com is likewise
optional and is requested only at the moment you set up GitHub sync.

## Contact

Ubicon is a personal open-source project by Tony Virelli. Questions or
concerns can be raised as an issue at
https://github.com/tvirelli/Ubicon/issues.
