# Ubicon 0.1.1

Firefox bug fix. No functional change on Chrome or Edge.

## Fixed

- Firefox: the popup's "Add this console" button did nothing when clicked.
  Firefox only allows a permission request while the click is being handled
  synchronously, and Ubicon read from storage before asking, which Firefox
  treats as leaving the click handler. The request now comes first. The same
  fix covers the Settings form and the toolbar icon's "Add Current Console"
  menu item.
- The popup now shows the error text in its status line if adding a console
  fails, instead of silently doing nothing.

## Browsers

Published for Firefox. Chrome and Edge remain on 0.1.0, where this bug did
not occur; they will pick up the change in the next release.
