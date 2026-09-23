import { browser } from 'wxt/browser';
import { loadOverlayMap, hydrateNames, mergeNames, paintAll, setLastClickedMac } from '../content/state';
import { ensureModalButton, ensureHeaderBadge, setHeaderBadgeState, setLayoutBreak } from '../content/panel';
import { checkHooks, LayoutMonitor, readShellVersion, readUnifiVersion } from '../content/layout-check';
import { activateProfile, activeProfileName, getSelectors, isNetworkPage } from '../content/selectors';
import { clearBreak, loadBreak, saveBreak, recallShellVersion, recallUnifiVersion, rememberShellVersion, rememberUnifiVersion } from '../shared/layout-state';

export default defineContentScript({
  matches: ['https://unifi.ui.com/*'],
  runAt: 'document_idle',
  async main() {
    // On a local console (a dynamically registered origin), the toolbar icon
    // may be showing "available here"; this tab has Ubicon running.
    if (location.hostname !== 'unifi.ui.com') browser.runtime.sendMessage({ type: 'console-active' }).catch(() => {});
    const [map0] = await Promise.all([loadOverlayMap(), hydrateNames()]);
    let map = map0;

    // Selects the same icon-shaped <img>s sweepAllIcons treats as candidates
    // (content/state.ts): used only to fingerprint the current candidate
    // set, not to paint anything here.

    // Cheap signal for "did the set of icons worth resolving actually
    // change since the last repaint": the count plus each candidate's src,
    // concatenated. Good enough to detect additions/removals/src swaps
    // without hashing: collisions would only cost a skipped resolve, never
    // a wrong paint, since paintAll above already ran against fresh DOM.
    function candidateFingerprint(): string {
      const imgs = document.querySelectorAll<HTMLImageElement>(getSelectors().iconImage);
      let fp = imgs.length + '|';
      for (const img of imgs) fp += img.src + ';';
      return fp;
    }

    // Layout-change detection (content/layout-check.ts): after each repaint,
    // ask whether the hooks Ubicon paints through still match, and only
    // after repeated failures turn the badge amber and store the break for
    // the popup and options page to show.
    const monitor = new LayoutMonitor({ startedAt: Date.now() });
    // A break stored by an earlier page load is only as good as this load
    // can confirm: a healthy check clears it, a repeat re-declares it.
    void loadBreak().then(stored => { if (stored) monitor.assumeDeclared(stored.signature); });
    const consoleKind = location.hostname === 'unifi.ui.com' ? 'cloud' as const : 'local' as const;
    let unifiVersion = 'unknown';
    let shell = 'unknown';
    // Which selector profile (content/selectors.ts) this page gets: by the
    // remembered Network version when there is one, by feature detection
    // until then. Re-chosen whenever the version becomes known.
    activateProfile(document, unifiVersion);
    void recallUnifiVersion(location.origin).then(v => {
      if (unifiVersion === 'unknown' && v !== 'unknown') { unifiVersion = v; activateProfile(document, v); }
    });
    void recallShellVersion(location.origin).then(v => { if (shell === 'unknown') shell = v; });
    const watchLayout = () => {
      // Only the Network application has anything for Ubicon to paint or to
      // check; unifi.ui.com also serves the console picker and other apps.
      if (!isNetworkPage(location.pathname)) return;
      const seenVersion = readUnifiVersion(document);
      if (seenVersion !== 'unknown' && seenVersion !== unifiVersion) {
        unifiVersion = seenVersion;
        activateProfile(document, seenVersion);
        void rememberUnifiVersion(location.origin, seenVersion);
      }
      const seenShell = readShellVersion(document);
      if (seenShell !== 'unknown' && seenShell !== shell) {
        shell = seenShell;
        void rememberShellVersion(location.origin, seenShell);
      }
      const check = checkHooks(document);
      const seen = monitor.observe(check, Date.now());
      if (seen) {
        const brk = {
          signature: seen.signature, hooks: seen.hooks, unifiVersion, shell, profile: activeProfileName(),
          console: consoleKind, path: location.pathname, firstSeen: seen.at, lastSeen: seen.at,
        };
        // One line for anyone looking in DevTools: what failed, where, on what.
        console.info('[Ubicon] layout change detected', { hooks: seen.hooks, page: location.pathname, network: unifiVersion, shell, profile: brk.profile });
        setLayoutBreak(brk);
        setHeaderBadgeState('warn');
        void saveBreak(brk);
      } else if (monitor.recovered(check)) {
        setLayoutBreak(null);
        setHeaderBadgeState('ok');
        void clearBreak();
      }
    };

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
        try { watchLayout(); } catch {}
        // Ask the MAIN-world bridge (entrypoints/bridge.content.ts) to
        // (re)resolve any icons it can key off React's internal props. It
        // replies with 'ubicon:resolved'. Only worth firing when the
        // candidate situation actually changed since the last repaint:
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
      const row = (e.target as Element).closest?.(getSelectors().clientRow);
      if (row) setLastClickedMac(row.getAttribute('data-row-id')!);
    }, true);

    new MutationObserver(repaint).observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'],
    });

    // Only repaint when the bridge actually stamped something new, or its
    // harvested name/mac pairs taught us something we didn't know: a
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
    // Mutations drive repaints; a broken page that has gone quiet would
    // otherwise never reach the monitor's third check.
    setInterval(() => { try { watchLayout(); } catch {} }, 5_000);
    repaint();
  },
});
