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
      });
    };

    document.addEventListener('click', e => {
      const row = (e.target as Element).closest?.('tr[data-row-id]');
      if (row) setLastClickedMac(row.getAttribute('data-row-id')!);
    }, true);

    new MutationObserver(repaint).observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'],
    });

    browser.storage.onChanged.addListener(async () => { map = await loadOverlayMap(); repaint(); });
    repaint();
  },
});
