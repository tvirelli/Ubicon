# Ubicon Privacy Policy

Last updated: 2026-08-20

Ubicon ("the extension") is a visual overlay for the UniFi Network web admin.
This policy explains, in plain terms, what the extension does and does not do
with your data.

## Summary

Ubicon does not collect, transmit, sell, or share any personal or network
data. There are no analytics, no telemetry, and no tracking of any kind. The
extension has no backend server of its own.

## What Ubicon stores, and where

- **Icon assignments** (which client gets which icon) are saved in your
  browser's sync storage. This lets the same assignments follow you between
  computers where you are signed in to the same browser profile. This sync is
  operated by your browser vendor, not by Ubicon.
- **Custom icons you upload** are stored in your browser's local storage on
  that one machine only. They are not synced automatically. You can move them
  between machines with the Export and Import buttons in the extension popup.
- **A cached copy of the community icon database** (a public list of device
  names and icon images) is stored locally so the extension works quickly and
  offline. It contains no user data.

All of this data stays on your own devices and in your own browser account.

## Network requests

Ubicon makes exactly one kind of outbound request: a plain, unauthenticated
GET to the jsDelivr content delivery network to download the public community
icon database and its icon images. These requests carry no user data, no
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
only when you choose to add them.

## Contact

Ubicon is a personal open-source project by Tony Virelli. Questions or
concerns can be raised as an issue at
https://github.com/tvirelli/Ubicon/issues.
