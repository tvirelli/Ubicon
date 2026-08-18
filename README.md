# Ubicon — Device Icons for UniFi

Browser extension (Chrome, Edge, Firefox, Brave) that lets you assign icons to
network clients that UniFi's fingerprint database doesn't recognize — from a
community database or your own images.

- Open a client in the UniFi web admin and use its own "Change Icon" dialog —
  Ubicon adds a small icon next to the dialog title. Click it to search the
  community database or upload a custom icon.
- Icons show up everywhere UniFi shows them: the clients table, the client
  detail panel, the view switcher, dashboard widgets, insights/flows, and side
  panes — a layered keying system matches each client by MAC first, falling
  back to name matching on pages that don't expose one.
- A small badge next to UniFi's own logo in the header confirms Ubicon is
  active on the page.
- Overlay only: Ubicon never calls the UniFi API or changes UniFi settings.
- Assignments sync between your computers via your browser account; custom
  icons stay local (move them with Export/Import backup).
- Works on unifi.ui.com out of the box; add local consoles in Settings.

Device database: [Ubicon-DB](https://github.com/tvirelli/Ubicon-DB) — PRs
welcome, with optional credit for contributors who add a device.

## License

MIT — see [LICENSE](LICENSE). The device database is separately MIT-licensed
at [tvirelli/Ubicon-DB](https://github.com/tvirelli/Ubicon-DB).
