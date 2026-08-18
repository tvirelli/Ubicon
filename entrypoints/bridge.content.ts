import { resolveIconMacs } from '../content/bridge-core';

// Runs in the page's MAIN world (not the extension's isolated world), so it
// can see React's internal fiber props on the live DOM nodes. It never talks
// to the extension directly — the isolated-world content script asks it to
// run via a DOM CustomEvent and reads the result back the same way, since
// that's the only channel available between the two worlds.
export default defineContentScript({
  matches: ['https://unifi.ui.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    document.addEventListener('ubicon:resolve', () => {
      const n = resolveIconMacs(document);
      document.dispatchEvent(new CustomEvent('ubicon:resolved', { detail: { n } }));
    });
  },
});
