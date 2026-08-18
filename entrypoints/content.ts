import { browser } from 'wxt/browser';
import { loadOverlayMap, hydrateNames, mergeNames, paintAll, setLastClickedMac } from '../content/state';
import { ensureModalButton, ensureHeaderBadge } from '../content/panel';

export default defineContentScript({
  matches: ['https://unifi.ui.com/*'],
  runAt: 'document_idle',
  async main() {
    const [map0] = await Promise.all([loadOverlayMap(), hydrateNames()]);
    let map = map0;

    // Selects the same icon-shaped <img>s sweepAllIcons treats as candidates
    // (content/state.ts) — used only to fingerprint the current candidate
    // set, not to paint anything here.
    const CANDIDATE_SELECTOR = 'img[src*="fingerprint/"], img[src*="/clients/photos/"], img[data-ubicon]';

    // Cheap signal for "did the set of icons worth resolving actually
    // change since the last repaint": the count plus each candidate's src,
    // concatenated. Good enough to detect additions/removals/src swaps
    // without hashing — collisions would only cost a skipped resolve, never
    // a wrong paint, since paintAll above already ran against fresh DOM.
    function candidateFingerprint(): string {
      const imgs = document.querySelectorAll<HTMLImageElement>(CANDIDATE_SELECTOR);
      let fp = imgs.length + '|';
      for (const img of imgs) fp += img.src + ';';
      return fp;
    }

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let lastFingerprint: string | undefined;
    // MutationObserver can fire dozens of times per second while UniFi's
    // React app re-renders a table; a ~200ms trailing debounce collapses
    // that burst into one repaint instead of one per animation frame.
    const repaint = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        paintAll(map, document);
        try { ensureModalButton(document); ensureHeaderBadge(document); } catch {}
        // Ask the MAIN-world bridge (entrypoints/bridge.content.ts) to
        // (re)resolve any icons it can key off React's internal props. It
        // replies with 'ubicon:resolved'. Only worth firing when the
        // candidate situation actually changed since the last repaint —
        // the bridge's own resolver is stamp/WeakSet-guarded and cheap, but
        // there's no point re-running it every debounced repaint when
        // nothing painting cares about has moved.
        const fingerprint = candidateFingerprint();
        if (fingerprint !== lastFingerprint) {
          lastFingerprint = fingerprint;
          document.dispatchEvent(new CustomEvent('ubicon:resolve'));
        }
      }, 200);
    };

    document.addEventListener('click', e => {
      const row = (e.target as Element).closest?.('tr[data-row-id]');
      if (row) setLastClickedMac(row.getAttribute('data-row-id')!);
    }, true);

    new MutationObserver(repaint).observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'],
    });

    // Only repaint when the bridge actually stamped something new, or its
    // harvested name/mac pairs taught us something we didn't know — a
    // no-op resolve (n === 0, no new pairs) means nothing changed that
    // painting cares about, so re-triggering here would just loop the
    // dispatch above. mergeNames re-merging identical pairs on a later
    // pass reports no change, which keeps this loop-safe.
    document.addEventListener('ubicon:resolved', e => {
      const detail = (e as CustomEvent).detail ?? {};
      const changed = mergeNames(detail.pairs ?? []);
      if (detail.n > 0 || changed) repaint();
    });

    browser.storage.onChanged.addListener(async () => { map = await loadOverlayMap(); repaint(); });
    repaint();
  },
});
