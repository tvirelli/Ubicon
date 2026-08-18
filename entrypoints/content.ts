import { browser } from 'wxt/browser';
import { loadOverlayMap, hydrateNames, paintAll, setLastClickedMac } from '../content/state';
import { ensureModalButton, ensureHeaderBadge } from '../content/panel';

export default defineContentScript({
  matches: ['https://unifi.ui.com/*'],
  runAt: 'document_idle',
  async main() {
    const [map0] = await Promise.all([loadOverlayMap(), hydrateNames()]);
    let map = map0;
    let scheduled = false;
    const repaint = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        paintAll(map, document);
        try { ensureModalButton(document); ensureHeaderBadge(document); } catch {}
        // Ask the MAIN-world bridge (entrypoints/bridge.content.ts) to
        // (re)resolve any icons it can key off React's internal props. It
        // replies with 'ubicon:resolved'; harmless to fire every repaint
        // since the bridge's own resolver is stamp/WeakSet-guarded and cheap.
        document.dispatchEvent(new CustomEvent('ubicon:resolve'));
      });
    };

    document.addEventListener('click', e => {
      const row = (e.target as Element).closest?.('tr[data-row-id]');
      if (row) setLastClickedMac(row.getAttribute('data-row-id')!);
    }, true);

    new MutationObserver(repaint).observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'],
    });

    // Only repaint when the bridge actually stamped something new — a
    // no-op resolve (n === 0) means nothing changed that painting cares
    // about, so re-triggering here would just loop the dispatch above.
    document.addEventListener('ubicon:resolved', e => {
      if ((e as CustomEvent).detail?.n > 0) repaint();
    });

    browser.storage.onChanged.addListener(async () => { map = await loadOverlayMap(); repaint(); });
    repaint();
  },
});
