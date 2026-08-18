// Pure resolver core for the MAIN-world React props bridge. No browser
// extension APIs here — this file is exercised directly by unit tests under
// happy-dom, and is also imported (unmodified) by the MAIN-world content
// script entrypoint that actually has access to React's internal fiber
// props on the live UniFi page.
//
// React (in dev and prod builds alike) stashes the props object it last
// rendered a DOM node with on the node itself, under a property whose name
// starts with "__reactProps$" (the suffix is a per-render random id). When
// present, that object is often a far more reliable way to recover a
// client's MAC than scraping ancestor attributes/text — UniFi's own
// component tree already carries the client record, this just reads it.

const MAC_EXACT_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

function isValidMac(value: unknown): value is string {
  return typeof value === 'string' && MAC_EXACT_RE.test(value);
}

// A plain, non-array, non-React-element object — i.e. a plausible "record"
// value worth checking for a nested .mac field. React elements are tagged
// with a $$typeof symbol/string; we skip those so we never walk back into
// the render tree itself.
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !('$$typeof' in value);
}

// Reads whatever mac-shaped value it can off a props object. Deliberately
// unguarded internally — UniFi's props can carry arbitrary getters, and a
// throwing one anywhere in here (direct paths or the shallow scan) is the
// caller's problem to contain, not this function's. See findReactMac, which
// wraps each call so a bad ancestor is skipped rather than aborting the walk.
function extractMacFromProps(props: unknown): string | undefined {
  if (!isPlainRecord(props)) return undefined;

  const direct = [
    props.mac,
    (props.client as Record<string, unknown> | undefined)?.mac,
    (props.data as Record<string, unknown> | undefined)?.mac,
    (props.item as Record<string, unknown> | undefined)?.mac,
    (props.row as Record<string, unknown> | undefined)?.mac,
  ];
  for (const v of direct) if (isValidMac(v)) return v.toLowerCase();

  for (const v of Object.values(props)) {
    if (isPlainRecord(v) && isValidMac(v.mac)) return (v.mac as string).toLowerCase();
  }
  return undefined;
}

function reactPropsOf(el: Element): unknown {
  const propName = Object.getOwnPropertyNames(el).find(n => n.startsWith('__reactProps$'));
  return propName ? (el as unknown as Record<string, unknown>)[propName] : undefined;
}

// Walks up from an icon's parent looking for the nearest ancestor carrying
// a React props object with a recoverable MAC. First valid MAC wins.
//
// Each ancestor's extraction is wrapped individually: UniFi's props objects
// can carry arbitrary getters, and a throwing one at one level must not
// stop the walk from reaching a perfectly good ancestor farther up — it
// just means this particular level contributed nothing.
function findReactMac(start: Element): string | undefined {
  let el: Element | null = start.parentElement;
  let levels = 0;
  while (el && el !== document.body && levels < 8) {
    try {
      const mac = extractMacFromProps(reactPropsOf(el));
      if (mac) return mac;
    } catch {
      // Throwing getter on this ancestor's props — treat as "nothing here"
      // and keep walking; don't let it take down the whole resolution.
    }
    el = el.parentElement;
    levels++;
  }
  return undefined;
}

// Tracks, per icon <img>, the src it had the last time it was processed.
// Replaces separate "already stamped" / "already tried and failed" caches:
// a virtualized list can and does reuse the same <img> node for a different
// client by swapping its src, and neither of those older caches would ever
// revisit a node once it had a verdict. Keying revalidation off src instead
// means a genuine client swap (src changes to a different remote URL) is
// always re-walked, while our own painting (rewriting src to a data: URI)
// is never mistaken for a client swap.
const lastProcessedSrc = new WeakMap<Element, string>();

function needsProcessing(img: Element, src: string): boolean {
  const stored = lastProcessedSrc.get(img);
  if (stored === undefined) return true;
  return src !== stored && !src.startsWith('data:');
}

// Sweeps for icon-shaped <img>s, stamping each with the client MAC recovered
// from React's internal props (data-ubicon-mac). Returns the number of imgs
// stamped this call (a fresh mac written, whether or not it matches what
// was there before — simplicity over precision, since a stamp write is rare
// and cheap for callers to react to).
export function resolveIconMacs(root: ParentNode): number {
  const candidates = new Set<HTMLImageElement>();
  for (const img of root.querySelectorAll<HTMLImageElement>('img[src*="fingerprint/"]')) candidates.add(img);
  for (const img of root.querySelectorAll<HTMLImageElement>('img[src*="/clients/photos/"]')) candidates.add(img);
  for (const img of root.querySelectorAll<HTMLImageElement>('img[data-ubicon]')) candidates.add(img);

  let stamped = 0;
  for (const img of candidates) {
    // One malformed candidate (e.g. some unexpected DOM/props shape we
    // haven't anticipated) must never abort the rest of the pass.
    try {
      const src = img.src;
      if (!needsProcessing(img, src)) continue;

      img.removeAttribute('data-ubicon-mac');
      const mac = findReactMac(img);
      if (mac) {
        img.setAttribute('data-ubicon-mac', mac);
        stamped++;
      }
      lastProcessedSrc.set(img, src);
    } catch {
      // Skip this candidate; keep processing the rest of the pass.
    }
  }
  return stamped;
}
